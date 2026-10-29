// 리스닝 모의고사 — TPO 앱과 같은 흐름.
// 모듈을 시작하기 전 안내 화면에서 그 모듈 음원 묶음을 한 번에 받아 두고(진행 막대), 그다음부터는 기기 안에서 바로 재생한다.
// 음원은 한 번만 나오고, 문제는 한 화면에 하나씩 나오며 문제마다 시간이 정해져 있다(응답·대화·공지 20초, 강의 30초).
// 답을 골라야 Next를 누를 수 있고, 시간이 다 되면 저절로 넘어간다. 이전 문제로 돌아갈 수 없다.
// index.html보다 먼저 불러온다. 여기 함수들은 그 페이지의 S, esc, render 등을 부를 때 쓴다.
//
// S.lcPick: { test(정답 없음), showAnswers } — 리스닝 회차를 고른 뒤 모듈을 고르는 화면
// S.lcSecs: { id: 회차, [모듈 번호]: [고른 섹션 유형들] } — 모듈 카드에서 고른 섹션 (없거나 다른 회차 것이면 전부)
// S.exam (리스닝): { kind: 'lc', test, showAnswers, mod, secs, answers, startedAt, step, phase, qEndsAt, used }
//   secs: 고른 섹션 유형들 (예: ['talk']). null이면 모듈 전체
//   step: 지금 화면 번호 (lcSteps 순서, -1이면 안내·음원 준비), phase: 'audio'(듣는 중) | 'answer'(답 고르는 중)

const LC_TYPE = { response: 'Best Response', conversation: 'Conversation', announcement: 'Announcement', talk: 'Academic Talk' };
const LC_PART = { resp: 'Best Response', conv: 'Conversation', ann: 'Announcement', talk: 'Academic Talk' };
const LC_ORDER = ['response', 'conversation', 'announcement', 'talk'];
const lcSecNames = secs => (secs && secs.length ? secs.map(s => LC_TYPE[s] || s).join(' · ') : '');
// 받은 음원(모듈 하나)과 재생기. 음원은 저장하지 않으므로 새로고침하면 다시 받는다.
// cur: 지금 들을 차례인 음원 주소(듣는 중일 때만), maxT: 그 음원을 어디까지 들었는지, ask: 'quit' | 'submit' (한 번 더 묻는 중)
const LC = { key: '', clips: null, loading: false, got: 0, need: 0, err: '', au: null, blocked: false, vol: 1, cur: null, maxT: 0, silent: null, ask: '' };
try { const v = parseFloat(localStorage.getItem('toefl-rq2:vol')); if (v >= 0 && v <= 1) LC.vol = v; } catch (e) {}
// 아이폰·아이패드는 웹에서 소리 크기를 바꿀 수 없다(항상 1). 그런 기기에서는 소리 크기 막대를 숨긴다.
const LC_VOL_OK = (() => { try { const a = document.createElement('audio'); a.volume = 0.5; return Math.abs(a.volume - 0.5) < 0.01; } catch (e) { return false; } })();

// 한 모듈의 화면 순서: Best Response는 문장 하나당 한 화면(듣기 → 답), 나머지는 듣기 화면 하나 + 문제마다 한 화면
// secs가 있으면 그 섹션 문항만 낸다. pos는 이번에 푸는 문항 안에서 몇 번째인지 (from·to는 듣기 화면이 덮는 범위)
const lcHas = (secs, it) => !secs || !secs.length || secs.includes(it.type);
function lcSteps(m, secs) {
  const out = []; let pos = 0;
  m.items.forEach((it, i) => {
    if (!lcHas(secs, it)) return;
    if (it.type === 'response') out.push({ t: 'resp', i, q: it.questions[0], pos: ++pos });
    else { out.push({ t: 'listen', i, from: pos + 1, to: pos + it.questions.length }); it.questions.forEach(q => out.push({ t: 'q', i, q, pos: ++pos })); }
  });
  return out;
}
const lcCount = (m, secs) => m.items.filter(it => lcHas(secs, it)).reduce((n, it) => n + it.questions.length, 0);
const lcStepsOf = e => lcSteps(e.test.modules[e.mod], e.secs);
// 모듈에 있는 섹션 유형 (시험 순서대로)
const lcTypesOf = m => LC_ORDER.filter(tp => m.items.some(it => it.type === tp));
const lcPicked = mi => { const m = S.lcPick.test.modules[mi], all = lcTypesOf(m), mine = S.lcSecs && S.lcSecs.id === S.lcPick.test.id, sel = mine && S.lcSecs[mi];
  return sel ? all.filter(tp => sel.includes(tp)) : all; };
