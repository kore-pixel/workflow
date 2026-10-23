'use strict';
/* sync.js — Microsoft 로그인(MSAL) + To Do(Graph) 동기화 + OneDrive 앱 폴더(기기 간 데이터) */

const SCOPES = ['Tasks.ReadWrite', 'Files.ReadWrite.AppFolder'];
const GRAPH = 'https://graph.microsoft.com/v1.0';
const FILE_PATH = '/me/drive/special/approot:/planner-data.json';
const FOCUS_RE = /\n*⏱ 집중 [^\n]*\s*$/;

/** Azure에 등록해야 하는 주소 (현재 페이지 주소에서 index.html 제거) */
P.redirectUri = () => (location.origin + location.pathname).replace(/index\.html$/, '');

const Sync = P.sync = {
  app: null, account: null, busy: false, error: '', cloudError: '', listeners: [],
  onChange() { Sync.listeners.forEach(f => f()); },
  isConfigured() { return !!P.ST.clientId; },
  isSignedIn() { return !!Sync.account; },

  async init() {
    if (!P.ST.clientId) return;
    if (!window.msal) { Sync.error = '로그인 라이브러리를 불러오지 못했어요'; return; }
    try {
      Sync.app = new msal.PublicClientApplication({
        auth: {
          clientId: P.ST.clientId.trim(),
          authority: 'https://login.microsoftonline.com/consumers',
          redirectUri: P.redirectUri(),
          navigateToLoginRequestUrl: false
        },
        cache: { cacheLocation: 'localStorage' }
      });
      if (typeof Sync.app.initialize === 'function') await Sync.app.initialize();
      const res = await Sync.app.handleRedirectPromise();
      if (res && res.account) Sync.app.setActiveAccount(res.account);
      const acc = Sync.app.getActiveAccount() || Sync.app.getAllAccounts()[0];
      if (acc) { Sync.app.setActiveAccount(acc); Sync.account = acc; }
    } catch (e) {
      Sync.error = Sync.friendly(e);
    }
  },
  async login() {
    if (!Sync.app) throw new Error('먼저 클라이언트 ID를 저장해 주세요');
    await Sync.app.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
  },
  async logout() {
    const acc = Sync.account;
    try { if (Sync.app && Sync.app.clearCache) await Sync.app.clearCache({ account: acc }); } catch (e) { /* 무시 */ }
    Object.keys(localStorage).filter(k => k.startsWith('msal.')).forEach(k => localStorage.removeItem(k));
    Sync.account = null; P.ST.listId = ''; P.ST.lastSync = 0; P.saveST();
    Sync.onChange();
  },
  async token() {
    if (!Sync.app || !Sync.account) throw new Error('Microsoft 계정으로 로그인해 주세요');
    try {
      const r = await Sync.app.acquireTokenSilent({ scopes: SCOPES, account: Sync.account });
      return r.accessToken;
    } catch (e) {
      if (window.msal && e instanceof msal.InteractionRequiredAuthError) {
        await Sync.app.acquireTokenRedirect({ scopes: SCOPES, account: Sync.account });
        throw new Error('다시 로그인하는 중이에요…');
      }
      throw e;
    }
  },
  friendly(e) {
    const m = (e && (e.errorMessage || e.message)) || String(e);
    if (/AADSTS700016|application.*not found/i.test(m)) return '클라이언트 ID가 맞지 않아요. 설정에서 다시 확인해 주세요';
    if (/AADSTS50011|redirect_uri|reply url/i.test(m)) return '리디렉션 주소가 Azure에 등록된 것과 달라요 (설정 탭에 표시된 주소를 그대로 등록)';
    if (/AADSTS9002326|cross-origin/i.test(m)) return 'Azure에서 리디렉션 URI를 "단일 페이지 애플리케이션(SPA)"으로 등록해야 해요';
    if (/AADSTS700025|AADSTS7000218/i.test(m)) return 'Azure 인증 설정에서 "공용 클라이언트 흐름 허용"/SPA 설정을 확인해 주세요';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return '네트워크에 연결할 수 없어요';
    return m.length > 140 ? m.slice(0, 140) + '…' : m;
  }
};

