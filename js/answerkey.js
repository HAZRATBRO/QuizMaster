// Reads an answer key typed or pasted in almost any common layout. Answers are returned
// as 0-based option indexes keyed by question number.
//
//   "1-a, 2-c, 3 d"   "1. (b) 2. (a)"   "Q1: 3"   one answer per line ("b" or "2")
//   a row of numbers followed by a row of letters (tabular keys)
//   a bare run of letters "abdcabd..." (answers for 1, 2, 3, ...)

import { labelToIndex } from './parser.js';

const PAIR = /(?:^|[^\w(])Q?\.?\s*(\d{1,3})\s*[.):\-=–]?\s*\(?\s*([a-eA-E1-5])\s*\)?(?![\w])/g;

function pairs(text) {
  const out = new Map();
  let m;
  PAIR.lastIndex = 0;
  while ((m = PAIR.exec(text))) {
    const n = parseInt(m[1], 10);
    const idx = labelToIndex(m[2]);
    if (n > 0 && idx !== null && !out.has(n)) out.set(n, idx);
    PAIR.lastIndex = m.index + m[0].length;
  }
  return out;
}

function tabular(text) {
  const out = new Map();
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i + 1 < lines.length; i++) {
    const nums = lines[i].split(/[\s,|]+/);
    const ans = lines[i + 1].split(/[\s,|]+/).map((t) => t.replace(/[()]/g, ''));
    if (nums.length < 2 || nums.length !== ans.length) continue;
    if (!nums.every((t) => /^\d{1,3}$/.test(t))) continue;
    if (!ans.every((t) => /^[a-eA-E]$/.test(t))) continue;
    nums.forEach((t, k) => out.set(parseInt(t, 10), labelToIndex(ans[k])));
    i++;
  }
  return out;
}

function sequence(text) {
  const out = new Map();
  const tokens = text.split(/[\s,;|]+/).filter(Boolean);
  let letters = [];
  if (tokens.length === 1 && /^[a-eA-E]{3,}$/.test(tokens[0])) letters = tokens[0].split('');
  else if (tokens.length > 1 && tokens.every((t) => /^\(?[a-eA-E1-5]\)?$/.test(t))) letters = tokens.map((t) => t.replace(/[()]/g, ''));
  letters.forEach((l, i) => out.set(i + 1, labelToIndex(l)));
  return out;
}

/** Returns a Map of question number -> option index (0-based). */
export function parseAnswerKey(text) {
  if (!text || !text.trim()) return new Map();
  const candidates = [tabular(text), sequence(text), pairs(text)];
  return candidates.reduce((best, c) => (c.size > best.size ? c : best), new Map());
}

/** Compact text form of a key, e.g. "1-c, 2-a, 3-d". */
export function formatAnswerKey(questions) {
  return questions
    .filter((q) => q.answer !== null && q.answer !== undefined)
    .map((q) => `${q.num}-${q.answer + 1}`)
    .join(', ');
}
