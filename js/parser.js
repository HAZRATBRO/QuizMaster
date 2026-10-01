// Turns positioned PDF text (from extract.js) into structured multiple-choice questions.
// Pure functions only, so the same code runs in the browser and in Node tests.

const STOPWORDS = new Set((
  'the of and is are which following in to from with by for was were correct select answer given ' +
  'below code statements statement only both not as at on it its that this be has have an or nor ' +
  'neither match list among these consider about who what when where how year first their there ' +
  'been will can also between under true false explanation reason assertion one other into than ' +
  'more most all any after before during state country government'
).split(' '));

const DEVANAGARI = /[ऀ-ॿ]/g;

/** Share of words that are common English words (0..1). Legacy Hindi fonts such as
 *  Kruti Dev or Chanakya come through as Latin gibberish and score near 0. */
export function englishScore(text) {
  const letters = (text.match(/[A-Za-zऀ-ॿ]/g) || []).length;
  if (!letters) return null;
  const dev = (text.match(DEVANAGARI) || []).length;
  if (dev / letters > 0.3) return 0;
  const words = text.match(/[A-Za-z]{2,}/g) || [];
  if (!words.length) return null;
  let hits = 0;
  for (const w of words) if (STOPWORDS.has(w.toLowerCase())) hits++;
  return hits / words.length;
}

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// ---------- page layout ----------

