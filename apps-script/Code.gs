// NEW TOEFL 리딩·리스닝 모의고사 서버.
// 이 스프레드시트에 문제(정답 포함), 설정, 결과를 보관하고, GitHub Pages의 학생/관리자 페이지가 보내는 요청을 처리한다.
// 학생에게는 정답 없는 문제만 보내고, 채점은 여기서 한다.
// 리스닝 음원은 내 드라이브의 "토플 리스닝 음원" 폴더에 모듈마다 파일 하나(<id>_m<k>.json)로 있고,
// 입장 코드가 맞는 학생에게만 이 서버가 꺼내 보낸다.

const SH = { settings: '설정', tests: '문제', results: '결과', lc: '리스닝' };
const LC_FOLDER = '토플 리스닝 음원';
// 리스닝 세트 이름. 회차 제목은 저장된 값 대신 늘 "세트 이름 + TEST 번호"로 만든다 (예: NEW TOEFL 3 TEST 1).
const LC_SET_NAME = { new: 'NEW TOEFL 3', tpo: 'TPO' };
// 리스닝 섹션 이름 (학생이 섹션만 골라 풀 때 기록에 붙인다)
const LC_TYPE_NAME = { response: 'Best Response', conversation: 'Conversation', announcement: 'Announcement', talk: 'Academic Talk' };
const DEFAULT_PW = 'toefl1234';
const RESULT_HEADERS = ['제출 시각', '이름', '회차', '총점', '만점', 'M1 단어', 'M1 리딩', 'M2 단어', 'M2 리딩',
  '소요 시간 (M1 + M2)', '틀린 문항', '틀린 답 → 정답', '상세 (JSON)', '기록 ID', '기간', '반'];
const LET = ['A', 'B', 'C', 'D'];

