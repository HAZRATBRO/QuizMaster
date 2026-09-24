// Copies an answer key between two versions of the same paper (booklet series A/B/C/D, a coaching
// reprint, a scan). Questions are paired by their wording and answers by the text of the options,
// because both the question order and the option order can differ between versions.

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  // Text recognition slips: "land2" for "1 and 2", "I" or "l" for "1", words run together with digits.
  .replace(/([a-z])(\d)/g, '$1 $2')
  .replace(/(\d)([a-z])/g, '$1 $2')
  .replace(/\bland\b/g, '1 and')
  .replace(/\b[il]\b/g, '1')
  .replace(/\s+/g, ' ')
  .trim();

const questionText = (q) => q.stem.map((b) => (b.type === 'p' ? b.text : b.rows.flat().join(' '))).join(' ');

function words(s) {
  return norm(s).split(' ').filter((w) => w.length > 1 || /\d/.test(w));
}

function bag(list) {
  const m = new Map();
  for (const w of list) m.set(w, (m.get(w) || 0) + 1);
  return m;
}

/** Overlap of two word bags (0..1, Dice coefficient). */
function similarity(a, b) {
  let common = 0;
  let total = 0;
  for (const [w, n] of a) {
    total += n;
    if (b.has(w)) common += Math.min(n, b.get(w));
  }
  for (const n of b.values()) total += n;
  return total ? (2 * common) / total : 0;
}

/** Similarity of two short option texts; exact matches after normalising win outright. */
function optionSimilarity(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // Match-the-list codes such as "A-4, B-1, C-2, D-3" must agree digit for digit.
  const dx = x.replace(/\D/g, '');
  const dy = y.replace(/\D/g, '');
  if (dx.length >= 3 && dy.length >= 3 && /[a-d]\s*\d/.test(x) && /[a-d]\s*\d/.test(y)) return dx === dy ? 0.95 : 0;
  // Short code options ("Only 1 and 3", "2, 3 and 4", "Neither 1 nor 2") must agree on every number
  // and every qualifier; sharing most words is not enough.
  if (dx && dy && x.length < 40 && y.length < 40) {
    const sig = (t) => `${t.replace(/\D/g, '')}|${t.split(' ').filter((w) => /^(only|both|neither|nor|all|none|and|or)$/.test(w)).join(' ')}`;
    return sig(x) === sig(y) ? 0.95 : 0.2;
  }
  // Word order is ignored here, so cap below an exact match: "(A) is true, but (R) is false" and
  // "(A) is false, but (R) is true" use the same words.
  return Math.min(0.9, similarity(bag(words(a)), bag(words(b))));
}

function elimination(options, want, count) {
  if (options.length !== count) return null;
  const blank = options.map((o, i) => (norm(o).length < 3 ? i : -1)).filter((i) => i >= 0);
  if (blank.length !== 1) return null;
  const others = options.filter((_, i) => i !== blank[0]);
  return others.every((o) => optionSimilarity(want, o) < 0.5) ? blank[0] : null;
}

/**
 * Copies answers from `source` questions onto `target` questions.
 * Returns { answers: Map(targetId -> index), matched, copied, unmatched: [targetNum], unsure: [targetNum] }.
 */
export function transferKey(source, target, { minQuestion = 0.55, minOption = 0.6 } = {}) {
  const keyed = source.filter((q) => q.answer !== null && q.answer !== undefined);
  const src = keyed.map((q) => ({ q, bag: bag(words(`${questionText(q)} ${q.options.join(' ')}`)), stem: bag(words(questionText(q))) }));
  const tgt = target.map((q) => ({ q, bag: bag(words(`${questionText(q)} ${q.options.join(' ')}`)), stem: bag(words(questionText(q))) }));

  // Score every pair, then pair greedily from the most similar down so each question is used once.
  const pairs = [];
  for (const t of tgt) {
    for (const s of src) {
      const score = 0.7 * similarity(t.stem, s.stem) + 0.3 * similarity(t.bag, s.bag);
      if (score >= minQuestion * 0.8) pairs.push({ t, s, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const usedT = new Set();
  const usedS = new Set();
  const answers = new Map();
  const unsure = [];
  let matched = 0;
  for (const { t, s, score } of pairs) {
    if (usedT.has(t.q.id) || usedS.has(s.q.id)) continue;
    usedT.add(t.q.id);
    usedS.add(s.q.id);
    if (score < minQuestion) {
      unsure.push(t.q.num);
      continue;
    }
    matched++;
    const want = s.q.options[s.q.answer];
    const scored = t.q.options.map((o, i) => ({ i, sim: optionSimilarity(want, o) })).sort((a, b) => b.sim - a.sim);
    const best = scored[0];
    const runnerUp = scored[1];
    if (best && best.sim >= minOption && (!runnerUp || best.sim - runnerUp.sim >= 0.1 || (best.sim === 1 && runnerUp.sim < 1))) {
      answers.set(t.q.id, best.i);
    } else if (elimination(t.q.options, want, s.q.options.length) !== null) {
      // One option is unreadable and none of the readable ones is the answer, so it must be that one.
      answers.set(t.q.id, elimination(t.q.options, want, s.q.options.length));
    } else {
      // Never fall back to the same position: versions of a paper shuffle the options too.
      unsure.push(t.q.num);
    }
  }
  const unmatched = target.filter((q) => !usedT.has(q.id)).map((q) => q.num);
  return { answers, matched, copied: answers.size, unmatched, unsure: [...new Set(unsure)].sort((a, b) => a - b) };
}