function removeRepeatedText(pages) {
  if (pages.length < 3) return;
  const key = (it) => `${it.str.trim().replace(/\s+/g, ' ')}|${Math.round(it.x / 3)}|${Math.round(it.baseline / 3)}`;
  const counts = new Map();
  for (const p of pages) {
    const seen = new Set();
    for (const it of p.items) {
      const k = key(it);
      if (seen.has(k)) continue;
      seen.add(k);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  // Headers, footers and watermarks repeat at the same spot on most pages. Question text can too
  // (an "(c)" marker in the same place), so only treat margin text or long strings as boilerplate.
  const threshold = Math.max(3, Math.ceil(pages.length * 0.4));
  for (const p of pages) {
    p.items = p.items.filter((it) => {
      if (counts.get(key(it)) < threshold) return true;
      const inMargin = it.baseline < p.height * 0.09 || it.baseline > p.height * 0.9;
      return !(inMargin || it.str.trim().length >= 12);
    });
  }
}

/** Finds a vertical gutter near the middle of the page. Returns the split x or null. */
function findGutter(page) {
  const items = page.items;
  if (items.length < 12) return null;
  const W = Math.ceil(page.width);
  const cover = new Array(W + 1).fill(0);
  for (const it of items) {
    const a = Math.max(0, Math.floor(it.x));
    const b = Math.min(W, Math.ceil(it.x + it.w));
    for (let x = a; x < b; x++) cover[x]++;
  }
  const tolerance = Math.floor(items.length * 0.01);
  const runs = [];
  let runStart = null;
  const lo = Math.floor(W * 0.28);
  const hi = Math.ceil(W * 0.72);
  for (let x = lo; x <= hi + 1; x++) {
    const open = x <= hi && cover[x] <= tolerance;
    if (open && runStart === null) runStart = x;
    if (!open && runStart !== null) {
      const width = x - runStart;
      const center = (runStart + x) / 2;
      if (width >= 4) runs.push({ center, score: width - Math.abs(center - W / 2) * 0.25 });
      runStart = null;
    }
  }
  // Take the best-placed empty strip that has a real column of text on each side. (A gap inside
  // one column, e.g. between widely spaced characters, fails that test; try the next strip.)
  // Measured by text width, not item count: some fonts give one item per character.
  runs.sort((a, b) => b.score - a.score);
  const total = items.reduce((n, it) => n + it.w, 0);
  for (const run of runs) {
    const left = items.reduce((n, it) => n + (it.x < run.center ? it.w : 0), 0);
    if (left >= total * 0.15 && total - left >= total * 0.15) return run.center;
  }
  return null;
}

function buildLines(items, pageNo, col) {
  const sorted = [...items].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const groups = [];
  for (const raw of sorted) {
    // Justified text is sometimes stored letter-spaced ("C l e a n"); squeeze it back.
    const it = /^(?:\S ){2,}\S$/.test(raw.str) ? { ...raw, str: raw.str.replace(/ /g, '') } : raw;
    const g = groups[groups.length - 1];
    if (g && it.baseline - g.baseline <= 0.45 * Math.max(it.size, g.size)) {
      g.items.push(it);
      g.size = Math.max(g.size, it.size);
    } else {
      groups.push({ baseline: it.baseline, size: it.size, items: [it] });
    }
  }
  const lines = [];
  for (const g of groups) {
    g.items.sort((a, b) => a.x - b.x);
    const runs = [];
    let prev = null;
    for (const it of g.items) {
      const gap = prev ? it.x - (prev.x + prev.w) : 0;
      const run = runs[runs.length - 1];
      if (!run || gap > 1.4 * it.size) {
        runs.push({ text: it.str, x: it.x, x2: it.x + it.w });
      } else {
        // Letter-spaced text arrives one character at a time; only a wide gap is a word break there.
        const perChar = prev.str.length === 1 && it.str.length === 1;
        const needsSpace = gap > (perChar ? 0.22 : 0.12) * it.size && !/\s$/.test(run.text) && !/^\s/.test(it.str);
        run.text += (needsSpace ? ' ' : '') + it.str;
        run.x2 = Math.max(run.x2, it.x + it.w);
      }
      prev = it;
    }
    // A bare list marker ("1.", "(a)") set apart from its text by a tab belongs with that text.
    for (let i = runs.length - 2; i >= 0; i--) {
      if (/^\s*(\(?[a-hA-H]\)|\(?\d{1,2}[.)]|[A-H]\.|\([ivx]{1,4}\))\s*$/.test(runs[i].text) && runs[i + 1].x - runs[i].x2 < 40) {
        runs[i].text = `${runs[i].text.trim()} ${runs[i + 1].text}`;
        runs[i].x2 = runs[i + 1].x2;
        runs.splice(i + 1, 1);
      }
    }
    for (const r of runs) r.text = r.text.replace(/\s+/g, ' ').replace(/\(\s+([a-eA-E1-5])\s*\)/g, '($1)').trim();
    const clean = runs.filter((r) => r.text);
    if (!clean.length) continue;
    lines.push({
      page: pageNo,
      col,
      runs: clean,
      text: clean.map((r) => r.text).join('\t'),
      x: clean[0].x,
      x2: Math.max(...clean.map((r) => r.x2)),
      baseline: g.baseline,
      top: g.baseline - g.size,
      bottom: g.baseline + g.size * 0.3,
      size: g.size,
    });
  }
  return lines;
}

const PAGE_NUMBER = /^(page\s*)?\d{1,3}(\s*(of|\/)\s*\d{1,3})?$/i;

function layoutLines(pages) {
  const columns = []; // { page, index, count, lines }
  for (const p of pages) {
    const split = findGutter(p);
    // A right-column question number can start a few points left of the gutter's middle, so an item
    // goes right when most of it lies right of the split, or it starts just short of it.
    const goesRight = (i) => i.x + i.w / 2 >= split || i.x >= split - 8;
    const parts = split === null ? [p.items] : [p.items.filter((i) => !goesRight(i)), p.items.filter(goesRight)];
    parts.forEach((items, index) => {
      const lines = buildLines(items, p.page, index).filter(
        (l) => !(PAGE_NUMBER.test(l.text) && (l.top < p.height * 0.08 || l.bottom > p.height * 0.9))
      );
      if (lines.length) columns.push({ page: p.page, width: p.width, index, count: parts.length, lines });
    });
  }
  // Column edges are usually identical on every page, so use the typical edge for each column slot.
  const edges = new Map();
  for (const c of columns) {
    const k = `${c.count}:${c.index}`;
    if (!edges.has(k)) edges.set(k, { lefts: [], rights: [] });
    edges.get(k).lefts.push(Math.min(...c.lines.map((l) => l.x)));
    edges.get(k).rights.push(Math.max(...c.lines.map((l) => l.x2)));
  }
  for (const c of columns) {
    const e = edges.get(`${c.count}:${c.index}`);
    c.left = median(e.lefts);
    c.right = median(e.rights);
    // Typical distance between wrapped lines in this column, to tell wraps from new paragraphs.
    const gaps = [];
    for (let i = 1; i < c.lines.length; i++) {
      const g = c.lines[i].baseline - c.lines[i - 1].baseline;
      if (g > c.lines[i].size * 0.8) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const lineGap = gaps.length >= 3 ? gaps[Math.floor(gaps.length * 0.3)] : null;
    // Where ordinary text starts on this page. Question numbers hang to the left of it; statement
    // numbers ("1.", "2.") sit at or right of it. Scanned pages drift, so this is measured per page.
    const bodyXs = c.lines.filter((l) => !/^\W{0,2}\w{1,3}\W{0,2}\s/.test(l.runs[0].text) && l.runs[0].text.length > 3).map((l) => l.x);
    const bodyX = bodyXs.length >= 3 ? median(bodyXs) : null;
    for (const l of c.lines) {
      l.bodyX = bodyX;
      l.colLeft = c.left;
      l.colRight = c.right;
      l.lineGap = lineGap;
    }
  }
  return columns;
}

// ---------- language filtering ----------

const devShare = (text) => {
  const chars = text.replace(/\s/g, '').length;
  return chars ? (text.match(DEVANAGARI) || []).length / chars : 0;
};

function filterEnglish(columns) {
  const scored = columns.map((c) => {
    // Score only the Latin-script lines: a column may hold both languages (Unicode Hindi below English).
    const latin = c.lines.filter((l) => devShare(l.text) < 0.3).map((l) => l.text).join(' ');
    const words = (latin.match(/[A-Za-z]{2,}/g) || []).length;
    const devLines = c.lines.length - c.lines.filter((l) => devShare(l.text) < 0.3).length;
    return { c, score: englishScore(latin), words, devLines };
  });
  const hasEnglish = scored.some((s) => s.score !== null && s.score >= 0.12 && s.words >= 20);
  const droppedPages = new Set();
  const kept = [];
  for (const s of scored) {
    // Legacy-font Hindi reads as Latin gibberish with almost no English words.
    const isOther = (s.score !== null && s.words >= 12 && s.score < 0.06) || (s.words < 5 && s.devLines > 3);
    if (hasEnglish && isOther) {
      droppedPages.add(s.c.page);
      continue;
    }
    if (hasEnglish && s.devLines) droppedPages.add(s.c.page);
    // Drop the Unicode Hindi lines of mixed columns.
    s.c.lines = s.c.lines.filter((l) => !hasEnglish || devShare(l.text) < 0.3);
    kept.push(s.c);
  }
  return { columns: kept, droppedPages: droppedPages.size, hasEnglish };
}

/** Pages that are an answer-key table ("1 A 31 D 61 B …"): returns their text and drops them from the columns. */
function takeKeyPages(columns, pagesByNo) {
  const byPage = new Map();
  for (const c of columns) {
    if (!byPage.has(c.page)) byPage.set(c.page, []);
    byPage.get(c.page).push(c);
  }
  const keyPages = new Set();
  const texts = [];
  for (const [page, cols] of byPage) {
    const lines = cols.flatMap((c) => c.lines.map((l) => l.text.replace(/\t/g, ' ')));
    const text = lines.join('\n');
    const pairs = (text.match(/(?:^|\s)\d{1,3}\s*[.)\-:]?\s*\(?[A-Da-d]\)?(?=\s|$)/g) || []).length;
    if (pairs >= 20 && pairs >= lines.length * 0.5) {
      keyPages.add(page);
      // Re-read the page as full-width rows: the key table's columns must stay paired.
      const p = pagesByNo.get(page);
      texts.push(buildLines(p.items, page, 0).map((l) => l.text.replace(/\t/g, ' ')).join('\n'));
    }
  }
  return { columns: columns.filter((c) => !keyPages.has(c.page)), keyText: texts.join('\n') };
}

// ---------- question segmentation ----------

const Q_START = /^(?:Q(?:ues(?:tion)?)?\s*\.?\s*(?:no\.?\s*)?)?(\d{1,3})(?:\s*([.):\-])|\s+(?=[A-Z'"‘“(]))\s*(.*)$/;
const ANSWER_LINE = /^(?:ans(?:wer)?|correct\s+(?:answer|option)|right\s+answer)\s*[.:\-–)]*\s*(?:option\s*)?\(?([a-eA-E1-5])\)?(?=$|[\s.,;)])/i;
const EXPLANATION_LINE = /^(?:explanation|solution|exp\.)\s*[:.\-–]/i;
const KEY_HEADING = /^(?:answer\s*key|answers|answer\s*sheet|key\s*answers?)\s*[:\-–]?\s*$/i;

const OPTION_HINT = /(^|\s)[(\[{]?[a-dA-D][)\]}](?=\s|$|[A-Z0-9])/g;

/** Every line that could start a question: a number hanging at the left margin. */
function questionCandidates(lines) {
  const out = [];
  lines.forEach((line, i) => {
    const m = Q_START.exec(line.runs[0].text);
    if (!m) return;
    const n = parseInt(m[1], 10);
    if (!n) return;
    const width = Math.max(40, line.colRight - line.colLeft);
    const rel = line.x - line.colLeft;
    const strict = rel <= Math.max(10, Math.min(16, width * 0.06));
    // Scanned pages drift sideways, so also accept a number that hangs left of this page's body text.
    const hanging = line.bodyX != null && line.x <= line.bodyX - 5 && rel <= width * 0.2;
    if (!strict && !hanging) return;
    out.push({ i, n, m, strict, punct: !!m[2], page: line.page });
  });
  // A real question is followed by answer options before the next candidate; numbered instructions are not.
  out.forEach((c, k) => {
    const stop = k + 1 < out.length ? out[k + 1].i : lines.length;
    let hints = 0;
    for (let j = c.i; j < Math.min(stop, c.i + 40); j++) hints += (lines[j].text.match(OPTION_HINT) || []).length;
    c.weight = 1 + (hints >= 2 ? 1 : 0) + (c.strict ? 0.1 : 0) + (c.punct ? 0.1 : 0);
  });
  return out;
}

/** The best run of question numbers in document order: rising by 1 (small gaps allowed). */
function numberChain(cands) {
  const best = new Array(cands.length).fill(0);
  const prev = new Array(cands.length).fill(-1);
  let top = -1;
  for (let k = 0; k < cands.length; k++) {
    best[k] = cands[k].weight;
    for (let j = k - 1; j >= 0 && j >= k - 400; j--) {
      const gap = cands[k].n - cands[j].n;
      if (gap < 1 || gap > 4) continue;
      const v = best[j] + cands[k].weight - (gap - 1) * 0.6;
      if (v > best[k]) {
        best[k] = v;
        prev[k] = j;
      }
    }
    if (top < 0 || best[k] > best[top]) top = k;
  }
  const chain = [];
  for (let k = top; k >= 0; k = prev[k]) chain.unshift(cands[k]);
  // Numbered instructions on a cover page (no options after them) are not questions.
  const lead = chain.findIndex((c) => c.weight >= 2);
  if (lead > 0 && chain.slice(0, lead).every((c) => c.page === chain[0].page) && chain[lead].page !== chain[0].page) {
    chain.splice(0, lead);
  }
  // Recover numbers that were misprinted ("5." where "135." belongs) or misread by text
  // recognition ("25." where "15." belongs) when they fill a gap in the run.
  const looksLike = (want, got) => {
    const a = String(want);
    const b = String(got);
    if (a.endsWith(b)) return true;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diff++;
    return diff === 1;
  };
  const filled = [];
  chain.forEach((c, k) => {
    const next = chain[k + 1];
    filled.push(c);
    if (!next || next.n - c.n < 2) return;
    let after = c.i;
    for (let want = c.n + 1; want < next.n; want++) {
      const fix = cands.find((x) => x.i > after && x.i < next.i && x.n !== want && x.punct && looksLike(want, x.n));
      if (!fix) continue;
      filled.push({ ...fix, misnumbered: fix.n, n: want });
      after = fix.i;
    }
  });
  return filled;
}

function segment(lines) {
  const questions = [];
  const chain = numberChain(questionCandidates(lines));
  const starts = new Map(chain.map((c) => [c.i, c]));
  // The run starts at 2 but the page before its first question holds options: that is question 1
  // with its number lost (common in scans).
  if (chain.length && chain[0].n === 2) {
    const first = chain[0].i;
    let k = first;
    while (k > 0 && lines[k - 1].page === lines[first].page) k--;
    const before = lines.slice(k, first).map((l) => l.text).join(' ');
    if (k < first && (before.match(OPTION_HINT) || []).length >= 2) {
      starts.set(k, { i: k, n: 1, m: [null, '1', null, lines[k].runs[0].text], misnumbered: 'unreadable' });
    }
  }
  let current = null;
  let mode = 'body';
  const keyLines = [];
  let inKey = false;
  // A question never runs on past the next page with kept text (this stops the last question from
  // swallowing whatever follows the paper, such as a second paper in the same file).
  const pageOrder = [...new Set(lines.map((l) => l.page))];
  const pageIndex = new Map(pageOrder.map((p, k) => [p, k]));

  lines.forEach((line, i) => {
    if (current && pageIndex.get(line.page) - pageIndex.get(current.startLine.page) > 1) current = null;
    if (inKey) {
      keyLines.push(line.text);
      return;
    }
    if (questions.length >= 5 && KEY_HEADING.test(line.text.replace(/\t/g, ' '))) {
      inKey = true;
      return;
    }
    const start = starts.get(i);
    if (start) {
      const firstRun = { ...line.runs[0], text: start.m[3] || '' };
      current = { num: start.n, lines: [{ ...line, runs: [firstRun, ...line.runs.slice(1)].filter((r) => r.text) }], answer: null, misnumbered: start.misnumbered ?? null };
      if (!current.lines[0].runs.length) current.lines = [];
      current.startLine = line;
      questions.push(current);
      mode = 'body';
      return;
    }
    if (!current) return;
    const flat = line.text.replace(/\t/g, ' ');
    const ans = ANSWER_LINE.exec(flat);
    if (ans) {
      current.answer = labelToIndex(ans[1]);
      mode = 'explanation';
      return;
    }
    if (EXPLANATION_LINE.test(flat)) mode = 'explanation';
    if (mode === 'explanation') return;
    current.lines.push(line);
  });
  return { questions, keyText: keyLines.join('\n') };
}

export function labelToIndex(label) {
  const s = String(label).trim().toLowerCase();
  if (/^[a-e]$/.test(s)) return s.charCodeAt(0) - 97;
  if (/^[1-5]$/.test(s)) return parseInt(s, 10) - 1;
  return null;
}

// ---------- options ----------

const FAMILIES = [
  { labels: ['a', 'b', 'c', 'd', 'e'], wrap: (l) => `\\(${l}\\)` },
  { labels: ['a', 'b', 'c', 'd', 'e'], wrap: (l) => `${l}\\)` },
  { labels: ['A', 'B', 'C', 'D', 'E'], wrap: (l) => `\\(${l}\\)` },
  { labels: ['1', '2', '3', '4', '5'], wrap: (l) => `\\(${l}\\)` },
  { labels: ['A', 'B', 'C', 'D', 'E'], wrap: (l) => `${l}\\)` },
  { labels: ['a', 'b', 'c', 'd', 'e'], wrap: (l) => `${l}\\.` },
  { labels: ['A', 'B', 'C', 'D', 'E'], wrap: (l) => `${l}\\.` },
  // Scanned papers: text recognition garbles "(b)" into "bj", "Id)", "(c", "dl" and so on.
  { labels: ['a', 'b', 'c', 'd'], wrap: (l) => `(?:[(\\[{|lI1]?${l}[)\\]}jl1|]{1,2}|[(\\[{]${l})`, ocr: true },
];

function findMarkers(lines, family) {
  const found = [];
  const alt = family.labels.map(family.wrap).join('|');
  const re = new RegExp(`(^|\\s)(${alt})(?=\\s|$|[A-Z0-9(])`, 'g');
  lines.forEach((line, li) => {
    line.runs.forEach((run, ri) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(run.text))) {
        const pos = m.index + m[1].length;
        const raw = m[2];
        const label = family.labels.findIndex((l) => new RegExp(`^${family.wrap(l)}$`).test(raw));
        const frac = run.text.length ? pos / run.text.length : 0;
        found.push({ li, ri, pos, len: raw.length, label, x: run.x + (run.x2 - run.x) * frac });
      }
    });
  });
  return found;
}

