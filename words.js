// 단어 등록·채점·출제 로직. 브라우저(window.Words)와 Node 테스트(module.exports) 양쪽에서 사용한다.
// 단어 항목: { word: 'reserve', meanings: ['예약하다', '보류하다'], miss: 0 }
(function () {
  const MAX_MISS = 5; // 틀린 기록 상한. 맞힐 때마다 1씩 줄고, 0이 될 때까지 한 바퀴에 한 번 더 나온다
  const RETRY_GAP = 4; // 틀린 단어는 다른 문제를 이만큼 푼 뒤에 다시 나온다

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

  function findWord(list, word) {
    const key = word.trim().toLowerCase();
    return list.find((w) => w.word.toLowerCase() === key);
  }

  // 같은 단어가 있으면 기존 뜻 뒤에 새 뜻을 덧붙이고(이미 있는 뜻은 건너뜀), 없으면 새로 등록한다
  function addMeanings(list, { word, meanings }) {
    const old = findWord(list, word);
    if (!old) return [...list, { word, meanings, miss: 0 }];
    return list.map((w) => (w === old ? { ...w, meanings: [...new Set([...w.meanings, ...meanings])] } : w));
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

  function shuffle(a, rand) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 한 바퀴 출제 순서(단어 이름 목록): 모든 단어를 섞어 한 번씩 낸다.
  // 틀린 기록이 있는 단어는 앞서 넣은 자리와 RETRY_GAP 문제 이상 떨어진 곳에 한 번 더 넣는다
  function buildRound(list, prevWord, rand = Math.random) {
    const round = shuffle(list.map((w) => w.word), rand);
    if (round.length > 1 && round[0] === prevWord) round.push(round.shift()); // 직전 단어로 시작하지 않게
    for (const w of list) {
      if (!w.miss) continue;
      const first = round.indexOf(w.word);
      const spots = [];
      for (let p = w.word === prevWord ? 1 : 0; p <= round.length; p++) {
        if (p <= first - RETRY_GAP || p > first + RETRY_GAP) spots.push(p);
      }
      // 단어가 너무 적어 떨어뜨릴 수 없으면 맨 끝
      round.splice(spots.length ? spots[Math.floor(rand() * spots.length)] : round.length, 0, w.word);
    }
    return round;
  }

  // 틀린 단어를 RETRY_GAP 문제 뒤에 다시 넣는다. 남은 순서에 이미 있거나 바퀴가 끝났으면(다음 바퀴에 나옴) 그대로 둔다
  function requeue(queue, word) {
    if (!queue.length || queue.includes(word)) return queue;
    const copy = [...queue];
    copy.splice(Math.min(RETRY_GAP, copy.length), 0, word);
    return copy;
  }

  // 결과 반영: 맞히면 틀린 기록 1 감소, 틀리면 1 증가
  function record(list, word, { correct }) {
    return list.map((w) => {
      if (w.word !== word) return w;
      const miss = correct ? Math.max(0, (w.miss || 0) - 1) : Math.min((w.miss || 0) + 1, MAX_MISS);
      return { ...w, miss };
    });
  }

  const api = { splitMeanings, parseLine, parseBulk, upsert, findWord, addMeanings, normalize, isCorrect, buildRound, requeue, record };
  if (typeof module !== 'undefined') module.exports = api;
  else window.Words = api;
})();
