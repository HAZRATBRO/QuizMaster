# QuizMaster

QuizMaster turns a PDF question paper into a timed multiple-choice test that runs in the browser.

1. **Import a PDF.** The app finds each numbered question, its statements or tables, and options (a)–(d). Options are shown as 1–4.
2. **Add the answer key.** An answer key printed in the PDF is read automatically, whether it is a table at the front or a section at the end. You can also paste one in almost any format, load it from a text or PDF file, click the correct option on each question, or **copy the answers from another test of the same paper**.
3. **Schedule the test.** Pick the time limit, marking scheme, question range and start time: now, or a set date and time. The test opens in its own tab with instructions and, for a set time, a countdown that starts the test on its own. The test tab has a timer, a question palette and the usual exam controls: select, unselect, clear response, mark for review, previous, and save & next. When time runs out, the test is submitted automatically.
4. **Read the performance report.** It opens in the test tab as soon as the test ends. It shows your score with negative marking, correct, wrong and unanswered counts, accuracy, marks lost to negative marking, time per question (as a chart), accuracy by question type, review-mark and answer-change habits, and your earlier attempts. Below that is every question with your answer and the correct one.

**Paper library.** Past papers are built in, ready to add to your tests: UPPSC Prelims 2025 GS Paper I in two question orders, with answer keys. Only the questions and answers are included, not the PDFs. Attach your own copy to see the original pages.

Each question can be shown as parsed **text**, as the original **PDF snippet** cropped from the page, or both.

Everything runs locally. The PDF is read in the browser with [pdf.js](https://mozilla.github.io/pdf.js/). Tests, PDFs and attempts are saved in the browser's IndexedDB, and nothing is uploaded.

## Running it

It is a static site with no build step. ES modules need an HTTP server, so it does not work from `file://`.

```bash
npm start            # serves http://localhost:8080
```

Any static host works too. pdf.js is loaded from jsDelivr at runtime.

### GitHub Pages

`.github/workflows/pages.yml` runs the tests and publishes `index.html`, `css/`, `js/` and `papers/` to GitHub Pages on every push to `main` (or the current default branch), or when run by hand from the Actions tab. The site is served at `https://<owner>.github.io/<repo>/`. If the first run fails at *Configure Pages*, open **Settings → Pages**, set **Source** to **GitHub Actions**, and re-run the workflow.

To get a single self-contained HTML file (CSS and JS inlined):

```bash
node scripts/build-single.mjs dist/quizmaster.html
```

## How questions are extracted

`js/parser.js` works on positioned text from pdf.js:

- **Layout.** Repeated headers, footers and page numbers are removed. Two-column pages are split at the gutter, and text is rebuilt into lines and cells.
- **Language.** Bilingual papers often set Hindi in legacy fonts (Kruti Dev, Chanakya) that come through as Latin gibberish, or in Unicode Devanagari. Columns or lines that are not English are dropped. When a question number appears twice, the more English copy is kept.
- **Questions.** A question starts at a number (`12.`, `12)`, `Q12`) hanging at the left margin. The parser picks the longest run of rising numbers across the whole document, favouring numbers that are followed by options. That skips numbered cover-page instructions, a second paper in the same file, and lost or misread numbers. Indented statement numbers are not mistaken for questions. A misprinted number such as `5.` where `135.` was expected is recovered, and the question is flagged.
- **Options.** `(a)`–`(d)` are found even when two options share a line or are laid out in column order. Other styles (`a)`, `(A)`, `(1)`, `A.`) are used as fallbacks. For match-the-list questions, a code table under `A B C D` becomes `A-4, B-1, C-2, D-3`.
- **Answers in the PDF.** `Answer: (b)` lines, an `Answer key` section at the end, and answer-key table pages (`1 A 31 D 61 B …`) anywhere in the file are picked up automatically.

Every question keeps the page regions it came from, so the app can draw the original snippet. Questions that look incomplete are flagged for review in the editor, where the text and options can be edited.

**Scanned papers.** A scan with a text layer from text recognition (OCR) imports too. The garbled text is still good enough to find the questions, and the app then shows each question as its cropped scan image, with options answerable by number. A scan with no text layer at all needs OCR first.

## Copying an answer key between versions

Exams print several booklet series (A/B/C/D), and coaching institutes reprint papers, each in its own question and option order. `js/match.js` pairs questions by their wording and picks the answer by the option text, not its position. Options that are nearly the same (the four assertion-and-reason choices) must match exactly. Code options such as `Only 1 and 3` must agree on every number. If exactly one option is unreadable in a scan and no readable option is the answer, the unreadable one is chosen. Anything unsure is left blank for you. Importing a paper that matches a test that already has a key offers to copy it.

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
npm test                                      # unit tests (parser, answer key, report, key copying)
node scripts/parse-pdf.mjs paper.pdf --show all      # print what the parser finds
node scripts/parse-pdf.mjs paper.pdf --json out.json
node scripts/debug-lines.mjs paper.pdf 3,4           # the laid-out lines on pages 3 and 4
node scripts/make-paper.mjs paper.pdf --id <id> --title "<title>" [--key-from papers/<other>.json]   # add to the paper library
```

| File | Purpose |
| --- | --- |
| `js/extract.js` | pdf.js → positioned text items per page |
| `js/parser.js` | items → questions (layout, language filter, options, tables, snippet regions) |
| `js/answerkey.js` | answer key text → answers |
| `js/pdfview.js` | loads pdf.js in the browser and draws question snippets |
| `js/store.js` | IndexedDB storage |
| `js/report.js` | scoring and performance statistics |
| `js/match.js` | copying an answer key between versions of a paper |
| `papers/` | the built-in paper library (questions and answers as JSON) |
| `js/app.js` | the interface: library, editor and key, scheduling, the test tab, the report |

Tested on three versions of UPPSC Prelims 2025 GS Paper I:

| PDF | What it is | Result |
| --- | --- | --- |
| Drishti IAS edition, 49 pages | Two columns, Hindi (legacy font) and English on alternate pages | 150/150 questions, 150 with 4 options |
| Physics Wallah edition, 79 pages | Answer-key table on page 2, then each question in English and Unicode Hindi, adverts between | 150/150 questions and 150/150 answers read from the key |
| Drishti IAS mock test booklet, 40 pages | English and Unicode Hindi side by side on every page, Hindi set one item per character | 150/150 questions, 150 with 4 options |
| Scanned question booklet, 60 pages | Photocopy with an OCR text layer, English and Hindi side by side, GS Paper II appended | 150/150 questions found; many options unreadable in the text, so shown from the scan |