function doGet() { return json_({ ok: true, message: '서버가 작동 중이에요.' }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: '잘못된 요청' }); }
  try {
    const fn = API[req.action];
    if (!fn) return json_({ ok: false, error: '알 수 없는 요청: ' + req.action });
    const out = fn(req) || {};
    // 음원 묶음은 이미 JSON 글자라 다시 풀었다 묶지 않고 그대로 감싸 보낸다 (몇 MB라 시간이 아깝다)
    if (out.rawPack != null) return ContentService.createTextOutput('{"ok":true,"pack":' + out.rawPack + '}').setMimeType(ContentService.MimeType.JSON);
    return json_(Object.assign({ ok: true }, out));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

const API = {
  // ---------- 학생 ----------
  enter(r) {
    checkCode_(r.code);
    return { tests: openTests_().map(testSummary_), lcTests: allLc_().filter(isLcOpen_).map(lcSummary_) };
  },
  getTest(r) {
    checkCode_(r.code);
    const t = loadTest_(r.id);
    if (!t || !isOpen_(t.id)) throw new Error('지금은 열려 있지 않은 회차예요.');
    return { test: stripAnswers_(t), showAnswers: setting_('정답공개') !== 'N' };
  },
  submit(r) {
    checkCode_(r.code);
    const t = loadTest_(r.id);
    if (!t) throw new Error('회차를 찾을 수 없어요.');
    // module: 0 또는 1이면 그 모듈만 채점, 없으면 전체
    const mi = (r.module === 0 || r.module === 1) ? r.module : null;
    const g = grade_(t, r.answers || {}, mi);
    const rec = {
      id: newId_(), name: clip_(r.name, 60), period: clip_(r.period, 40), cls: clip_(r.cls, 60), testId: t.id, module: mi, limit: Math.max(0, Number(r.limit) || 0),
      finishedAt: Date.now(), used: (r.used || []).map(Number),
      score: g.score, total: g.total, parts: g.parts, rows: g.rows
    };
    // 닫힌 회차도 기록은 남기지만 정답은 돌려주지 않는다 (나중에 열릴 회차의 정답이 새지 않게)
    return saveResult_(rec, r.attempt, isOpen_(t.id));
  },
  // 빈칸 모아 풀기: from~to 회차 중 열린 회차의 빈칸 지문만 보낸다 (글자 수만).
  getWords(r) {
    checkCode_(r.code);
    const sets = wordsSets_(r.from, r.to);
    return { sets: sets.map(s => ({ t: s.t, mi: s.mi, start: s.start, text: wordsText_(s) })) };
  },
  submitWords(r) {
    checkCode_(r.code);
    const sets = wordsSets_(r.from, r.to), answers = r.answers || {}, rows = [];
    sets.forEach(s => blanks_(s).forEach(b => {
      const k = s.t + '-' + s.mi + '-' + b.n;
      rows.push({ k, t: s.t, mi: s.mi, n: b.n, kind: 'w', given: String(answers[k] || ''), correct: b.ans, full: b.full, ok: blankOk_(b, answers[k]) });
    }));
    const score = rows.filter(x => x.ok).length;
    const rec = {
      id: newId_(), name: clip_(r.name, 60),
      period: clip_(r.period, 40), cls: clip_(r.cls, 60), testId: null, practice: { from: Number(r.from), to: Number(r.to) }, module: null, limit: Math.max(0, Number(r.limit) || 0),
      finishedAt: Date.now(), used: (r.used || []).map(Number), score, total: rows.length, parts: { w: [score, rows.length] }, rows
    };
    return saveResult_(rec, r.attempt, true);
  },

  // ---------- 리스닝 ----------
  getListening(r) {
    checkCode_(r.code);
    const t = loadLc_(r.id);
    if (!t || !isLcOpen_(t)) throw new Error('지금은 열려 있지 않은 회차예요.');
    return { test: stripLc_(t), showAnswers: setting_('정답공개') !== 'N' };
  },
  // 한 모듈의 음원 묶음 ({ id, module, clips: { "1": base64, "13-14": base64, ... } })
  getAudio(r) {
    checkCode_(r.code);
    const t = loadLc_(r.id), mi = Number(r.module);
    if (!t || !isLcOpen_(t)) throw new Error('지금은 열려 있지 않은 회차예요.');
    if (!(mi === 0 || mi === 1)) throw new Error('모듈을 다시 골라 주세요.');
    return { rawPack: lcFile_(t.id + '_m' + (mi + 1) + '.json').getBlob().getDataAsString() };
  },
  // module이 'both'면 모든 모듈을 이어서 푼 답안이다 (기록 하나, module은 null)
  submitListening(r) {
    checkCode_(r.code);
    const t = loadLc_(r.id), mi = r.module === 'both' ? null : Number(r.module);
    if (!t) throw new Error('회차를 찾을 수 없어요.');
    const secs = lcSecs_(t, mi, r.secs);
    const g = gradeLc_(t, r.answers || {}, mi, secs);
    const rec = {
      id: newId_(), name: clip_(r.name, 60),
      period: clip_(r.period, 40), cls: clip_(r.cls, 60), testId: null, lc: { id: t.id, title: t.title }, secs, module: mi, limit: 0,
      finishedAt: Date.now(), used: (r.used || []).map(Number), score: g.score, total: g.total, parts: g.parts, rows: g.rows
    };
    return saveResult_(rec, r.attempt, isLcOpen_(t));
  },

  // ---------- 내 기록 ----------
  // 같은 반·이름으로 낸 기록 (최근 것부터). 반 칸이 빈 옛 기록은 이름만 맞으면 넣는다.
  // 상세(JSON) 칸은 크니까 읽지 않고 회차 칸으로 종류를 알아낸다.
  // 지금 닫힌 회차의 기록은 점수를 돌려주지 않는다 (닫힌 회차에 답을 바꿔 내 보며 점수로 정답을 알아내지 못하게).
  myResults(r) {
    checkCode_(r.code);
    const who = who_(r), sheet = sheet_(SH.results), n = sheet.getLastRow() - 1, out = [];
    if (n < 1) return { results: out };
    const head = sheet.getRange(2, 1, n, 5).getValues(), tail = sheet.getRange(2, 14, n, 3).getValues(), open = openNow_();
    for (let i = 0; i < n; i++) {
      if (!tail[i][0] || !mine_(who, head[i][1], tail[i][2])) continue;
      const info = labelInfo_(head[i][2]), shown = recOpen_(info, open);
      out.push(Object.assign(info, { id: String(tail[i][0]), finishedAt: time_(head[i][0]), score: shown ? Number(head[i][3]) || 0 : null, total: Number(head[i][4]) || 0, hidden: !shown }));
    }
    // 선생님이 시트를 정렬해 두었을 수도 있어서 줄 순서 대신 제출 시각으로 줄 세운다
    out.sort((a, b) => b.finishedAt - a.finishedAt);
    return { results: out.slice(0, 300) };
  },
  // 기록 하나를 문제와 함께 다시 보기. 내 기록이고 지금 열린 회차일 때만 점수·채점 결과·문제(정답 뺀 것)를 보낸다.
  // 정답은 정답 공개가 켜져 있을 때만 보낸다. 빈칸 모아 풀기는 지금 열린 회차의 문항만 보여 준다.
  myResult(r) {
    checkCode_(r.code);
    const who = who_(r), sheet = sheet_(SH.results), n = sheet.getLastRow() - 1, id = String(r.id || '');
    const ids = id && n > 0 ? sheet.getRange(2, 14, n, 1).getValues() : [];
    let at = -1;
    for (let i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === id) { at = i + 2; break; }
    // 두 번 읽는 사이에 줄이 지워지거나 정렬됐을 수 있어서 그 줄의 기록 ID를 다시 확인한다
    const row = at > 0 ? sheet.getRange(at, 1, 1, 16).getValues()[0] : null;
    if (!row || String(row[13]) !== id || !mine_(who, row[1], row[15])) throw new Error('기록을 찾을 수 없어요. 다시 시도해 주세요.');
    let d = null; try { d = JSON.parse(row[12]); } catch (e) {}
    d = d || {};
    // 회차 칸보다 상세 칸이 정확하다 (리스닝 회차 ID, 모듈, 섹션)
    const info = labelInfo_(row[2]), open = openNow_();
    if (d.lc && d.lc.id) info.lc = { id: String(d.lc.id), title: String(d.lc.title || '') };
    if (d.practice) info.practice = d.practice;
    if (d.module === 0 || d.module === 1) info.module = d.module;
    if (Array.isArray(d.secs)) info.secs = d.secs;
    const rec = Object.assign(info, { id, name: String(row[1]).trim(), finishedAt: time_(row[0]), used: Array.isArray(d.used) ? d.used : [], limit: Number(d.limit) || 0 });
    if (!recOpen_(info, open)) return { result: Object.assign(rec, { hidden: true, score: null, total: Number(row[4]) || 0, parts: {}, rows: [] }), showAnswers: false, content: null };
    let rows = Array.isArray(d.rows) ? d.rows : [], content = null, cut = 0;
    if (info.practice) {
      const before = rows.length;
      rows = rows.filter(x => !open.rc || open.rc.has(Number(x.t)));
      cut = before - rows.length;
      // 고른 회차가 지금 모두 닫혔으면 닫힌 회차 기록처럼 숨긴다
      if (!rows.length) return { result: Object.assign(rec, { hidden: true, score: null, total: Number(row[4]) || 0, parts: {}, rows: [] }), showAnswers: false, content: null };
      if (cut) rec.orig = { score: Number(row[3]) || 0, total: Number(row[4]) || 0 };
      const tests = testsById_(rows.map(x => x.t)), sets = [], has = new Set(rows.map(x => x.k));
      Object.keys(tests).map(Number).sort((a, b) => a - b).forEach(tid => tests[tid].modules.forEach((m, mi) => m.sets.forEach(s => {
        if (s.type === 'words' && blanks_(s).some(b => has.has(tid + '-' + mi + '-' + b.n))) sets.push({ t: tid, mi, start: s.start, text: wordsText_(s) });
      })));
      content = sets.length ? { sets } : null;
    } else if (info.lc) {
      const t = loadLc_(info.lc.id);
      content = t ? { test: stripLc_(t) } : null;
    } else if (info.testId != null) {
      const t = testsById_([info.testId])[info.testId];
      content = t ? { test: stripAnswers_(t) } : null;
    }
    if (!open.showAnswers) rows = rows.map(x => ({ k: x.k, t: x.t, mi: x.mi, n: x.n, kind: x.kind, type: x.type, given: x.given, ok: x.ok }));
    const score = rows.filter(x => x.ok).length;
    return { result: Object.assign(rec, { score, total: rows.length, parts: partsOf_(rows, !!info.practice), rows, cut }), showAnswers: open.showAnswers, content };
  },

  // ---------- 관리자 ----------
  adminLogin(r) { checkPw_(r.pw); return { settings: settings_() }; },
  getSettings(r) { checkPw_(r.pw); return { settings: settings_() }; },
  saveSettings(r) {
    checkPw_(r.pw);
    const s = r.settings || {};
    if (s.code != null) setSetting_('입장코드', String(s.code).trim());
    if (s.open != null) setSetting_('열린회차', String(s.open).trim());
    if (s.showAnswers != null) setSetting_('정답공개', s.showAnswers ? 'Y' : 'N');
    if (s.lcNew != null) setSetting_('리스닝새열린회차', String(s.lcNew).trim());
    if (s.lcTpo != null) setSetting_('리스닝TPO열린회차', String(s.lcTpo).trim());
    return { settings: settings_() };
  },
  changePassword(r) {
    checkPw_(r.pw);
    const np = String(r.newPw || '').trim();
    if (np.length < 4) throw new Error('비밀번호는 4자 이상이어야 해요.');
    setSetting_('관리자비밀번호', np);
    return {};
  },
  listTests(r) { checkPw_(r.pw); return { tests: allTests_().map(testSummary_), open: setting_('열린회차') }; },
  saveTests(r) {
    checkPw_(r.pw);
    const list = Array.isArray(r.tests) ? r.tests : (r.tests && r.tests.tests) || [];
    if (!list.length) throw new Error('추가할 회차가 없어요. tests.json 형식인지 확인해 주세요.');
    list.forEach(validateTest_);
    let added = 0, updated = 0;
    withLock_(() => {
      const sheet = sheet_(SH.tests), rows = sheet.getDataRange().getValues();
      const idx = {}; rows.forEach((row, i) => { if (i) idx[String(row[0])] = i + 1; });
      const fresh = {};
      list.forEach(t => {
        const line = [t.id, 'TEST ' + t.id, countOf_(t), JSON.stringify(t)];
        if (idx[String(t.id)]) { sheet.getRange(idx[String(t.id)], 1, 1, 4).setValues([line]); updated++; }
        else fresh[String(t.id)] = line;
      });
      added = appendRows_(sheet, Object.values(fresh));
    });
    return { added, updated, tests: allTests_().map(testSummary_) };
  },
  deleteTest(r) {
    checkPw_(r.pw);
    withLock_(() => deleteRows_(SH.tests, 0, r.id));
    return { tests: allTests_().map(testSummary_) };
  },
  listLc(r) { checkPw_(r.pw); const tests = allLc_(); return { tests: tests.map(lcSummary_), audio: lcAudioStatus_(tests) }; },
  saveLc(r) {
    checkPw_(r.pw);
    const list = Array.isArray(r.tests) ? r.tests : (r.tests && r.tests.tests) || [];
    if (!list.length) throw new Error('추가할 리스닝 회차가 없어요.');
    list.forEach(validateLc_);
    let added = 0, updated = 0;
    // 두 번 겹쳐 올려도 같은 회차가 두 줄 생기지 않게, 잠근 뒤 시트를 읽고 쓴다
    withLock_(() => {
      const sheet = sheet_(SH.lc), rows = sheet.getDataRange().getValues();
      const idx = {}; rows.forEach((row, i) => { if (i) idx[String(row[0])] = i + 1; });
      const fresh = {};
      list.forEach(t => {
        const line = [t.id, LC_SET_NAME[t.set], Number(t.no), lcCount_(t), JSON.stringify(t)];
        if (idx[t.id]) { sheet.getRange(idx[t.id], 1, 1, 5).setValues([line]); updated++; }
        else fresh[t.id] = line;
      });
      added = appendRows_(sheet, Object.values(fresh));
    });
    return { added, updated, tests: allLc_().map(lcSummary_) };
  },
  // 음원 묶음 하나(<id>_m<k>.json)를 드라이브 "토플 리스닝 음원" 폴더에 저장한다. 같은 이름이 있으면 휴지통으로 보내고 새로 만든다.
  saveAudio(r) {
    checkPw_(r.pw);
    const name = String(r.name || '');
    if (!/^(new|tpo)-\d+_m[12]\.json$/.test(name)) throw new Error('음원 파일 이름이 잘못됐어요: ' + name);
    const folder = lcFolder_(true), old = folder.searchFiles(ownedQ_(name));
    while (old.hasNext()) old.next().setTrashed(true);
    const f = folder.createFile(name, String(r.data || ''), 'application/json');
    CacheService.getScriptCache().put('lcf:' + name, f.getId(), 21600);
    return { name, size: f.getSize() };
  },
  deleteLc(r) {
    checkPw_(r.pw);
    withLock_(() => deleteRows_(SH.lc, 0, r.id));
    return { tests: allLc_().map(lcSummary_) };
  },
  listResults(r) {
    checkPw_(r.pw);
    const sheet = sheet_(SH.results), rows = sheet.getDataRange().getValues();
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]; if (!row[13]) continue;
      let detail = null; try { detail = JSON.parse(row[12]); } catch (e) {}
      const practice = detail && detail.practice || null, lc = detail && detail.lc || null;
      out.push({
        id: String(row[13]), finishedAt: row[0] instanceof Date ? row[0].getTime() : Number(row[0]) || 0,
        name: String(row[1]), practice, lc, secs: detail && detail.secs || null, period: String(row[14] || ''), cls: String(row[15] || ''),
        testId: practice || lc ? null : Number((String(row[2]).match(/TEST (\d+)/) || [])[1]) || String(row[2]),
        module: detail && (detail.module === 0 || detail.module === 1) ? detail.module : (/ M1$/.test(String(row[2])) ? 0 : / M2$/.test(String(row[2])) ? 1 : null),
        limit: detail && Number(detail.limit) || 0,
        score: Number(row[3]) || 0, total: Number(row[4]) || 0,
        // 모듈별 점수 칸("3/10")은 예전에 날짜로 바뀌어 저장된 것이 있어서, 상세 칸이 있으면 거기서 다시 센다
        parts: lc ? detail.parts || {} : !practice && detail && Array.isArray(detail.rows) ? partText_(partsOf_(detail.rows, false))
          : { '0w': row[5], '0r': row[6], '1w': row[7], '1r': row[8] }, usedText: String(row[9]),
        wrong: String(row[10]), rows: detail && detail.rows || null, used: detail && detail.used || null
      });
    }
    out.sort((a, b) => b.finishedAt - a.finishedAt);
    return { results: out };
  },
  deleteResult(r) {
    checkPw_(r.pw);
    withLock_(() => deleteRows_(SH.results, 13, r.id));
    return {};
  }
};