/* ───────── Graph 호출 ───────── */
async function gfetch(url, init = {}, retry = true) {
  const tk = await Sync.token();
  const headers = Object.assign({ Authorization: 'Bearer ' + tk }, init.headers || {});
  let body = init.body;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
  const res = await fetch(url.startsWith('http') ? url : GRAPH + url, { method: init.method || 'GET', headers, body });
  if ((res.status === 429 || res.status === 503) && retry) {
    const wait = Math.min(10, Number(res.headers.get('Retry-After')) || 2);
    await new Promise(r => setTimeout(r, wait * 1000));
    return gfetch(url, init, false);
  }
  return res;
}
async function gerr(res) {
  let msg = '', code = '';
  try { const j = await res.json(); code = (j.error && j.error.code) || ''; msg = (j.error && j.error.message) || ''; } catch (e) { /* 본문 없음 */ }
  const err = new Error(`Microsoft 서버 오류 ${res.status}${code ? ' (' + code + ')' : ''}${msg ? ': ' + msg : ''}`);
  err.status = res.status; err.code = code;
  return err;
}
async function gjson(url, init) {
  const res = await gfetch(url, init);
  if (res.status === 204) return null;
  if (!res.ok) throw await gerr(res);
  return res.json();
}

/* ───────── To Do 변환 ───────── */
function bodyText(t) {
  let c = t.memo || '';
  const f = P.focusSec(t.id);
  if (f >= 60) c += (c ? '\n\n' : '') + `⏱ 집중 ${fmtDur(f)}`;
  return c;
}
function toRemote(t, create) {
  const o = { title: t.title, status: t.done ? 'completed' : 'notStarted', body: { content: bodyText(t), contentType: 'text' } };
  if (t.date) o.dueDateTime = { dateTime: `${t.date}T00:00:00.0000000`, timeZone: 'UTC' };
  else if (!create) o.dueDateTime = null;
  if (t.date && t.time) {
    const d = new Date(`${t.date}T${t.time}:00`);
    o.isReminderOn = true;
    o.reminderDateTime = { dateTime: d.toISOString().slice(0, 19) + '.0000000', timeZone: 'UTC' };
  } else {
    o.isReminderOn = false;
    if (!create) o.reminderDateTime = null;
  }
  return o;
}
function htmlToText(h) { try { return new DOMParser().parseFromString(h, 'text/html').body.textContent || ''; } catch (e) { return h; } }
function fromRemote(r) {
  let date = '', time = '';
  if (r.dueDateTime && r.dueDateTime.dateTime) date = r.dueDateTime.dateTime.slice(0, 10);
  if (r.isReminderOn && r.reminderDateTime && r.reminderDateTime.dateTime) {
    const raw = r.reminderDateTime.dateTime.slice(0, 19);
    const d = (r.reminderDateTime.timeZone || 'UTC') === 'UTC' ? new Date(raw + 'Z') : new Date(raw);
    const rd = ymd(d);
    if (!date) date = rd;
    if (rd === date) time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  let memo = (r.body && r.body.content) || '';
  if (r.body && r.body.contentType === 'html') memo = htmlToText(memo);
  memo = memo.replace(FOCUS_RE, '').trim();
  return { title: r.title || '(제목 없음)', done: r.status === 'completed', date, time, memo };
}
const sameFields = (t, f) => t.title === f.title && !!t.done === f.done && (t.date || '') === f.date && (t.time || '') === f.time && (t.memo || '') === f.memo;

/* ───────── To Do 목록/작업 ───────── */
async function ensureList() {
  if (P.ST.listId) {
    try { await gjson(`/me/todo/lists/${P.ST.listId}`); return P.ST.listId; }
    catch (e) { if (e.status !== 404) throw e; P.ST.listId = ''; }
  }
  let url = '/me/todo/lists?$top=100';
  while (url) {
    const j = await gjson(url);
    const f = (j.value || []).find(l => l.displayName === P.ST.listName);
    if (f) { P.ST.listId = f.id; P.saveST(); return f.id; }
    url = j['@odata.nextLink'];
  }
  const n = await gjson('/me/todo/lists', { method: 'POST', json: { displayName: P.ST.listName } });
  P.ST.listId = n.id; P.saveST(); return n.id;
}
async function fetchRemoteTasks(listId) {
  const out = [];
  let url = `/me/todo/lists/${listId}/tasks?$top=100`;
  while (url) { const j = await gjson(url); out.push(...(j.value || [])); url = j['@odata.nextLink']; }
  return out;
}

async function syncTodo() {
  const listId = await ensureList();
  const remote = await fetchRemoteTasks(listId);
  const rmap = new Map(remote.map(r => [r.id, r]));
  const tasks = P.S.tasks;
  const stat = { created: 0, updated: 0, deleted: 0, imported: 0, pulled: 0 };
  const now = () => Date.now();
  const rmod = r => Date.parse(r.lastModifiedDateTime) || 0;

  // 1) 내 쪽 변경을 To Do로
  for (const t of tasks) {
    if (t.deleted) {
      if (t.todoId) {
        if (rmap.has(t.todoId)) {
          const res = await gfetch(`/me/todo/lists/${listId}/tasks/${t.todoId}`, { method: 'DELETE' });
          if (!res.ok && res.status !== 404) throw await gerr(res);
          stat.deleted++;
        }
        t.todoId = ''; t.updatedAt = t.syncedAt = now();
      }
      continue;
    }
    if (!t.todoId) {
      const r = await gjson(`/me/todo/lists/${listId}/tasks`, { method: 'POST', json: toRemote(t, true) });
      t.todoId = r.id; t.remoteMod = rmod(r); t.updatedAt = t.syncedAt = now();
      rmap.set(r.id, r); stat.created++;
      continue;
    }
    const r = rmap.get(t.todoId);
    if (!r) {                       // To Do에서 지워진 항목
      if ((t.updatedAt || 0) > (t.syncedAt || 0)) {   // 그 사이 내가 고쳤다면 다시 올림
        const n = await gjson(`/me/todo/lists/${listId}/tasks`, { method: 'POST', json: toRemote(t, true) });
        t.todoId = n.id; t.remoteMod = rmod(n); t.updatedAt = t.syncedAt = now(); rmap.set(n.id, n); stat.created++;
      } else {
        t.deleted = true; t.todoId = ''; t.updatedAt = t.syncedAt = now(); stat.pulled++;
      }
      continue;
    }
    const localChanged = (t.updatedAt || 0) > (t.syncedAt || 0);
    const remoteChanged = rmod(r) > (t.remoteMod || 0);
    if (localChanged && (!remoteChanged || (t.updatedAt || 0) >= rmod(r))) {
      const n = await gjson(`/me/todo/lists/${listId}/tasks/${t.todoId}`, { method: 'PATCH', json: toRemote(t, false) });
      t.remoteMod = rmod(n); t.syncedAt = now(); t.updatedAt = Math.min(t.updatedAt, t.syncedAt); stat.updated++;
    } else if (remoteChanged) {
      const f = fromRemote(r);
      if (!sameFields(t, f)) { Object.assign(t, f); stat.pulled++; }
      t.remoteMod = rmod(r); t.updatedAt = t.syncedAt = now();
    }
  }

  // 2) To Do에만 있는 항목 가져오기
  const known = new Set(tasks.filter(t => t.todoId).map(t => t.todoId));
  for (const r of remote) {
    if (known.has(r.id)) continue;
    const f = fromRemote(r);
    const twin = tasks.find(t => !t.deleted && !t.todoId && t.title === f.title && (t.date || '') === f.date);
    if (twin) {
      twin.todoId = r.id; twin.remoteMod = rmod(r); twin.updatedAt = twin.syncedAt = now();
    } else {
      tasks.push({ id: 'td-' + r.id, ...f, createdAt: Date.parse(r.createdDateTime) || now(), todoId: r.id, remoteMod: rmod(r), updatedAt: now(), syncedAt: now() });
      stat.imported++;
    }
    known.add(r.id);
  }
  return stat;
}

/* ───────── OneDrive 앱 폴더 (할 일 외 데이터: 타이머 기록·가계부) ───────── */
async function cloudRead() {
  let res;
  try { res = await gfetch(FILE_PATH + ':/content'); }
  catch (e) {
    if (!(e instanceof TypeError)) throw e;
    res = null;                       // 리디렉션 CORS 문제일 수 있어 다운로드 주소로 재시도
  }
  if (res && res.status === 404) return null;
  if (res && res.ok) return res.json();
  if (res && !res.ok && res.status !== 0) throw await gerr(res);
  const meta = await gfetch(FILE_PATH);
  if (meta.status === 404) return null;
  if (!meta.ok) throw await gerr(meta);
  const m = await meta.json();
  const url = m['@microsoft.graph.downloadUrl'];
  if (!url) return null;
  const dl = await fetch(url);
  if (!dl.ok) throw new Error('OneDrive 파일을 읽지 못했어요');
  return dl.json();
}
async function cloudWrite(payload) {
  const res = await gfetch(FILE_PATH + ':/content', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw await gerr(res);
}

/* ───────── 전체 동기화 ───────── */
let queued = null;
P.scheduleSync = () => {
  if (!Sync.isSignedIn() || !P.ST.autoSync) return;
  clearTimeout(queued);
  queued = setTimeout(() => P.syncNow(true), 3500);
};
P.syncNow = async (quiet) => {
  if (Sync.busy) return;
  if (!Sync.isSignedIn()) { if (!quiet) P.toast('먼저 설정에서 Microsoft 로그인을 해 주세요'); return; }
  if (!navigator.onLine) { if (!quiet) P.toast('오프라인이에요. 연결되면 자동으로 동기화돼요'); return; }
  Sync.busy = true; Sync.error = ''; Sync.cloudError = ''; Sync.onChange();
  let stat = null, todoOk = false;
  try {
    // ① 다른 기기의 데이터를 먼저 합치기
    let cloudLoaded = false;
    if (P.ST.cloud) {
      try {
        const remote = await cloudRead();
        if (remote) P.mergeData(remote);
        cloudLoaded = true;
      } catch (e) { Sync.cloudError = 'OneDrive 읽기 실패: ' + Sync.friendly(e); }
    }
    P.dedupeTodo();
    // ② To Do와 맞추기
    stat = await syncTodo();
    todoOk = true;
    P.dedupeTodo();
    P.prune();
    // ③ 합친 결과를 OneDrive에 저장 (To Do 연결이 끝난 할 일만 올림)
    if (P.ST.cloud && cloudLoaded) {
      try {
        await cloudWrite({
          v: 1, savedAt: Date.now(),
          tasks: P.S.tasks.filter(t => t.deleted || t.todoId),
          sessions: P.S.sessions, categories: P.S.categories, entries: P.S.entries
        });
      } catch (e) { Sync.cloudError = 'OneDrive 저장 실패: ' + Sync.friendly(e); }
    }
    P.ST.lastSync = Date.now(); P.ST.lastError = '';
  } catch (e) {
    Sync.error = Sync.friendly(e); P.ST.lastError = Sync.error;
  } finally {
    Sync.busy = false;
    P.saveST(); P.save({ silent: true });
    P.render && P.render(); Sync.onChange();
  }
  if (Sync.error) { if (!quiet || todoOk === false) P.toast('동기화 실패: ' + Sync.error); }
  else if (!quiet) {
    const bits = [];
    if (stat.created) bits.push(`보냄 ${stat.created}`);
    if (stat.updated) bits.push(`수정 ${stat.updated}`);
    if (stat.imported) bits.push(`가져옴 ${stat.imported}`);
    if (stat.deleted) bits.push(`삭제 ${stat.deleted}`);
    P.toast(Sync.cloudError ? Sync.cloudError : ('동기화 완료' + (bits.length ? ' · ' + bits.join(' · ') : '')));
  }
};

// 테스트에서 쓸 수 있도록 내부 변환 함수 노출
P._sync = { toRemote, fromRemote, syncTodo };
