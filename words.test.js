const test = require('node:test');
const assert = require('node:assert');
const { parseLine, parseBulk, upsert, isCorrect, pickNext, record } = require('./words.js');

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

test('출제: 직전 단어 제외, 틀린 단어가 더 자주', () => {
  const list = [
    { word: 'a', meanings: ['가'], miss: 0 },
    { word: 'b', meanings: ['나'], miss: 3 }, // 가중치 1 : 4
  ];
  assert.strictEqual(pickNext(list, 'a').word, 'b');
  assert.strictEqual(pickNext(list, 'b').word, 'a');
  assert.strictEqual(pickNext(list, null, () => 0.1).word, 'a'); // 0.5 < 1
  assert.strictEqual(pickNext(list, null, () => 0.3).word, 'b'); // 1.5 >= 1
  assert.strictEqual(pickNext([list[0]], 'a').word, 'a'); // 하나뿐이면 반복
  assert.strictEqual(pickNext([], null), null);
});
