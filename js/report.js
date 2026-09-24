// Scoring and performance statistics for a finished (or running) attempt. Pure data, no DOM.

export const hasAnswer = (q) => q.answer !== null && q.answer !== undefined;
const round2 = (n) => Math.round(n * 100) / 100;

/** Rough question style, read from the question text. */
export function questionType(q) {
  const text = q.stem.map((b) => (b.type === 'p' ? b.text : b.rows.flat().join(' '))).join(' ');
  if (/assertion\s*\(?a\)?/i.test(text) && /reason\s*\(?r\)?/i.test(text)) return 'Assertion and reason';
  if (/match\s+list|list\s*[-–]?\s*i\b.*list\s*[-–]?\s*ii/i.test(text)) return 'Match the lists';
  if (/chronolog|arrange|correct\s+order|sequence/i.test(text)) return 'Order and chronology';
  if (/pairs?\b.*\bmatched/i.test(text)) return 'Matched pairs';
  if (/statements?\b/i.test(text) || q.stem.some((b) => b.type === 'p' && /^\d\.\s/.test(b.text))) return 'Statements';
  return 'Direct question';
}

export function scoreAttempt(quiz, attempt) {
  const byId = new Map(quiz.questions.map((q) => [q.id, q]));
  const { plus, minus } = attempt.settings;
  const timeSpent = attempt.timeSpent || {};
  const changes = attempt.changes || {};
  const rows = [];
  let correct = 0, wrong = 0, skipped = 0, unscored = 0;
  attempt.order.forEach((qid, index) => {
    const q = byId.get(qid);
    if (!q) return;
    const resp = attempt.responses[qid];
    const answered = resp !== undefined && resp !== null;
    let status;
    if (!hasAnswer(q)) { status = 'unscored'; unscored++; }
    else if (!answered) { status = 'skipped'; skipped++; }
    else if (resp === q.answer) { status = 'correct'; correct++; }
    else { status = 'wrong'; wrong++; }
    rows.push({
      q, index, status,
      resp: answered ? resp : null,
      marked: !!attempt.marked[qid],
      visited: !!(attempt.visited && attempt.visited[qid]),
      time: Math.round(timeSpent[qid] || 0),
      changes: changes[qid] || 0,
      type: questionType(q),
    });
  });
  const scored = correct + wrong + skipped;
  return {
    rows, correct, wrong, skipped, unscored,
    score: round2(correct * plus - wrong * minus),
    max: round2(scored * plus),
    accuracy: correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : null,
    attempted: rows.filter((r) => r.resp !== null).length,
  };
}

const avg = (rows) => (rows.length ? Math.round(rows.reduce((n, r) => n + r.time, 0) / rows.length) : null);

/** Everything the performance report shows. `history` is every submitted attempt of the same quiz. */
export function analyze(quiz, attempt, history = []) {
  const s = scoreAttempt(quiz, attempt);
  const { plus, minus } = attempt.settings;
  const tracked = s.rows.some((r) => r.time > 0);
  const answered = s.rows.filter((r) => r.resp !== null);

  const types = new Map();
  for (const r of s.rows) {
    if (!types.has(r.type)) types.set(r.type, { type: r.type, total: 0, correct: 0, wrong: 0, skipped: 0, unscored: 0, time: 0 });
    const t = types.get(r.type);
    t.total++;
    t[r.status]++;
    t.time += r.time;
  }
  const byType = [...types.values()]
    .map((t) => ({ ...t, accuracy: t.correct + t.wrong ? Math.round((t.correct / (t.correct + t.wrong)) * 100) : null, avgTime: t.total ? Math.round(t.time / t.total) : 0 }))
    .sort((a, b) => b.total - a.total);

  const marked = s.rows.filter((r) => r.marked);
  const changed = s.rows.filter((r) => r.changes > 0);
  const timeUsed = attempt.timeUsedSec ?? Math.round(((attempt.submittedAt || Date.now()) - (attempt.startedAt || Date.now())) / 1000);

  const past = history
    .filter((h) => h.status === 'submitted')
    .sort((a, b) => a.submittedAt - b.submittedAt)
    .map((h) => {
      const hs = scoreAttempt(quiz, h);
      return { id: h.id, at: h.submittedAt, score: hs.score, max: hs.max, accuracy: hs.accuracy, attempted: hs.attempted, timeUsed: h.timeUsedSec, current: h.id === attempt.id };
    });

  return {
    ...s,
    percent: s.max ? Math.round((s.score / s.max) * 1000) / 10 : null,
    marks: {
      gained: round2(s.correct * plus),
      lost: round2(s.wrong * minus),
      withoutNegative: round2(s.correct * plus),
      plus, minus,
    },
    time: {
      tracked,
      used: timeUsed,
      limit: attempt.durationSec,
      perAnswered: avg(answered),
      perCorrect: avg(s.rows.filter((r) => r.status === 'correct')),
      perWrong: avg(s.rows.filter((r) => r.status === 'wrong')),
      over2min: s.rows.filter((r) => r.time > 120).length,
      slowest: [...s.rows].filter((r) => r.time > 0).sort((a, b) => b.time - a.time).slice(0, 5),
      maxTime: Math.max(0, ...s.rows.map((r) => r.time)),
    },
    byType,
    marked: { total: marked.length, correct: marked.filter((r) => r.status === 'correct').length, wrong: marked.filter((r) => r.status === 'wrong').length, blank: marked.filter((r) => r.resp === null).length },
    changed: { total: changed.length, correct: changed.filter((r) => r.status === 'correct').length, wrong: changed.filter((r) => r.status === 'wrong').length },
    notVisited: s.rows.filter((r) => !r.visited).length,
    past,
  };
}
