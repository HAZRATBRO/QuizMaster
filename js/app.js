import { parseQuestions } from './parser.js';
import { parseAnswerKey } from './answerkey.js';
import { readPdf, registerDoc, hasDoc, openStoredDoc, drawSnippet } from './pdfview.js';
import * as db from './store.js';

const app = document.getElementById('app');
const LETTERS = ['1', '2', '3', '4', '5'];

const state = {
  view: 'library',
  quizzes: [],
  attempts: [],
  quiz: null,
  attempt: null,
  importing: null, // { label, pct }
  importError: '',
  importSummary: null,
  confirmDelete: null,
  editor: { filter: 'all', display: 'text', editing: null, confirmDeleteQ: null, keyMsg: '', confirmClear: false },
  exam: { display: 'text', modal: null, paletteOpen: false },
  result: { filter: 'all' },
  setup: null,
};

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hasAnswer = (q) => q.answer !== null && q.answer !== undefined;
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const round2 = (n) => Math.round(n * 100) / 100;

function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function fmtDuration(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
}

let toastTimer = null;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

function stemHtml(q) {
  return q.stem
    .map((b) => {
      if (b.type === 'p') return `<p>${esc(b.text)}</p>`;
      const head = b.rows.length > 1 && !b.rows[0].some((c) => /^(\d{1,2}|[A-H])[.)]/.test(c));
      const rows = b.rows
        .map((r, i) => `<tr${i === 0 && !head ? ' class="plain"' : ''}>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('');
      return `<div class="q-table-wrap"><table class="${head ? 'has-head' : 'no-head'}">${rows}</table></div>`;
    })
    .join('');
}

function stemToText(stem) {
  return stem.map((b) => (b.type === 'p' ? b.text : b.rows.map((r) => r.join(' | ')).join('\n'))).join('\n');
}

function textToStem(text) {
  const blocks = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const last = blocks[blocks.length - 1];
    if (line.includes(' | ')) {
      const cells = line.split(' | ').map((c) => c.trim());
      if (last && last.type === 'table') last.rows.push(cells);
      else blocks.push({ type: 'table', rows: [cells] });
    } else blocks.push({ type: 'p', text: line });
  }
  return blocks;
}

async function saveQuiz(quiz) {
  quiz.updatedAt = Date.now();
  await db.put('quizzes', quiz);
  const i = state.quizzes.findIndex((q) => q.id === quiz.id);
  if (i >= 0) state.quizzes[i] = quiz;
  else state.quizzes.unshift(quiz);
}

async function saveAttempt(attempt) {
  await db.put('attempts', attempt);
  const i = state.attempts.findIndex((a) => a.id === attempt.id);
  if (i >= 0) state.attempts[i] = attempt;
  else state.attempts.unshift(attempt);
}

async function ensureDoc(quiz) {
  if (!quiz || !quiz.hasPdf) return false;
  if (hasDoc(quiz.id)) return true;
  const rec = await db.get('pdfs', quiz.id);
  if (!rec) return false;
  await openStoredDoc(quiz.id, rec.bytes);
  return true;
}

/** Fills every [data-snippet] placeholder currently on screen. */
function hydrateSnippets(root = app) {
  const quiz = state.quiz;
  const els = [...root.querySelectorAll('[data-snippet]:not([data-drawn])')];
  if (!els.length || !quiz) return;
  const draw = async (el) => {
    el.dataset.drawn = '1';
    const q = quiz.questions.find((x) => x.id === el.dataset.snippet);
    try {
      const ok = (await ensureDoc(quiz)) && (await drawSnippet(el, quiz.id, q.regions));
      if (!ok) el.innerHTML = '<div class="snippet-missing">The original PDF is not stored for this test, so only the text version is available.</div>';
    } catch (err) {
      console.error(err);
      el.innerHTML = '<div class="snippet-missing">Could not draw this part of the PDF. Switch to the text view.</div>';
    }
  };
  if (!('IntersectionObserver' in window) || els.length < 4) {
    els.forEach(draw);
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      draw(e.target);
    }
  }, { rootMargin: '600px 0px' });
  els.forEach((el) => io.observe(el));
}

// ---------- scoring ----------

function scoreAttempt(quiz, attempt) {
  const byId = new Map(quiz.questions.map((q) => [q.id, q]));
  const plus = attempt.settings.plus;
  const minus = attempt.settings.minus;
  const rows = [];
  let correct = 0, wrong = 0, skipped = 0, unscored = 0;
  for (const qid of attempt.order) {
    const q = byId.get(qid);
    if (!q) continue;
    const resp = attempt.responses[qid];
    const answered = resp !== undefined && resp !== null;
    let status;
    if (!hasAnswer(q)) { status = 'unscored'; unscored++; }
    else if (!answered) { status = 'skipped'; skipped++; }
    else if (resp === q.answer) { status = 'correct'; correct++; }
    else { status = 'wrong'; wrong++; }
    rows.push({ q, resp: answered ? resp : null, status, marked: !!attempt.marked[qid] });
  }
  const scored = correct + wrong + skipped;
  return {
    rows, correct, wrong, skipped, unscored,
    score: round2(correct * plus - wrong * minus),
    max: round2(scored * plus),
    accuracy: correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : null,
    attempted: rows.filter((r) => r.resp !== null).length,
  };
}

// ---------- rendering ----------

function render() {
  clearInterval(state.timerHandle);
  document.body.classList.toggle('in-exam', state.view === 'exam');
  if (state.view === 'library') renderLibrary();
  else if (state.view === 'editor') renderEditor();
  else if (state.view === 'setup') renderSetup();
  else if (state.view === 'exam') renderExam();
  else if (state.view === 'result') renderResult();
}

function topbar(extra = '') {
  return `<header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span><h1>QuizMaster</h1><span class="tag">PDF papers into timed tests</span></div>
    ${extra}
  </header>`;
}

function renderLibrary() {
  const quizzes = [...state.quizzes].sort((a, b) => b.updatedAt - a.updatedAt);
  const imp = state.importing;
  const cards = quizzes.map((quiz) => {
    const keyed = quiz.questions.filter(hasAnswer).length;
    const attempts = state.attempts.filter((a) => a.quizId === quiz.id);
    const live = attempts.find((a) => a.status === 'in-progress');
    const done = attempts.filter((a) => a.status === 'submitted').sort((a, b) => b.submittedAt - a.submittedAt);
    const confirming = state.confirmDelete === quiz.id;
    const strip = done.slice(0, 4).map((a) => {
      const s = scoreAttempt(quiz, a);
      return `<button data-action="open-result" data-id="${a.id}">${fmtDate(a.submittedAt)} · <span class="num">${s.score}/${s.max}</span></button>`;
    }).join('');
    return `<article class="quiz-card">
      <div>
        <h3>${esc(quiz.title)}</h3>
        <div class="quiz-meta">
          <span>${plural(quiz.questions.length, 'question')}</span>
          <span>${keyed === quiz.questions.length ? '<span class="chip good">Answer key complete</span>' : keyed ? `<span class="chip warn">Key: ${keyed}/${quiz.questions.length}</span>` : '<span class="chip warn">No answer key yet</span>'}</span>
          <span>${esc(quiz.sourceName || '')}</span>
        </div>
      </div>
      <div class="quiz-actions">
        ${confirming ? `<span class="muted">Delete this test and its attempts?</span>
          <button class="btn small danger solid" data-action="delete-quiz" data-id="${quiz.id}">Delete</button>
          <button class="btn small" data-action="cancel-delete">Keep</button>` : `
          ${live ? `<button class="btn primary" data-action="resume" data-id="${live.id}">Resume test</button>` : `<button class="btn primary" data-action="setup" data-id="${quiz.id}">Start test</button>`}
          <button class="btn" data-action="edit" data-id="${quiz.id}">Questions &amp; key</button>
          <button class="btn ghost danger" data-action="ask-delete" data-id="${quiz.id}" aria-label="Delete ${esc(quiz.title)}">Delete</button>`}
      </div>
      ${strip ? `<div class="attempt-strip"><span class="muted">Past attempts:</span>${strip}</div>` : ''}
    </article>`;
  }).join('');

  app.innerHTML = `<div class="wrap">
    ${topbar()}
    <label class="drop" id="drop">
      <span class="eyebrow">New test</span>
      <h2>Drop a question paper PDF</h2>
      <p>QuizMaster reads the numbered questions and their options, skips Hindi text in bilingual papers, and keeps each question's snippet from the PDF. Then add the answer key and start a timed test.</p>
      ${imp ? `<div class="progress" aria-label="Import progress"><i style="width:${imp.pct}%"></i></div><span class="muted" role="status">${esc(imp.label)}</span>`
        : `<span class="btn primary">Choose PDF</span><input type="file" id="pdf-input" accept="application/pdf,.pdf" aria-label="Choose a PDF question paper">`}
      ${state.importError ? `<span class="chip bad" role="alert">${esc(state.importError)}</span>` : ''}
    </label>
    <div class="lib-head"><h2>Your tests</h2><span class="muted">${quizzes.length ? plural(quizzes.length, 'test') : ''}</span></div>
    <div class="quiz-list">${cards || '<div class="empty">No tests yet. Import a PDF above to create one.</div>'}</div>
    ${db.storage.persistent ? '' : '<p class="muted">This browser is blocking storage, so tests will be lost when you close the page.</p>'}
  </div>`;

  const input = document.getElementById('pdf-input');
  if (input) input.addEventListener('change', () => input.files[0] && importPdf(input.files[0]));
  const drop = document.getElementById('drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) importPdf(f);
  });
}

async function importPdf(file) {
  if (state.importing) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    state.importError = `${file.name} is not a PDF. Choose a .pdf file.`;
    render();
    return;
  }
  state.importError = '';
  state.importing = { label: 'Loading the PDF reader…', pct: 2 };
  render();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { doc, pages } = await readPdf(bytes, (n, total) => {
      state.importing = { label: `Reading page ${n} of ${total}`, pct: Math.round((n / total) * 90) };
      const bar = app.querySelector('.progress > i');
      const label = app.querySelector('.drop [role="status"]');
      if (bar) bar.style.width = `${state.importing.pct}%`;
      if (label) label.textContent = state.importing.label;
    });
    const chars = pages.reduce((n, p) => n + p.items.reduce((m, it) => m + it.str.length, 0), 0);
    if (chars < pages.length * 40) {
      throw new Error('This PDF has almost no selectable text. It looks like a scanned paper, which needs OCR before it can be imported.');
    }
    const result = parseQuestions(pages);
    if (!result.questions.length) {
      throw new Error('No numbered questions with options were found in this PDF.');
    }
    const quiz = {
      id: db.uid('quiz'),
      title: file.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled test',
      sourceName: file.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pageCount: pages.length,
      hasPdf: true,
      stats: result.stats,
      questions: result.questions,
      settings: {
        minutes: Math.max(5, Math.round(result.questions.length * 0.8)),
        plus: 1,
        minus: 0.33,
      },
    };
    let keyFound = 0;
    if (result.keyText) {
      const key = parseAnswerKey(result.keyText);
      for (const q of quiz.questions) if (key.has(q.num)) { q.answer = key.get(q.num); keyFound++; }
    }
    keyFound += quiz.questions.filter((q) => hasAnswer(q)).length - keyFound;
    await db.put('pdfs', { id: quiz.id, name: file.name, bytes: bytes.buffer });
    registerDoc(quiz.id, doc);
    await saveQuiz(quiz);
    state.importSummary = { ...result.stats, keyFound };
    state.importing = null;
    openEditor(quiz.id);
  } catch (err) {
    console.error(err);
    state.importing = null;
    state.importError = err && err.message ? err.message : 'The PDF could not be read.';
    render();
  }
}

// ---------- editor ----------

function openEditor(id) {
  state.quiz = state.quizzes.find((q) => q.id === id);
  state.editor = { filter: 'all', display: 'text', editing: null, confirmDeleteQ: null, keyMsg: '', confirmClear: false };
  state.view = 'editor';
  render();
  window.scrollTo(0, 0);
}

function questionCard(q, display) {
  const ed = state.editor;
  if (ed.editing === q.id) {
    return `<article class="qcard" id="card-${q.id}">
      <div class="qcard-head"><span class="qno">Q${q.num}</span><span class="muted">Editing</span></div>
      <form class="edit-form" data-form="edit-q" data-id="${q.id}">
        <label for="edit-stem-${q.id}">Question text (a line with " | " between cells becomes a table row)</label>
        <textarea id="edit-stem-${q.id}" name="stem">${esc(stemToText(q.stem))}</textarea>
        <label for="edit-opts-${q.id}">Options, one per line</label>
        <textarea id="edit-opts-${q.id}" name="options" style="min-height:96px">${esc(q.options.join('\n'))}</textarea>
        <div class="row"><button class="btn primary small" type="submit">Save question</button><button class="btn small" type="button" data-action="cancel-edit">Cancel</button></div>
      </form>
    </article>`;
  }
  const opts = q.options.map((o, i) => `<button class="opt ${q.answer === i ? 'key' : ''}" data-action="set-key" data-id="${q.id}" data-i="${i}" aria-pressed="${q.answer === i}" title="Mark option ${i + 1} as the correct answer">
      <span class="bubble">${LETTERS[i]}</span><span>${esc(o) || '<em class="muted">(empty)</em>'}${q.answer === i ? '<span class="opt-note" style="color:var(--good)">Correct answer</span>' : ''}</span>
    </button>`).join('');
  const content = display === 'pdf'
    ? `<div class="snippet" data-snippet="${q.id}"><div class="snippet-missing">Drawing from the PDF…</div></div>`
    : `<div class="q-body">${stemHtml(q)}</div>`;
  const confirming = ed.confirmDeleteQ === q.id;
  return `<article class="qcard ${q.warnings.length ? 'flag' : ''}" id="card-${q.id}">
    <div class="qcard-head">
      <span class="qno">Q${q.num}</span>
      ${hasAnswer(q) ? `<span class="chip good">Answer ${q.answer + 1}</span>` : '<span class="chip">No answer</span>'}
      ${q.warnings.length ? '<span class="chip warn">Check this one</span>' : ''}
      <span class="spacer"></span>
      ${confirming ? `<span class="muted">Remove Q${q.num}?</span><button class="btn small danger solid" data-action="delete-q" data-id="${q.id}">Remove</button><button class="btn small" data-action="cancel-delete-q">Keep</button>`
        : `<button class="btn small ghost" data-action="edit-q" data-id="${q.id}">Edit</button><button class="btn small ghost danger" data-action="ask-delete-q" data-id="${q.id}">Remove</button>`}
    </div>
    ${q.warnings.length ? `<div class="warnings">${q.warnings.map((w) => `<span>${esc(w)}</span>`).join('')}</div>` : ''}
    ${content}
    <div class="opts" role="group" aria-label="Options for question ${q.num}. Choose the correct one.">${opts}</div>
  </article>`;
}

function renderEditor() {
  const quiz = state.quiz;
  const ed = state.editor;
  const total = quiz.questions.length;
  const keyed = quiz.questions.filter(hasAnswer).length;
  const flagged = quiz.questions.filter((q) => q.warnings.length).length;
  const list = quiz.questions.filter((q) => ed.filter === 'all' || (ed.filter === 'nokey' && !hasAnswer(q)) || (ed.filter === 'flag' && q.warnings.length));
  const sum = state.importSummary;
  const seg = (name, value, label) => `<button data-action="${name}" data-v="${value}" aria-pressed="${ed[name === 'filter' ? 'filter' : 'display'] === value}">${label}</button>`;

  app.innerHTML = `<div class="wrap">
    ${topbar(`<button class="btn" data-action="home">All tests</button><button class="btn primary" data-action="setup" data-id="${quiz.id}">Start test</button>`)}
    <section class="editor-head">
      <input class="title-input" id="quiz-title" value="${esc(quiz.title)}" aria-label="Test name">
      <div class="summary-bar">
        <span class="chip accent">${plural(total, 'question')}</span>
        ${sum && sum.skippedPages ? `<span class="chip">Hindi text skipped on ${plural(sum.skippedPages, 'page')}</span>` : ''}
        ${sum && sum.missing && sum.missing.length ? `<span class="chip warn">Not found: Q${sum.missing.join(', Q')}</span>` : ''}
        ${flagged ? `<span class="chip warn">${plural(flagged, 'question')} to check</span>` : ''}
        ${sum && sum.keyFound ? `<span class="chip good">${sum.keyFound} answers found in the PDF</span>` : ''}
      </div>
      ${quiz.hasPdf ? '' : `<div class="row"><span class="muted">The original PDF is not stored for this test, so only the text view is available.</span>
        <label class="btn small" style="position:relative">Attach the PDF<input type="file" id="attach-pdf" accept="application/pdf,.pdf" style="position:absolute;inset:0;opacity:0;cursor:pointer" aria-label="Attach the original PDF"></label></div>`}
    </section>

    <section class="panel key-panel" aria-labelledby="key-h">
      <div class="row"><span class="eyebrow" id="key-h">Answer key</span><span class="spacer"></span>
        <div class="meter"><div class="progress"><i style="width:${total ? (keyed / total) * 100 : 0}%"></i></div><span class="num">${keyed}/${total}</span></div>
      </div>
      <textarea id="key-text" placeholder="Paste the key, for example:  1-c, 2-a, 3-d  or  1 (b) 2 (a)  or  Q1: 3.  Letters a–d and numbers 1–4 both work." aria-label="Answer key text"></textarea>
      <div class="row">
        <button class="btn primary small" data-action="apply-key">Apply key</button>
        <label class="btn small" style="position:relative">Load key from a file<input type="file" id="key-file" accept=".txt,.csv,.pdf,text/plain,application/pdf" style="position:absolute;inset:0;opacity:0;cursor:pointer" aria-label="Load answer key from a text or PDF file"></label>
        ${keyed ? (ed.confirmClear ? `<span class="muted">Clear all ${keyed} answers?</span><button class="btn small danger solid" data-action="clear-key">Clear</button><button class="btn small" data-action="cancel-clear">Keep</button>` : '<button class="btn small ghost danger" data-action="ask-clear">Clear key</button>') : ''}
        <span class="muted" role="status">${esc(ed.keyMsg)}</span>
      </div>
      <p class="muted" style="margin:0;font-size:13px">You can also click an option number on any question below to mark it as the correct answer.</p>
    </section>

    <div class="filters">
      <div class="seg" role="group" aria-label="Show questions">
        ${seg('filter', 'all', `All ${total}`)}
        ${seg('filter', 'nokey', `No answer ${total - keyed}`)}
        ${seg('filter', 'flag', `To check ${flagged}`)}
      </div>
      <span class="spacer"></span>
      <div class="seg" role="group" aria-label="Question view">
        ${seg('display', 'text', 'Text')}
        ${seg('display', 'pdf', 'PDF snippet')}
      </div>
    </div>
    <div class="qcards">${list.map((q) => questionCard(q, ed.display)).join('') || '<div class="empty">Nothing in this list.</div>'}</div>
  </div>`;

  document.getElementById('quiz-title').addEventListener('change', async (e) => {
    quiz.title = e.target.value.trim() || quiz.title;
    await saveQuiz(quiz);
    toast('Name saved');
  });
  document.getElementById('attach-pdf')?.addEventListener('change', (e) => e.target.files[0] && attachPdf(e.target.files[0]));
  document.getElementById('key-file').addEventListener('change', (e) => e.target.files[0] && loadKeyFile(e.target.files[0]));
  hydrateSnippets();
}

async function attachPdf(file) {
  const quiz = state.quiz;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { doc, pages } = await readPdf(bytes);
    if (quiz.pageCount && pages.length !== quiz.pageCount) {
      toast(`That PDF has ${pages.length} pages but this test came from one with ${quiz.pageCount}. Choose the same file.`);
      return;
    }
    await db.put('pdfs', { id: quiz.id, name: file.name, bytes: bytes.buffer });
    registerDoc(quiz.id, doc);
    quiz.hasPdf = true;
    await saveQuiz(quiz);
    state.editor.display = 'pdf';
    render();
    toast('PDF attached');
  } catch (err) {
    console.error(err);
    toast('That PDF could not be read.');
  }
}

async function applyKeyText(text) {
  const quiz = state.quiz;
  const key = parseAnswerKey(text);
  if (!key.size) {
    state.editor.keyMsg = 'No answers found in that text. Use a format like "1-c, 2-a" or "1 (b) 2 (d)".';
    render();
    return;
  }
  let applied = 0;
  const byNum = new Map(quiz.questions.map((q) => [q.num, q]));
  const unknown = [];
  for (const [n, idx] of key) {
    const q = byNum.get(n);
    if (!q) { unknown.push(n); continue; }
    q.answer = idx;
    applied++;
  }
  await saveQuiz(quiz);
  state.editor.keyMsg = `Applied ${plural(applied, 'answer')}.${unknown.length ? ` ${unknown.length} did not match a question (Q${unknown.slice(0, 5).join(', Q')}${unknown.length > 5 ? '…' : ''}).` : ''}`;
  render();
}

async function loadKeyFile(file) {
  try {
    let text;
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      state.editor.keyMsg = 'Reading the key PDF…';
      render();
      const { pages } = await readPdf(new Uint8Array(await file.arrayBuffer()));
      text = pages.map((p) => {
        const lines = new Map();
        for (const it of p.items) {
          const k = Math.round(it.baseline / 4);
          if (!lines.has(k)) lines.set(k, []);
          lines.get(k).push(it);
        }
        return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, its]) => its.sort((a, b) => a.x - b.x).map((i) => i.str).join(' ')).join('\n');
      }).join('\n');
    } else {
      text = await file.text();
    }
    document.getElementById('key-text').value = text.slice(0, 20000);
    await applyKeyText(text);
  } catch (err) {
    console.error(err);
    state.editor.keyMsg = 'That file could not be read. Paste the key as text instead.';
    render();
  }
}

// ---------- setup ----------

function openSetup(id) {
  state.quiz = state.quizzes.find((q) => q.id === id);
  const s = state.quiz.settings;
  const nums = state.quiz.questions.map((q) => q.num);
  state.setup = {
    minutes: s.minutes, plus: s.plus, minus: s.minus, shuffle: false,
    from: Math.min(...nums), to: Math.max(...nums),
    display: s.display && (s.display === 'text' || state.quiz.hasPdf) ? s.display : 'text',
  };
  state.view = 'setup';
  render();
  window.scrollTo(0, 0);
}

function setupSelection() {
  const s = state.setup;
  return state.quiz.questions.filter((q) => q.num >= s.from && q.num <= s.to);
}

function renderSetup() {
  const quiz = state.quiz;
  const s = state.setup;
  const picked = setupSelection();
  const noKey = picked.filter((q) => !hasAnswer(q)).length;
  const dispBtn = (v, label, disabled) => `<button data-action="setup-display" data-v="${v}" aria-pressed="${s.display === v}" ${disabled ? 'disabled title="The PDF is not stored for this test"' : ''}>${label}</button>`;
  app.innerHTML = `<div class="wrap">
    ${topbar(`<button class="btn" data-action="edit" data-id="${quiz.id}">Questions &amp; key</button><button class="btn" data-action="home">All tests</button>`)}
    <form class="setup" data-form="start">
      <div><span class="eyebrow">Test settings</span><h2 style="font-size:24px;margin-top:4px">${esc(quiz.title)}</h2></div>
      <div class="panel stack">
        <label class="field"><span>Time limit (minutes)</span>
          <input type="number" id="set-minutes" name="minutes" min="1" max="600" value="${s.minutes}" required>
        </label>
        <div class="quick" role="group" aria-label="Preset time limits">
          ${[30, 60, 90, 120, 150, 180].map((m) => `<button type="button" class="btn small ${+s.minutes === m ? 'primary' : ''}" data-action="preset" data-v="${m}">${m} min</button>`).join('')}
        </div>
        <div class="field-row">
          <label class="field"><span>Marks for a correct answer</span><input type="number" id="set-plus" name="plus" step="0.01" min="0" value="${s.plus}"></label>
          <label class="field"><span>Marks taken off for a wrong answer</span><input type="number" id="set-minus" name="minus" step="0.01" min="0" value="${s.minus}"><small>0.33 is the usual one-third penalty. Use 0 for none.</small></label>
        </div>
        <div class="field-row">
          <label class="field"><span>From question</span><input type="number" id="set-from" name="from" value="${s.from}"></label>
          <label class="field"><span>To question</span><input type="number" id="set-to" name="to" value="${s.to}"></label>
        </div>
        <label class="check"><input type="checkbox" id="set-shuffle" name="shuffle" ${s.shuffle ? 'checked' : ''}> Shuffle the question order</label>
        <div class="field"><span>Show questions as</span>
          <div class="seg" role="group" aria-label="Question display">
            ${dispBtn('text', 'Text')}${dispBtn('pdf', 'PDF snippet', !quiz.hasPdf)}${dispBtn('both', 'Both', !quiz.hasPdf)}
          </div>
          <small>You can switch this during the test too.</small>
        </div>
      </div>
      <p class="muted" style="margin:0">${plural(picked.length, 'question')} in ${fmtDuration(s.minutes * 60)}.${noKey ? ` ${plural(noKey, 'question has', 'questions have')} no answer yet and will show as unscored. You can add the key later and the result updates.` : ''}</p>
      <div class="row"><button class="btn primary" type="submit" ${picked.length ? '' : 'disabled'}>Start the test</button><button class="btn" type="button" data-action="edit" data-id="${quiz.id}">Back</button></div>
    </form>
  </div>`;
  const form = app.querySelector('[data-form="start"]');
  form.addEventListener('input', () => {
    const f = new FormData(form);
    Object.assign(s, {
      minutes: +f.get('minutes') || s.minutes,
      plus: +f.get('plus'),
      minus: +f.get('minus'),
      from: +f.get('from'),
      to: +f.get('to'),
      shuffle: f.get('shuffle') === 'on',
    });
  });
  form.addEventListener('change', () => {
    const active = document.activeElement && document.activeElement.id;
    render();
    if (active) document.getElementById(active)?.focus();
  });
}

async function startExam() {
  const quiz = state.quiz;
  const s = state.setup;
  const picked = setupSelection();
  const order = picked.map((q) => q.id);
  if (s.shuffle) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  quiz.settings = { ...quiz.settings, minutes: s.minutes, plus: s.plus, minus: s.minus, display: s.display };
  await saveQuiz(quiz);
  const now = Date.now();
  const attempt = {
    id: db.uid('att'),
    quizId: quiz.id,
    status: 'in-progress',
    startedAt: now,
    endsAt: now + s.minutes * 60000,
    durationSec: s.minutes * 60,
    order,
    responses: {},
    marked: {},
    visited: {},
    current: 0,
    settings: { plus: s.plus, minus: s.minus },
  };
  await saveAttempt(attempt);
  openExam(attempt, s.display);
}

// ---------- exam ----------

function openExam(attempt, display) {
  state.attempt = attempt;
  state.quiz = state.quizzes.find((q) => q.id === attempt.quizId);
  const pref = display || state.quiz.settings.display || 'text';
  state.exam = { display: state.quiz.hasPdf ? pref : 'text', modal: null, paletteOpen: false };
  state.view = 'exam';
  render();
}

function paletteStatus(a, qid) {
  const ans = a.responses[qid] !== undefined;
  if (a.marked[qid]) return ans ? 'markdone' : 'mark';
  if (ans) return 'done';
  if (a.visited[qid]) return 'seen';
  return 'idle';
}

function examCounts(a) {
  const c = { done: 0, seen: 0, idle: 0, mark: 0, markdone: 0 };
  for (const qid of a.order) c[paletteStatus(a, qid)]++;
  return c;
}

function renderExam() {
  const a = state.attempt;
  const quiz = state.quiz;
  const ex = state.exam;
  const qid = a.order[a.current];
  const q = quiz.questions.find((x) => x.id === qid);
  if (!a.visited[qid]) {
    a.visited[qid] = true;
    saveAttempt(a);
  }
  const resp = a.responses[qid];
  const c = examCounts(a);
  const showText = ex.display !== 'pdf';
  const showPdf = ex.display !== 'text';
  const opts = q.options.map((o, i) => `<button class="opt" role="radio" aria-checked="${resp === i}" data-action="pick" data-i="${i}">
      <span class="bubble">${LETTERS[i]}</span><span>${showText ? esc(o) : `Option ${LETTERS[i]}`}</span></button>`).join('');
  const legend = [
    ['done', 'Answered', c.done], ['seen', 'Not answered', c.seen], ['idle', 'Not visited', c.idle],
    ['mark', 'Marked for review', c.mark], ['markdone', 'Answered &amp; marked', c.markdone],
  ].map(([k, label, n]) => `<div><span class="swatch st-${k}"></span>${label} <b>${n}</b></div>`).join('');
  const grid = a.order.map((id, i) => {
    const num = quiz.questions.find((x) => x.id === id)?.num ?? i + 1;
    const st = paletteStatus(a, id);
    return `<button class="pbtn st-${st} ${i === a.current ? 'current' : ''}" data-action="jump" data-i="${i}" aria-label="Question ${num}, ${st === 'done' ? 'answered' : st === 'seen' ? 'not answered' : st === 'idle' ? 'not visited' : st === 'mark' ? 'marked for review' : 'answered and marked for review'}">${num}</button>`;
  }).join('');
  const modal = ex.modal === 'submit' ? `<div class="scrim" role="dialog" aria-modal="true" aria-labelledby="submit-h">
      <div class="modal">
        <h2 id="submit-h">Submit the test?</h2>
        <table>
          <tr><td>Answered</td><td>${c.done + c.markdone}</td></tr>
          <tr><td>Not answered</td><td>${c.seen + c.mark}</td></tr>
          <tr><td>Not visited</td><td>${c.idle}</td></tr>
          <tr><td>Marked for review</td><td>${c.mark + c.markdone}</td></tr>
          <tr><td>Time left</td><td id="modal-time">${fmtClock((a.endsAt - Date.now()) / 1000)}</td></tr>
        </table>
        <p class="muted" style="margin:0">Answers marked for review are still counted. You cannot change answers after submitting.</p>
        <div class="row"><button class="btn primary" data-action="confirm-submit">Submit</button><button class="btn" data-action="close-modal">Back to the test</button></div>
      </div>
    </div>` : ex.modal === 'quit' ? `<div class="scrim" role="dialog" aria-modal="true" aria-labelledby="quit-h">
      <div class="modal">
        <h2 id="quit-h">Leave the test?</h2>
        <p class="muted" style="margin:0">Your answers are saved and the timer keeps running. Resume it from your tests list.</p>
        <div class="row"><button class="btn" data-action="leave-exam">Leave</button><button class="btn primary" data-action="close-modal">Stay</button></div>
      </div>
    </div>` : '';

  app.innerHTML = `<div class="exam">
    <div class="exam-bar">
      <h1>${esc(quiz.title)}</h1>
      <span class="timer" id="timer" role="timer" aria-label="Time left">${fmtClock((a.endsAt - Date.now()) / 1000)}</span>
      <button class="btn small palette-toggle" data-action="toggle-palette" aria-expanded="${ex.paletteOpen}">Questions</button>
      <button class="btn small primary" data-action="ask-submit">Submit</button>
      <button class="btn small ghost" data-action="ask-quit">Leave</button>
    </div>
    <div class="exam-main">
      <main class="q-pane" id="q-pane">
        <div class="q-inner">
          <div class="q-top">
            <h2>Question ${q.num} <span class="muted" style="font-weight:400">· ${a.current + 1} of ${a.order.length}</span></h2>
            ${a.marked[qid] ? '<span class="chip" style="background:var(--review-soft);color:var(--review);border-color:transparent">Marked for review</span><button class="btn small ghost" data-action="unmark">Unmark</button>' : ''}
            ${quiz.hasPdf ? `<div class="seg" role="group" aria-label="Question display">
              ${['text', 'pdf', 'both'].map((v) => `<button data-action="exam-display" data-v="${v}" aria-pressed="${ex.display === v}">${v === 'text' ? 'Text' : v === 'pdf' ? 'PDF' : 'Both'}</button>`).join('')}
            </div>` : ''}
          </div>
          ${showPdf ? `<div class="snippet" data-snippet="${q.id}"><div class="snippet-missing">Drawing from the PDF…</div></div>` : ''}
          ${showText ? `<div class="q-body">${stemHtml(q)}</div>` : ''}
          <div class="opts" role="radiogroup" aria-label="Options">${opts}</div>
          <div class="kbd-hint">Keys: <kbd>1</kbd>–<kbd>${q.options.length || 4}</kbd> choose · <kbd>C</kbd> clear · <kbd>M</kbd> mark for review · <kbd>←</kbd> <kbd>→</kbd> move</div>
        </div>
      </main>
      <aside class="palette ${ex.paletteOpen ? 'open' : ''}" aria-label="Question palette">
        <div class="row"><span class="eyebrow">Question palette</span><span class="spacer"></span><button class="btn small ghost palette-toggle" data-action="toggle-palette">Close</button></div>
        <div class="legend">${legend}</div>
        <div class="pgrid">${grid}</div>
      </aside>
    </div>
    <div class="exam-actions">
      <button class="btn" data-action="mark-next">Mark for review &amp; next</button>
      <button class="btn" data-action="clear" ${resp === undefined ? 'disabled' : ''}>Clear response</button>
      <span class="spacer"></span>
      <button class="btn" data-action="prev" ${a.current === 0 ? 'disabled' : ''}>Previous</button>
      <button class="btn primary" data-action="save-next">${a.current === a.order.length - 1 ? 'Save' : 'Save &amp; next'}</button>
    </div>
    ${modal}
  </div>`;

  hydrateSnippets();
  tick();
  state.timerHandle = setInterval(tick, 500);
  const pane = document.getElementById('q-pane');
  if (state.lastShown !== qid) {
    pane.scrollTop = 0;
    state.lastShown = qid;
  }
}

function tick() {
  const a = state.attempt;
  if (!a || state.view !== 'exam') return;
  const left = (a.endsAt - Date.now()) / 1000;
  const el = document.getElementById('timer');
  if (el) {
    el.textContent = fmtClock(left);
    el.classList.toggle('low', left <= 600 && left > 120);
    el.classList.toggle('critical', left <= 120);
  }
  const mt = document.getElementById('modal-time');
  if (mt) mt.textContent = fmtClock(left);
  if (left <= 0) submitExam(true);
}

function go(delta) {
  const a = state.attempt;
  const next = a.current + delta;
  if (next < 0 || next >= a.order.length) return false;
  a.current = next;
  return true;
}

async function submitExam(auto = false) {
  const a = state.attempt;
  if (!a || a.status !== 'in-progress') return;
  clearInterval(state.timerHandle);
  a.status = 'submitted';
  a.submittedAt = Math.min(Date.now(), a.endsAt);
  a.timeUsedSec = Math.round((a.submittedAt - a.startedAt) / 1000);
  a.autoSubmitted = auto;
  await saveAttempt(a);
  state.result = { filter: 'all', timeUp: auto };
  state.view = 'result';
  render();
  window.scrollTo(0, 0);
}

// ---------- results ----------

function openResult(id) {
  const a = state.attempts.find((x) => x.id === id);
  state.attempt = a;
  state.quiz = state.quizzes.find((q) => q.id === a.quizId);
  state.result = { filter: 'all' };
  state.view = 'result';
  render();
  window.scrollTo(0, 0);
}

function renderResult() {
  const a = state.attempt;
  const quiz = state.quiz;
  const r = scoreAttempt(quiz, a);
  const f = state.result.filter;
  const total = r.rows.length;
  const pct = (n) => `${total ? (n / total) * 100 : 0}%`;
  const rows = r.rows.filter((x) => f === 'all' || x.status === f || (f === 'marked' && x.marked));
  const list = rows.map((x) => {
    const q = x.q;
    const opts = q.options.map((o, i) => {
      let cls = '';
      let note = '';
      if (hasAnswer(q) && i === q.answer) { cls = 'r-correct'; note = x.resp === i ? 'Your answer, correct' : 'Correct answer'; }
      else if (x.resp === i) { cls = hasAnswer(q) ? 'r-wrong' : 'key'; note = 'Your answer'; }
      return `<div class="opt ${cls}"><span class="bubble">${LETTERS[i]}</span><span>${esc(o)}${note ? `<span class="opt-note">${note}</span>` : ''}</span></div>`;
    }).join('');
    const chip = { correct: '<span class="chip good">Correct</span>', wrong: '<span class="chip bad">Wrong</span>', skipped: '<span class="chip">Not answered</span>', unscored: '<span class="chip warn">No answer key</span>' }[x.status];
    return `<article class="qcard">
      <div class="qcard-head"><span class="qno">Q${q.num}</span>${chip}${x.marked ? '<span class="chip" style="background:var(--review-soft);color:var(--review);border-color:transparent">Marked</span>' : ''}</div>
      <div class="q-body">${stemHtml(q)}</div>
      <div class="opts">${opts}</div>
    </article>`;
  }).join('');
  const seg = (v, label) => `<button data-action="result-filter" data-v="${v}" aria-pressed="${f === v}">${label}</button>`;
  const markedCount = r.rows.filter((x) => x.marked).length;

  app.innerHTML = `<div class="wrap">
    ${topbar(`<button class="btn" data-action="home">All tests</button>`)}
    <section class="panel stack">
      ${state.result.timeUp ? '<span class="chip warn">Time ran out, so the test was submitted automatically.</span>' : ''}
      <div class="score-head">
        <div>
          <span class="eyebrow">Score</span>
          <div class="score-big">${r.score}<small> / ${r.max}</small></div>
        </div>
        <div class="stack" style="gap:8px">
          <h2 style="font-size:20px">${esc(quiz.title)}</h2>
          <span class="muted">${fmtDate(a.submittedAt)} · ${fmtDuration(a.timeUsedSec)} of ${fmtDuration(a.durationSec)} used · +${a.settings.plus} / −${a.settings.minus} per question</span>
        </div>
      </div>
      <div class="bar" aria-hidden="true">
        <i style="width:${pct(r.correct)};background:var(--good)"></i><i style="width:${pct(r.wrong)};background:var(--bad)"></i><i style="width:${pct(r.unscored)};background:var(--warn)"></i>
      </div>
      <div class="stats">
        <div class="stat good"><b>${r.correct}</b><span>Correct</span></div>
        <div class="stat bad"><b>${r.wrong}</b><span>Wrong</span></div>
        <div class="stat"><b>${r.skipped}</b><span>Not answered</span></div>
        ${r.unscored ? `<div class="stat"><b>${r.unscored}</b><span>No answer key</span></div>` : ''}
        <div class="stat"><b>${r.accuracy === null ? '–' : `${r.accuracy}%`}</b><span>Accuracy</span></div>
        <div class="stat"><b>${r.attempted}/${total}</b><span>Attempted</span></div>
      </div>
      ${r.unscored ? `<p class="muted" style="margin:0">${plural(r.unscored, 'question has', 'questions have')} no answer in the key. Add the key and this result is re-scored automatically.</p>` : ''}
      <div class="row">
        <button class="btn primary" data-action="setup" data-id="${quiz.id}">Take it again</button>
        <button class="btn" data-action="edit" data-id="${quiz.id}">${r.unscored ? 'Add answer key' : 'Questions &amp; key'}</button>
      </div>
    </section>
    <div class="filters">
      <span class="eyebrow">Review</span>
      <div class="seg" role="group" aria-label="Filter review">
        ${seg('all', `All ${total}`)}${seg('correct', `Correct ${r.correct}`)}${seg('wrong', `Wrong ${r.wrong}`)}${seg('skipped', `Not answered ${r.skipped}`)}${markedCount ? seg('marked', `Marked ${markedCount}`) : ''}${r.unscored ? seg('unscored', `No key ${r.unscored}`) : ''}
      </div>
    </div>
    <div class="review-list">${list || '<div class="empty">Nothing in this list.</div>'}</div>
  </div>`;
}

// ---------- events ----------

const actions = {
  home() { state.view = 'library'; state.confirmDelete = null; state.importSummary = null; render(); },
  edit(el) { openEditor(el.dataset.id); },
  setup(el) { openSetup(el.dataset.id); },
  resume(el) { openExam(state.attempts.find((a) => a.id === el.dataset.id)); },
  'open-result'(el) { openResult(el.dataset.id); },
  'ask-delete'(el) { state.confirmDelete = el.dataset.id; render(); },
  'cancel-delete'() { state.confirmDelete = null; render(); },
  async 'delete-quiz'(el) {
    const id = el.dataset.id;
    await db.remove('quizzes', id);
    await db.remove('pdfs', id);
    for (const a of state.attempts.filter((x) => x.quizId === id)) await db.remove('attempts', a.id);
    state.quizzes = state.quizzes.filter((q) => q.id !== id);
    state.attempts = state.attempts.filter((a) => a.quizId !== id);
    state.confirmDelete = null;
    render();
    toast('Test deleted');
  },

  // editor
  filter(el) { state.editor.filter = el.dataset.v; render(); },
  display(el) { state.editor.display = el.dataset.v; render(); },
  async 'set-key'(el) {
    const q = state.quiz.questions.find((x) => x.id === el.dataset.id);
    const i = +el.dataset.i;
    q.answer = q.answer === i ? null : i;
    await saveQuiz(state.quiz);
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  },
  'apply-key'() { applyKeyText(document.getElementById('key-text').value); },
  'ask-clear'() { state.editor.confirmClear = true; render(); },
  'cancel-clear'() { state.editor.confirmClear = false; render(); },
  async 'clear-key'() {
    for (const q of state.quiz.questions) q.answer = null;
    await saveQuiz(state.quiz);
    state.editor.confirmClear = false;
    state.editor.keyMsg = 'Answer key cleared.';
    render();
  },
  'edit-q'(el) { state.editor.editing = el.dataset.id; keepScroll(); },
  'cancel-edit'() { state.editor.editing = null; keepScroll(); },
  'ask-delete-q'(el) { state.editor.confirmDeleteQ = el.dataset.id; keepScroll(); },
  'cancel-delete-q'() { state.editor.confirmDeleteQ = null; keepScroll(); },
  async 'delete-q'(el) {
    state.quiz.questions = state.quiz.questions.filter((q) => q.id !== el.dataset.id);
    await saveQuiz(state.quiz);
    state.editor.confirmDeleteQ = null;
    keepScroll();
    toast('Question removed');
  },

  // setup
  preset(el) { state.setup.minutes = +el.dataset.v; render(); },
  'setup-display'(el) { state.setup.display = el.dataset.v; render(); },

  // exam
  async pick(el) {
    const a = state.attempt;
    const qid = a.order[a.current];
    const i = +el.dataset.i;
    if (a.responses[qid] === i) delete a.responses[qid];
    else a.responses[qid] = i;
    await saveAttempt(a);
    render();
  },
  async clear() {
    const a = state.attempt;
    delete a.responses[a.order[a.current]];
    await saveAttempt(a);
    render();
  },
  async 'mark-next'() {
    const a = state.attempt;
    a.marked[a.order[a.current]] = true;
    go(1);
    await saveAttempt(a);
    render();
  },
  async unmark() {
    const a = state.attempt;
    delete a.marked[a.order[a.current]];
    await saveAttempt(a);
    render();
  },
  async 'save-next'() {
    const a = state.attempt;
    const qid = a.order[a.current];
    if (a.responses[qid] !== undefined) delete a.marked[qid];
    const moved = go(1);
    await saveAttempt(a);
    if (!moved) state.exam.modal = 'submit';
    render();
  },
  async prev() { go(-1); await saveAttempt(state.attempt); render(); },
  async jump(el) {
    state.attempt.current = +el.dataset.i;
    state.exam.paletteOpen = false;
    await saveAttempt(state.attempt);
    render();
  },
  'exam-display'(el) {
    state.exam.display = el.dataset.v;
    state.quiz.settings.display = el.dataset.v;
    saveQuiz(state.quiz);
    render();
  },
  'toggle-palette'() { state.exam.paletteOpen = !state.exam.paletteOpen; render(); },
  'ask-submit'() { state.exam.modal = 'submit'; render(); },
  'ask-quit'() { state.exam.modal = 'quit'; render(); },
  'close-modal'() { state.exam.modal = null; render(); },
  'confirm-submit'() { submitExam(false); },
  'leave-exam'() { state.view = 'library'; render(); },

  // results
  'result-filter'(el) { state.result.filter = el.dataset.v; render(); },
};

function keepScroll() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve(fn(el, e)).catch((err) => {
    console.error(err);
    toast('Something went wrong saving that change. Try again.');
  });
});

app.addEventListener('submit', async (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.dataset.form === 'start') {
    startExam();
  } else if (form.dataset.form === 'edit-q') {
    const q = state.quiz.questions.find((x) => x.id === form.dataset.id);
    const f = new FormData(form);
    q.stem = textToStem(String(f.get('stem')));
    q.options = String(f.get('options')).split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 5);
    if (hasAnswer(q) && q.answer >= q.options.length) q.answer = null;
    q.warnings = q.options.length < 2 ? ['Add at least two options.'] : [];
    q.edited = true;
    await saveQuiz(state.quiz);
    state.editor.editing = null;
    keepScroll();
    toast(`Q${q.num} saved`);
  }
});

document.addEventListener('keydown', (e) => {
  if (state.view !== 'exam' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  if (state.exam.modal) {
    if (e.key === 'Escape') actions['close-modal']();
    return;
  }
  const a = state.attempt;
  const q = state.quiz.questions.find((x) => x.id === a.order[a.current]);
  if (/^[1-5]$/.test(e.key) && +e.key <= q.options.length) {
    actions.pick({ dataset: { i: String(+e.key - 1) } });
  } else if (e.key === 'ArrowRight') actions['save-next']();
  else if (e.key === 'ArrowLeft') actions.prev();
  else if (e.key.toLowerCase() === 'm') actions['mark-next']();
  else if (e.key.toLowerCase() === 'c') actions.clear();
  else return;
  e.preventDefault();
});

// ---------- boot ----------

async function boot() {
  try {
    state.quizzes = await db.getAll('quizzes');
    state.attempts = await db.getAll('attempts');
  } catch (err) {
    console.error(err);
  }
  if (!state.quizzes.length && window.QUIZMASTER_SAMPLE) {
    const sample = window.QUIZMASTER_SAMPLE;
    await saveQuiz({ ...sample, id: db.uid('quiz'), createdAt: Date.now(), updatedAt: Date.now(), hasPdf: false });
  }
  // A test whose time ran out while the page was closed is submitted now.
  for (const a of state.attempts) {
    if (a.status === 'in-progress' && a.endsAt <= Date.now()) {
      a.status = 'submitted';
      a.submittedAt = a.endsAt;
      a.timeUsedSec = a.durationSec;
      a.autoSubmitted = true;
      await saveAttempt(a);
    }
  }
  render();
}

boot();
