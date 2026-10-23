'use strict';
/* app.js — 화면(할 일 / 타이머 / 가계부 / 설정) */

const V = { tab: 'tasks', date: todayStr(), lgType: 'expense', lgCat: '' };
const TABS = {
  tasks: ['할 일', ICON.tTasks], timer: ['타이머', ICON.tTimer],
  ledger: ['가계부', ICON.tLedger], settings: ['설정', ICON.tSettings]
};
const view = $('#view');

/* ───────── 토스트 / 시트 ───────── */
let toastTimer;
P.toast = msg => {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
};
function closeSheet() { $('#sheetRoot').innerHTML = ''; }
function openSheet(title, bodyHtml, mount) {
  closeSheet();
  const w = document.createElement('div');
  w.className = 'sheetwrap';
  w.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(title)}"><header><h2>${esc(title)}</h2><button class="mini" data-close aria-label="닫기">${ICON.x}</button></header><div class="body">${bodyHtml}</div></div>`;
  w.addEventListener('click', e => { if (e.target === w || e.target.closest('[data-close]')) closeSheet(); });
  $('#sheetRoot').appendChild(w);
  if (mount) mount($('.body', w), w);
  return w;
}

/* ───────── 화면 틀 ───────── */
function updateChrome() {
  const settings = V.tab === 'settings';
  $('#winTitle').textContent = TABS[V.tab][0];
  $('#dateText').textContent = settings ? '설정' : fmtDateLong(V.date);
  $('#datePill').classList.toggle('off', settings);
  $('#dateInput').value = V.date;
  $('#btnPrev').disabled = $('#btnNext').disabled = settings;
  $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === V.tab));
  const sb = $('#btnSync');
  sb.classList.toggle('spin', P.sync.busy);
  const dot = $('.dot', sb);
  dot.className = 'dot' + (P.sync.error ? ' err' : (P.sync.isSignedIn() ? ' ok' : ''));
}
function setDate(d) {
  V.date = d;
  const a = $('#tDate'); if (a) a.value = d;
  const b = $('#lgDate'); if (b) b.value = d;
  refresh();
}
function setTab(t) {
  V.tab = t;
  ({ tasks: mountTasks, timer: mountTimer, ledger: mountLedger, settings: mountSettings })[t]();
  refresh();
  view.scrollTop = 0;
}
function refresh() {
  ({ tasks: refreshTasks, timer: refreshTimer, ledger: refreshLedger, settings: refreshSettings })[V.tab]();
  updateChrome();
}
P.render = refresh;
P.afterChange = () => P.scheduleSync();

/* ═════════════ 할 일 ═════════════ */
function mountTasks() {
  view.innerHTML = `
    <form class="card addform" id="taskForm" autocomplete="off">
      <input class="field" id="tTitle" placeholder="할 일을 적어요" maxlength="120" enterkeyhint="done">
      <div class="row">
        <label class="pill pill-input">${ICON.cal}<input type="date" id="tDate" value="${V.date}"></label>
        <label class="pill pill-input">${ICON.clock}<input type="time" id="tTime"><button type="button" class="mini" id="tTimeClear" hidden aria-label="시간 지우기">${ICON.x}</button></label>
        <span class="grow"></span>
        <button class="pill primary" type="submit">${ICON.plus}추가</button>
      </div>
    </form>
    <div id="taskList" class="stack"></div>`;
  const time = $('#tTime');
  time.oninput = () => { $('#tTimeClear').hidden = !time.value; };
  $('#tTimeClear').onclick = () => { time.value = ''; $('#tTimeClear').hidden = true; };
  $('#taskForm').onsubmit = e => {
    e.preventDefault();
    const title = $('#tTitle').value.trim();
    if (!title) { $('#tTitle').focus(); return; }
    const date = $('#tDate').value, tm = time.value;
    P.addTask({ title, date, time: tm });
    $('#tTitle').value = ''; time.value = ''; $('#tTimeClear').hidden = true;
    if (date && date !== V.date) P.toast(`${fmtDateShort(date)} 할 일에 추가했어요`);
    else if (!date) P.toast('날짜 없는 할 일에 추가했어요');
    $('#tTitle').focus();
  };
  $('#taskList').onclick = e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const id = a.closest('[data-id]').dataset.id;
    if (a.dataset.act === 'toggle') P.toggleTask(id);
    else if (a.dataset.act === 'edit') openTaskSheet(id);
    else if (a.dataset.act === 'timer') startTimerFor(id);
  };
}
function taskRow(t, showDate) {
  const meta = [];
  const late = !t.done && t.date && t.date < todayStr();
  if (showDate && t.date) meta.push(`<span class="${late ? 'late' : ''}">${ICON.cal}${fmtMD(t.date)}</span>`);
  if (t.time) meta.push(`<span>${ICON.clock}${esc(t.time)}</span>`);
  const f = P.focusSec(t.id);
  if (f >= 60) meta.push(`<span>${ICON.tTimer}${fmtDur(f)}</span>`);
  if (t.memo) meta.push(`<span>${ICON.note}메모</span>`);
  return `<div class="task ${t.done ? 'done' : ''}" data-id="${esc(t.id)}">
    <button class="check" data-act="toggle" aria-label="완료 표시">${ICON.check}</button>
    <div class="tmain" data-act="edit"><div class="ttitle">${esc(t.title)}</div>${meta.length ? `<div class="tmeta">${meta.join('')}</div>` : ''}</div>
    ${t.done ? '' : `<button class="icobtn" data-act="timer" aria-label="이 할 일로 타이머 시작">${ICON.play}</button>`}
  </div>`;
}
const sortTasks = list => list.slice().sort((a, b) =>
  (a.done - b.done) || ((a.date || '9') < (b.date || '9') ? -1 : (a.date || '9') > (b.date || '9') ? 1 : 0) ||
  ((a.time || '99:99') < (b.time || '99:99') ? -1 : (a.time || '99:99') > (b.time || '99:99') ? 1 : 0) ||
  ((a.createdAt || 0) - (b.createdAt || 0)));
