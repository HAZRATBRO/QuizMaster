# QuizMaster

QuizMaster turns a PDF question paper into a timed multiple-choice test that runs in the browser.

1. **Import a PDF.** The app finds each numbered question, its statements or tables, and options (a)–(d). Options are shown as 1–4.
2. **Add the answer key.** Paste it in almost any format, load it from a text or PDF file, or click the correct option on each question.
3. **Take the test.** You get a timer, a question palette and the usual exam controls: select, unselect, clear response, mark for review, previous, and save & next.
4. **Review the result.** You see your score with negative marking and a per-question review of your answer against the correct one.

Each question can be shown as parsed **text**, as the original **PDF snippet** cropped from the page, or both.

Everything runs locally. The PDF is read in the browser with [pdf.js](https://mozilla.github.io/pdf.js/). Tests, PDFs and attempts are saved in the browser's IndexedDB, and nothing is uploaded.

## Running it

It is a static site with no build step. ES modules need an HTTP server, so it does not work from `file://`.

```bash
npm start            # serves http://localhost:8080
```

Any static host works too. pdf.js is loaded from jsDelivr at runtime.

### GitHub Pages

`.github/workflows/pages.yml` runs the tests and publishes `index.html`, `css/` and `js/` to GitHub Pages on every push to `main` (or the current default branch), or when run by hand from the Actions tab. The site is served at `https://<owner>.github.io/<repo>/`. If the first run fails at *Configure Pages*, open **Settings → Pages**, set **Source** to **GitHub Actions**, and re-run the workflow.

To get a single self-contained HTML file (CSS and JS inlined):

```bash
node scripts/build-single.mjs dist/quizmaster.html
```

## How questions are extracted

`js/parser.js` works on positioned text from pdf.js:

- **Layout.** Repeated headers, footers and page numbers are removed. Two-column pages are split at the gutter, and text is rebuilt into lines and cells.
- **Language.** Bilingual papers often set Hindi in legacy fonts (Kruti Dev, Chanakya) that come through as Latin gibberish, or in Unicode Devanagari. Columns or lines that are not English are dropped. When a question number appears twice, the more English copy is kept.
- **Questions.** A question starts at a number (`12.`, `12)`, `Q12`) at the column's left margin, in sequence. Indented statement numbers are not mistaken for questions. A misprinted number such as `5.` where `135.` was expected is recovered, and the question is flagged.
- **Options.** `(a)`–`(d)` are found even when two options share a line or are laid out in column order. Other styles (`a)`, `(A)`, `(1)`, `A.`) are used as fallbacks. For match-the-list questions, a code table under `A B C D` becomes `A-4, B-1, C-2, D-3`.
- **Answers in the PDF.** `Answer: (b)` lines and an `Answer key` section at the end are picked up automatically.

Every question keeps the page regions it came from, so the app can draw the original snippet. Questions that look incomplete are flagged for review in the editor, where the text and options can be edited.

Scanned PDFs, which are images with no text layer, need OCR before import.

## Answer key formats

All of these work:

```
1-c, 2-a, 3-d          1 (b) 2 (a) 3 (d)          Q1: 3  Q2: 1
1 2 3 4                abdcab…                    one answer per line
b a d c
```

Letters `a–d` and numbers `1–4` mean the same option.

## Development

```bash
npm install                                   # pdfjs-dist, used by the Node scripts
npm test                                      # unit tests (parser, answer key)
node scripts/parse-pdf.mjs paper.pdf --show all      # print what the parser finds
node scripts/parse-pdf.mjs paper.pdf --json out.json
node scripts/debug-lines.mjs paper.pdf 3,4           # the laid-out lines on pages 3 and 4
```

| File | Purpose |
| --- | --- |
| `js/extract.js` | pdf.js → positioned text items per page |
| `js/parser.js` | items → questions (layout, language filter, options, tables, snippet regions) |
| `js/answerkey.js` | answer key text → answers |
| `js/pdfview.js` | loads pdf.js in the browser and draws question snippets |
| `js/store.js` | IndexedDB storage |
| `js/app.js` | the interface: library, editor and key, test setup, exam, results |

Tested on the UPPCS Prelims 2025 GS Paper I (Drishti edition, 49 pages, Hindi and English on alternate pages). All 150 English questions were extracted with 4 options each, and the Hindi pages were skipped.
