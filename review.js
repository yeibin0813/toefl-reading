/* 다시 보기 화면 그리기: 학생 페이지(index.html)와 관리자 페이지(admin.html)가 함께 쓴다.
   쓰는 쪽에서 esc, LET, LC_TYPE을 정의한다. V = { r: 기록(rows에 문항별 답), content: 서버가 보낸 문제, onlyWrong, seen: 그린 문항 키 }
   그리는 함수들은 화면에 그린 문항을 V.seen에 적는다. */
// 보기에 붙는 '내 답' 표시 (관리자 페이지는 '학생 답')
let RV_MINE = '내 답';
// 펼친 스크립트는 화면을 다시 그려도 펼친 채로 둔다 (toggle은 버블링되지 않아서 capture로 받는다)
const RV_OPEN = new Set();
document.addEventListener('toggle', ev => { const d = ev.target; if (d.dataset && d.dataset.sk) RV_OPEN[d.open ? 'add' : 'delete'](d.dataset.sk); }, true);

const BLANK = /\[(\d+)\]/g;
function blanksOf(set) { const out = []; let i = 0; set.text.replace(BLANK, (a, len) => { out.push({ n: set.start + i++, len: +len }); return a; }); return out; }
const rowMap = rows => { const by = {}; rows.forEach(x => { by[x.k] = x; }); return by; };
// 리딩: 모듈마다 지문 순서대로
function rcReviewBody(V) {
  const r = V.r, by = rowMap(r.rows);
  return V.content.test.modules.map((m, mi) => {
    if (r.module != null && mi !== r.module) return '';
    const html = m.sets.map(s => (s.type === 'words' ? rvWords(s, mi, by, V, '') : rvRead(s, mi, by, V))).join('');
    return html ? `<section class="stack"><h3 class="rvmod">${esc(m.name)}</h3>${html}</section>` : '';
  }).join('');
}
// 빈칸 모아 풀기: 회차·모듈마다 빈칸 지문
function wordsReviewBody(V) {
  const by = rowMap(V.r.rows);
  return V.content.sets.map(s => rvWords(s, s.t + '-' + s.mi, by, V, `TEST ${esc(s.t)} · Module ${s.mi + 1}`)).join('');
}
// 빈칸 지문 하나: 낸 글자를 채워 넣고, 틀린 칸은 정답(정답 공개일 때)을 옆에 붙인다. kp는 답 키 앞부분 ("0" 또는 "7-0")
function rvWords(set, kp, by, V, title) {
  const bl = blanksOf(set), xs = bl.map(b => by[kp + '-' + b.n]);
  xs.forEach(x => x && V.seen.add(x.k));
  if (!xs.some(Boolean) || (V.onlyWrong && !xs.some(x => x && !x.ok))) return '';
  let i = 0;
  const html = esc(set.text).replace(/(\S*?)\[(\d+)\]/g, (a, pre, len) => {
    const b = bl[i++], x = by[kp + '-' + b.n], gap = '_'.repeat(+len);
    if (!x) return `<span class="wd">${pre}<span class="rvb">${gap}</span></span>`;
    const fix = !x.ok && x.correct ? `<span class="rvb fix">${esc(x.correct)}</span>` : '';
    return `<span class="wd">${pre}<span class="rvb ${x.ok ? 'ok' : x.given ? 'bad' : 'bad none'}">${x.given ? esc(x.given) : gap}</span>${fix}<span class="sr"> (${b.n}번 ${x.ok ? '맞음' : '틀림'}${fix ? ', 정답 ' + esc(x.correct) : ''})</span></span>`;
  });
  return `<div class="sheet words rvwords">${title ? `<div class="eyebrow">${title}</div>` : ''}${html}</div>`;
}
// 리딩 지문 하나와 그 문제들. 문장 넣기 문제가 있으면 지문의 ■ 자리에 A~D를 붙이고, 내가 고른 자리와 정답 자리를 칠한다.
function rvRead(set, mi, by, V) {
  set.questions.forEach(q => { const x = by[mi + '-' + q.n]; if (x) V.seen.add(x.k); });
  const qs = set.questions.filter(q => { const x = by[mi + '-' + q.n]; return x && (!V.onlyWrong || !x.ok); });
  if (!qs.length) return '';
  const ins = set.questions.find(q => q.insert), ix = ins && by[mi + '-' + ins.n];
  let i = 0;
  const mark = () => { const L = LET[i++] || '', c = ix ? (ix.given === L ? (ix.ok ? ' mine' : ' mine bad') : '') + (ix.correct === L ? ' right' : '') : '';
    return `<span class="insmark${c}">■ ${L}</span>`; };
  const passage = set.passage.split(/\n\n/).map(p => {
    const h = esc(p).replace(/\n/g, '<br>');
    return `<p>${ins ? h.replace(/■/g, mark) : h.replace(/ ?■ ?/g, ' ').replace(/ {2,}/g, ' ').trim()}</p>`;
  }).join('');
  const cards = qs.map(q => rvChoice(q.n, q.insert ? '다음 문장이 들어갈 가장 알맞은 위치를 고르세요.' : q.q, q.insert ? LET.map(L => `위치 ■ ${L}`) : q.c,
    by[mi + '-' + q.n], q.insert ? `<div class="insert-sent">${esc(q.insert)}</div>` : '')).join('');
  return `<div class="split rvsplit"><div class="sheet passage">${set.kind ? `<div class="eyebrow">${esc(set.kind)}</div>` : ''}${set.title ? `<h3>${esc(set.title)}</h3>` : ''}${passage}</div>
    <div class="stack">${cards}</div></div>`;
}
// 객관식 한 문제: 내 답과 정답(정답 공개일 때만 x.correct가 있다)을 표시한다
// ex: 리스닝 해설 { qk 질문 해석, type 문항 유형, ok 보기 해석, ul 보기별 함정 표현, exp 해설 } (정답 공개일 때만 서버가 보낸다)
function rvChoice(n, text, choices, x, extra, ex) {
  ex = ex || {};
  return `<div class="sheet rvq${x.ok ? '' : ' wrong'}"><div class="rvqh"><span class="mark ${x.ok ? 'ok' : 'bad'}">${x.ok ? 'O' : 'X'}<span class="sr">${x.ok ? ' 맞음' : ' 틀림'}</span></span>
    <span><span class="num">${n}.</span> ${esc(text)}${ex.qk ? `<span class="ko">${esc(ex.qk)}</span>` : ''}</span></div>${extra || ''}
    <div class="opts">${choices.map((c, ci) => { const L = LET[ci], mine = x.given === L, right = x.correct === L, ko = ex.ok && ex.ok[ci];
      return `<div class="opt rv${mine ? (x.ok ? ' mine' : ' mine bad') : ''}${right ? ' right' : ''}"><b>(${L})</b><span>${trapText(c, ex.ul && ex.ul[ci])}${ko ? `<span class="ko">${esc(ko)}</span>` : ''}</span>${mine ? `<span class="tag">${RV_MINE}</span>` : ''}${right ? '<span class="tag ok">정답</span>' : ''}</div>`; }).join('')}</div>
    ${x.given ? '' : '<div class="note">답을 고르지 않았어요.</div>'}${ex.exp ? `<div class="rvx"><b>해설</b>${ex.type ? `<span class="rvtype">${esc(ex.type)}</span>` : ''}<p>${rvExp(ex.exp)}</p></div>` : ''}</div>`;
}
// 해설 본문: **굵게**, 줄 첫머리의 "(A) 언급 없음." "(B) 정답." 같은 꼬리표와 "Paraphrasing:"은 굵게
const rvExp = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^(\([A-D]\) [^.\n]{1,20}\.|Paraphrasing:)/gm, '<b class="tagl">$1</b>');
// 보기에서 오답 함정 표현(phrases)에 밑줄. 원문 위치로 표시한 뒤 한 글자씩 이스케이프해서 태그가 겹치지 않게 한다.
function trapText(text, phrases) {
  const low = String(text).toLowerCase(), on = new Array(low.length).fill(false);
  (phrases || []).forEach(p => { p = String(p || ''); const i = p ? low.indexOf(p.toLowerCase()) : -1; for (let k = i; i >= 0 && k < i + p.length; k++) on[k] = true; });
  let out = '', u = false;
  for (let k = 0; k < low.length; k++) { if (on[k] !== u) { out += on[k] ? '<u class="trap">' : '</u>'; u = on[k]; } out += esc(text[k]); }
  return out + (u ? '</u>' : '');
}

