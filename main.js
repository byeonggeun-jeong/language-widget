const { app, BrowserWindow, Menu, ipcMain, screen, dialog, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZES = {
  cycle: { width: 220, height: 260 },
  flash: { width: 220, height: 260 },
  table: { width: 420, height: 540 },
  quiz: { width: 220, height: 260 },
  manage: { width: 360, height: 520 },
};

const DEFAULTS = {
  lang: 'ja', // ja | en
  mode: 'cycle', // 일본어: cycle | flash | table
  enMode: 'quiz', // 영어: quiz | manage
  script: 'hiragana', // hiragana | katakana | random
  groups: { seion: true, daku: false, yoon: false },
  order: 'random', // random | sequential
  opacity: 1,
  theme: 'dark', // dark | light
  font: 'gothic', // gothic | textbook
  image: null, // userData 안의 배경 이미지 파일 이름
  veil: 'medium', // light | medium | strong (이미지 위 가림막 진하기)
  x: undefined,
  y: undefined,
};

const isMac = process.platform === 'darwin';
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
const wordsFile = path.join(app.getPath('userData'), 'words.json');
let settings;
let win;

// 지금 보여주는 화면 (창 크기 기준)
const view = (s) => (s.lang === 'en' ? s.enMode : s.mode);

function loadWords() {
  try {
    return JSON.parse(fs.readFileSync(wordsFile, 'utf8'));
  } catch {
    return [];
  }
}

// v1.3.1까지는 데이터 폴더 이름이 kana-widget이었다. 처음 실행할 때 설정·단어·배경 이미지를 옮기고 예전 폴더는 지운다
function migrateOldData() {
  const oldDir = path.join(app.getPath('appData'), 'kana-widget');
  if (fs.existsSync(settingsFile) || !fs.existsSync(oldDir)) return;
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  for (const name of fs.readdirSync(oldDir)) {
    if (name === 'settings.json' || name === 'words.json' || /^background-\d+\.png$/.test(name)) {
      fs.copyFileSync(path.join(oldDir, name), path.join(app.getPath('userData'), name));
    }
  }
  try {
    fs.rmSync(oldDir, { recursive: true, force: true });
  } catch {} // 예전 버전이 실행 중이라 잠겨 있으면 남겨 둔다
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return { ...DEFAULTS, ...saved, groups: { ...DEFAULTS.groups, ...saved.groups } };
  } catch {
    return { ...DEFAULTS, groups: { ...DEFAULTS.groups } };
  }
}

function saveSettings() {
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

// 자동 실행: exe 버전은 exe만, 소스 실행은 electron.exe + 앱 폴더 경로로 등록한다
// macOS는 path/args를 무시하고 실행 중인 .app 자체를 등록하므로, 소스 실행(Electron.app)에서는 쓸 수 없다
const loginItem = { path: process.execPath, args: app.isPackaged ? [] : [path.resolve(__dirname)] };
const canAutoStart = !isMac || app.isPackaged;

function update(patch) {
  const prevView = view(settings);
  settings = { ...settings, ...patch };
  saveSettings();
  if (view(settings) !== prevView) win.setBounds({ ...win.getBounds(), ...SIZES[view(settings)] });
  win.setOpacity(settings.opacity);
  win.webContents.send('settings', settings);
}

const MAX_IMAGE_SIDE = 1200; // 위젯이 작아서 이보다 크면 화질 차이 없이 메모리만 씀

function removeImageFile() {
  if (settings.image) fs.rmSync(path.join(app.getPath('userData'), settings.image), { force: true });
}

async function chooseImage() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '배경 이미지 선택',
    filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg'] }],
    properties: ['openFile'],
  });
  if (canceled) return;
  let img = nativeImage.createFromPath(filePaths[0]);
  if (img.isEmpty()) {
    dialog.showMessageBox(win, { type: 'error', message: '이미지를 열 수 없습니다.', detail: 'PNG 또는 JPG 파일을 선택하세요.' });
    return;
  }
  const { width, height } = img.getSize();
  if (Math.max(width, height) > MAX_IMAGE_SIDE) {
    img = width >= height ? img.resize({ width: MAX_IMAGE_SIDE, quality: 'best' }) : img.resize({ height: MAX_IMAGE_SIDE, quality: 'best' });
  }
  removeImageFile();
  const name = `background-${Date.now()}.png`;
  fs.writeFileSync(path.join(app.getPath('userData'), name), img.toPNG());
  update({ image: name });
}

