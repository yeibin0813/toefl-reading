// 리스닝 모의고사 — TPO 앱과 같은 흐름.
// 모듈을 시작하기 전 안내 화면에서 그 모듈 음원 묶음을 한 번에 받아 두고(진행 막대), 그다음부터는 기기 안에서 바로 재생한다.
// 음원은 한 번만 나오고, 문제는 한 화면에 하나씩 나오며 문제마다 시간이 정해져 있다(응답·대화·공지 20초, 강의 30초).
// 답을 골라야 Next를 누를 수 있고, 시간이 다 되면 저절로 넘어간다. 이전 문제로 돌아갈 수 없다.
// index.html보다 먼저 불러온다. 여기 함수들은 그 페이지의 S, esc, render 등을 부를 때 쓴다.
//
// S.lcPick: { test(정답 없음), showAnswers } — 리스닝 회차를 고른 뒤 모듈을 고르는 화면
// S.lcSecs: { id: 회차, [모듈 번호 또는 'all']: [고른 섹션 유형들] } — 모듈 카드에서 고른 섹션 (없거나 다른 회차 것이면 전부)
// S.exam (리스닝): { kind: 'lc', test, showAnswers, mod, both, secs, answers, startedAt, step, phase, qEndsAt, used }
//   secs: 고른 섹션 유형들 (예: ['talk']). null이면 모듈 전체
//   both: Module 1 + 2 이어 풀기. 이때 test는 두 모듈을 이은 모듈 하나짜리(mod 0)이고 test.mods가 음원을 받을 원래 모듈들이다 (lcBothModule)
//   step: 지금 화면 번호 (lcSteps 순서, -1이면 안내·음원 준비), phase: 'audio'(듣는 중) | 'answer'(답 고르는 중)

const LC_TYPE = { response: 'Best Response', conversation: 'Conversation', announcement: 'Announcement', talk: 'Academic Talk' };
const LC_PART = { resp: 'Best Response', conv: 'Conversation', ann: 'Announcement', talk: 'Academic Talk' };
const LC_ORDER = ['response', 'conversation', 'announcement', 'talk'];
const lcSecNames = secs => (secs && secs.length ? secs.map(s => LC_TYPE[s] || s).join(' · ') : '');
// 받은 음원(모듈 하나)과 재생기. 음원은 저장하지 않으므로 새로고침하면 다시 받는다.
// cur: 지금 들을 차례인 음원 주소(듣는 중일 때만), maxT: 그 음원을 어디까지 들었는지, ask: 'quit' | 'submit' (한 번 더 묻는 중)
// tok·ctl: 지금 받고 있는 받기 (그만두면 끊고, 늦게 끝난 예전 받기는 아무것도 바꾸지 않는다)
const LC = { key: '', clips: null, loading: false, got: 0, need: 0, err: '', au: null, blocked: false, vol: 1, cur: null, maxT: 0, silent: null, ask: '', tok: null, ctl: null };
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
// Module 1 + 2 이어 풀기: 모든 모듈의 문항 묶음을 차례로 이은 모듈 하나. 묶음마다 원래 모듈 번호(mi)를 붙이고 음원 이름은 "모듈:이름"으로 바꾼다
function lcBothModule(t) {
  return { name: 'Module 1 + 2', items: t.modules.flatMap((m, mi) => m.items.map(it => Object.assign({}, it, { mi, clip: mi + ':' + it.clip }))) };
}
const lcPickModule = (t, mi) => (mi === 'all' ? lcBothModule(t) : t.modules[mi]);
// 이어 풀기에서 고른 섹션이 들어 있는 원래 모듈들 (음원은 이 모듈들 것만 받는다)
const lcModsOf = (m, sel) => [...new Set(m.items.filter(it => sel.includes(it.type)).map(it => it.mi))].sort();
const lcPicked = mi => { const m = lcPickModule(S.lcPick.test, mi), all = lcTypesOf(m), mine = S.lcSecs && S.lcSecs.id === S.lcPick.test.id, sel = mine && S.lcSecs[mi];
  return sel ? all.filter(tp => sel.includes(tp)) : all; };