const after = (a, b) => a.li > b.li || (a.li === b.li && (a.ri > b.ri || (a.ri === b.ri && a.pos > b.pos)));

function chooseOptions(lines) {
  let best = null;
  FAMILIES.forEach((family, fi) => {
    const markers = findMarkers(lines, family);
    for (const start of markers.filter((m) => m.label === 0)) {
      const chosen = [start];
      for (let k = 1; k < family.labels.length; k++) {
        const next = markers.find((m) => m.label === k && after(m, start));
        if (!next) break;
        chosen.push(next);
      }
      if (chosen.length < 2) continue;
      // "A. … D." items followed by a "Code:" line are List-I of a matching question, not options.
      if (/^[A-E]$/.test(family.labels[0])) {
        const lastLi = Math.max(...chosen.map((m) => m.li));
        if (lines.slice(lastLi + 1).some((l) => /^code\b/i.test(l.runs[0].text) || /(^|\s)\(?[a-d]\)/.test(l.text))) continue;
      }
      // Prefer more options, then the first family listed, then the first block. A later block is
      // usually the same options repeated in the other language.
      const score = chosen.length * 100 - fi;
      if (!best || score > best.score) {
        const last = chosen.reduce((a, b) => (after(b, a) ? b : a));
        const stop = markers.find((m) => m.label === 0 && after(m, last)) || null;
        best = { score, chosen, stop };
      }
    }
  });
  // Scans lose markers: collect whichever labels can still be read after the "Code:" line.
  if (!best || best.chosen.length < 4) {
    const codeLine = lines.findIndex((l) => /^code\s*[:;.]?/i.test(l.runs[0].text));
    FAMILIES.forEach((family, fi) => {
      if (!/^[a-e]$/.test(family.labels[0])) return;
      const markers = findMarkers(lines, family).filter((m) => codeLine < 0 || m.li > codeLine);
      const chosen = [];
      for (let k = 0; k < 4; k++) {
        const m = markers.find((x) => x.label === k);
        if (m) chosen.push(m);
      }
      if (chosen.length < 2 || (best && chosen.length <= best.chosen.length)) return;
      chosen.sort((a, b) => (after(a, b) ? 1 : -1));
      best = { score: chosen.length * 100 - fi, chosen, stop: null, partial: true };
    });
  }
  if (!best) return null;
  best.chosen.stop = best.stop;
  return best.chosen;
}

