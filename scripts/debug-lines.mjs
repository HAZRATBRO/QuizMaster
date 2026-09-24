// Prints the laid-out text lines for chosen pages: node scripts/debug-lines.mjs paper.pdf 3,4
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { loadPdf, extractPages } from '../js/extract.js';
import { _internal as I } from '../js/parser.js';
const doc = await loadPdf(pdfjs, new Uint8Array(fs.readFileSync(process.argv[2])));
const pages = await extractPages(doc);
I.removeRepeatedText(pages);
const cols = I.filterEnglish(I.layoutLines(pages)).columns;
const want = process.argv[3].split(',').map(Number);
for (const c of cols) if (want.includes(c.page)) { console.log('== page', c.page, 'col', c.index, 'left', c.left, 'right', c.right); for (const l of c.lines) console.log(Math.round(l.x), Math.round(l.baseline), JSON.stringify(l.runs.map(r=>r.text))); }
