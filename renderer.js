const { TABLES, makeKana, buildPool, isCorrect } = window.Kana;
const { parseBulk, splitMeanings, upsert, isCorrect: isMeaningCorrect, pickNext, record } = window.Words;
const app = document.getElementById('app');
const MAX_TRIES = 3;

let s; // 현재 설정
let deck = [];
let idx = 0;
let tableTab = 'seion';
// 영어
let words = [];
let current = null; // 지금 출제 중인 단어
let editing = null; // 단어 관리에서 수정 중인 단어
let bulkOpen = false;

// ---------- 출제 덱 ----------
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function newDeck() {
  deck = buildPool(s.groups);
  if (s.order === 'random') shuffle(deck);
  idx = 0;
}

function nextKana() {
  if (!deck.length) return null;
  if (idx >= deck.length) newDeck();
  const k = deck[idx++];
  const useKata = s.script === 'katakana' || (s.script === 'random' && Math.random() < 0.5);
  return { ...k, show: useKata ? k.kata : k.hira };
}

// ---------- 화면 ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function charEl(k) {
  return el('div', k.show.length > 1 ? 'char small' : 'char', k.show);
}

function renderEmpty(text = '출제 범위가 비어 있습니다.\n우클릭 → 출제 범위에서 선택하세요.') {
  app.replaceChildren(el('div', 'empty', text));
  app.firstChild.style.whiteSpace = 'pre-line';
}

function renderCycle() {
  const k = nextKana();
  if (!k) return renderEmpty();
  let keys = ''; // 한글 IME가 켜진 채 로마자를 쳐도 인정하도록 누른 키를 따로 기록
  let tries = 0;
  let locked = false;
  let submitAfterIme = false;

  const card = el('div', 'card');
  const answer = el('div', 'answer');
  const box = el('input', 'typebox');
  box.placeholder = '정답 입력';
  box.spellcheck = false;
  const dots = el('div', 'tries');
  for (let i = 0; i < MAX_TRIES; i++) dots.append(el('span'));
  card.append(charEl(k), answer, box, dots);
  app.replaceChildren(card);
  box.focus();
  card.addEventListener('mousedown', () => setTimeout(() => box.focus()));

  box.addEventListener('keydown', (e) => {
    if (locked) return e.preventDefault();
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      // 한글 조합 중 Enter는 조합 확정이 끝난 뒤 제출
      if (e.isComposing) submitAfterIme = true;
      else submit();
    } else if (/^Key[A-Z]$/.test(e.code) && !e.ctrlKey && !e.altKey) {
      keys += e.code.slice(3).toLowerCase();
    } else if (e.code === 'Backspace') {
      keys = keys.slice(0, -1);
    }
  });
  box.addEventListener('compositionend', () => {
    if (submitAfterIme) setTimeout(submit);
    submitAfterIme = false;
  });
  box.addEventListener('input', () => {
    box.className = 'typebox';
    if (!box.value) keys = '';
  });

  // 대기 중 모드가 바뀌었으면(카드가 사라졌으면) 다음 글자를 그리지 않는다
  const next = () => card.isConnected && renderCycle();

  function submit() {
    if (locked || !box.value.trim()) return;
    if (isCorrect(k, box.value) || isCorrect(k, keys)) {
      locked = true;
      box.className = 'typebox ok';
      setTimeout(next, 350);
      return;
    }
    tries++;
    dots.children[tries - 1].className = 'used';
    keys = '';
    box.value = '';
    box.className = 'typebox';
    void box.offsetWidth; // 흔들림 애니메이션 재시작
    box.className = 'typebox ng';
    if (tries >= MAX_TRIES) {
      locked = true;
      answer.textContent = `${k.romaji} · ${k.korean}`;
      setTimeout(next, 1500);
    }
  }
}

function renderFlash() {
  const k = nextKana();
  if (!k) return renderEmpty();
  const card = el('div', 'card flash');
  const answer = el('div', 'answer hidden', k.romaji);
  const hint = el('div', 'hint', '클릭하여 확인');
  card.append(charEl(k), answer, hint);
  app.replaceChildren(card);

  card.addEventListener('click', () => {
    if (answer.classList.contains('hidden')) {
      answer.classList.remove('hidden');
      hint.textContent = '클릭하여 다음';
    } else {
      renderFlash();
    }
  });
}

