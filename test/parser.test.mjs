import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestions, englishScore } from '../js/parser.js';

// Builds a page of text items from [x, baseline, text] triples (11pt text, ~5.5pt per character).
const page = (n, rows) => ({
  page: n, width: 612, height: 792,
  items: rows.map(([x, baseline, str]) => ({ str, x, baseline, w: str.length * 5.5, size: 11 })),
});

test('parses numbered questions, statements, side-by-side options and code tables', () => {
  const p = page(1, [
    [60, 100, '1. Which of the following statements is/are correct?'],
    [86, 118, '1. The Ganga rises at Gangotri.'],
    [86, 136, '2. The Yamuna joins it at Prayagraj.'],
    [77, 158, 'Select the correct answer from the code given below:'],
    [82, 176, '(a) Only 1'], [190, 176, '(b) Only 2'],
    [82, 194, '(c) Both 1 and 2'], [190, 194, '(d) Neither 1 nor 2'],
    [60, 220, '2. Match List-I with List-II.'],
    [110, 238, 'A'], [140, 238, 'B'], [170, 238, 'C'], [200, 238, 'D'],
    [82, 256, '(a)'], [110, 256, '1'], [140, 256, '2'], [170, 256, '3'], [200, 256, '4'],
    [82, 274, '(b)'], [110, 274, '2'], [140, 274, '1'], [170, 274, '4'], [200, 274, '3'],
    [82, 292, '(c)'], [110, 292, '4'], [140, 292, '3'], [170, 292, '2'], [200, 292, '1'],
    [82, 310, '(d)'], [110, 310, '3'], [140, 310, '4'], [170, 310, '1'], [200, 310, '2'],
    [60, 336, '3. Who wrote the Indian national anthem?'],
    [82, 354, '(a) Bankim Chandra Chatterjee'],
    [82, 372, '(b) Rabindranath Tagore'],
    [82, 390, '(c) Sarojini Naidu'],
    [82, 408, '(d) Muhammad Iqbal'],
    [77, 426, 'Answer: (b)'],
  ]);
  const { questions, stats } = parseQuestions([p]);
  assert.equal(stats.found, 3);
  const [q1, q2, q3] = questions;
  assert.deepEqual(q1.options, ['Only 1', 'Only 2', 'Both 1 and 2', 'Neither 1 nor 2']);
  assert.equal(q1.stem[0].text, 'Which of the following statements is/are correct?');
  assert.equal(q1.stem[1].text, '1. The Ganga rises at Gangotri.');
  assert.deepEqual(q2.options[1], 'A-2, B-1, C-4, D-3');
  assert.equal(q3.answer, 1);
  assert.equal(q3.options.length, 4);
});

test('skips a legacy-font Hindi copy of the same question', () => {
  const hindi = page(1, [
    [60, 100, '1- fuEufyf•r esa ls dkSu&lk dFku lgh gS@gSa\\ dwV ls lgh mÙkj pqfu,A ;g ,d iz\'u gSA'],
    [82, 118, '(a) dsoy 1'], [82, 136, '(b) dsoy 2'], [82, 154, '(c) 1 vkSj 2 nksuksa'], [82, 172, '(d) u rks 1 u gh 2'],
    [60, 200, 'uhps fn, x, dwV ls lgh mÙkj pqfu, rFkk nwljs dks dkj.k dgk x;k gSA'],
  ]);
  const english = page(2, [
    [60, 100, '1. Which of the following is the capital of India?'],
    [82, 118, '(a) Mumbai'], [82, 136, '(b) New Delhi'], [82, 154, '(c) Kolkata'], [82, 172, '(d) Chennai'],
    [60, 200, 'Select the correct answer from the code given below and mark it on the sheet.'],
  ]);
  const { questions } = parseQuestions([hindi, english]);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].options[1], 'New Delhi');
});

test('englishScore separates English from legacy Hindi fonts', () => {
  assert.ok(englishScore('Which of the following statements is correct?') > 0.3);
  assert.ok(englishScore('fuEufyf•r esa ls dkSu&lk dFku lgh gS') < 0.06);
});