// 답 키 "모듈-문항": 이어 풀기에서는 묶음의 원래 모듈 번호를 쓴다
const lcKey = (e, it, q) => (it.mi != null ? it.mi : e.mod) + '-' + q.n;
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
  const all = mineList(), best = id => bestText(all && all.filter(a => a.lc && a.lc.id === id), a => lcModName(a.mod) + esc(lcSecTag(a)));
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
  const t = S.lcPick.test, recs = mineList();
  // 모듈 카드 하나. mi가 'all'이면 Module 1 + 2 이어 풀기 카드
  const card = mi => {
    const both = mi === 'all', m = lcPickModule(t, mi), sel = lcPicked(mi), all = lcTypesOf(m), n = lcCount(m, sel.length === all.length ? null : sel);
    const desc = tp => { const its = m.items.filter(it => it.type === tp), q = its.reduce((k, it) => k + it.questions.length, 0);
      return tp === 'response' ? `${q}문제` : `${its.length}개 · ${q}문제`; };
    const done = recs && recs.filter(a => a.lc && a.lc.id === t.id && (both ? a.mod == null : a.mod === mi));
    const mb = both ? lcModsOf(m, sel).reduce((s, i) => s + ((t.packs || [])[i] || 0), 0) : (t.packs || [])[mi] || 0;
    return `<article class="tcard${both ? ' lcboth' : ''}"><h3>${esc(m.name)}</h3>
      ${both ? '<p class="note" style="margin:0">두 모듈에서 고른 섹션을 Module 1부터 이어서 풀어요. 예를 들어 Conversation만 고르면 이 회차의 Conversation을 모두 풀어요.</p>' : ''}
      <fieldset class="lcsecs"><legend>풀 섹션 <span class="note">원하는 섹션만 골라 풀 수 있어요</span></legend>
        ${all.map(tp => `<label class="check"><input type="checkbox" data-lcsec="${mi}" value="${tp}"${sel.includes(tp) ? ' checked' : ''}>${LC_TYPE[tp]} <span class="note">${desc(tp)}</span></label>`).join('')}</fieldset>
      <dl><dt>음원</dt><dd>약 ${lcMB(mb)}MB (시작 전에 받아요)</dd></dl>
      <div class="best">${bestText(done, a => esc(lcSecTag(a)).trim())}</div>
      ${sel.length ? `<button class="btn primary" data-act="lcModule" data-mi="${mi}">${esc(m.name)} 시작 · ${n}문제</button>`
        : `<button class="btn primary" disabled>섹션을 하나 이상 고르세요</button>`}</article>`;
  };
  const cards = t.modules.map((m, mi) => card(mi)).join('') + (t.modules.length > 1 ? card('all') : '');
  return `<div class="home">
    <div class="qhead" style="margin:0"><h2 style="font-size:24px">리스닝 ${esc(t.title)}</h2><button class="btn small" data-act="home">회차 목록</button></div>
    <ul class="note lcrules"><li>음원은 <b>한 번만</b> 나오고 다시 들을 수 없어요.</li><li>문제는 한 화면에 하나씩 나와요. Best Response·Conversation·Announcement는 문제마다 <b>20초</b>, Academic Talk는 <b>30초</b>예요.</li>
      <li>답을 골라야 Next로 넘어갈 수 있고, 시간이 다 되면 저절로 넘어가요. <b>이전 문제로 돌아갈 수 없어요.</b></li><li>소리가 잘 들리는지 확인하고, 이어폰을 쓰면 좋아요.</li></ul>
    <section class="tests">${cards}</section></div>`;
}
function startLcModule(mi) {
  const t = S.lcPick.test, both = mi === 'all', m = lcPickModule(t, mi), sel = lcPicked(mi), all = lcTypesOf(m);
  if (!sel.length) return;
  const secs = sel.length === all.length ? null : sel;  // 전부 고르면 모듈 전체
  // src: 원래 회차 (끝난 뒤 모듈 고르는 화면으로 돌아갈 때 쓴다)
  const test = both ? { id: t.id, set: t.set, no: t.no, title: t.title, packs: t.packs, mods: lcModsOf(m, sel), modules: [m], src: t } : t;
  S.exam = { kind: 'lc', test, both, showAnswers: S.lcPick.showAnswers, mod: both ? 0 : mi, secs, answers: {}, startedAt: null, step: -1, phase: null, qEndsAt: null, used: [] };
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
  if (LC.ctl) { try { LC.ctl.abort(); } catch (e) {} }
  LC.clips = null; LC.key = ''; LC.got = 0; LC.err = ''; LC.loading = false; LC.blocked = false; LC.tok = null; LC.ctl = null;
}
function b64bytes(b64) { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
// 이어 풀기면 고른 섹션이 있는 모듈마다 묶음을 차례로 받고, 음원 이름 앞에 "모듈:"을 붙인다 (lcBothModule과 같은 이름)
async function lcLoad() {
  const e = S.exam; if (!e || e.kind !== 'lc') return;
  const mods = e.both ? e.test.mods : [e.mod], key = e.test.id + '_m' + (e.both ? 'all' + mods.join('') : e.mod);
  if (LC.key === key && (LC.clips || LC.loading)) return;
  lcRelease();
  const tok = LC.tok = {}, live = () => LC.tok === tok;
  LC.key = key; LC.loading = true; LC.need = mods.reduce((n, mi) => n + ((e.test.packs || [])[mi] || 0), 0);
  render();
  // 45초 동안 한 글자도 오지 않으면 끊고 '다시 받기'를 보여 준다
  const ctl = LC.ctl = window.AbortController ? new AbortController() : null;
  let last = Date.now();
  const dog = setInterval(() => { if (ctl && Date.now() - last > 45000) ctl.abort(); }, 2000);
  const SLOW = '음원을 받는 데 너무 오래 걸려요. 인터넷 연결을 확인하고 다시 받아 주세요.';
  const clips = {}, drop = () => Object.values(clips).forEach(u => URL.revokeObjectURL(u));
  try {
    for (const mi of mods) {
      if (!live()) break;
      let res;
      try { res = await fetch(window.API_URL, { method: 'POST', body: JSON.stringify({ action: 'getAudio', code: S.code.trim(), id: e.test.id, module: mi }), signal: ctl ? ctl.signal : undefined }); }
      catch (x) { throw new Error(ctl && ctl.signal.aborted ? SLOW : '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.'); }
      let text;
      try {
        if (res.body && res.body.getReader) {  // 받은 만큼 진행 막대를 채운다
          const reader = res.body.getReader(), parts = [];
          for (;;) { const { done, value } = await reader.read(); if (done) break; last = Date.now(); parts.push(value); if (live()) { LC.got += value.length; lcProgress(); } }
          text = await new Blob(parts).text();
        } else { text = await res.text(); if (live()) LC.got += (e.test.packs || [])[mi] || 0; }
      } catch (x) { throw new Error(ctl && ctl.signal.aborted ? SLOW : '음원을 받다가 끊겼어요. 다시 받아 주세요.'); }
      let j; try { j = JSON.parse(text); } catch (x) { throw new Error('음원을 받지 못했어요. 잠시 후 다시 시도해 주세요.'); }
      if (!j.ok) throw new Error(j.error || '음원을 받지 못했어요.');
      Object.entries(j.pack.clips).forEach(([k, b64]) => { clips[(e.both ? mi + ':' : '') + k] = URL.createObjectURL(new Blob([b64bytes(b64)], { type: 'audio/mpeg' })); });
    }
    if (live()) LC.clips = clips; else drop();
  } catch (x) { drop(); if (live()) LC.err = x.message; }
  clearInterval(dog);
  if (!live()) return;
  LC.loading = false; LC.ctl = null;
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
  return au;
}
// 시험 중에는 잠금 화면·이어폰 버튼으로 음원을 멈추거나 옮기지 못하게 한다. 다시 보기에서는 풀어 준다.
const LC_MEDIA = ['seekto', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'pause', 'stop', 'play'];
function lcMediaLock() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession, au = LC.au, none = () => {};
  LC_MEDIA.forEach(a => { try { ms.setActionHandler(a, a === 'play' ? () => { if (au && LC.cur && au.src === LC.cur) au.play().catch(() => {}); } : none); } catch (e) {} });
}
function lcMediaFree() {
  if (!('mediaSession' in navigator)) return;
  LC_MEDIA.forEach(a => { try { navigator.mediaSession.setActionHandler(a, null); } catch (e) {} });
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
  lcAudio(); lcMediaLock(); LC.ask = '';
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
  // 섹션만 골라 풀거나 이어 풀 때는 원래 문항 번호와 함께 이번에 푸는 문항 중 몇 번째인지 보여 준다 (이어 풀기는 모듈도)
  const where = (it, n, pos) => (e.both ? `Module ${it.mi + 1} · Question ${n} · ${pos}/${total}` : e.secs ? `Question ${n} · ${pos}/${total}` : `Question ${n} of ${total}`);
  const intro = e.both ? `Module 1과 2에서 ${e.secs ? '고른 섹션 ' : ''}<b>${total}문제</b>를 이어서 풀어요.`
    : e.secs ? `${m.name}에서 고른 섹션 <b>${total}문제</b>를 풀어요.` : `${m.name}은 <b>${total}문제</b>예요.`;
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
      ${e.step < 0 ? `<p class="note" style="margin:0">${intro} The clock will show you how much time you have to complete each question. You WILL NOT be able to return to previous questions.</p>
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
  const options = q => { const k = lcKey(e, it, q), cur = e.answers[k];
    return `<div class="sheet qs"><fieldset><legend><span class="num">${q.n}.</span>${q.q ? esc(q.q) : '가장 알맞은 응답을 고르세요.'}</legend>
      ${q.c.map((c, ci) => `<label class="opt"><input type="radio" name="lc${k}" data-lck="${k}" value="${LET[ci]}"${cur === LET[ci] ? ' checked' : ''}><b>(${LET[ci]})</b><span>${esc(c)}</span></label>`).join('')}</fieldset></div>
      <div class="navrow"><span class="note">답을 고르면 Next를 누를 수 있어요.</span><button class="btn primary" data-act="lcNext"${cur ? '' : ' disabled'}>Next</button></div>`; };
  if (st.t === 'resp') {
    return `<div class="qhead"><h2>Choose the best response.</h2><span class="note num">${where(it, st.q.n, st.pos)}</span></div>
      ${e.phase === 'audio' ? listening : options(st.q)}`;
  }
  if (st.t === 'listen') {
    return `<div class="qhead"><h2>${esc(it.heading)}</h2><span class="note num">${e.both ? `Module ${it.mi + 1} · ` : ''}Questions ${it.from}–${it.to}${e.secs || e.both ? ` · ${st.from}–${st.to}/${total}` : ` of ${total}`}</span></div>${listening}`;
  }
  return `<div class="qhead"><h2>${esc(it.heading)}</h2><span class="note num">${where(it, st.q.n, st.pos)}</span></div>${options(st.q)}`;
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

/* ---------- 다시 보기 ---------- */
// 다시 볼 때 쓰는 음원 (시험용 LC와 따로 둔다). '음원 불러오기'를 누르면 그 모듈 묶음을 받고, 문항 묶음마다 마음대로 다시 들을 수 있다.
// 화면에 <audio>를 두지 않고 재생기 하나(au)를 버튼과 막대로 튼다. 브라우저 재생기에 있는 '다운로드' 메뉴로 파일을 저장하지 못하게 하려는 것이다.
// tok: 불러오기마다 새로 만든다. 늦게 끝난 예전 불러오기가 지금 것을 덮지 않게 한다. cur: 재생기에 걸린 음원 이름
const LCR = { key: '', clips: null, loading: false, err: '', tok: null, au: null, cur: null, drag: null, open: new Set() };
function rvRelease() {
  if (LCR.au) { try { LCR.au.pause(); LCR.au.removeAttribute('src'); LCR.au.load(); } catch (e) {} }
  if (LCR.clips) Object.values(LCR.clips).forEach(u => URL.revokeObjectURL(u));
  Object.assign(LCR, { key: '', clips: null, loading: false, err: '', tok: null, cur: null });
}
function rvAu() {
  if (LCR.au) return LCR.au;
  const au = LCR.au = new Audio();
  ['timeupdate', 'loadedmetadata', 'play', 'pause', 'ended'].forEach(ev => au.addEventListener(ev, rvTick));
  return au;
}
// 음원을 재생기에 건다 (다른 음원이 걸려 있었으면 바꾼다). 시작 위치 frac(0~1)를 주면 거기부터
function rvLoad(clip, frac) {
  const au = rvAu(), url = LCR.clips && LCR.clips[clip]; if (!url) return null;
  if (LCR.cur !== clip) { LCR.cur = clip; au.src = url; }
  if (frac != null) { const go = () => { if (au.duration) au.currentTime = frac * au.duration; rvTick(); }; au.duration ? go() : au.addEventListener('loadedmetadata', go, { once: true }); }
  return au;
}
function rvToggle(clip) {
  const au = rvLoad(clip); if (!au) return;
  if (au.paused) au.play().catch(() => {}); else au.pause();
  rvTick();
}
// 막대를 손가락·마우스로 끄는 동안에는 재생 위치로 막대를 되돌리지 않는다
document.addEventListener('pointerdown', ev => { if (ev.target.dataset && ev.target.dataset.rvseek != null) LCR.drag = ev.target; });
['pointerup', 'pointercancel'].forEach(n => document.addEventListener(n, () => { LCR.drag = null; }));
// 음원 하나의 재생기 표시. 길이를 알면 막대 단위는 초 (화살표 키로 1초씩 옮긴다), 모르면 0~1000
function rvState(clip) {
  const au = LCR.au, on = !!au && clip === LCR.cur, d = on && au.duration || 0, t = on ? au.currentTime || 0 : 0;
  return { label: on && !au.paused ? '❚❚ 멈춤' : '▶ 듣기', max: d ? Math.max(1, Math.round(d)) : 1000, value: d ? Math.round(t) : 0,
    text: `${fmtTime(t)} / ${d ? fmtTime(d) : '--:--'}` };
}
// 재생 버튼·막대·시간만 고친다 (화면 전체를 다시 그리지 않아서 막대를 끄는 중에도 끊기지 않는다)
function rvTick() {
  document.querySelectorAll('.rvplay').forEach(el => {
    const s = rvState(el.dataset.clip), bar = el.querySelector('input');
    el.querySelector('button').textContent = s.label;
    el.querySelector('.t').textContent = s.text;
    if (LCR.drag !== bar) { bar.max = s.max; bar.value = s.value; }
    bar.setAttribute('aria-valuetext', s.text);
  });
}
// 화면을 다시 그린 뒤: 틀는 음원의 재생기가 화면에서 빠졌으면(틀린 문항만 보기 등) 멈춘다
function rvSync() {
  if (LCR.au && LCR.cur && !document.querySelector(`.rvplay[data-clip="${CSS.escape(LCR.cur)}"]`)) LCR.au.pause();
  rvTick();
}
// 기록이 다루는 모듈들 (Module 1 + 2 이어 풀기 기록은 module이 null이고, 채점된 문항이 있는 모듈만)
const rvMods = (r, t) => { if (r.module != null) return [r.module];
  const ms = [...new Set(r.rows.map(x => x.mi))].filter(i => i === 0 || i === 1).sort(); return ms.length ? ms : t.modules.map((m, i) => i); };
// 음원 이름은 "모듈:이름"으로 둔다 (모듈 두 개를 받아도 이름이 겹치지 않게)
async function rvAudioLoad() {
  const V = S.review; if (!V || !V.r || !V.r.lc || !V.content) return;
  const id = V.r.lc.id, mods = rvMods(V.r, V.content.test), key = id + '_m' + mods.join('');
  if (LCR.key === key && (LCR.clips || LCR.loading)) return;
  rvRelease(); lcMediaFree();
  const tok = LCR.tok = {}; LCR.key = key; LCR.loading = true; render();
  const clips = {}, drop = () => Object.values(clips).forEach(u => URL.revokeObjectURL(u));
  try {
    for (const mi of mods) {
      const j = await api('getAudio', { code: S.code.trim(), id, module: mi });
      Object.entries(j.pack.clips).forEach(([k, b64]) => { clips[mi + ':' + k] = URL.createObjectURL(new Blob([b64bytes(b64)], { type: 'audio/mpeg' })); });
      if (LCR.tok !== tok) break;
    }
    if (LCR.tok === tok) LCR.clips = clips; else drop();
  } catch (e) { drop(); if (LCR.tok === tok) LCR.err = e.message; }
  if (LCR.tok !== tok) return;
  LCR.loading = false;
  if (S.screen === 'review') render();
}
// 스크립트를 말차례(대화)·한두 문장씩 영어와 해석으로. 문항의 근거 문장(ev) 앞에 ⟨문항-정답⟩ 표시를 붙인다.
function rvLines(lines, qs) {
  const fold = s => String(s).replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\u2028/g, ' ');
  const marks = lines.map(() => []);
  qs.forEach(([q, e, x]) => {
    if (!e || !e.ev || !x) return;
    for (const probe of [fold(e.ev), fold(e.ev).slice(0, 30)]) {
      const li = lines.findIndex(l => fold(l.en).includes(probe));
      if (li >= 0) { marks[li].push({ at: fold(lines[li].en).indexOf(probe), len: probe.length, tag: `${q.n}-${x.correct || '?'}` }); return; }
    }
  });
  return `<div class="rvlines">${lines.map((l, li) => {
    let en = '', pos = 0;
    marks[li].sort((a, b) => a.at - b.at).forEach(m => { if (m.at < pos) return; en += esc(l.en.slice(pos, m.at)) + `<span class="evmark">⟨${esc(m.tag)}⟩</span><span class="evd">${esc(l.en.slice(m.at, m.at + m.len))}</span>`; pos = m.at + m.len; });
    en += esc(l.en.slice(pos));
    return `<div class="ln"><span class="sp">${l.sp === 'M' ? '남' : l.sp === 'W' ? '여' : ''}</span><div><p class="en">${en}</p><p class="ko">${esc(l.ko)}</p></div></div>`;
  }).join('')}</div>`;
}
// 리스닝 다시 보기: 모듈마다 문항 묶음별로 음원(불러왔으면)과 문제
function lcReviewBody(V) {
  // ex: 정답 공개일 때 서버가 보내는 해설 { i: { "모듈:첫 문항": { s: 원문, l: [{ sp, en, ko }] } }, q: { "모듈-문항": { qk, type, ok, ul, ev, exp } } }
  const r = V.r, t = V.content.test, mods = rvMods(r, t), by = rowMap(r.rows), ex = V.content.extra || { i: {}, q: {} };
  if (!mods.length || mods.some(mi => !t.modules[mi])) return '';
  const key = r.lc.id + '_m' + mods.join(''), mine = LCR.key === key;
  const mb = lcMB(mods.reduce((n, mi) => n + ((t.packs || [])[mi] || 0), 0));
  const bar = mine && LCR.clips ? '' : mine && LCR.loading ? `<div class="banner">음원을 불러오는 중이에요… (약 ${mb}MB)</div>`
    : `<div class="toolbar"><button class="btn" data-act="rvAudio">음원 불러오기 · 약 ${mb}MB</button><span class="note">불러오면 이 화면에서 문항 묶음마다 다시 들을 수 있어요.</span></div>
       ${mine && LCR.err ? `<div class="banner bad">${esc(LCR.err)}</div>` : ''}`;
  const body = mods.map(mi => {
    const items = t.modules[mi].items.map(it => {
      it.questions.forEach(q => { const x = by[mi + '-' + q.n]; if (x) V.seen.add(x.k); });
      const qs = it.questions.filter(q => { const x = by[mi + '-' + q.n]; return x && (!V.onlyWrong || !x.ok); });
      if (!qs.length) return '';
      const clip = mi + ':' + it.clip, s = mine && LCR.clips && LCR.clips[clip] ? rvState(clip) : null, ix = ex.i[mi + ':' + it.from] || {}, sk = r.id + '|' + mi + ':' + it.from;
      const player = s ? `<div class="rvplay" data-clip="${esc(clip)}"><button class="btn small" data-act="rvPlay" data-clip="${esc(clip)}">${s.label}</button>
        <input type="range" min="0" max="${s.max}" step="1" value="${s.value}" data-rvseek="${esc(clip)}" aria-label="${esc(it.heading)} 재생 위치" aria-valuetext="${s.text}"><span class="t num">${s.text}</span></div>` : '';
      return `<section class="stack rvitem"><div class="qhead" style="margin:0"><h3>${esc(it.heading)}</h3><span class="note num">${LC_TYPE[it.type] || ''} · ${it.from === it.to ? `Question ${it.from}` : `Questions ${it.from}–${it.to}`}</span></div>
        ${player}
        ${ix.l && it.type !== 'response' ? `<details class="rvscript" data-sk="${esc(sk)}"${LCR.open.has(sk) ? ' open' : ''}><summary>스크립트 · 해석 보기</summary>${rvLines(ix.l, it.questions.map(q => [q, ex.q[mi + '-' + q.n], by[mi + '-' + q.n]]))}</details>` : ''}
        ${qs.map(q => rvChoice(q.n, q.q || (it.type === 'response' && ix.s ? ix.s : '가장 알맞은 응답을 고르세요.'), q.c, by[mi + '-' + q.n], '', ex.q[mi + '-' + q.n])).join('')}</section>`;
    }).join('');
    return items && mods.length > 1 ? `<h3 class="rvmod">${esc(t.modules[mi].name)}</h3>${items}` : items;
  }).join('');
  return body ? bar + body : '';
}

/* ---------- 이벤트 ---------- */
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'lcStart') startLc(b.dataset.id);
  else if (act === 'lcModule') startLcModule(b.dataset.mi === 'all' ? 'all' : +b.dataset.mi);
  else if (act === 'lcBegin') lcBegin();
  else if (act === 'lcNext') lcNext();
  else if (act === 'lcRetry') { LC.err = ''; LC.key = ''; lcLoad(); }
  else if (act === 'lcQuit') lcQuit();
  else if (act === 'lcAsk') { LC.ask = b.dataset.ask; render(); }
  else if (act === 'lcSubmitNow' && S.exam && S.exam.kind === 'lc') lcFinish();
  else if (act === 'lcPlay' && LC.au && LC.cur) { const url = LC.cur; LC.au.play().then(() => { LC.blocked = false; render(); }).catch(x => lcPlayFailed(x, url)); }
  else if (act === 'lcPickAgain') { S.screen = 'lcpick'; S.result = null; S.err = ''; render(); window.scrollTo(0, 0); }
  else if (act === 'tab') { S.tab = b.dataset.tab; lsSet(':tab', S.tab); S.err = ''; render(); }
  else if (act === 'rvAudio') rvAudioLoad();
  else if (act === 'rvPlay') rvToggle(b.dataset.clip);
});
// 펼친 스크립트는 화면을 다시 그려도 펼친 채로 둔다 (toggle은 버블링되지 않아서 capture로 받는다)
document.addEventListener('toggle', ev => { const d = ev.target; if (d.dataset && d.dataset.sk) LCR.open[d.open ? 'add' : 'delete'](d.dataset.sk); }, true);
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.type === 'checkbox' && el.dataset.lcsec != null && S.lcPick) {
    const mi = el.dataset.lcsec === 'all' ? 'all' : +el.dataset.lcsec, all = lcTypesOf(lcPickModule(S.lcPick.test, mi));
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
  if (ev.target.dataset && ev.target.dataset.rvseek != null) { const el = ev.target; rvLoad(el.dataset.rvseek, Number(el.value) / (Number(el.max) || 1000)); return; }
  if (ev.target.id === 'lcvol') {
    LC.vol = Math.max(0, Math.min(1, Number(ev.target.value)));
    if (LC.au && LC_VOL_OK) LC.au.volume = LC.vol;
    try { localStorage.setItem('toefl-rq2:vol', String(LC.vol)); } catch (e) {}
  }
});