function splitOptions(lines, markers) {
  const start = markers[0];
  const options = markers.map((m) => ({ ...m, text: '' }));
  let current = options[0];
  let seq = 0;
  let prevLine = null;
  const optionLines = new Set();
  const end = markers.stop ? markers.stop.li : lines.length;
  for (let li = start.li; li < end; li++) {
    const line = lines[li];
    if (prevLine && line.page === prevLine.page && line.col === prevLine.col &&
        line.baseline - prevLine.baseline > 3 * line.size) break; // far below: not part of the options
    line.runs.forEach((run, ri) => {
      if (li === start.li && ri < start.ri) return;
      const cuts = options
        .filter((o) => o.li === li && o.ri === ri)
        .sort((a, b) => a.pos - b.pos);
      let cursor = li === start.li && ri === start.ri ? start.pos : 0;
      const append = (target, text) => {
        const t = text.trim();
        if (!t) return;
        target.text = target.text ? `${target.text}${/-$/.test(target.text) ? '' : ' '}${t}` : t;
      };
      if (!cuts.length || cuts[0].pos > cursor) {
        const lead = run.text.slice(cursor, cuts.length ? cuts[0].pos : undefined);
        if (lead.trim()) {
          // Continuation text: give it to the option whose marker sits closest to its left.
          const candidates = options.filter((o) => o.opened && o.x <= run.x + 8);
          const maxX = Math.max(...candidates.map((o) => o.x));
          const pick = candidates.filter((o) => Math.abs(o.x - maxX) < 6).sort((a, b) => b.order - a.order)[0];
          append(pick || current, lead);
        }
      }
      cuts.forEach((o, k) => {
        const end = k + 1 < cuts.length ? cuts[k + 1].pos : undefined;
        o.opened = true;
        o.order = ++seq;
        current = o;
        append(o, run.text.slice(o.pos + o.len, end));
      });
    });
    optionLines.add(li);
    prevLine = line;
  }
  return { options: options.map((o) => o.text), optionLines };
}