// ---------- 설정 ----------
function settings_() {
  return { code: setting_('입장코드'), open: setting_('열린회차'), showAnswers: setting_('정답공개') !== 'N', pwIsDefault: setting_('관리자비밀번호') === DEFAULT_PW,
    lcNew: setting_('리스닝새열린회차'), lcTpo: setting_('리스닝TPO열린회차') };
}
function setting_(key) {
  const rows = sheet_(SH.settings).getDataRange().getValues();
  for (const row of rows) if (String(row[0]) === key) return String(row[1] == null ? '' : row[1]).replace(/^'/, '').trim();
  return '';
}
// 값 칸은 텍스트 서식이라 "1027"도 숫자로 바뀌지 않는다.
function setSetting_(key, value) {
  const sheet = sheet_(SH.settings), rows = sheet.getDataRange().getValues();
  for (let i = 0; i < rows.length; i++) if (String(rows[i][0]) === key) { sheet.getRange(i + 1, 2).setNumberFormat('@').setValue(String(value)); return; }
  sheet.appendRow([key, String(value)]);
  sheet.getRange(rows.length + 1, 2).setNumberFormat('@').setValue(String(value));
}
function checkPw_(pw) {
  const real = setting_('관리자비밀번호');
  if (!pw || String(pw) !== real) throw new Error('비밀번호가 맞지 않아요.');
}
function checkCode_(code) {
  const real = setting_('입장코드');
  if (!real) throw new Error('아직 입장 코드가 설정되지 않았어요. 선생님께 문의하세요.');
  if (String(code || '').trim() !== real) throw new Error('입장 코드가 맞지 않아요.');
}
// "1-5, 8" 같은 문자열을 회차 번호 집합으로 바꾼다. 비어 있으면 전부 열림.
function openSet_(key) { return parseOpen_(setting_(key || '열린회차')); }
// 지금 열린 회차들과 정답 공개 (설정 시트를 한 번만 읽는다). rc가 null이면 리딩은 전부 열림, lcNew·lcTpo가 null이면 그 세트는 전부 닫힘
function openNow_() {
  const rows = sheet_(SH.settings).getDataRange().getValues();
  const get = key => { for (const row of rows) if (String(row[0]) === key) return String(row[1] == null ? '' : row[1]).replace(/^'/, '').trim(); return ''; };
  return { rc: parseOpen_(get('열린회차')), lcNew: parseOpen_(get('리스닝새열린회차')), lcTpo: parseOpen_(get('리스닝TPO열린회차')), showAnswers: get('정답공개') !== 'N' };
}
function parseOpen_(s) {
  if (!s) return null;
  const set = new Set();
  s.split(/[,\s]+/).filter(Boolean).forEach(p => {
    const m = p.match(/^(\d+)\s*[-~]\s*(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) set.add(i); } else if (/^\d+$/.test(p)) set.add(+p);
  });
  return set;
}
function isOpen_(id) { const s = openSet_(); return !s || s.has(Number(id)); }
function openTests_() { return allTests_().filter(t => isOpen_(t.id)); }
// from~to 회차 중 열린 회차의 빈칸 지문: [{ t, mi, start, text }]
function wordsSets_(from, to) {
  from = Number(from); to = Number(to);
  if (!(from >= 1) || !(to >= from)) throw new Error('회차 범위를 다시 골라 주세요.');
  const out = [];
  openTests_().filter(t => t.id >= from && t.id <= to).forEach(t => t.modules.forEach((m, mi) => m.sets.forEach(s => {
    if (s.type === 'words') out.push({ t: t.id, mi, start: s.start, text: s.text });
  })));
  if (!out.length) throw new Error('그 범위에는 열려 있는 회차가 없어요.');
  return out;
}

// ---------- 문제 ----------
function allTests_() {
  const rows = sheet_(SH.tests).getDataRange().getValues(), out = [];
  for (let i = 1; i < rows.length; i++) { try { out.push(JSON.parse(rows[i][3])); } catch (e) {} }
  return out.sort((a, b) => a.id - b.id);
}
function loadTest_(id) {
  const rows = sheet_(SH.tests).getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === String(id)) return JSON.parse(rows[i][3]);
  return null;
}
// 여러 회차를 시트 한 번 읽어서 { 회차: 문제 } 로 (없는 회차는 빠진다)
function testsById_(ids) {
  const want = new Set(ids.map(String)), rows = sheet_(SH.tests).getDataRange().getValues(), out = {};
  for (let i = 1; i < rows.length; i++) if (want.has(String(rows[i][0]))) { try { out[rows[i][0]] = JSON.parse(rows[i][3]); } catch (e) {} }
  return out;
}
function validateTest_(t) {
  if (!t || !t.id || !Array.isArray(t.modules) || !t.modules.length) throw new Error('회차 형식이 잘못됐어요 (id, modules 필요).');
  t.modules.forEach(m => (m.sets || []).forEach(s => {
    if (s.type === 'words') { if (!blanks_(s).length) throw new Error('TEST ' + t.id + ': 빈칸이 없는 단어 지문이 있어요.'); }
    else if (s.type === 'read') (s.questions || []).forEach(q => { if (!LET.includes(q.a)) throw new Error('TEST ' + t.id + ' ' + q.n + '번: 정답이 A~D가 아니에요.'); });
    else throw new Error('TEST ' + t.id + ': 알 수 없는 유형 ' + s.type);
  }));
}
function blanks_(set) {
  const out = []; let i = 0;
  String(set.text).replace(/(\S*?)\[([a-z]+)\]/g, (all, pre, ans) => {
    const prefix = pre.replace(/^[^A-Za-z]+/, '');
    out.push({ n: set.start + i++, ans, full: prefix + ans }); return all;
  });
  return out;
}
function countOf_(t) {
  const c = { words: 0, read: 0 };
  t.modules.forEach(m => m.sets.forEach(s => { if (s.type === 'words') c.words += blanks_(s).length; else c.read += s.questions.length; }));
  return c.words + c.read;
}
function testSummary_(t) {
  return { id: t.id, modules: t.modules.map(m => ({ name: m.name, minutes: m.minutes,
    words: m.sets.filter(s => s.type === 'words').reduce((n, s) => n + blanks_(s).length, 0),
    read: m.sets.filter(s => s.type === 'read').reduce((n, s) => n + s.questions.length, 0) })) };
}
// 학생에게 보낼 버전: 빈칸은 글자 수만, 객관식은 정답 제거
function stripAnswers_(t) {
  return { id: t.id, modules: t.modules.map(m => ({ name: m.name, minutes: m.minutes, sets: m.sets.map(s => {
    if (s.type === 'words') return { type: 'words', start: s.start, text: wordsText_(s) };
    return { type: 'read', kind: s.kind, title: s.title, passage: s.passage,
      questions: s.questions.map(q => ({ n: q.n, q: q.q, c: q.c, insert: q.insert })) };
  }) })) };
}
// 빈칸 지문의 학생용 글: 빠진 글자는 글자 수만 남긴다 ("popul[ation]" → "popul[5]")
function wordsText_(s) { return String(s.text).replace(/\[([a-z]+)\]/g, (a, w) => '[' + w.length + ']'); }

// ---------- 리스닝 문제 ----------
// 시험 하나: { id: "new-1" | "tpo-7", set, no, title, packs: [m1 bytes, m2 bytes],
//   modules: [{ name, items: [{ type, heading, from, to, audio: "m1/13-14.mp3", secs, questions: [{ n, q, c, a }] }] }] }
function allLc_() {
  const rows = sheet_(SH.lc).getDataRange().getValues(), byId = {};
  for (let i = 1; i < rows.length; i++) { try { const t = JSON.parse(rows[i][4]); if (t && t.id && Array.isArray(t.modules)) { t.title = lcTitle_(t); byId[t.id] = t; } } catch (e) {} }
  return Object.values(byId).sort((a, b) => (a.set === b.set ? a.no - b.no : a.set === 'new' ? -1 : 1));
}
function loadLc_(id) {
  const rows = sheet_(SH.lc).getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === String(id)) { const t = JSON.parse(rows[i][4]); t.title = lcTitle_(t); return t; }
  return null;
}
function lcTitle_(t) { return (LC_SET_NAME[t.set] || t.set) + ' TEST ' + t.no; }
// 리스닝은 열린 회차 칸이 비어 있으면 아무 회차도 열리지 않는다 (리딩은 비어 있으면 전부 열림)
function isLcOpen_(t) { const s = openSet_(t.set === 'new' ? '리스닝새열린회차' : '리스닝TPO열린회차'); return !!s && s.has(Number(t.no)); }
function lcCount_(t) { return t.modules.reduce((n, m) => n + m.items.reduce((k, it) => k + it.questions.length, 0), 0); }
function lcSummary_(t) {
  return { id: t.id, set: t.set, no: t.no, title: t.title, modules: t.modules.map(m => ({ name: m.name, count: m.items.reduce((k, it) => k + it.questions.length, 0) })) };
}
function validateLc_(t) {
  if (!t || !/^(new|tpo)-\d+$/.test(String(t.id)) || !Array.isArray(t.modules) || !t.modules.length) throw new Error('리스닝 회차 형식이 잘못됐어요 (id, modules 필요).');
  // 시트 칸에 그대로 들어가는 값은 숫자·정해진 글자만 받는다 (수식이 들어가지 않게)
  if (!(t.set === 'new' || t.set === 'tpo') || !(Number.isInteger(Number(t.no)) && Number(t.no) > 0) || t.id !== t.set + '-' + Number(t.no)) throw new Error('리스닝 회차 번호가 잘못됐어요: ' + String(t.id).slice(0, 20));
  t.modules.forEach(m => m.items.forEach(it => it.questions.forEach(q => {
    if (!LET.includes(q.a)) throw new Error(lcTitle_(t) + ' ' + m.name + ' ' + q.n + '번: 정답이 A~D가 아니에요.');
  })));
}
// 학생에게 보낼 버전: 정답만 뺀다
function stripLc_(t) {
  return { id: t.id, set: t.set, no: t.no, title: t.title, packs: t.packs || [], modules: t.modules.map(m => ({ name: m.name, items: m.items.map(it => ({
    type: it.type, heading: it.heading, from: it.from, to: it.to, clip: it.audio.split('/').pop().replace(/\.mp3$/, ''), secs: it.secs,
    questions: it.questions.map(q => ({ n: q.n, q: q.q, c: q.c })) })) })) };
}
// 드라이브 "토플 리스닝 음원" 폴더. 내가 만든(내 소유) 폴더만 쓴다. 남이 같은 이름 폴더를 공유해 와도 쓰지 않는다.
// 한 번 고른 폴더는 ID를 기억해 두고 계속 쓴다. 같은 이름 폴더가 여럿이면(다시 올리다 생긴 것) 파일이 가장 많은 폴더를 고른다.
// 휴지통에 있는 폴더는 보지 않는다. create면 없을 때 만든다. 동시에 여러 요청이 와도 폴더가 하나만 생기게 잠근 뒤 다시 확인한다.
function lcFolder_(create) {
  const props = PropertiesService.getScriptProperties();
  let found = lcFolders_();
  const known = () => { const id = props.getProperty('lcFolder'); return id && found.find(x => x.getId() === id) || null; };
  let f = known(); if (f) return f;
  if (!found.length && create) {
    withLock_(() => {
      found = lcFolders_(); f = known(); if (f) return;
      if (!found.length) found = [DriveApp.createFolder(LC_FOLDER)];
    });
    if (f) return f;
  }
  if (!found.length) throw new Error('드라이브에 "' + LC_FOLDER + '" 폴더가 없어요. 선생님께 문의하세요.');
  f = found.length === 1 ? found[0] : found.map(x => [x, lcNames_(x).size]).sort((a, b) => b[1] - a[1])[0][0];
  props.setProperty('lcFolder', f.getId());
  return f;
}
// 내 소유이고 휴지통에 없는 것만 찾는 검색어 (name이 없으면 이름 상관없이)
function ownedQ_(name) { return (name ? "title = '" + name + "' and " : '') + "'me' in owners and trashed = false"; }
function lcFolders_() {
  const out = [], it = DriveApp.searchFolders(ownedQ_(LC_FOLDER));
  while (it.hasNext()) out.push(it.next());
  return out;
}
function lcNames_(folder) {
  const names = new Set(), it = folder.searchFiles(ownedQ_());
  while (it.hasNext()) names.add(it.next().getName());
  return names;
}
// 그 폴더의 파일. 파일 ID는 6시간 기억해 두고 다시 찾지 않는다 (휴지통으로 간 파일이면 다시 찾는다).
function lcFile_(name) {
  const cache = CacheService.getScriptCache(), key = 'lcf:' + name, id = cache.get(key);
  if (id) { try { const f = DriveApp.getFileById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  const it = lcFolder_(false).searchFiles(ownedQ_(name));
  let f = null;
  while (it.hasNext()) { const x = it.next(); if (!f || x.getLastUpdated() > f.getLastUpdated()) f = x; }
  if (!f) throw new Error('음원 파일이 아직 없어요 (' + name + '). 선생님께 문의하세요.');
  cache.put(key, f.getId(), 21600);
  return f;
}
// 관리자 화면용: 폴더가 있는지, 같은 이름 폴더가 더 있는지, 회차별로 빠진 음원이 있는지
function lcAudioStatus_(tests) {
  const folders = lcFolders_();
  const names = folders.length ? lcNames_(lcFolder_(false)) : new Set(), missing = [];
  tests.forEach(t => t.modules.forEach((m, mi) => { if (!names.has(t.id + '_m' + (mi + 1) + '.json')) missing.push(t.title + ' M' + (mi + 1)); }));
  return { folder: folders.length > 0, files: names.size, dup: Math.max(0, folders.length - 1), missing };
}
// 채점할 모듈 번호들: mi가 null이면 모든 모듈 (Module 1 + 2 이어 풀기)
function lcMods_(t, mi) {
  if (mi == null) return t.modules.map((m, i) => i);
  if (!t.modules[mi]) throw new Error('모듈을 다시 골라 주세요.');
  return [mi];
}
// 학생이 고른 섹션: 그 모듈(들)에 있는 유형만 남긴다. 안 골랐거나 전부 골랐으면 null(전체)
function lcSecs_(t, mi, raw) {
  if (!Array.isArray(raw) || (mi != null && !t.modules[mi])) return null;
  const items = lcMods_(t, mi).flatMap(i => t.modules[i].items);
  const present = Object.keys(LC_TYPE_NAME).filter(tp => items.some(it => it.type === tp));
  const chosen = present.filter(tp => raw.includes(tp));
  return !chosen.length || chosen.length === present.length ? null : chosen;
}
// 리스닝 채점 (secs가 있으면 그 섹션 문항만). 답 키는 "모듈-문항". 유형별 점수: resp Best Response, conv Conversation, ann Announcement, talk Academic Talk
function gradeLc_(t, answers, mi, secs) {
  const rows = [], parts = {}, key = { response: 'resp', conversation: 'conv', announcement: 'ann', talk: 'talk' };
  lcMods_(t, mi).forEach(i => t.modules[i].items.filter(it => !secs || secs.includes(it.type)).forEach(it => it.questions.forEach(q => {
    const k = i + '-' + q.n, given = String(answers[k] || ''), ok = given === q.a;
    rows.push({ k, mi: i, n: q.n, kind: 'l', type: it.type, given, correct: q.a, ok });
    const p = parts[key[it.type]] || (parts[key[it.type]] = [0, 0]); p[1]++; if (ok) p[0]++;
  })));
  return { rows, parts, score: rows.filter(r => r.ok).length, total: rows.length };
}

// ---------- 채점 ----------
// only가 0 또는 1이면 그 모듈만 채점한다.
function grade_(t, answers, only) {
  const rows = [], parts = {};
  t.modules.forEach((m, mi) => (only != null && mi !== only) ? null : m.sets.forEach(set => {
    if (set.type === 'words') blanks_(set).forEach(b => {
      const k = mi + '-' + b.n;
      rows.push({ k, mi, n: b.n, kind: 'w', given: String(answers[k] || ''), correct: b.ans, full: b.full, ok: blankOk_(b, answers[k]) });
    });
    else set.questions.forEach(q => {
      const k = mi + '-' + q.n;
      rows.push({ k, mi, n: q.n, kind: 'r', given: String(answers[k] || ''), correct: q.a, ok: answers[k] === q.a });
    });
  }));
  rows.forEach(r => { const p = parts[r.mi + r.kind] || (parts[r.mi + r.kind] = [0, 0]); p[1]++; if (r.ok) p[0]++; });
  return { rows, parts, score: rows.filter(r => r.ok).length, total: rows.length };
}
// 빠진 글자만 써도, 단어 전체를 써도 정답
function blankOk_(b, raw) {
  const given = String(raw || '').trim().toLowerCase();
  return !!given && (given === b.ans || given === b.full.toLowerCase());
}

// ---------- 결과 ----------
// 기록을 남기고, 정답을 숨기는 설정이면 학생에게 돌려줄 답안에서 정답을 뺀다.
// 닫힌 회차(open이 false)면 점수·맞고 틀린 것도 돌려주지 않는다. 맞고 틀린 것만 보여도 A~D를 바꿔 내 보며 정답을 알아낼 수 있어서다.
// attempt(학생 기기에서 만든 응시 ID)가 같은 제출이 다시 오면(다시 보내기) 새로 기록하지 않고 처음 결과를 돌려준다.
function saveResult_(rec, attempt, open) {
  const att = String(attempt || '').replace(/[^\w-]/g, '').slice(0, 40), cache = CacheService.getScriptCache();
  const closed = open === false, showAnswers = !closed && setting_('정답공개') !== 'N';
  // 유형(type)은 정답이 아니라서 남긴다
  const shown = closed ? Object.assign({}, rec, { hidden: true, score: null, parts: {}, rows: [] })
    : showAnswers ? rec : Object.assign({}, rec, { rows: rec.rows.map(x => ({ k: x.k, t: x.t, mi: x.mi, n: x.n, kind: x.kind, type: x.type, given: x.given, ok: x.ok })) });
  const out = { result: shown, showAnswers };
  let prev = null;
  withLock_(() => {
    prev = att ? cache.get('att:' + att) : null;
    if (prev) return;
    appendResult_(rec);
    if (att) { try { cache.put('att:' + att, JSON.stringify(out), 21600); } catch (e) {} }
  });
  return prev ? JSON.parse(prev) : out;
}
// 결과 시트에 한 줄 쓴다. 부르는 쪽(saveResult_)이 잠근 상태에서 부른다.
function appendResult_(rec) {
  {
    // 앞에 '를 붙여 글자로 넣는다 (그냥 "3/10"이면 시트가 3월 10일 날짜로 바꾼다)
    const part = k => rec.parts[k] ? "'" + rec.parts[k][0] + '/' + rec.parts[k][1] : '';
    const fmt = s => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + '분 ' + (s % 60) + '초'; };
    const lim = rec.limit > 0 ? ' (제한 ' + rec.limit + '분)' : ' (제한 없음)';
    // 빈칸 모음: "빈칸 5분 2초 (제한 없음)" / 모듈 하나: "M1 12분 3초 (제한 18분)" / 전체: "12분 3초 + 8분 0초"
    const used = rec.practice ? '빈칸 ' + fmt(rec.used[0]) + lim
      : rec.lc ? (rec.module != null ? 'M' + (rec.module + 1) + ' ' : '') + fmt(rec.used[0])
      : rec.module != null ? 'M' + (rec.module + 1) + ' ' + fmt(rec.used[0]) + lim
      : rec.used.map(fmt).join(' + ');
    const label = rec.practice ? '빈칸 TEST ' + rec.practice.from + (rec.practice.to !== rec.practice.from ? '-' + rec.practice.to : '')
      : rec.lc ? '리스닝 ' + rec.lc.title + (rec.module != null ? ' M' + (rec.module + 1) : '') + (rec.secs ? ' (' + rec.secs.map(s => LC_TYPE_NAME[s]).join(' · ') + ')' : '')
      : 'TEST ' + rec.testId + (rec.module != null ? ' M' + (rec.module + 1) : '');
    const where = x => (x.t != null ? 'T' + x.t + ' ' : '') + 'M' + (x.mi + 1) + '-' + x.n;
    const wrong = rec.rows.filter(x => !x.ok);
    const sheet = sheet_(SH.results);
    // 기간·반 열은 나중에 생겼다. 예전에 만든 시트면 머리글을 채운다.
    if (String(sheet.getRange(1, 15).getValue()) !== '기간') sheet.getRange(1, 15, 1, 2).setValues([['기간', '반']]).setFontWeight('bold');
    sheet.appendRow([
      new Date(rec.finishedAt), rec.name, label, rec.score, rec.total,
      part('0w'), part('0r'), part('1w'), part('1r'), used,
      clip_(wrong.map(where).join(', '), 5000),
      clip_(wrong.map(x => where(x) + ': ' + (x.given || '(빈칸)') + ' → ' + (x.kind === 'w' ? x.full : x.correct)).join('; '), 5000),
      JSON.stringify({ used: rec.used, rows: rec.rows, module: rec.module, limit: rec.limit, practice: rec.practice || null, lc: rec.lc || null, secs: rec.secs || undefined, parts: rec.lc ? rec.parts : undefined }), rec.id,
      rec.period || '', rec.cls || ''
    ]);
  }
}
// 유형별 [맞은 수, 문항 수]: 리딩 '0w' '0r' '1w' '1r', 빈칸 모음 'w', 리스닝 'resp' 'conv' 'ann' 'talk'
function partsOf_(rows, practice) {
  const key = { response: 'resp', conversation: 'conv', announcement: 'ann', talk: 'talk' }, parts = {};
  rows.forEach(x => { const k = x.kind === 'l' ? key[x.type] : practice ? 'w' : x.mi + x.kind; if (!k) return;
    const p = parts[k] || (parts[k] = [0, 0]); p[1]++; if (x.ok) p[0]++; });
  return parts;
}
function partText_(parts) { const out = {}; Object.keys(parts).forEach(k => { out[k] = parts[k][0] + '/' + parts[k][1]; }); return out; }

// ---------- 내 기록 ----------
// 반·이름은 앞뒤·겹친 빈칸과 대소문자를 따지지 않고 비교한다 (이름은 저장할 때처럼 60자까지만)
function norm_(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); }
function who_(r) {
  const name = norm_(clip_(r.name, 60)), cls = norm_(clip_(r.cls, 60));
  if (!name || !cls) throw new Error('반과 이름을 먼저 입력해 주세요.');
  return { name, cls };
}
function mine_(who, name, cls) { const c = norm_(cls); return norm_(name) === who.name && (c === who.cls || !c); }
function time_(v) { return v instanceof Date ? v.getTime() : Number(v) || 0; }
// 결과 시트의 회차 칸("TEST 5 M1", "빈칸 TEST 1-10", "리스닝 NEW TOEFL 3 TEST 1 M2 (Best Response · Conversation)")에서 기록 종류를 읽는다
// 리스닝 Module 1 + 2 이어 풀기는 M이 없다 ("리스닝 NEW TOEFL 3 TEST 1 (Conversation)")
function labelInfo_(label) {
  const s = String(label == null ? '' : label).trim(), out = { testId: null, module: null, practice: null, lc: null, secs: null };
  let m;
  if ((m = s.match(/^빈칸 TEST (\d+)(?:-(\d+))?$/))) return Object.assign(out, { practice: { from: +m[1], to: +(m[2] || m[1]) } });
  if ((m = s.match(/^TEST (\d+)(?: M([12]))?$/))) return Object.assign(out, { testId: +m[1], module: m[2] ? m[2] - 1 : null });
  if ((m = s.match(/^리스닝 (.+? TEST \d+)(?: M([12]))?(?: \((.+)\))?$/))) {
    // 이름을 NEW TOEFL 3으로 바꾸기 전에는 새 문제집 회차 제목이 "새 TEST 1"이었다
    const title = m[1], names = [[LC_SET_NAME.new, 'new'], [LC_SET_NAME.tpo, 'tpo'], ['새', 'new']];
    const hit = names.find(x => title.indexOf(x[0] + ' TEST ') === 0), set = hit && hit[1];
    const no = hit ? title.slice((hit[0] + ' TEST ').length) : '';
    const secs = m[3] ? m[3].split(' · ').map(x => Object.keys(LC_TYPE_NAME).find(k => LC_TYPE_NAME[k] === x)).filter(Boolean) : [];
    return Object.assign(out, { module: m[2] - 1, lc: { id: /^\d+$/.test(no) ? set + '-' + Number(no) : null, title }, secs: secs.length ? secs : null });
  }
  return Object.assign(out, { label: s });
}
// 학생에게 점수·채점 결과를 보여도 되는 기록인가: 지금 열린 회차의 기록만.
// 빈칸 모아 풀기는 낼 때 열린 회차만 채점하므로 점수는 보여 준다 (문항은 myResult가 지금 열린 회차 것만 보낸다).
function recOpen_(info, open) {
  if (info.practice) return true;
  if (info.testId != null) return !open.rc || open.rc.has(Number(info.testId));
  if (info.lc && /^(new|tpo)-\d+$/.test(info.lc.id || '')) {
    const p = info.lc.id.split('-'), s = p[0] === 'new' ? open.lcNew : open.lcTpo;
    return !!s && s.has(Number(p[1]));
  }
  return false;
}

// 시트를 읽고 쓰는 동안 다른 요청이 끼어들지 못하게 잠근다.
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('지금 요청이 많아요. 잠시 후 다시 시도해 주세요.');
  try { return fn(); } finally { lock.releaseLock(); }
}
// col번째 칸(0부터)이 id인 줄을 지운다
function deleteRows_(name, col, id) {
  const sheet = sheet_(name), rows = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) if (String(rows[i][col]) === String(id)) sheet.deleteRow(i + 1);
}
// 새 줄 여러 개를 한 번에 붙인다 (한 줄씩 붙이면 회차가 많을 때 오래 걸린다)
function appendRows_(sheet, lines) {
  if (lines.length) sheet.getRange(sheet.getLastRow() + 1, 1, lines.length, lines[0].length).setValues(lines);
  return lines.length;
}
function newId_() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ---------- 시트 ----------
function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  sheet = ss.insertSheet(name);
  if (name === SH.settings) {
    sheet.getRange(1, 1, 5, 2).setValues([['항목', '값'], ['입장코드', ''], ['열린회차', ''], ['정답공개', 'Y'], ['관리자비밀번호', DEFAULT_PW]]);
    sheet.getRange('B:B').setNumberFormat('@');
  } else if (name === SH.tests) {
    sheet.appendRow(['회차', '제목', '문제 수', 'JSON']);
  } else if (name === SH.lc) {
    sheet.appendRow(['ID', '세트', '회차', '문제 수', 'JSON']);
  } else if (name === SH.results) {
    sheet.appendRow(RESULT_HEADERS); sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm');
  }
  sheet.setFrozenRows(1); sheet.getRange(1, 1, 1, RESULT_HEADERS.length).setFontWeight('bold');
  return sheet;
}
// 시트에서 수식으로 해석되지 않도록 앞에 공백을 붙이고 길이를 제한한다.
function clip_(v, max) {
  const s = String(v == null ? '' : v).slice(0, max);
  return /^[=+\-@]/.test(s) ? ' ' + s : s;
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