function readImage() {
  if (!settings.image) return null;
  const img = nativeImage.createFromPath(path.join(app.getPath('userData'), settings.image));
  return img.isEmpty() ? null : img.toDataURL();
}

// 저장된 위치가 현재 연결된 모니터 밖이면(모니터 분리 등) 기본 위치 사용
function initialPosition(size) {
  if (settings.x !== undefined) {
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      settings.x >= a.x && settings.y >= a.y && settings.x < a.x + a.width - 40 && settings.y < a.y + a.height - 40);
    if (visible) return { x: settings.x, y: settings.y };
  }
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - size.width - 40, y: a.y + 40 };
}

function buildMenu() {
  const radio = (label, key, value) => ({
    label, type: 'radio', checked: settings[key] === value, click: () => update({ [key]: value }),
  });
  const group = (label, key) => ({
    label, type: 'checkbox', checked: settings.groups[key],
    click: () => update({ groups: { ...settings.groups, [key]: !settings.groups[key] } }),
  });
  const japanese = [
    radio('순환 학습', 'mode', 'cycle'),
    radio('플래시카드', 'mode', 'flash'),
    radio('전체 표', 'mode', 'table'),
    { type: 'separator' },
    { label: '문자', submenu: [
      radio('히라가나', 'script', 'hiragana'),
      radio('가타가나', 'script', 'katakana'),
      radio('랜덤', 'script', 'random'),
    ] },
    { label: '출제 범위', submenu: [group('청음', 'seion'), group('탁음·반탁음', 'daku'), group('요음', 'yoon')] },
    { label: '순서', submenu: [radio('랜덤', 'order', 'random'), radio('순서대로', 'order', 'sequential')] },
    { label: '글꼴', submenu: [radio('고딕체', 'font', 'gothic'), radio('교과서체', 'font', 'textbook')] },
  ];
  const english = [
    radio('단어 퀴즈', 'enMode', 'quiz'),
    radio('단어 관리', 'enMode', 'manage'),
  ];
  return Menu.buildFromTemplate([
    radio('일본어', 'lang', 'ja'),
    radio('영어', 'lang', 'en'),
    { type: 'separator' },
    ...(settings.lang === 'en' ? english : japanese),
    { type: 'separator' },
    { label: '투명도', submenu: [1, 0.9, 0.8, 0.7, 0.5].map((v) => radio(`${v * 100}%`, 'opacity', v)) },
    { label: '테마', submenu: [radio('다크', 'theme', 'dark'), radio('라이트', 'theme', 'light')] },
    { label: '배경 이미지', submenu: [
      { label: '이미지 선택…', click: chooseImage },
      { label: '이미지 제거', enabled: !!settings.image, click: () => { removeImageFile(); update({ image: null }); } },
      { type: 'separator' },
      { label: '가림막 진하기', enabled: false },
      radio('연하게', 'veil', 'light'),
      radio('보통', 'veil', 'medium'),
      radio('진하게', 'veil', 'strong'),
    ] },
    { type: 'separator' },
    {
      label: isMac ? '로그인 시 자동 실행' : 'Windows 시작 시 자동 실행', type: 'checkbox',
      enabled: canAutoStart,
      checked: canAutoStart && app.getLoginItemSettings(loginItem).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginItem, openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
}

function createWindow() {
  const size = SIZES[view(settings)];
  win = new BrowserWindow({
    ...size,
    ...initialPosition(size),
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    hasShadow: false, // macOS: 투명 창 그림자가 둥근 모서리 밖으로 비치는 것 방지
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setOpacity(settings.opacity);
  // macOS: 데스크톱(Space)을 바꿔도 위젯이 따라오도록
  if (isMac) win.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true }); // 옵션 없으면 Dock 아이콘이 다시 생김
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.showInactive());

  let moveTimer;
  win.on('moved', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const [x, y] = win.getPosition();
      settings = { ...settings, x, y };
      saveSettings();
    }, 300);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    // macOS: skipTaskbar는 Windows 전용이라 Dock 아이콘·메뉴바를 따로 숨긴다
    if (isMac) app.setActivationPolicy('accessory');
    migrateOldData();
    settings = loadSettings();
    ipcMain.handle('get-settings', () => settings);
    ipcMain.handle('get-image', readImage);
    ipcMain.handle('get-words', loadWords);
    ipcMain.on('save-words', (_e, words) => fs.writeFileSync(wordsFile, JSON.stringify(words, null, 2)));
    ipcMain.on('show-menu', () => buildMenu().popup({ window: win }));
    createWindow();
  });
  app.on('second-instance', () => win && win.show());
  app.on('window-all-closed', () => app.quit());
}
