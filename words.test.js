const test = require('node:test');
const assert = require('node:assert');
const { parseLine, parseBulk, upsert, findWord, addMeanings, isCorrect, buildRound, requeue, record } = require('./words.js');

test('한 줄 파싱: =, :, 탭, 구분자 없음', () => {
  const want = { word: 'reserve', meanings: ['예약하다', '예매하다'] };
  assert.deepStrictEqual(parseLine('reserve = 예약하다, 예매하다'), want);
  assert.deepStrictEqual(parseLine('reserve: 예약하다; 예매하다'), want);
  assert.deepStrictEqual(parseLine('reserve\t예약하다/예매하다'), want);
  assert.deepStrictEqual(parseLine('reserve 예약하다, 예매하다'), want);
  assert.deepStrictEqual(parseLine('in  advance 미리'), { word: 'in advance', meanings: ['미리'] });
  assert.deepStrictEqual(parseLine('attend ~에 참석하다'), { word: 'attend', meanings: ['~에 참석하다'] });
  assert.strictEqual(parseLine('reserve'), null);
  assert.strictEqual(parseLine('   '), null);
});

test('여러 줄 파싱: 빈 줄은 무시, 인식 못한 줄은 따로', () => {
  const r = parseBulk('reserve = 예약하다\n\r\nhello\nattend = 참석하다, 출석하다\n');
  assert.strictEqual(r.words.length, 2);
  assert.deepStrictEqual(r.bad, ['hello']);
});

test('같은 단어는 대소문자 무시하고 뜻만 바꾸며 틀린 기록 유지', () => {
  let list = upsert([], { word: 'reserve', meanings: ['예약하다'] });
  list = record(list, 'reserve', { correct: false });
  list = upsert(list, { word: 'Reserve', meanings: ['보류하다'] });
  assert.deepStrictEqual(list, [{ word: 'Reserve', meanings: ['보류하다'], miss: 1 }]);
});

test('정답 판정: 띄어쓰기·끝말·괄호·물결표', () => {
  const w = { word: 'x', meanings: ['예약하다', '(~에) 참석하다', '중요한', '정확히'] };
  assert.ok(isCorrect(w, '예약하다'));
  assert.ok(isCorrect(w, '예약'));
  assert.ok(isCorrect(w, ' 예약 하다 '));
  assert.ok(isCorrect(w, '참석'));
  assert.ok(isCorrect(w, '참석하다'));
  assert.ok(isCorrect(w, '중요하다'));
  assert.ok(isCorrect(w, '정확한'));
  assert.ok(!isCorrect(w, '취소하다'));
  assert.ok(!isCorrect(w, ''));
  assert.ok(!isCorrect(w, '  '));
});

test('맞음으로 처리해도 뜻은 그대로, 틀린 기록만 감소', () => {
  let list = [{ word: 'reserve', meanings: ['예약하다'], miss: 2 }];
  list = record(list, 'reserve', { correct: true });
  assert.deepStrictEqual(list[0], { word: 'reserve', meanings: ['예약하다'], miss: 1 });
});

test('틀린 기록은 0~5 사이', () => {
  let list = [{ word: 'a', meanings: ['가'], miss: 0 }];
  list = record(list, 'a', { correct: true });
  assert.strictEqual(list[0].miss, 0);
  for (let i = 0; i < 10; i++) list = record(list, 'a', { correct: false });
  assert.strictEqual(list[0].miss, 5);
});

test('이미 있는 단어 찾기: 대소문자·앞뒤 공백 무시', () => {
  const list = [{ word: 'Reserve', meanings: ['예약하다'], miss: 0 }];
  assert.strictEqual(findWord(list, ' reserve ').word, 'Reserve');
  assert.strictEqual(findWord(list, 'attend'), undefined);
});

test('뜻 추가: 있는 단어는 뜻을 덧붙이고(중복 제외) 틀린 기록 유지, 없으면 새로 등록', () => {
  let list = [{ word: 'reserve', meanings: ['예약하다'], miss: 2 }];
  list = addMeanings(list, { word: 'RESERVE', meanings: ['예약하다', '보류하다'] });
  assert.deepStrictEqual(list, [{ word: 'reserve', meanings: ['예약하다', '보류하다'], miss: 2 }]);
  list = addMeanings(list, { word: 'attend', meanings: ['참석하다'] });
  assert.deepStrictEqual(list[1], { word: 'attend', meanings: ['참석하다'], miss: 0 });
});

const make = (n, missed = []) =>
  Array.from({ length: n }, (_, i) => ({ word: `w${i}`, meanings: ['뜻'], miss: missed.includes(i) ? 1 : 0 }));
const count = (round, word) => round.filter((x) => x === word).length;

test('한 바퀴: 틀린 기록이 없으면 모든 단어가 정확히 한 번씩', () => {
  for (let t = 0; t < 50; t++) {
    const round = buildRound(make(20), null);
    assert.strictEqual(round.length, 20);
    assert.strictEqual(new Set(round).size, 20);
  }
});

test('한 바퀴: 틀린 기록이 있는 단어는 4문제 이상 뒤에 한 번 더', () => {
  for (let t = 0; t < 200; t++) {
    const round = buildRound(make(20, [3, 7]), null);
    assert.strictEqual(round.length, 22);
    for (const word of ['w3', 'w7']) {
      assert.strictEqual(count(round, word), 2);
      assert.ok(round.lastIndexOf(word) - round.indexOf(word) > 4, round.join(' '));
    }
  }
});

test('한 바퀴: 직전 단어로 시작하지 않음', () => {
  for (let t = 0; t < 50; t++) assert.notStrictEqual(buildRound(make(5), 'w0')[0], 'w0');
  for (let t = 0; t < 200; t++) assert.notStrictEqual(buildRound(make(12, [0]), 'w0')[0], 'w0'); // 한 번 더 넣는 자리도
  assert.deepStrictEqual(buildRound(make(1), 'w0'), ['w0']); // 하나뿐이면 어쩔 수 없음
  assert.deepStrictEqual(buildRound([], null), []);
});

test('틀린 단어는 4문제 뒤에 다시', () => {
  assert.deepStrictEqual(requeue(['a', 'b', 'c', 'd', 'e', 'f'], 'x'), ['a', 'b', 'c', 'd', 'x', 'e', 'f']);
  assert.deepStrictEqual(requeue(['a', 'b'], 'x'), ['a', 'b', 'x']); // 남은 문제가 적으면 맨 끝
  assert.deepStrictEqual(requeue([], 'x'), []); // 바퀴가 끝났으면 다음 바퀴에서
  assert.deepStrictEqual(requeue(['a', 'x', 'b'], 'x'), ['a', 'x', 'b']); // 이미 남아 있으면 그대로
});
