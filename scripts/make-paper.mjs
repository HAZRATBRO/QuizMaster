// Adds a question paper to the built-in paper library (papers/), so it shows in the app ready to take.
// Only the extracted questions and answers are stored, not the PDF.
//
// Usage: node scripts/make-paper.mjs paper.pdf --id uppsc-2025-gs1 --title "UPPSC Prelims 2025 · GS Paper I"
//          [--note "Question order of the … edition"] [--key-from papers/other.json]
//   --key-from  copy answers from a library paper with the same questions in another order

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { loadPdf, extractPages } from '../js/extract.js';
import { parseQuestions } from '../js/parser.js';
import { parseAnswerKey } from '../js/answerkey.js';
import { transferKey } from '../js/match.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const file = args[0];
const id = opt('--id');
const title = opt('--title');
if (!file || !id || !title) {
  console.error('Usage: node scripts/make-paper.mjs paper.pdf --id <id> --title <title> [--note <text>] [--key-from papers/x.json]');
  process.exit(1);
}

const doc = await loadPdf(pdfjs, new Uint8Array(fs.readFileSync(file)));
const pages = await extractPages(doc);
const result = parseQuestions(pages);
const questions = result.questions;
if (result.keyText) {
  const key = parseAnswerKey(result.keyText);
  for (const q of questions) if (key.has(q.num)) q.answer = key.get(q.num);
}
let keySource = result.keyText ? 'answer key printed in the PDF' : null;
const from = opt('--key-from');
if (from) {
  const other = JSON.parse(fs.readFileSync(from, 'utf8'));
  const r = transferKey(other.questions, questions);
  for (const q of questions) if ((q.answer === null || q.answer === undefined) && r.answers.has(q.id)) q.answer = r.answers.get(q.id);
  keySource = `copied from "${other.title}" by matching question wording`;
  console.log(`Copied ${r.copied} answers from ${other.title}. Unsure: ${r.unsure.join(', ') || 'none'}`);
}

const keyed = questions.filter((q) => q.answer !== null && q.answer !== undefined).length;
const paper = {
  id,
  title,
  note: opt('--note') || '',
  pageCount: pages.length,
  stats: result.stats,
  keySource,
  questions,
};
const dir = path.join(root, 'papers');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(paper));

const indexPath = path.join(dir, 'index.json');
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
const entry = { id, title, note: paper.note, file: `${id}.json`, questions: questions.length, keyed, keySource };
const at = index.findIndex((p) => p.id === id);
if (at >= 0) index[at] = entry;
else index.push(entry);
fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`papers/${id}.json: ${questions.length} questions, ${keyed} answers`);
