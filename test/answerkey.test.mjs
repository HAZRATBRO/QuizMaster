import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnswerKey } from '../js/answerkey.js';

const obj = (m) => Object.fromEntries(m);

test('number-letter pairs', () => {
  assert.deepEqual(obj(parseAnswerKey('1-a, 2-c, 3 d, 4.(b)')), { 1: 0, 2: 2, 3: 3, 4: 1 });
});
test('number-number pairs', () => {
  assert.deepEqual(obj(parseAnswerKey('Q1: 3\nQ2: 1\n10) 4')), { 1: 2, 2: 0, 10: 3 });
});
test('tabular rows', () => {
  assert.deepEqual(obj(parseAnswerKey('1 2 3 4\nb a d c\n5 6\nc c')), { 1: 1, 2: 0, 3: 3, 4: 2, 5: 2, 6: 2 });
});
test('bare sequence', () => {
  assert.deepEqual(obj(parseAnswerKey('abdc')), { 1: 0, 2: 1, 3: 3, 4: 2 });
  assert.deepEqual(obj(parseAnswerKey('b\nd\n1\n(c)')), { 1: 1, 2: 3, 3: 0, 4: 2 });
});
test('ignores text without answers', () => {
  assert.equal(parseAnswerKey('').size, 0);
});
