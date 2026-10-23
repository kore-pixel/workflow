'use strict';
/* core.js — 유틸, 저장소(localStorage), 데이터 조작 함수 */
const P = window.P = {};

/* ───────── 유틸 ───────── */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const todayStr = () => ymd(new Date());
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const fmtDateLong = s => { const d = parseYmd(s); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${DOW[d.getDay()]})`; };
const fmtDateShort = s => { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`; };
const fmtMD = s => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fmtDur = sec => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h > 0) return m ? `${h}시간 ${m}분` : `${h}시간`;
  if (m > 0) return `${m}분`;
  return `${sec}초`;
};
const fmtClock = sec => { sec = Math.max(0, Math.floor(sec)); return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`; };
const fmtHM = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const won = n => (Math.round(n) || 0).toLocaleString('ko-KR') + '원';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const relLabel = s => {
  const t = todayStr();
  if (s === t) return '오늘';
  if (s === addDays(t, 1)) return '내일';
  if (s === addDays(t, -1)) return '어제';
  return fmtDateShort(s);
};

const svg = (inner, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${inner}</svg>`;
const ICON = {
  prev: svg('<path d="M15 5l-7 7 7 7"/>'),
  next: svg('<path d="M9 5l7 7-7 7"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  sync: svg('<path d="M20 11a8 8 0 00-14.5-4M4 5v4h4M4 13a8 8 0 0014.5 4M20 19v-4h-4"/>'),
  cal: svg('<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  play: svg('<path d="M8 5.5v13l11-6.5z"/>', 'fill'),
  pause: svg('<path d="M9 6v12M15 6v12"/>'),
  stop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  trash: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  note: svg('<path d="M6 4h9l4 4v12H6zM15 4v4h4M9 13h6M9 16.5h6"/>'),
  tTasks: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>'),
  tTimer: svg('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 3h5M12 3v3"/>'),
  tLedger: svg('<path d="M4 8a2 2 0 012-2h11v3"/><rect x="4" y="8" width="16" height="11" rx="3"/><circle cx="16" cy="13.5" r="1.1"/>'),
  tSettings: svg('<path d="M5 8h8M17 8h2M5 16h2M11 16h8"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>')
};

/* ───────── 저장소 ───────── */
const KEY = 'planner.data.v1', SKEY = 'planner.settings.v1', TKEY = 'planner.timer.v1';
const readJSON = (k, def) => { try { const j = JSON.parse(localStorage.getItem(k)); return (j && typeof j === 'object') ? j : def; } catch (e) { return def; } };
const SEED_CATS = [
  ['c-e-food', 'expense', '식비'], ['c-e-snack', 'expense', '간식'], ['c-e-trans', 'expense', '교통'],
  ['c-e-shop', 'expense', '쇼핑'], ['c-e-fun', 'expense', '문화·여가'], ['c-e-etc', 'expense', '기타'],
  ['c-i-allow', 'income', '용돈'], ['c-i-job', 'income', '알바'], ['c-i-etc', 'income', '기타']
];
function loadData() {
  const j = readJSON(KEY, {});
  j.tasks = j.tasks || []; j.sessions = j.sessions || []; j.categories = j.categories || []; j.entries = j.entries || [];
  if (!j.seeded) {
    SEED_CATS.forEach(([id, type, name]) => { if (!j.categories.some(c => c.id === id)) j.categories.push({ id, type, name, updatedAt: 1 }); });
    j.seeded = true;
  }
  return j;
}
const CFG = Object.assign({ clientId: '', todoListName: '플래너' }, window.PLANNER_CONFIG || {});
function loadSettings() {
  const s = readJSON(SKEY, {});
  return Object.assign({
    clientId: CFG.clientId || '', listName: CFG.todoListName || '플래너', listId: '',
    font: 'mix', hideDone: false, viewAll: false, autoSync: true, cloud: true, lastSync: 0, lastError: ''
  }, s, s.clientId ? {} : { clientId: CFG.clientId || '' });
}
P.S = loadData();
P.ST = loadSettings();
P.T = Object.assign({ running: false, startedAt: 0, accSec: 0, sessionStart: 0, taskId: '', label: '' }, readJSON(TKEY, {}));

P.saveST = () => localStorage.setItem(SKEY, JSON.stringify(P.ST));
P.saveT = () => localStorage.setItem(TKEY, JSON.stringify(P.T));
/** silent: 화면 갱신/동기화 예약 없이 저장만 */
P.save = (opt = {}) => {
  try { localStorage.setItem(KEY, JSON.stringify(P.S)); }
  catch (e) { P.toast && P.toast('저장 공간이 부족해요'); }
  if (!opt.silent) { P.render && P.render(); P.afterChange && P.afterChange(); }
};
const touch = r => { r.updatedAt = Date.now(); return r; };
P.touch = touch;

/* ───────── 할 일 ───────── */
P.liveTasks = () => P.S.tasks.filter(t => !t.deleted);
P.task = id => P.S.tasks.find(t => t.id === id);
P.addTask = ({ title, date = '', time = '', memo = '' }) => {
  const t = touch({ id: uid(), title: title.trim(), date, time: date ? time : '', memo: memo.trim(), done: false, createdAt: Date.now(), todoId: '' });
  P.S.tasks.push(t); P.save(); return t;
};
P.updateTask = (id, patch) => {
  const t = P.task(id); if (!t) return;
  Object.assign(t, patch);
  if (!t.date) t.time = '';
  touch(t); P.save();
};
P.toggleTask = id => { const t = P.task(id); if (t) P.updateTask(id, { done: !t.done }); };
P.deleteTask = id => {
  const t = P.task(id); if (!t) return;
  if (!t.todoId) P.S.tasks = P.S.tasks.filter(x => x.id !== id);
  else { t.deleted = true; touch(t); }
  P.save();
};
P.focusSec = taskId => P.S.sessions.filter(s => !s.deleted && s.taskId === taskId).reduce((a, s) => a + s.sec, 0);

/* ───────── 타이머 ───────── */
P.elapsed = () => P.T.accSec + (P.T.running ? Math.floor((Date.now() - P.T.startedAt) / 1000) : 0);
P.timerStart = () => {
  if (P.T.running) return;
  P.T.running = true; P.T.startedAt = Date.now();
  if (!P.T.sessionStart) P.T.sessionStart = Date.now();
  P.saveT();
};
P.timerPause = () => {
  if (!P.T.running) return;
  P.T.accSec = P.elapsed(); P.T.running = false; P.T.startedAt = 0; P.saveT();
};
/** 종료하고 기록으로 저장. 저장된 초를 돌려줌(5초 미만은 저장 안 함 → 0) */
P.timerStop = () => {
  const sec = P.elapsed();
  const start = P.T.sessionStart || (Date.now() - sec * 1000);
  const taskId = P.T.taskId, label = P.T.label;
  P.T = { running: false, startedAt: 0, accSec: 0, sessionStart: 0, taskId: '', label: '' };
  P.saveT();
  if (sec < 5) return 0;
  P.S.sessions.push(touch({ id: uid(), taskId: taskId || '', label: taskId ? '' : (label || '').trim(), start, sec, date: ymd(new Date(start)) }));
  const t = taskId && P.task(taskId);
  if (t) touch(t);          // 집중 시간이 To Do 메모에 반영되도록
  P.save();
  return sec;
};
P.deleteSession = id => {
  const s = P.S.sessions.find(x => x.id === id); if (!s) return;
  s.deleted = true; touch(s);
  const t = s.taskId && P.task(s.taskId); if (t) touch(t);
  P.save();
};
P.daySessions = date => P.S.sessions.filter(s => !s.deleted && s.date === date).sort((a, b) => a.start - b.start);
P.dayTotal = date => P.daySessions(date).reduce((a, s) => a + s.sec, 0);

/* ───────── 가계부 ───────── */
P.cats = type => P.S.categories.filter(c => !c.deleted && (!type || c.type === type));
P.catName = id => { const c = P.S.categories.find(x => x.id === id); return c ? (c.deleted ? c.name + '(삭제됨)' : c.name) : '미분류'; };
P.addCategory = (type, name) => {
  name = name.trim(); if (!name) return null;
  const ex = P.cats(type).find(c => c.name === name); if (ex) return ex;
  const c = touch({ id: uid(), type, name }); P.S.categories.push(c); P.save(); return c;
};
P.deleteCategory = id => { const c = P.S.categories.find(x => x.id === id); if (c) { c.deleted = true; touch(c); P.save(); } };
P.addEntry = e => { const r = touch({ id: uid(), type: e.type, categoryId: e.categoryId, amount: e.amount, date: e.date, memo: (e.memo || '').trim() }); P.S.entries.push(r); P.save(); return r; };
P.updateEntry = (id, patch) => { const r = P.S.entries.find(x => x.id === id); if (r) { Object.assign(r, patch); touch(r); P.save(); } };
P.deleteEntry = id => { const r = P.S.entries.find(x => x.id === id); if (r) { r.deleted = true; touch(r); P.save(); } };
P.liveEntries = () => P.S.entries.filter(e => !e.deleted);

/* ───────── 병합(기기 간 동기화용) ───────── */
P.mergeList = (a, b) => {
  const m = new Map();
  a.forEach(r => m.set(r.id, r));
  b.forEach(r => { const x = m.get(r.id); if (!x || (r.updatedAt || 0) > (x.updatedAt || 0)) m.set(r.id, r); });
  return Array.from(m.values());
};
P.mergeData = remote => {
  ['tasks', 'sessions', 'categories', 'entries'].forEach(k => { P.S[k] = P.mergeList(P.S[k], Array.isArray(remote[k]) ? remote[k] : []); });
};
/** 같은 To Do 항목을 가리키는 중복 할 일 정리(원격 삭제는 하지 않음) */
P.dedupeTodo = () => {
  const seen = new Map();
  P.S.tasks.filter(t => !t.deleted && t.todoId).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach(t => {
    if (seen.has(t.todoId)) { t.todoId = ''; t.deleted = true; touch(t); } else seen.set(t.todoId, t);
  });
};
/** 오래된 삭제 기록 정리 */
P.prune = () => {
  const limit = Date.now() - 60 * 864e5;
  ['tasks', 'sessions', 'categories', 'entries'].forEach(k => {
    P.S[k] = P.S[k].filter(r => !(r.deleted && !r.todoId && (r.updatedAt || 0) < limit && r.updatedAt !== 1));
  });
};
