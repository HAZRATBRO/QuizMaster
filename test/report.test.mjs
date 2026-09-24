import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, questionType } from '../js/report.js';

const q = (id, num, answer, text) => ({ id, num, answer, options: ['a', 'b', 'c', 'd'], stem: [{ type: 'p', text }] });

const quiz = {
  questions: [
    q('q1', 1, 0, 'Given below are two statements. Assertion (A): x. Reason (R): y.'),
    q('q2', 2, 1, 'Match List-I with List-II and select the correct answer.'),
    q('q3', 3, 2, 'Which of the following statements is/are correct?'),
    q('q4', 4, 3, 'Who wrote Gitanjali?'),
    q('q5', 5, null, 'Arrange the following in chronological order.'),
  ],
};

const attempt = {
  id: 'a1',
  status: 'submitted',
  order: ['q1', 'q2', 'q3', 'q4', 'q5'],
  responses: { q1: 0, q2: 3, q5: 1 },
  marked: { q2: true, q3: true },
  visited: { q1: true, q2: true, q3: true, q5: true },
  timeSpent: { q1: 30, q2: 150, q3: 10, q5: 20 },
  changes: { q2: 1 },
  settings: { plus: 2, minus: 0.66 },
  durationSec: 600,
  startedAt: 0,
  submittedAt: 300000,
  timeUsedSec: 300,
};

test('scores with negative marking and ignores unkeyed questions', () => {
  const r = analyze(quiz, attempt, [attempt]);
  assert.equal(r.correct, 1);
  assert.equal(r.wrong, 1);
  assert.equal(r.skipped, 2);
  assert.equal(r.unscored, 1);
  assert.equal(r.score, 1.34);
  assert.equal(r.max, 8);
  assert.equal(r.accuracy, 50);
  assert.deepEqual(r.marks, { gained: 2, lost: 0.66, withoutNegative: 2, plus: 2, minus: 0.66 });
});

test('time, review and change statistics', () => {
  const r = analyze(quiz, attempt, [attempt]);
  assert.equal(r.time.tracked, true);
  assert.equal(r.time.perCorrect, 30);
  assert.equal(r.time.perWrong, 150);
  assert.equal(r.time.over2min, 1);
  assert.equal(r.time.slowest[0].q.id, 'q2');
  assert.deepEqual(r.marked, { total: 2, correct: 0, wrong: 1, blank: 1 });
  assert.deepEqual(r.changed, { total: 1, correct: 0, wrong: 1 });
  assert.equal(r.notVisited, 1);
});

test('classifies question styles', () => {
  assert.deepEqual(quiz.questions.map(questionType), ['Assertion and reason', 'Match the lists', 'Statements', 'Direct question', 'Order and chronology']);
});