function renderTable() {
  const tabs = el('div', 'tabs');
  for (const [key, t] of Object.entries(TABLES)) {
    const b = el('button', key === tableTab ? 'on' : '', t.label);
    b.addEventListener('click', () => { tableTab = key; renderTable(); });
    tabs.append(b);
  }
  const t = TABLES[tableTab];
  const grid = el('div', 'grid');
  grid.style.gridTemplateColumns = `repeat(${t.cols}, 1fr)`;
  for (const row of t.rows) {
    for (const cell of row) {
      if (!cell) { grid.append(el('div', 'cell')); continue; }
      const k = makeKana(cell);
      const text = s.script === 'hiragana' ? k.hira : s.script === 'katakana' ? k.kata : `${k.hira} ${k.kata}`;
      const c = el('div', 'cell filled');
      c.append(el('b', '', text), el('small', '', k.romaji));
      grid.append(c);
    }
  }
  app.replaceChildren(tabs, grid);
}

// ---------- 영어: 단어 퀴즈 ----------
function setWords(next) {
  words = next;
  window.widget.saveWords(words);
}

function button(label, onClick, cls = '') {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// 한글 조합 중 Enter는 조합 확정이 끝난 뒤 실행한다
function onEnter(input, fn) {
  let pending = false;
  input.addEventListener('keydown', (e) => {
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    e.preventDefault();
    if (e.isComposing) pending = true;
    else fn();
  });
  input.addEventListener('compositionend', () => {
    if (pending) setTimeout(fn);
    pending = false;
  });
}

function renderQuiz() {
  const w = pickNext(words, current);
  if (!w) return renderEmpty('등록된 단어가 없습니다.\n우클릭 → 단어 관리에서 등록하세요.');
  current = w.word;
  let locked = false;
  let shownAt = 0;

  const card = el('div', 'card en');
  const size = w.word.length > 12 ? ' small' : w.word.length > 8 ? ' mid' : '';
  const answer = el('div', 'answer');
  const box = el('input', 'typebox');
  box.placeholder = '뜻 입력 · 모르면 Enter';
  box.spellcheck = false;
  const actions = el('div', 'actions');
  card.append(el('div', 'word' + size, w.word), answer, box, actions);
  app.replaceChildren(card);
  box.focus();
  card.addEventListener('mousedown', (e) => {
    if (!locked && e.target !== box) setTimeout(() => box.focus());
  });
  onEnter(box, submit);

  // 대기 중 모드가 바뀌었으면(카드가 사라졌으면) 다음 단어를 그리지 않는다
  const next = () => card.isConnected && renderQuiz();

  function finish(correct) {
    if (Date.now() - shownAt < 300) return; // Enter를 누르고 있어서 바로 눌리는 것 방지
    setWords(record(words, w.word, { correct }));
    next();
  }

  function submit() {
    if (locked) return;
    locked = true;
    const input = box.value.trim();
    answer.textContent = w.meanings.join(', ');
    if (isMeaningCorrect(w, input)) {
      box.className = 'typebox ok';
      box.readOnly = true;
      setWords(record(words, w.word, { correct: true }));
      setTimeout(next, 1200);
      return;
    }
    // 등록된 뜻과 다르면 정답을 보여주고, 맞는 답이었는지는 직접 판단한다
    box.replaceWith(el('div', 'mine', input ? `내 답: ${input}` : '모름'));
    const accept = () => finish(!!input);
    const reject = () => finish(false);
    if (input) {
      actions.append(button('맞음', accept, 'primary'), button('틀림', reject));
    } else {
      actions.append(button('다음', reject, 'primary'));
    }
    // Enter = 맞음(모름이면 다음), Esc = 틀림. 누르고 있어서 반복되는 키는 무시
    card.addEventListener('keydown', (e) => {
      if (e.repeat || (e.key !== 'Enter' && e.key !== 'Escape')) return;
      e.preventDefault();
      (e.key === 'Enter' ? accept : reject)();
    });
    shownAt = Date.now();
    actions.querySelector('.primary').focus();
  }
}

// ---------- 영어: 단어 관리 ----------
function renderManage() {
  const wrap = el('div', 'manage');
  const msg = el('div', 'msg');

  // 한 개씩 등록·수정
  const form = el('div', 'form');
  const wordIn = el('input');
  wordIn.placeholder = '영단어';
  wordIn.spellcheck = false;
  const meanIn = el('input');
  meanIn.placeholder = '뜻 (여러 개는 쉼표로 구분)';
  meanIn.spellcheck = false;
  const formButtons = el('div', 'row-buttons');
  formButtons.append(button(editing ? '수정' : '추가', save, 'primary'));
  if (editing) {
    const old = words.find((w) => w.word === editing);
    wordIn.value = old.word;
    meanIn.value = old.meanings.join(', ');
    formButtons.append(button('취소', () => { editing = null; renderManage(); }));
  }
  form.append(wordIn, meanIn, formButtons);
  onEnter(wordIn, () => meanIn.focus());
  onEnter(meanIn, save);

  function save() {
    const word = wordIn.value.trim().replace(/\s+/g, ' ');
    const meanings = splitMeanings(meanIn.value);
    if (!word && !meanings.length) return;
    if (!word || !meanings.length) {
      msg.textContent = '영단어와 뜻을 모두 입력하세요.';
      return;
    }
    // 수정하면서 영단어 철자를 바꿨으면 이전 항목은 지운다
    const base = editing && editing.toLowerCase() !== word.toLowerCase() ? words.filter((w) => w.word !== editing) : words;
    setWords(upsert(base, { word, meanings }));
    editing = null;
    renderManage();
    app.querySelector('.form input').focus();
  }

  // 여러 개 붙여넣기
  const bulk = el('div', 'bulk');
  bulk.append(button(bulkOpen ? '여러 개 붙여넣기 ▴' : '여러 개 붙여넣기 ▾', () => {
    bulkOpen = !bulkOpen;
    renderManage();
  }, 'link'));
  if (bulkOpen) {
    const area = el('textarea');
    area.placeholder = '한 줄에 하나씩\nreserve = 예약하다, 예매하다\nattend = 참석하다';
    area.spellcheck = false;
    bulk.append(area, button('한꺼번에 등록', () => {
      const { words: parsed, bad } = parseBulk(area.value);
      if (!parsed.length && !bad.length) return;
      setWords(parsed.reduce(upsert, words));
      bulkOpen = bad.length > 0;
      renderManage();
      app.querySelector('.msg').textContent = `${parsed.length}개 등록` + (bad.length ? `, ${bad.length}줄은 형식을 알 수 없어 남겨 두었습니다.` : '');
      if (bad.length) app.querySelector('.bulk textarea').value = bad.join('\n');
    }, 'primary'));
  }

  // 목록 (최근 등록 순)
  const list = el('div', 'list');
  for (const w of [...words].reverse()) {
    const row = el('div', w.word === editing ? 'item on' : 'item');
    row.append(el('b', '', w.word), el('span', '', w.meanings.join(', ')), button('×', (e) => {
      e.stopPropagation();
      if (editing === w.word) editing = null;
      setWords(words.filter((x) => x !== w));
      renderManage();
    }, 'del'));
    row.title = '클릭해서 수정';
    row.addEventListener('click', () => { editing = w.word; renderManage(); });
    list.append(row);
  }
  if (!words.length) list.append(el('div', 'empty', '아직 등록된 단어가 없습니다.'));

  wrap.append(form, bulk, msg, el('div', 'count', `단어 ${words.length}개`), list);
  app.replaceChildren(wrap);
}

function render() {
  if (s.lang === 'en') return ({ quiz: renderQuiz, manage: renderManage })[s.enMode]();
  ({ cycle: renderCycle, flash: renderFlash, table: renderTable })[s.mode]();
}

// ---------- 설정 반영 ----------
const panel = document.querySelector('.panel');

async function applyImage(changed) {
  if (changed) {
    const url = s.image ? await window.widget.getImage() : null;
    panel.style.setProperty('--image', url ? `url("${url}")` : 'none');
  }
  // 표·단어 관리는 칸이 촘촘해 가독성을 위해 이미지를 쓰지 않는다
  const v = s.lang === 'en' ? s.enMode : s.mode;
  panel.classList.toggle('with-image', !!s.image && v !== 'table' && v !== 'manage');
}

function apply(next) {
  const prev = s;
  s = next;
  const root = document.documentElement.dataset;
  root.theme = s.theme;
  root.font = s.lang === 'en' ? 'gothic' : s.font; // 교과서체는 가나 쓰기 연습용
  root.veil = s.veil;
  applyImage(!prev || prev.image !== s.image);
  // 투명도·테마만 바뀌었으면 풀던 문제를 유지한다
  const key = (x) => JSON.stringify([x.lang, x.mode, x.enMode, x.script, x.order, x.groups]);
  if (!prev || key(prev) !== key(s)) {
    editing = null;
    newDeck();
    render();
  }
}

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.widget.showMenu();
});
window.addEventListener('focus', () => document.querySelector('.typebox, .actions .primary')?.focus());

Promise.all([window.widget.getWords(), window.widget.getSettings()]).then(([w, st]) => {
  words = w;
  apply(st);
  window.widget.onSettings(apply);
});
