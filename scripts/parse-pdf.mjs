// Usage: node scripts/parse-pdf.mjs path/to/paper.pdf [--json out.json] [--show 1,2,3]
// Runs the same extraction + parsing code the web app uses and prints a report.
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { loadPdf, extractPages } from '../js/extract.js';
import { parseQuestions } from '../js/parser.js';
import { formatQuestion } from '../js/format.js';

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node scripts/parse-pdf.mjs paper.pdf [--json out.json] [--show 1,2,3|all]');
  process.exit(1);
}
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
const doc = await loadPdf(pdfjs, new Uint8Array(fs.readFileSync(file)));
const pages = await extractPages(doc);
const result = parseQuestions(pages);
console.log(JSON.stringify(result.stats));
const show = opt('--show');
for (const q of result.questions) {
  if (show === 'all' || (show && show.split(',').map(Number).includes(q.num)) || q.warnings.length) {
    console.log('\n' + formatQuestion(q));
  }
}
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(result, null, 2));