// 최근 기록 옆에 붙이는 섹션 표시 (섹션만 골라 푼 기록이면)
const lcSecTag = a => (a && a.secs && a.secs.length ? ` (${lcSecNames(a.secs)})` : '');
const lcMB = n => (n / 1048576).toFixed(1);

/* ---------- 회차·모듈 고르기 ---------- */
async function startLc(id) {
  S.busy = 'lc' + id; S.err = ''; render();
  try {
    const j = await api('getListening', { code: S.code.trim(), id });
    S.lcPick = { test: j.test, showAnswers: j.showAnswers }; S.lcSecs = { id: j.test.id };
    S.screen = 'lcpick'; S.busy = ''; render(); window.scrollTo(0, 0);
  } catch (e) { S.err = e.message; S.busy = ''; render(); }
}
function viewLcList() {
  const tests = S.lcTests || [];
  if (!tests.length) return `<div class="banner">지금 열려 있는 리스닝 회차가 없어요. 선생님께 문의하세요.</div>`;
  const best = id => { const xs = MINE.filter(a => a.lc && a.lc.id === id); return xs.length ? `최근 ${modName(xs[0].mod)}${esc(lcSecTag(xs[0]))} <span class="num">${scoreText(xs[0])}</span> · ${xs.length}회 응시` : '아직 안 풀었어요'; };
  const group = (set, title) => {
    const list = tests.filter(t => t.set === set); if (!list.length) return '';
    return `<section class="stack"><h2 style="font-size:18px">${title} <span class="note" style="font-weight:400">${list.length}회차</span></h2><section class="tests">${list.map(t => `<article class="tcard"><h3>${esc(t.title)}</h3>
      <dl>${t.modules.map(m => `<dt>${esc(m.name)}</dt><dd>${m.count}문제</dd>`).join('')}</dl>
      <div class="best">${best(t.id)}</div>
      <button class="btn primary" data-act="lcStart" data-id="${esc(t.id)}"${S.busy ? ' disabled' : ''}>${S.busy === 'lc' + t.id ? '불러오는 중…' : '선택'}</button></article>`).join('')}</section></section>`;
  };
  return group('new', 'NEW TOEFL 3') + group('tpo', 'TPO');
}
function viewLcPick() {
  const t = S.lcPick.test;
  const cards = t.modules.map((m, mi) => {
    const sel = lcPicked(mi), all = lcTypesOf(m), n = lcCount(m, sel.length === all.length ? null : sel);
    const desc = tp => { const its = m.items.filter(it => it.type === tp), q = its.reduce((k, it) => k + it.questions.length, 0);
      return tp === 'response' ? `${q}문제` : `${its.length}개 · ${q}문제`; };
    const done = MINE.filter(a => a.lc && a.lc.id === t.id && a.mod === mi);
    return `<article class="tcard"><h3>${esc(m.name)}</h3>
      <fieldset class="lcsecs"><legend>풀 섹션 <span class="note">원하는 섹션만 골라 풀 수 있어요</span></legend>
        ${all.map(tp => `<label class="check"><input type="checkbox" data-lcsec="${mi}" value="${tp}"${sel.includes(tp) ? ' checked' : ''}>${LC_TYPE[tp]} <span class="note">${desc(tp)}</span></label>`).join('')}</fieldset>
      <dl><dt>음원</dt><dd>약 ${lcMB((t.packs || [])[mi] || 0)}MB (시작 전에 받아요)</dd></dl>
      <div class="best">${done.length ? `최근${esc(lcSecTag(done[0]))} <span class="num">${scoreText(done[0])}</span> · ${done.length}회 응시` : '아직 안 풀었어요'}</div>
      ${sel.length ? `<button class="btn primary" data-act="lcModule" data-mi="${mi}">${esc(m.name)} 시작 · ${n}문제</button>`
        : `<button class="btn primary" disabled>섹션을 하나 이상 고르세요</button>`}</article>`;
  }).join('');
  return `<div class="home">
    <div class="qhead" style="margin:0"><h2 style="font-size:24px">리스닝 ${esc(t.title)}</h2><button class="btn small" data-act="home">회차 목록</button></div>
    <ul class="note lcrules"><li>음원은 <b>한 번만</b> 나오고 다시 들을 수 없어요.</li><li>문제는 한 화면에 하나씩 나와요. Best Response·Conversation·Announcement는 문제마다 <b>20초</b>, Academic Talk는 <b>30초</b>예요.</li>
      <li>답을 골라야 Next로 넘어갈 수 있고, 시간이 다 되면 저절로 넘어가요. <b>이전 문제로 돌아갈 수 없어요.</b></li><li>소리가 잘 들리는지 확인하고, 이어폰을 쓰면 좋아요.</li></ul>
    <section class="tests">${cards}</section></div>`;
}
function startLcModule(mi) {
  const t = S.lcPick.test, sel = lcPicked(mi), all = lcTypesOf(t.modules[mi]);
  if (!sel.length) return;
  const secs = sel.length === all.length ? null : sel;  // 전부 고르면 모듈 전체
  S.exam = { kind: 'lc', test: t, showAnswers: S.lcPick.showAnswers, mod: mi, secs, answers: {}, startedAt: null, step: -1, phase: null, qEndsAt: null, used: [] };
  LC.ask = ''; persist(); S.screen = 'exam'; render(); window.scrollTo(0, 0);
  lcLoad();
}
// 안내·이어서 풀기 화면에서 그만두기: 이 응시는 버린다
function lcQuit() {
  lcRelease(); LC.ask = ''; S.exam = null; persist();
  S.screen = S.lcPick ? 'lcpick' : 'home'; render(); window.scrollTo(0, 0);
}