function taskSection(title, all, showDate) {
  if (!all.length) return '';
  const shown = P.ST.hideDone ? all.filter(t => !t.done) : all;
  const done = all.filter(t => t.done).length;
  if (!shown.length) return `<div><div class="sec">${esc(title)}<span class="count">${done}/${all.length} 완료</span></div></div>`;
  return `<div><div class="sec">${esc(title)}<span class="count">${done}/${all.length}</span></div>
    <div class="card tlist">${sortTasks(shown).map(t => taskRow(t, showDate)).join('')}</div></div>`;
}
function refreshTasks() {
  const list = $('#taskList'); if (!list) return;
  const all = P.liveTasks(), today = todayStr();
  let html = '';
  if (!P.ST.viewAll) {
    html += taskSection(`${relLabel(V.date)} 할 일`, all.filter(t => t.date === V.date), false);
    if (V.date === today) html += taskSection('밀린 할 일', all.filter(t => !t.done && t.date && t.date < today), true);
    html += taskSection('날짜 없음', all.filter(t => !t.date), false);
    if (!html) html = `<div class="empty">${esc(relLabel(V.date))}은 아직 할 일이 없어요.<br>위에서 하나 적어 볼까요?</div>`;
  } else {
    const dates = Array.from(new Set(all.filter(t => t.date).map(t => t.date))).sort();
    dates.forEach(d => { html += taskSection(`${fmtDateShort(d)}${d === today ? ' · 오늘' : ''}`, all.filter(t => t.date === d), false); });
    html += taskSection('날짜 없음', all.filter(t => !t.date), false);
    if (!html) html = '<div class="empty">아직 할 일이 없어요.</div>';
  }
  list.innerHTML = html;
}
function openTaskSheet(id) {
  const t = P.task(id); if (!t) return;
  const focus = P.focusSec(id);
  openSheet('할 일 수정', `
    <input class="field" id="eTitle" value="${esc(t.title)}" maxlength="120">
    <div class="row">
      <label class="pill pill-input">${ICON.cal}<input type="date" id="eDate" value="${esc(t.date)}"><button type="button" class="mini" id="eDateClear" aria-label="날짜 지우기">${ICON.x}</button></label>
      <label class="pill pill-input">${ICON.clock}<input type="time" id="eTime" value="${esc(t.time)}"><button type="button" class="mini" id="eTimeClear" aria-label="시간 지우기">${ICON.x}</button></label>
    </div>
    <textarea class="field" id="eMemo" placeholder="메모 (To Do 메모란에도 들어가요)">${esc(t.memo)}</textarea>
    ${focus >= 60 ? `<div class="hint">지금까지 집중한 시간 <b>${fmtDur(focus)}</b></div>` : ''}
    <div class="row nw">
      <button class="pill danger" data-del>${ICON.trash}삭제</button>
      <button class="pill grow" data-close>취소</button>
      <button class="pill primary grow" data-save>저장</button>
    </div>`, b => {
    $('#eDateClear', b).onclick = () => { $('#eDate', b).value = ''; $('#eTime', b).value = ''; };
    $('#eTimeClear', b).onclick = () => { $('#eTime', b).value = ''; };
    $('[data-del]', b).onclick = () => { if (confirm('이 할 일을 삭제할까요?')) { P.deleteTask(id); closeSheet(); } };
    $('[data-save]', b).onclick = () => {
      const title = $('#eTitle', b).value.trim();
      if (!title) { $('#eTitle', b).focus(); return; }
      P.updateTask(id, { title, date: $('#eDate', b).value, time: $('#eTime', b).value, memo: $('#eMemo', b).value.trim() });
      closeSheet();
    };
  });
}
function startTimerFor(id) {
  if (P.T.running || P.T.accSec > 0) {
    if (P.T.taskId !== id) P.toast('진행 중인 타이머를 먼저 종료해 주세요');
  } else {
    P.T.taskId = id; P.T.label = ''; P.saveT(); P.timerStart(); requestWake();
  }
  V.date = todayStr();
  setTab('timer');
}