// ---------- stem ----------

const PARA_START = /^(\d{1,2}[.)]\s|\(?[ivx]{1,4}\)\s|[A-H][.)]\s|\([A-H]\)\s|assertion\s*\([A-Z]\)\s*:|reason\s*\([A-Z]\)\s*:|statement\s*[-–]?\s*[IVX\d]+\s*:|code\s*:)/i;

function buildStem(lines) {
  const blocks = [];
  let prev = null;
  for (const line of lines) {
    const gap = prev && prev.page === line.page && prev.col === line.col ? line.baseline - prev.baseline : 0;
    const last = blocks[blocks.length - 1];
    const near = gap > 0 && gap < 2.2 * line.size;
    if (line.runs.length >= 2) {
      const cells = line.runs.map((r) => ({ text: r.text, x: r.x }));
      if (last && last.type === 'table' && near) last.rows.push(cells);
      else blocks.push({ type: 'table', rows: [cells] });
    } else {
      const run = line.runs[0];
      if (last && last.type === 'table' && near && !PARA_START.test(run.text) && !/^(select|choose) the correct answer/i.test(run.text)) {
        // A wrapped table cell: attach to the cell of the previous row it lines up with.
        const row = last.rows[last.rows.length - 1];
        const cell = [...row].reverse().find((c) => c.x <= run.x + 6);
        if (cell && (cell !== row[0] || run.x < row[1].x - 6)) {
          cell.text += (/-$/.test(cell.text) ? '' : ' ') + run.text;
          prev = line;
          continue;
        }
      }
      const instruction = /^(select|choose) the correct answer/i.test(run.text) && last && last.type === 'p' &&
        (/^\d{1,2}[.)]\s/.test(last.text) || /[.?:)]$/.test(last.text));
      const newPara = !last || last.type !== 'p' || PARA_START.test(run.text) || instruction || !near || gap > (line.lineGap ? line.lineGap * 1.2 : 1.6 * line.size);
      if (newPara) blocks.push({ type: 'p', text: run.text });
      else last.text += (/-$/.test(last.text) ? '' : ' ') + run.text;
    }
    prev = line;
  }
  return blocks.map((b) => {
    if (b.type !== 'table') return b;
    // Glue a bare list marker ("1.") to the cell that follows it.
    const rows = b.rows.map((r) => r.map((c) => c.text).reduce((acc, t) => {
      if (acc.length && /^(\d{1,2}|[A-H])[.)]$/.test(acc[acc.length - 1])) acc[acc.length - 1] += ` ${t}`;
      else acc.push(t);
      return acc;
    }, []));
    // A one-row "table" is usually a sentence with a wide gap in it.
    if (rows.length === 1 && rows[0].length === 2 && !/^[A-F]$/.test(rows[0][0])) return { type: 'p', text: rows[0].join('   ') };
    return { type: 'table', rows };
  });
}