/* ---------- 음원 받기 ---------- */
function lcRelease() {
  LC.cur = null; lcUnload();
  if (LC.clips) Object.values(LC.clips).forEach(u => URL.revokeObjectURL(u));
  LC.clips = null; LC.key = ''; LC.got = 0; LC.err = ''; LC.loading = false; LC.blocked = false;
}
function b64bytes(b64) { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
async function lcLoad() {
  const e = S.exam; if (!e || e.kind !== 'lc') return;
  const key = e.test.id + '_m' + e.mod;
  if (LC.key === key && (LC.clips || LC.loading)) return;
  lcRelease(); LC.key = key; LC.loading = true; LC.need = (e.test.packs || [])[e.mod] || 0;
  render();
  // 45초 동안 한 글자도 오지 않으면 끊고 '다시 받기'를 보여 준다
  const ctl = window.AbortController ? new AbortController() : null;
  let last = Date.now();
  const dog = setInterval(() => { if (ctl && Date.now() - last > 45000) ctl.abort(); }, 2000);
  const SLOW = '음원을 받는 데 너무 오래 걸려요. 인터넷 연결을 확인하고 다시 받아 주세요.';
  try {
    let res;
    try { res = await fetch(window.API_URL, { method: 'POST', body: JSON.stringify({ action: 'getAudio', code: S.code.trim(), id: e.test.id, module: e.mod }), signal: ctl ? ctl.signal : undefined }); }
    catch (x) { throw new Error(ctl && ctl.signal.aborted ? SLOW : '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.'); }
    let text;
    try {
      if (res.body && res.body.getReader) {  // 받은 만큼 진행 막대를 채운다
        const reader = res.body.getReader(), parts = [];
        for (;;) { const { done, value } = await reader.read(); if (done) break; last = Date.now(); parts.push(value); LC.got += value.length; lcProgress(); }
        text = await new Blob(parts).text();
      } else { text = await res.text(); LC.got = LC.need; }
    } catch (x) { throw new Error(ctl && ctl.signal.aborted ? SLOW : '음원을 받다가 끊겼어요. 다시 받아 주세요.'); }
    let j; try { j = JSON.parse(text); } catch (x) { throw new Error('음원을 받지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    if (!j.ok) throw new Error(j.error || '음원을 받지 못했어요.');
    const clips = {};
    Object.entries(j.pack.clips).forEach(([k, b64]) => { clips[k] = URL.createObjectURL(new Blob([b64bytes(b64)], { type: 'audio/mpeg' })); });
    if (LC.key === key) LC.clips = clips;
  } catch (x) { if (LC.key === key) LC.err = x.message; }
  clearInterval(dog);
  if (LC.key === key) LC.loading = false;
  if (S.exam && S.exam.kind === 'lc' && S.screen === 'exam') render();
}
function lcProgress() {
  const pct = LC.need ? Math.min(99, Math.floor(LC.got / LC.need * 100)) : 0;
  const fill = document.getElementById('lcfill'), txt = document.getElementById('lctxt');
  if (fill) fill.style.width = pct + '%';
  if (txt) txt.textContent = `음원 준비 중 ${pct}% (${lcMB(LC.got)} / ${lcMB(LC.need)}MB)`;
}

/* ---------- 재생기 ---------- */
// 재생기는 하나만 만들어 계속 쓴다. 들을 차례가 아닌 소리는 나오지 않게 막는다.
function lcAudio() {
  if (LC.au) return LC.au;
  const au = LC.au = new Audio();
  au.preload = 'auto';
  const mine = () => !!LC.cur && au.src === LC.cur;
  au.addEventListener('ended', () => { if (mine()) lcClipDone(); });
  au.addEventListener('error', () => { if (mine()) lcClipDone(); });  // 음원이 깨졌으면 다음으로 넘어간다
  // 잠금 화면·제어 센터·이어폰 버튼으로 끝난 음원을 다시 틀려고 하면 바로 멈춘다
  au.addEventListener('play', () => { if (!mine() && au.src !== LC.silent) au.pause(); });
  // 기기가 소리를 멈추면(이어폰이 빠짐, 전화 등) 멈춘 곳부터 이어 듣는 버튼을 보여 준다
  au.addEventListener('pause', () => { if (mine() && !au.ended && S.screen === 'exam') { LC.blocked = true; render(); } });
  au.addEventListener('timeupdate', () => { if (mine() && !au.seeking) LC.maxT = Math.max(LC.maxT, au.currentTime); });
  // 앞뒤로 옮기지 못하게, 들은 데까지로 되돌린다
  au.addEventListener('seeking', () => { if (mine() && Math.abs(au.currentTime - LC.maxT) > 1) au.currentTime = LC.maxT; });
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession, none = () => {};
    ['seekto', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'pause', 'stop'].forEach(a => { try { ms.setActionHandler(a, none); } catch (e) {} });
    try { ms.setActionHandler('play', () => { if (mine()) au.play().catch(() => {}); }); } catch (e) {}
  }
  return au;
}
// 끝난 음원은 재생기에서 빼 둔다 (남아 있으면 잠금 화면에서 다시 틀 수 있다)
function lcUnload() {
  const au = LC.au; if (!au) return;
  try { au.pause(); au.removeAttribute('src'); au.load(); } catch (e) {}
}
// 0.2초짜리 무음 (휴대폰에서 재생기를 깨우는 데만 쓴다)
function lcSilent() {
  if (LC.silent) return LC.silent;
  const n = 1600, b = new ArrayBuffer(44 + n), v = new DataView(b), w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return (LC.silent = URL.createObjectURL(new Blob([b], { type: 'audio/wav' })));
}
// 휴대폰 브라우저는 사용자가 누른 순간에만 소리를 처음 틀 수 있다. 누른 김에 무음을 한 번 틀어 두면 다음 음원은 저절로 나온다.
function lcUnlock() { const au = lcAudio(); au.muted = false; au.src = lcSilent(); au.play().catch(() => {}); }

/* ---------- 진행 ---------- */
function lcBegin() {
  const e = S.exam; if (!LC.clips) return;
  lcAudio(); LC.ask = '';
  e.resumed = false;
  if (e.step < 0) { e.startedAt = Date.now(); e.step = 0; lcEnter(); return; }  // 이 클릭 안에서 첫 음원이 바로 재생된다
  // 새로고침 뒤 이어서: 듣던 음원은 다시 틀지 않고 문제로 넘어가고, 보던 문제는 남아 있던 시간만 준다
  lcUnlock();
  const st = lcStepsOf(e)[e.step], left = e.qLeft;
  delete e.qLeft;
  if (!st) { lcFinish(); return; }
  if (e.phase === 'audio' && st.t === 'listen') { e.step++; lcEnter(); return; }
  if (e.phase === 'answer' && left != null) {
    if (left < 500) { e.step++; lcEnter(); return; }  // 그 문제는 시간이 이미 다 됐었다
    lcAnswerPhase(st, left); return;
  }
  lcAnswerPhase(st);  // Best Response 음원을 듣다 끊긴 경우: 그 문제 시간은 처음부터
}
function lcEnter() {
  const e = S.exam, steps = lcStepsOf(e), st = steps[e.step];
  if (!st) { lcFinish(); return; }
  const it = e.test.modules[e.mod].items[st.i];
  if (st.t === 'q') { lcAnswerPhase(st); return; }
  e.phase = 'audio'; e.qEndsAt = null; persist(); render(); window.scrollTo(0, 0);
  lcPlay(it.clip);
}
function lcAnswerPhase(st, ms) {
  const e = S.exam, it = e.test.modules[e.mod].items[st.i];
  e.phase = 'answer'; e.qEndsAt = Date.now() + (ms != null ? ms : it.secs * 1000); e.resumed = false;
  persist(); render(); window.scrollTo(0, 0);
}
function lcPlay(clip) {
  const url = LC.clips && LC.clips[clip];
  if (!url) { lcAudioEnded(); return; }
  const au = lcAudio();
  LC.cur = url; LC.maxT = 0; LC.blocked = false;
  if (LC_VOL_OK) au.volume = LC.vol;
  au.muted = false; au.src = url;
  au.play().then(() => { if (LC.blocked) { LC.blocked = false; render(); } }).catch(x => lcPlayFailed(x, url));
}
// 재생이 안 될 때: 브라우저가 막은 것이면 '소리 재생' 버튼을 보여 주고, 음원 자체가 안 되면 다음으로 넘어간다
function lcPlayFailed(x, url) {
  if (LC.cur !== url || (LC.au && LC.au.src !== url)) return;  // 이미 다른 음원으로 넘어갔다
  if (x && x.name === 'NotAllowedError') { LC.blocked = true; render(); } else lcClipDone();
}
function lcClipDone() { LC.cur = null; LC.blocked = false; lcUnload(); lcAudioEnded(); }
function lcAudioEnded() {
  const e = S.exam; if (!e || e.kind !== 'lc' || e.phase !== 'audio') return;
  const st = lcStepsOf(e)[e.step];
  if (st.t === 'resp') lcAnswerPhase(st);
  else { e.step++; lcEnter(); }
}
function lcNext() {
  const e = S.exam; if (!e || e.kind !== 'lc' || e.phase !== 'answer') return;
  e.step++; lcEnter();
}
function lcFinish() {
  const e = S.exam;
  e.used = [Math.round((Date.now() - (e.startedAt || Date.now())) / 1000)];
  lcRelease(); LC.ask = '';
  finish();
}
// index.html의 0.5초 타이머가 부른다: 듣기 막대와 남은 시간을 고치고, 시간이 다 되면 넘긴다.
function lcTick() {
  const e = S.exam;
  if (e.phase === 'audio' && LC.au) {
    const f = document.getElementById('lcplay');
    if (f && LC.au.duration) f.style.width = Math.min(100, LC.au.currentTime / LC.au.duration * 100) + '%';
  }
  const el = document.getElementById('timer');
  if (e.phase === 'answer' && e.qEndsAt && !e.resumed) {
    const left = (e.qEndsAt - Date.now()) / 1000;
    if (el) { el.textContent = fmtTime(Math.ceil(left)); el.classList.toggle('low', left <= 5); }
    if (left <= 0) lcNext();
  }
}

/* ---------- 화면 ---------- */
function lcTopBar() {
  const e = S.exam, m = e.test.modules[e.mod];
  const waiting = e.step < 0 || e.resumed || !LC.clips;  // 안내·음원 준비·이어서 풀기 화면에서는 시간이 가지 않는다
  const timer = !waiting && e.phase === 'answer' && e.qEndsAt ? `<span class="timer num" id="timer" aria-label="남은 시간">${fmtTime(Math.ceil((e.qEndsAt - Date.now()) / 1000))}</span>`
    : `<span class="timer num up" id="timer">${!waiting && e.phase === 'audio' ? '듣는 중' : '--:--'}</span>`;
  return `<span class="chip">리스닝 ${esc(e.test.title)}</span><span class="chip">${m.name}${e.secs ? ' · ' + esc(lcSecNames(e.secs)) : ''}</span><span class="spacer"></span>
    ${LC_VOL_OK ? `<label class="vol" title="소리 크기">🔊<input type="range" id="lcvol" min="0" max="1" step="0.05" value="${LC.vol}" aria-label="소리 크기"></label>` : ''}${timer}`;
}
function viewLcExam() {
  const e = S.exam, m = e.test.modules[e.mod], steps = lcStepsOf(e), total = lcCount(m, e.secs);
  const part = e.secs ? ` (${esc(lcSecNames(e.secs))})` : '';
  // 섹션만 골라 풀 때는 원래 문항 번호와 함께 이번에 푸는 문항 중 몇 번째인지 보여 준다
  const where = (n, pos) => (e.secs ? `Question ${n} · ${pos}/${total}` : `Question ${n} of ${total}`);
  // 안내 화면 (처음) 또는 새로고침 뒤 음원을 다시 받는 화면
  if (e.step < 0 || !LC.clips || e.resumed) {
    // 새로고침으로 멈춘 순간 그 문제에 남아 있던 시간을 적어 둔다 (이어서 풀 때 그만큼만 준다)
    if (e.step >= 0 && !e.resumed) { e.resumed = true; if (e.phase === 'answer' && e.qEndsAt) e.qLeft = Math.max(0, e.qEndsAt - Date.now()); persist(); }
    if (!LC.clips && !LC.loading && !LC.err) setTimeout(lcLoad, 0);
    const pct = LC.clips ? 100 : LC.need ? Math.min(99, Math.floor(LC.got / LC.need * 100)) : 0;
    const status = LC.err ? `<div class="banner bad">${esc(LC.err)}</div><div><button class="btn" data-act="lcRetry">다시 받기</button></div>`
      : `<div class="lcbar"><div id="lcfill" style="width:${pct}%"></div></div>
         <div class="note num" id="lctxt">${LC.clips ? '음원 준비 완료' : `음원 준비 중 ${pct}% (${lcMB(LC.got)} / ${lcMB(LC.need)}MB)`}</div>`;
    return `<div class="sheet stack lcintro">
      <div class="eyebrow">Listening · ${m.name}</div>
      <h2>${e.step < 0 ? `${esc(e.test.title)} ${m.name}${part}` : '이어서 풀기'}</h2>
      ${e.step < 0 ? `<p class="note" style="margin:0">${e.secs ? `${m.name}에서 고른 섹션 <b>${total}문제</b>를 풀어요.` : `${m.name}은 <b>${total}문제</b>예요.`} The clock will show you how much time you have to complete each question. You WILL NOT be able to return to previous questions.</p>
      <ul class="note lcrules"><li>음원은 한 번만 나와요.</li><li>Best Response·Conversation·Announcement는 문제마다 20초, Academic Talk는 30초예요.</li><li>답을 고르면 Next로 넘어가요. 시간이 다 되면 저절로 넘어가요.</li></ul>`
        : `<p class="note" style="margin:0">페이지를 새로 열어서 음원을 다시 받아요. 듣던 음원은 다시 나오지 않고, 풀던 문제는 남아 있던 시간만큼 이어서 풀어요.</p>`}
      ${status}
      <div class="toolbar"><button class="btn primary" data-act="lcBegin"${LC.clips ? '' : ' disabled'}>${e.step < 0 ? '시작' : '이어서 풀기'}</button>
        ${e.step < 0 ? `<button class="btn" data-act="lcQuit">돌아가기</button>` : ''}</div>
      ${e.step >= 0 ? lcResumeExits(e) : ''}</div>`;
  }
  const st = steps[e.step], it = m.items[st.i];
  const blocked = LC.blocked && e.phase === 'audio' ? `<div class="note">소리가 멈췄어요. 버튼을 누르면 멈춘 곳부터 이어서 나와요.</div><div><button class="btn primary" data-act="lcPlay">▶ 소리 재생</button></div>` : '';
  const listening = `<div class="sheet lclisten"><div class="lcicon" aria-hidden="true">🎧</div><div class="note">듣는 중이에요. 음원은 한 번만 나와요.</div>
    <div class="lcbar thin"><div id="lcplay" style="width:0%"></div></div>${blocked}</div>`;
  const options = q => { const k = e.mod + '-' + q.n, cur = e.answers[k];
    return `<div class="sheet qs"><fieldset><legend><span class="num">${q.n}.</span>${q.q ? esc(q.q) : '가장 알맞은 응답을 고르세요.'}</legend>
      ${q.c.map((c, ci) => `<label class="opt"><input type="radio" name="lc${k}" data-lck="${k}" value="${LET[ci]}"${cur === LET[ci] ? ' checked' : ''}><b>(${LET[ci]})</b><span>${esc(c)}</span></label>`).join('')}</fieldset></div>
      <div class="navrow"><span class="note">답을 고르면 Next를 누를 수 있어요.</span><button class="btn primary" data-act="lcNext"${cur ? '' : ' disabled'}>Next</button></div>`; };
  if (st.t === 'resp') {
    return `<div class="qhead"><h2>Choose the best response.</h2><span class="note num">${where(st.q.n, st.pos)}</span></div>
      ${e.phase === 'audio' ? listening : options(st.q)}`;
  }
  if (st.t === 'listen') {
    return `<div class="qhead"><h2>${esc(it.heading)}</h2><span class="note num">Questions ${it.from}–${it.to}${e.secs ? ` · ${st.from}–${st.to}/${total}` : ` of ${total}`}</span></div>${listening}`;
  }
  return `<div class="qhead"><h2>${esc(it.heading)}</h2><span class="note num">${where(st.q.n, st.pos)}</span></div>${options(st.q)}`;
}

// 이어서 풀기 화면: 음원을 받을 수 없을 때도 빠져나갈 수 있게
function lcResumeExits(e) {
  const answered = Object.keys(e.answers).length;
  if (LC.ask === 'submit') return `<div class="banner">지금까지 고른 ${answered}문제의 답으로 제출할까요? 남은 문제는 빈칸으로 채점돼요.
    <div class="toolbar" style="margin-top:8px"><button class="btn primary" data-act="lcSubmitNow">제출</button><button class="btn" data-act="lcAsk" data-ask="">취소</button></div></div>`;
  if (LC.ask === 'quit') return `<div class="banner bad">이 시험을 그만둘까요? 고른 답은 선생님께 가지 않아요.
    <div class="toolbar" style="margin-top:8px"><button class="btn" data-act="lcQuit">그만두기</button><button class="btn" data-act="lcAsk" data-ask="">취소</button></div></div>`;
  return `<div class="lcexit"><span class="note">음원을 받을 수 없을 때</span>
    <div class="toolbar"><button class="btn small" data-act="lcAsk" data-ask="submit">지금까지 고른 답으로 제출</button><button class="btn small" data-act="lcAsk" data-ask="quit">그만두기</button></div></div>`;
}

/* ---------- 이벤트 ---------- */
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'lcStart') startLc(b.dataset.id);
  else if (act === 'lcModule') startLcModule(+b.dataset.mi);
  else if (act === 'lcBegin') lcBegin();
  else if (act === 'lcNext') lcNext();
  else if (act === 'lcRetry') { LC.err = ''; LC.key = ''; lcLoad(); }
  else if (act === 'lcQuit') lcQuit();
  else if (act === 'lcAsk') { LC.ask = b.dataset.ask; render(); }
  else if (act === 'lcSubmitNow' && S.exam && S.exam.kind === 'lc') lcFinish();
  else if (act === 'lcPlay' && LC.au && LC.cur) { const url = LC.cur; LC.au.play().then(() => { LC.blocked = false; render(); }).catch(x => lcPlayFailed(x, url)); }
  else if (act === 'lcPickAgain') { S.screen = 'lcpick'; S.result = null; S.err = ''; render(); window.scrollTo(0, 0); }
  else if (act === 'tab') { S.tab = b.dataset.tab; lsSet(':tab', S.tab); S.err = ''; render(); }
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.type === 'checkbox' && el.dataset.lcsec != null && S.lcPick) {
    const mi = +el.dataset.lcsec, all = lcTypesOf(S.lcPick.test.modules[mi]);
    if (!S.lcSecs || S.lcSecs.id !== S.lcPick.test.id) S.lcSecs = { id: S.lcPick.test.id };
    S.lcSecs[mi] = all.filter(tp => document.querySelector(`input[data-lcsec="${mi}"][value="${tp}"]`).checked);
    render(); return;
  }
  if (el.type === 'radio' && el.dataset.lck && S.exam && S.exam.kind === 'lc') {
    S.exam.answers[el.dataset.lck] = el.value; persist();
    const nx = document.querySelector('[data-act="lcNext"]'); if (nx) nx.disabled = false;
  }
});
document.addEventListener('input', ev => {
  if (ev.target.id === 'lcvol') {
    LC.vol = Math.max(0, Math.min(1, Number(ev.target.value)));
    if (LC.au && LC_VOL_OK) LC.au.volume = LC.vol;
    try { localStorage.setItem('toefl-rq2:vol', String(LC.vol)); } catch (e) {}
  }
});
