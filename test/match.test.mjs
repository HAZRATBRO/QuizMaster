import test from 'node:test';
import assert from 'node:assert/strict';
import { transferKey } from '../js/match.js';

const q = (id, num, text, options, answer = null) => ({ id, num, answer, options, stem: [{ type: 'p', text }] });
const AR = ['Both (A) and (R) are true and (R) is the correct explanation of (A)', '(A) is false, but (R) is true',
  'Both (A) and (R) are true, but (R) is not the correct explanation of (A)', '(A) is true, but (R) is false'];

const seriesA = [
  q('a1', 1, 'Which of the following sites were obtained under the Treaty of Sugauli in 1816?', ['1 and 2', '2, 3 and 4', 'Only 3 and 4', 'Only 1'], 1),
  q('a2', 2, 'Assertion (A): The interior part of Australia is desert. Reason (R): Northern Australia is in the temperate zone.', AR, 3),
  q('a3', 3, 'Match List-I (Coal Field) with List-II (Country): Appalachian, Lancashire, Ruhr, Kuzbass', ['A-4, B-1, C-2, D-3', 'A-1, B-4, C-3, D-2', 'A-1, B-4, C-2, D-3', 'A-4, B-1, C-3, D-2'], 0),
];
// Another booklet series: questions and options in a different order, one option unreadable.
const seriesB = [
  q('b1', 1, 'Match List-I (Coal Field) with List-II (Country): Appalachian, Lancashire, Ruhr, Kuzbass', ['A-1, B-4, C-3, D-2', 'A-4, B-1, C-3, D-2', 'A-4, B-1, C-2, D-3', 'A-1, B-4, C-2, D-3']),
  q('b2', 2, 'Given below are two statements. Assertion (A): The interior part of Australia is desert. Reason (R): Northern Australia is in the temperate zone.', [AR[2], AR[3], AR[1], AR[0]]),
  q('b3', 3, 'Which of the following sites were obtained under the Treaty of Sugauli in 1816 ?', ['land2', '', 'Only 3 and 4', 'Only l']),
  q('b4', 4, 'Who wrote Gitanjali?', ['Tagore', 'Premchand', 'Nirala', 'Prasad']),
];

test('copies answers by question and option wording', () => {
  const r = transferKey(seriesA, seriesB);
  assert.equal(r.answers.get('b1'), 2);
  assert.equal(r.answers.get('b2'), 1); // "(A) is true, but (R) is false", not its mirror image
  assert.equal(r.answers.get('b3'), 1); // the unreadable option, by elimination
  assert.equal(r.answers.has('b4'), false);
  assert.deepEqual(r.unmatched, [4]);
});