/** "A B C D" header + options like "4 1 2 3" become "A-4, B-1, C-2, D-3". */
function applyCodeHeader(stem, options) {
  const last = stem[stem.length - 1];
  if (!last) return;
  let header = null;
  if (last.type === 'table' && last.rows.length === 1) header = last.rows[0];
  else if (last.type === 'p') header = last.text.split(/\s+/);
  if (!header || header.length < 3 || !header.every((h) => /^[A-F]$/.test(h))) return;
  const digits = options.map((o) => o.split(/[\s,]+/).filter(Boolean));
  if (!digits.every((d) => d.length === header.length && d.every((v) => /^\d{1,2}$/.test(v)))) return;
  stem.pop();
  digits.forEach((d, i) => {
    options[i] = header.map((h, k) => `${h}-${d[k]}`).join(', ');
  });
}

function regionsFor(lines, pagesByNo) {
  const groups = new Map();
  for (const l of lines) {
    const k = `${l.page}:${l.col}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(l);
  }
  return [...groups.values()].map((ls) => {
    const p = pagesByNo.get(ls[0].page);
    const pad = 4;
    return {
      page: ls[0].page,
      x0: Math.max(0, Math.min(ls[0].colLeft, ...ls.map((l) => l.x)) - pad),
      x1: Math.min(p.width, Math.max(ls[0].colRight, ...ls.map((l) => l.x2)) + pad),
      y0: Math.max(0, Math.min(...ls.map((l) => l.top)) - pad),
      y1: Math.min(p.height, Math.max(...ls.map((l) => l.bottom)) + pad),
    };
  });
}

// ---------- entry point ----------

export function parseQuestions(inputPages) {
  const pages = inputPages.map((p) => ({ ...p, items: [...p.items] }));
  const pagesByNo = new Map(pages.map((p) => [p.page, p]));
  removeRepeatedText(pages);
  const { columns: laidOut, keyText: tableKey } = takeKeyPages(layoutLines(pages), pagesByNo);
  const { columns, droppedPages, hasEnglish } = filterEnglish(laidOut);
  const lines = columns.flatMap((c) => c.lines);
  const { questions: raw, keyText: trailingKey } = segment(lines);
  const keyText = [tableKey, trailingKey].filter(Boolean).join('\n');

  let questions = raw.map((q) => {
    const warnings = [];
    if (q.misnumbered === 'unreadable') warnings.push('The question number could not be read in the PDF.');
    else if (q.misnumbered !== null && q.misnumbered !== undefined) warnings.push(`Printed as question ${q.misnumbered} in the PDF.`);
    const markers = chooseOptions(q.lines);
    let stemLines = q.lines;
    let options = [];
    let optionLineIdx = new Set();
    if (markers) {
      const first = markers[0];
      stemLines = q.lines.slice(0, first.li);
      const firstLine = q.lines[first.li];
      const before = firstLine.runs.slice(0, first.ri).map((r) => ({ ...r }));
      const lead = firstLine.runs[first.ri].text.slice(0, first.pos).trim();
      if (lead) before.push({ ...firstLine.runs[first.ri], text: lead });
      if (before.length) stemLines = [...stemLines, { ...firstLine, runs: before }];
      const split = splitOptions(q.lines, markers);
      // Place each option by its label: a scan may have lost some markers.
      markers.forEach((m, k) => { options[m.label] = split.options[k]; });
      options = Array.from({ length: Math.max(...markers.map((m) => m.label)) + 1 }, (_, k) => options[k] || '');
      optionLineIdx = split.optionLines;
    } else {
      warnings.push('No answer options were found.');
    }
    const stem = buildStem(stemLines);
    applyCodeHeader(stem, options);
    if (options.length && options.length < 4) warnings.push(`Only ${options.length} options were found.`);
    if (options.some((o) => !o)) warnings.push('An option is empty.');
    // Where the options could not all be read, keep the whole block so the PDF snippet shows them.
    const used = options.length < 4 || options.some((o) => !o)
      ? q.lines
      : q.lines.filter((l, i) => i < markers[0].li || optionLineIdx.has(i));
    const regionLines = [q.startLine, ...used.filter((l) => l !== q.lines[0])];
    const text = [stem.map((b) => (b.type === 'p' ? b.text : b.rows.flat().join(' '))).join(' '), ...options].join(' ');
    const regions = regionsFor(regionLines, pagesByNo);
    // The number line was lost, and often the line of text beside it: show a little more above.
    if (q.misnumbered === 'unreadable' && regions[0]) regions[0].y0 = Math.max(0, regions[0].y0 - 30);
    return {
      num: q.num,
      stem,
      options,
      answer: q.answer,
      regions,
      warnings,
      score: englishScore(text),
    };
  });

  // When numbering repeats (e.g. one section per language), keep the most English copy.
  const bestByNum = new Map();
  for (const q of questions) {
    const prev = bestByNum.get(q.num);
    if (!prev || (q.score ?? 0) > (prev.score ?? 0) || (q.score === prev.score && q.options.length > prev.options.length)) {
      bestByNum.set(q.num, q);
    }
  }
  questions = questions.filter((q) => bestByNum.get(q.num) === q);
  if (hasEnglish) questions = questions.filter((q) => q.score === null || q.score >= 0.04 || q.options.length >= 2);
  questions.sort((a, b) => a.num - b.num);

  // In a paper of four-option questions, give unreadable ones four blank options: the PDF view shows the
  // real ones and the answer can still be picked by number.
  const counts = questions.map((q) => q.options.length).sort((a, b) => a - b);
  const typical = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  const unreadable = questions.filter((q) => q.options.length < 4 || q.options.some((o) => !o)).length;
  if (typical >= 4 || unreadable > questions.length * 0.3) {
    for (const q of questions) {
      if (q.options.length >= 4) continue;
      while (q.options.length < 4) q.options.push('');
      q.warnings = q.warnings.filter((w) => !/options were found|option is empty/.test(w));
      q.warnings.push('Some options could not be read. Check them in the PDF view.');
    }
  }
  const lowTextQuality = questions.length > 0 && unreadable > questions.length * 0.3;

  const nums = questions.map((q) => q.num);
  const missing = [];
  if (nums.length) for (let n = nums[0]; n <= nums[nums.length - 1]; n++) if (!nums.includes(n)) missing.push(n);

  questions.forEach((q, i) => {
    q.id = `q${q.num}-${i}`;
    delete q.score;
  });

  return {
    questions,
    keyText,
    stats: {
      pages: pages.length,
      found: questions.length,
      missing,
      skippedPages: droppedPages,
      withWarnings: questions.filter((q) => q.warnings.length).length,
      lowTextQuality,
    },
  };
}
export const _internal = { findGutter, removeRepeatedText, layoutLines, filterEnglish, segment, chooseOptions, findMarkers, FAMILIES };