// 기록이 다루는 모듈들 (Module 1 + 2 이어 풀기 기록은 module이 null이고, 채점된 문항이 있는 모듈만)
const rvMods = (r, t) => { if (r.module != null) return [r.module];
  const ms = [...new Set(r.rows.map(x => x.mi))].filter(i => i === 0 || i === 1).sort(); return ms.length ? ms : t.modules.map((m, i) => i); };
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
// 리스닝 문제: 모듈마다 문항 묶음별로 스크립트(해설이 있으면)와 문제. player(mi, it)는 묶음마다 붙일 재생기 HTML (관리자 화면은 없음)
function lcReviewItems(V, player) {
  // ex: 해설 { i: { "모듈:첫 문항": { s: 원문, l: [{ sp, en, ko }] } }, q: { "모듈-문항": { qk, type, ok, ul, ev, exp } } }
  const r = V.r, t = V.content.test, mods = rvMods(r, t), by = rowMap(r.rows), ex = V.content.extra || { i: {}, q: {} };
  if (!mods.length || mods.some(mi => !t.modules[mi])) return '';
  return mods.map(mi => {
    const items = t.modules[mi].items.map(it => {
      it.questions.forEach(q => { const x = by[mi + '-' + q.n]; if (x) V.seen.add(x.k); });
      const qs = it.questions.filter(q => { const x = by[mi + '-' + q.n]; return x && (!V.onlyWrong || !x.ok); });
      if (!qs.length) return '';
      const ix = ex.i[mi + ':' + it.from] || {}, sk = r.id + '|' + mi + ':' + it.from;
      return `<section class="stack rvitem"><div class="qhead" style="margin:0"><h3>${esc(it.heading)}</h3><span class="note num">${LC_TYPE[it.type] || ''} · ${it.from === it.to ? `Question ${it.from}` : `Questions ${it.from}–${it.to}`}</span></div>
        ${player(mi, it)}
        ${it.type === 'response' || !(ix.l || ix.s) ? '' : `<details class="rvscript" data-sk="${esc(sk)}"${RV_OPEN.has(sk) ? ' open' : ''}>${ix.l
          ? `<summary>스크립트 · 해석 보기</summary>${rvLines(ix.l, it.questions.map(q => [q, ex.q[mi + '-' + q.n], by[mi + '-' + q.n]]))}`
          : `<summary>스크립트 보기</summary><p class="rvplain">${esc(ix.s)}</p>`}</details>`}
        ${qs.map(q => rvChoice(q.n, q.q || (it.type === 'response' && ix.s ? ix.s : '가장 알맞은 응답을 고르세요.'), q.c, by[mi + '-' + q.n], '', ex.q[mi + '-' + q.n])).join('')}</section>`;
    }).join('');
    return items && mods.length > 1 ? `<h3 class="rvmod">${esc(t.modules[mi].name)}</h3>${items}` : items;
  }).join('');
}
