// 단어 등록·채점·출제 로직. 브라우저(window.Words)와 Node 테스트(module.exports) 양쪽에서 사용한다.
// 단어 항목: { word: 'reserve', meanings: ['예약하다', '보류하다'], miss: 0 }
(function () {
  const MAX_MISS = 5; // 많이 틀린 단어도 최대 (1 + 5)배까지만 자주 나오게

  function splitMeanings(text) {
    const list = text.split(/[,;/|]/).map((m) => m.trim()).filter(Boolean);
    return [...new Set(list)];
  }

  // "reserve = 예약하다, 예매하다" / "reserve: …" / "reserve<Tab>…" / "reserve 예약하다"
  function parseLine(line) {
    const t = line.trim();
    if (!t) return null;
    let m = t.match(/^(.+?)\s*[=:\t]\s*(.+)$/);
    if (!m) {
      const i = t.search(/[가-힣ㄱ-ㅎ(~]/);
      if (i > 0) m = [t, t.slice(0, i), t.slice(i)];
    }
    if (!m) return null;
    const word = m[1].trim().replace(/\s+/g, ' ');
    const meanings = splitMeanings(m[2]);
    return word && meanings.length ? { word, meanings } : null;
  }

  function parseBulk(text) {
    const words = [];
    const bad = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const w = parseLine(line);
      if (w) words.push(w);
      else bad.push(line.trim());
    }
    return { words, bad };
  }

  // 같은 단어(대소문자 무시)가 있으면 뜻을 바꾸고 틀린 기록은 유지한다
  function upsert(list, { word, meanings }) {
    const key = word.toLowerCase();
    const i = list.findIndex((w) => w.word.toLowerCase() === key);
    if (i < 0) return [...list, { word, meanings, miss: 0 }];
    const copy = [...list];
    copy[i] = { ...copy[i], word, meanings };
    return copy;
  }

  // 끝말이 조금 달라도 같은 뜻으로 본다: 예약 = 예약하다, 중요한 = 중요하다, 정확히 = 정확한
  const SUFFIXES = ['하다', '되다', '하는', '되는', '하게', '한', '된', '히', '다'];

  function normalize(text) {
    let s = text.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[\s~.,!?·'"]/g, '');
    for (const suf of SUFFIXES) {
      if (s.length > suf.length && s.endsWith(suf)) return s.slice(0, -suf.length);
    }
    return s;
  }

  function isCorrect(entry, input) {
    const v = normalize(input);
    return !!v && entry.meanings.some((m) => normalize(m) === v);
  }

  // 틀린 횟수가 많을수록 자주 나온다. 단어가 2개 이상이면 직전 단어는 연달아 내지 않는다
  function pickNext(list, prevWord, rand = Math.random) {
    const pool = list.length > 1 ? list.filter((w) => w.word !== prevWord) : list;
    if (!pool.length) return null;
    const weight = (w) => 1 + Math.min(w.miss || 0, MAX_MISS);
    let r = rand() * pool.reduce((sum, w) => sum + weight(w), 0);
    for (const w of pool) {
      r -= weight(w);
      if (r < 0) return w;
    }
    return pool[pool.length - 1];
  }

  // 결과 반영: 맞히면 틀린 기록 1 감소, 틀리면 1 증가
  function record(list, word, { correct }) {
    return list.map((w) => {
      if (w.word !== word) return w;
      const miss = correct ? Math.max(0, (w.miss || 0) - 1) : Math.min((w.miss || 0) + 1, MAX_MISS);
      return { ...w, miss };
    });
  }

  const api = { splitMeanings, parseLine, parseBulk, upsert, normalize, isCorrect, pickNext, record };
  if (typeof module !== 'undefined') module.exports = api;
  else window.Words = api;
})();