/* ═════════════ 타이머 ═════════════ */
let wake = null;
async function requestWake() {
  try {
    if ('wakeLock' in navigator && !wake) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    }
  } catch (e) { /* 지원 안 함 */ }
}
function releaseWake() { try { if (wake) wake.release(); } catch (e) { /* 무시 */ } wake = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && P.T.running) requestWake();
});

function mountTimer() {
  view.innerHTML = `
    <div class="card timercard">
      <div class="sel">
        <select class="field" id="tgt" aria-label="집중할 일"></select>
        <input class="field" id="tLabel" placeholder="무엇을 하나요? (예: 영어 공부)" maxlength="40">
      </div>
      <div class="clock" id="clock">00:00:00</div>
      <div class="tstate" id="tstate"></div>
      <div class="tbtns">
        <button class="pill big primary" id="tgo"></button>
        <button class="pill big" id="tstop">${ICON.stop}종료·저장</button>
      </div>
    </div>
    <div class="card total"><div class="cap" id="totCap"></div><div class="num" id="totNum"></div></div>
    <div><div class="sec">기록<span class="count" id="sessCount"></span></div><div class="card" id="sessList"></div></div>
    <div><div class="sec">최근 7일</div><div class="card"><div class="bars" id="bars"></div></div></div>`;
  $('#tgt').onchange = () => { P.T.taskId = $('#tgt').value; P.saveT(); refreshTimer(); };
  $('#tLabel').oninput = () => { P.T.label = $('#tLabel').value; P.saveT(); };
  $('#tgo').onclick = () => {
    if (P.T.running) { P.timerPause(); releaseWake(); } else { P.timerStart(); requestWake(); }
    refreshTimer();
  };
  $('#tstop').onclick = () => {
    if (P.elapsed() < 1) return;
    const sec = P.timerStop(); releaseWake();
    P.toast(sec ? `${fmtDur(sec)} 집중 기록을 저장했어요` : '5초 미만이라 저장하지 않았어요');
    refreshTimer();
  };
  $('#sessList').onclick = e => {
    const a = e.target.closest('[data-del]'); if (!a) return;
    if (confirm('이 기록을 삭제할까요?')) P.deleteSession(a.closest('[data-id]').dataset.id);
  };
}
function timerTotalNow() {
  const live = (V.date === todayStr() && (P.T.running || P.T.accSec > 0)) ? P.elapsed() : 0;
  return P.dayTotal(V.date) + live;
}
function tickTimer() {
  const clock = $('#clock'); if (!clock) return;
  clock.textContent = fmtClock(P.elapsed());
  $('#totNum').textContent = fmtDur(timerTotalNow());
}
function refreshTimer() {
  const sel = $('#tgt'); if (!sel) return;
  const today = todayStr();
  const open = P.liveTasks().filter(t => !t.done || t.id === P.T.taskId)
    .sort((a, b) => ((a.date === today ? 0 : 1) - (b.date === today ? 0 : 1)) || ((a.date || '9') < (b.date || '9') ? -1 : 1));
  const html = '<option value="">자유 집중 (직접 입력)</option>' +
    open.map(t => `<option value="${esc(t.id)}">${t.date ? fmtMD(t.date) + ' · ' : ''}${esc(t.title)}</option>`).join('');
  if (sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; }
  sel.value = P.T.taskId;
  if (sel.value !== P.T.taskId) { P.T.taskId = ''; sel.value = ''; }
  const idle = !P.T.running && P.T.accSec === 0;
  sel.disabled = !idle;
  const lab = $('#tLabel');
  lab.hidden = !!P.T.taskId; lab.disabled = !idle;
  if (document.activeElement !== lab) lab.value = P.T.label || '';
  const state = P.T.running ? 'run' : (P.T.accSec > 0 ? 'pause' : 'idle');
  $('#clock').classList.toggle('run', state === 'run');
  $('#tgo').innerHTML = state === 'run' ? `${ICON.pause}일시정지` : `${ICON.play}${state === 'pause' ? '이어서' : '시작'}`;
  $('#tstop').disabled = state === 'idle';
  $('#tstate').textContent = state === 'run' ? '집중하는 중… 화면을 켜 둘게요' : state === 'pause' ? '잠시 멈춤' : '시작을 누르면 시간이 올라가요';
  $('#totCap').textContent = `${relLabel(V.date)} 총 집중 시간`;
  tickTimer();

  const ss = P.daySessions(V.date);
  $('#sessCount').textContent = ss.length ? `${ss.length}개` : '';
  $('#sessList').innerHTML = ss.length ? ss.slice().reverse().map(s => {
    const t = s.taskId && P.task(s.taskId);
    const name = s.taskId ? (t && !t.deleted ? t.title : '(삭제된 할 일)') : (s.label || '자유 집중');
    return `<div class="srow" data-id="${esc(s.id)}"><div class="when">${fmtHM(s.start)}–${fmtHM(s.start + s.sec * 1000)}</div>
      <div class="what">${esc(name)}</div><div class="dur">${fmtDur(s.sec)}</div>
      <button class="mini" data-del aria-label="기록 삭제">${ICON.x}</button></div>`;
  }).join('') : '<div class="empty" style="padding:14px 8px">이 날은 아직 기록이 없어요.</div>';

  const days = [];
  for (let i = 6; i >= 0; i--) { const d = addDays(V.date, -i); days.push([d, P.dayTotal(d)]); }
  const max = Math.max(...days.map(x => x[1]), 1);
  $('#bars').innerHTML = days.map(([d, sec]) => {
    const h = sec ? Math.max(6, Math.round(sec / max * 68)) : 4;
    const v = sec >= 3600 ? (sec / 3600).toFixed(1) + 'h' : sec >= 60 ? Math.round(sec / 60) + 'm' : '';
    return `<div class="bcol ${d === today ? 'today' : ''} ${d === V.date ? 'sel' : ''}"><div class="v">${v}</div><div class="fill" style="height:${h}px;${sec ? '' : 'opacity:.35'}"></div><div class="d">${DOW[parseYmd(d).getDay()]}</div></div>`;
  }).join('');
}
setInterval(() => { if (V.tab === 'timer') tickTimer(); }, 1000);

/* ═════════════ 가계부 ═════════════ */
function mountLedger() {
  view.innerHTML = `
    <div class="card stack" id="lgSummary"></div>
    <form class="card stack" id="lgForm" autocomplete="off">
      <div class="seg"><button type="button" data-type="expense">지출</button><button type="button" data-type="income">수입</button></div>
      <div class="row nw">
        <label class="pill pill-input">${ICON.cal}<input type="date" id="lgDate" value="${V.date}"></label>
        <input class="field grow" id="lgAmount" inputmode="numeric" placeholder="금액 (원)">
      </div>
      <div class="chips" id="lgCats"></div>
      <input class="field" id="lgMemo" placeholder="메모 (선택)" maxlength="60">
      <button class="pill primary full" type="submit">${ICON.plus}기록하기</button>
    </form>
    <div><div class="sec" id="lgDayTitle"></div><div class="card" id="lgDay"></div></div>
    <div><div class="sec" id="lgMonthTitle"></div><div class="card" id="lgMonth"></div></div>
    <div><div class="sec">이번 달 지출 분류</div><div class="card" id="lgBreak"></div></div>`;
  $('.seg', view).onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    V.lgType = b.dataset.type; V.lgCat = ''; refreshLedger();
  };
  $('#lgCats').onclick = e => {
    if (e.target.closest('[data-addcat]')) { openCatSheet(); return; }
    const c = e.target.closest('[data-cat]'); if (c) { V.lgCat = c.dataset.cat; refreshLedger(); }
  };
  $('#lgDate').onchange = e => { if (e.target.value) { V.date = e.target.value; refreshLedger(); updateChrome(); } };
  $('#lgAmount').oninput = e => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 10);
    e.target.value = d ? Number(d).toLocaleString('ko-KR') : '';
  };
  $('#lgForm').onsubmit = e => {
    e.preventDefault();
    const amount = parseInt($('#lgAmount').value.replace(/\D/g, ''), 10);
    if (!amount) { $('#lgAmount').focus(); return; }
    if (!V.lgCat) { P.toast('분류를 먼저 골라 주세요'); return; }
    const date = $('#lgDate').value || V.date;
    P.addEntry({ type: V.lgType, categoryId: V.lgCat, amount, date, memo: $('#lgMemo').value });
    $('#lgAmount').value = ''; $('#lgMemo').value = '';
    V.date = date;
    P.toast(`${fmtMD(date)} ${V.lgType === 'income' ? '수입' : '지출'} ${won(amount)} 기록했어요`);
    $('#lgAmount').focus();
  };
  $('#lgDay').onclick = e => { const r = e.target.closest('[data-id]'); if (r) openEntrySheet(r.dataset.id); };
  $('#lgMonth').onclick = e => { const r = e.target.closest('[data-date]'); if (r) setDate(r.dataset.date); };
}
const sum = (list, type) => list.filter(e => e.type === type).reduce((a, e) => a + e.amount, 0);
const signed = e => (e.type === 'income' ? '+' : '−') + won(e.amount);
function refreshLedger() {
  if (!$('#lgForm')) return;
  const all = P.liveEntries();
  const ym = V.date.slice(0, 7);
  const month = all.filter(e => e.date.slice(0, 7) === ym);
  const inc = sum(month, 'income'), exp = sum(month, 'expense'), net = inc - exp;
  const bal = sum(all, 'income') - sum(all, 'expense');
  const [yy, mm] = ym.split('-');
  $('#lgSummary').innerHTML = `
    <div class="row" style="justify-content:space-between"><b>${yy}년 ${Number(mm)}월</b><span class="hint">전체 잔액 <b>${won(bal)}</b></span></div>
    <div class="sum3">
      <div><div class="cap">수입</div><div class="num inc">${won(inc)}</div></div>
      <div><div class="cap">지출</div><div class="num exp">${won(exp)}</div></div>
      <div><div class="cap">이번 달 합계</div><div class="num ${net < 0 ? 'exp' : 'inc'}">${net < 0 ? '−' : ''}${won(Math.abs(net))}</div></div>
    </div>`;

  $$('.seg button', view).forEach(b => b.classList.toggle('on', b.dataset.type === V.lgType));
  const cats = P.cats(V.lgType);
  if (!cats.some(c => c.id === V.lgCat)) V.lgCat = cats.length ? cats[0].id : '';
  $('#lgCats').innerHTML = cats.map(c => `<button type="button" class="chip ${c.id === V.lgCat ? 'on' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('')
    + `<button type="button" class="chip add" data-addcat>＋ 분류 관리</button>`;
  const dateEl = $('#lgDate'); if (dateEl.value !== V.date && document.activeElement !== dateEl) dateEl.value = V.date;

  const day = all.filter(e => e.date === V.date).sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  const di = sum(day, 'income'), de = sum(day, 'expense');
  $('#lgDayTitle').innerHTML = `${esc(relLabel(V.date))} 내역<span class="sp"></span><span class="count">${di ? `<span class="inc">+${won(di)}</span> ` : ''}${de ? `<span class="exp">−${won(de)}</span>` : ''}</span>`;
  $('#lgDay').innerHTML = day.length ? day.map(e => `<div class="erow" data-id="${esc(e.id)}">
      <span class="tag">${esc(P.catName(e.categoryId))}</span><span class="memo">${esc(e.memo)}</span>
      <span class="amt ${e.type === 'income' ? 'inc' : 'exp'}">${signed(e)}</span></div>`).join('')
    : '<div class="empty" style="padding:14px 8px">이 날은 기록이 없어요.</div>';

  $('#lgMonthTitle').textContent = `${Number(mm)}월 날짜별`;
  const byDate = {};
  month.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const dates = Object.keys(byDate).sort().reverse();
  $('#lgMonth').innerHTML = dates.length ? dates.map(d => {
    const i = sum(byDate[d], 'income'), x = sum(byDate[d], 'expense');
    return `<div class="drow ${d === V.date ? 'sel' : ''}" data-date="${d}"><span class="dd">${fmtMD(d)} (${DOW[parseYmd(d).getDay()]})</span><span class="sp"></span>
      ${i ? `<span class="inc">+${won(i)}</span>` : ''}${x ? `<span class="exp">−${won(x)}</span>` : ''}</div>`;
  }).join('') : '<div class="empty" style="padding:14px 8px">이번 달 기록이 없어요.</div>';

  const by = {};
  month.filter(e => e.type === 'expense').forEach(e => { by[e.categoryId] = (by[e.categoryId] || 0) + e.amount; });
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
  const mx = rows.length ? rows[0][1] : 1;
  $('#lgBreak').innerHTML = rows.length ? rows.map(([id, v]) =>
    `<div class="cbar"><span>${esc(P.catName(id))}</span><div class="track"><i style="width:${Math.max(4, Math.round(v / mx * 100))}%"></i></div><span class="amt">${won(v)}</span></div>`).join('')
    : '<div class="empty" style="padding:14px 8px">이번 달 지출이 없어요.</div>';
}
function openEntrySheet(id) {
  const e = P.S.entries.find(x => x.id === id); if (!e) return;
  let type = e.type, cat = e.categoryId;
  openSheet('내역 수정', `
    <div class="seg"><button type="button" data-type="expense">지출</button><button type="button" data-type="income">수입</button></div>
    <div class="row nw">
      <label class="pill pill-input">${ICON.cal}<input type="date" id="xDate" value="${esc(e.date)}"></label>
      <input class="field grow" id="xAmount" inputmode="numeric" value="${e.amount.toLocaleString('ko-KR')}">
    </div>
    <div class="chips" id="xCats"></div>
    <input class="field" id="xMemo" value="${esc(e.memo)}" placeholder="메모 (선택)" maxlength="60">
    <div class="row nw">
      <button class="pill danger" data-del>${ICON.trash}삭제</button>
      <button class="pill grow" data-close>취소</button>
      <button class="pill primary grow" data-save>저장</button>
    </div>`, b => {
    const draw = () => {
      const list = P.cats(type).slice();
      if (cat && !list.some(c => c.id === cat)) {
        const old = P.S.categories.find(c => c.id === cat && c.type === type);
        if (old) list.unshift(old); else cat = '';
      }
      if (!cat && list.length) cat = list[0].id;
      $('#xCats', b).innerHTML = list.map(c => `<button type="button" class="chip ${c.id === cat ? 'on' : ''}" data-cat="${esc(c.id)}">${esc(P.catName(c.id))}</button>`).join('');
      $$('.seg button', b).forEach(x => x.classList.toggle('on', x.dataset.type === type));
    };
    draw();
    $('.seg', b).onclick = ev => { const x = ev.target.closest('button'); if (x) { type = x.dataset.type; cat = ''; draw(); } };
    $('#xCats', b).onclick = ev => { const x = ev.target.closest('[data-cat]'); if (x) { cat = x.dataset.cat; draw(); } };
    $('#xAmount', b).oninput = ev => { const d = ev.target.value.replace(/\D/g, '').slice(0, 10); ev.target.value = d ? Number(d).toLocaleString('ko-KR') : ''; };
    $('[data-del]', b).onclick = () => { if (confirm('이 내역을 삭제할까요?')) { P.deleteEntry(id); closeSheet(); } };
    $('[data-save]', b).onclick = () => {
      const amount = parseInt($('#xAmount', b).value.replace(/\D/g, ''), 10);
      if (!amount) { $('#xAmount', b).focus(); return; }
      P.updateEntry(id, { type, categoryId: cat, amount, date: $('#xDate', b).value || e.date, memo: $('#xMemo', b).value.trim() });
      closeSheet();
    };
  });
}
function openCatSheet() {
  openSheet('분류 관리', '<div id="catBody" class="stack"></div>', b => {
    const body = $('#catBody', b);
    const draw = () => {
      body.innerHTML = [['expense', '지출 분류'], ['income', '수입 분류']].map(([type, label]) => `
        <div><div class="sec" style="margin-left:0">${label}</div>
          <div class="chips">${P.cats(type).map(c => `<span class="chip">${esc(c.name)} <button class="mini" style="display:inline-grid;vertical-align:middle;margin-left:4px" data-delcat="${esc(c.id)}" aria-label="${esc(c.name)} 삭제">${ICON.x}</button></span>`).join('') || '<span class="hint">분류가 없어요</span>'}</div>
          <div class="row nw" style="margin-top:8px"><input class="field grow" data-new="${type}" placeholder="새 ${type === 'expense' ? '지출' : '수입'} 분류 이름" maxlength="16">
          <button class="pill primary" data-addcat="${type}">추가</button></div></div>`).join('') +
        '<button class="pill full" data-close>닫기</button>';
    };
    draw();
    body.onclick = ev => {
      const del = ev.target.closest('[data-delcat]');
      if (del) { if (confirm('이 분류를 삭제할까요? 이미 쓴 내역은 그대로 남아요.')) { P.deleteCategory(del.dataset.delcat); draw(); } return; }
      const add = ev.target.closest('[data-addcat]');
      if (add) {
        const input = $(`[data-new="${add.dataset.addcat}"]`, body);
        if (!input.value.trim()) { input.focus(); return; }
        const c = P.addCategory(add.dataset.addcat, input.value);
        if (c && add.dataset.addcat === V.lgType) V.lgCat = c.id;
        draw();
      }
    };
  });
}

/* ═════════════ 설정 ═════════════ */
const FONT_LABEL = { mix: '본문 Pretendard · 제목 조선굴림체', sans: '전부 Pretendard', serif: '전부 조선굴림체' };
function mountSettings() {
  const st = P.ST;
  view.innerHTML = `
    <div class="card stack">
      <div class="sec" style="margin:0">Microsoft To Do 연결</div>
      <div id="connStatus" class="hint"></div>
      <div><span class="lab">클라이언트 ID (Azure 앱 등록에서 복사)</span>
        <input class="field" id="sClient" value="${esc(st.clientId)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <div><span class="lab">Azure에 등록할 리디렉션 주소 (단일 페이지 애플리케이션)</span>
        <div class="row nw"><span class="code grow" id="sRedirect">${esc(P.redirectUri())}</span><button class="pill small" id="sCopy" type="button">복사</button></div></div>
      <div><span class="lab">To Do 목록 이름</span><input class="field" id="sList" value="${esc(st.listName)}" maxlength="40"></div>
      <div class="row"><button class="pill" id="sSave">저장</button><button class="pill primary" id="sLogin"></button><button class="pill" id="sNow">${ICON.sync}지금 동기화</button></div>
      <div class="kv"><span>자동 동기화</span><input type="checkbox" class="switch" id="sAuto"></div>
      <div class="kv"><span>타이머·가계부도 기기끼리 맞추기<br><small class="hint">OneDrive 앱 폴더에 저장돼요</small></span><input type="checkbox" class="switch" id="sCloud"></div>
    </div>
    <div class="card stack">
      <div class="sec" style="margin:0">모양</div>
      <div><span class="lab">글꼴</span><select class="field" id="sFont">${Object.entries(FONT_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="kv"><span>완료한 할 일 숨기기</span><input type="checkbox" class="switch" id="sHide"></div>
    </div>
    <div class="card stack">
      <div class="sec" style="margin:0">내 데이터</div>
      <div class="hint">할 일·타이머 기록·가계부는 이 기기에 저장돼요. 가끔 백업해 두면 안전해요.</div>
      <div class="row"><button class="pill" id="sExport">백업 파일 저장</button><button class="pill" id="sImport">백업 불러오기</button><input type="file" id="sFile" accept="application/json,.json" hidden></div>
    </div>
    <details class="help"><summary>Azure 설정 방법 (처음 한 번)</summary>
      <ol>
        <li>이 사이트를 GitHub Pages 같은 곳에 올리면 주소가 생겨요. 위 <b>리디렉션 주소</b>가 그 주소예요.</li>
        <li>Azure 포털 → <b>Microsoft Entra ID</b> → <b>앱 등록</b> → <b>새 등록</b>. 지원 계정 유형은 “모든 조직 디렉터리의 계정 및 개인 Microsoft 계정”(또는 개인 계정만)을 고르세요.</li>
        <li>만든 앱 → 왼쪽 <b>인증(Authentication)</b> → <b>플랫폼 추가</b> → <b>단일 페이지 애플리케이션</b> → 리디렉션 URI에 위 주소를 그대로 붙여넣고 구성.</li>
        <li><b>개요</b>의 “애플리케이션(클라이언트) ID”를 복사해 위 칸에 넣고 저장 → 로그인.</li>
      </ol>
    </details>`;
  const $s = id => $(id, view);
  $s('#sAuto').checked = !!st.autoSync; $s('#sCloud').checked = !!st.cloud; $s('#sHide').checked = !!st.hideDone;
  $s('#sFont').value = st.font;
  $s('#sCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(P.redirectUri()); P.toast('주소를 복사했어요'); }
    catch (e) { P.toast('길게 눌러 직접 복사해 주세요'); }
  };
  $s('#sSave').onclick = () => {
    const id = $s('#sClient').value.trim(), list = $s('#sList').value.trim() || '플래너';
    if (id && !/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) { P.toast('클라이언트 ID 형식이 아니에요 (8-4-4-4-12 형태)'); return; }
    const changed = id !== st.clientId || list !== st.listName;
    st.clientId = id; if (list !== st.listName) st.listId = ''; st.listName = list; P.saveST();
    P.toast('저장했어요');
    if (changed) setTimeout(() => location.reload(), 500);
  };
  $s('#sLogin').onclick = async () => {
    if (P.sync.isSignedIn()) { if (confirm('로그아웃할까요? 이 기기의 데이터는 그대로 남아요.')) { await P.sync.logout(); refresh(); } return; }
    if (!st.clientId) { P.toast('먼저 클라이언트 ID를 저장해 주세요'); return; }
    try { await P.sync.login(); } catch (e) { P.toast(P.sync.friendly(e)); }
  };
  $s('#sNow').onclick = () => P.syncNow(false);
  $s('#sAuto').onchange = e => { st.autoSync = e.target.checked; P.saveST(); };
  $s('#sCloud').onchange = e => { st.cloud = e.target.checked; P.saveST(); };
  $s('#sHide').onchange = e => { st.hideDone = e.target.checked; P.saveST(); };
  $s('#sFont').onchange = e => { st.font = e.target.value; P.saveST(); document.documentElement.dataset.font = st.font; };
  $s('#sExport').onclick = () => {
    const blob = new Blob([JSON.stringify({ v: 1, tasks: P.S.tasks, sessions: P.S.sessions, categories: P.S.categories, entries: P.S.entries }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `planner-backup-${todayStr()}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  $s('#sImport').onclick = () => $s('#sFile').click();
  $s('#sFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); P.mergeData(j); P.save(); P.toast('백업을 합쳤어요'); }
    catch (err) { P.toast('백업 파일을 읽지 못했어요'); }
    e.target.value = '';
  };
}
function refreshSettings() {
  const el = $('#connStatus'); if (!el) return;
  const st = P.ST, sy = P.sync;
  let h;
  if (!st.clientId) h = '아직 연결 전이에요. 연결 없이도 할 일·타이머·가계부는 모두 쓸 수 있어요. 아래에 클라이언트 ID를 넣고 저장하면 To Do와 연결할 수 있어요.';
  else if (!sy.isSignedIn()) h = '클라이언트 ID가 저장돼 있어요. <b>Microsoft로 로그인</b>을 눌러 주세요.';
  else h = `<b>${esc(sy.account.username || '')}</b> 계정으로 연결됨` + (st.lastSync ? `<br>마지막 동기화 ${fmtDateShort(ymd(new Date(st.lastSync)))} ${fmtHM(st.lastSync)}` : '<br>아직 동기화 전이에요');
  if (sy.error) h += `<br><span class="err">${esc(sy.error)}</span>`;
  else if (sy.cloudError) h += `<br><span class="err">${esc(sy.cloudError)}</span>`;
  el.innerHTML = h;
  $('#sLogin').textContent = sy.isSignedIn() ? '로그아웃' : 'Microsoft로 로그인';
  $('#sNow').disabled = !sy.isSignedIn() || sy.busy;
}

/* ═════════════ 시작 ═════════════ */
function boot() {
  document.documentElement.dataset.font = P.ST.font;
  $('#btnPrev').innerHTML = ICON.prev; $('#btnNext').innerHTML = ICON.next;
  $('#btnMenu').innerHTML = ICON.menu; $('#btnSync').innerHTML = ICON.sync + '<i class="dot"></i>';
  $$('.tab').forEach(b => { b.innerHTML = TABS[b.dataset.tab][1] + TABS[b.dataset.tab][0]; b.onclick = () => { if (b.dataset.tab !== V.tab) setTab(b.dataset.tab); }; });
  $('#btnPrev').onclick = () => setDate(addDays(V.date, -1));
  $('#btnNext').onclick = () => setDate(addDays(V.date, 1));
  $('#dateInput').onchange = e => { if (e.target.value) setDate(e.target.value); };
  $('#btnSync').onclick = () => {
    if (!P.sync.isConfigured() || !P.sync.isSignedIn()) { setTab('settings'); P.toast('먼저 Microsoft 로그인을 해 주세요'); return; }
    P.syncNow(false);
  };
  $('#btnMenu').onclick = () => {
    const tasks = V.tab === 'tasks';
    openSheet('보기', `<div class="stack">
      <button class="pill full" data-m="today">${ICON.cal}오늘로 이동</button>
      ${tasks ? `<button class="pill full" data-m="viewAll">${P.ST.viewAll ? '선택한 날짜만 보기' : '전체 목록으로 보기'}</button>
      <button class="pill full" data-m="hideDone">${P.ST.hideDone ? '완료한 할 일 보이기' : '완료한 할 일 숨기기'}</button>` : ''}
    </div>`, b => {
      b.onclick = e => {
        const m = e.target.closest('[data-m]'); if (!m) return;
        if (m.dataset.m === 'today') setDate(todayStr());
        if (m.dataset.m === 'viewAll') { P.ST.viewAll = !P.ST.viewAll; P.saveST(); refresh(); }
        if (m.dataset.m === 'hideDone') { P.ST.hideDone = !P.ST.hideDone; P.saveST(); refresh(); }
        closeSheet();
      };
    });
  };
  P.sync.listeners.push(() => { updateChrome(); if (V.tab === 'settings') refreshSettings(); });

  setTab('tasks');
  if (P.T.running) requestWake();

  P.sync.init().then(() => {
    updateChrome(); if (V.tab === 'settings') refreshSettings();
    if (P.sync.isSignedIn() && P.ST.autoSync) P.syncNow(true);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && P.sync.isSignedIn() && P.ST.autoSync && Date.now() - (P.ST.lastSync || 0) > 60000) P.syncNow(true);
  });
  window.addEventListener('online', () => { if (P.sync.isSignedIn() && P.ST.autoSync) P.syncNow(true); });
  setInterval(() => { if (document.visibilityState === 'visible' && P.sync.isSignedIn() && P.ST.autoSync) P.syncNow(true); }, 5 * 60 * 1000);

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => { });
}
boot();
