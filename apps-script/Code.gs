// NEW TOEFL 리딩 모의고사 서버.
// 이 스프레드시트에 문제(정답 포함), 설정, 결과를 보관하고, GitHub Pages의 학생/관리자 페이지가 보내는 요청을 처리한다.
// 학생에게는 정답 없는 문제만 보내고, 채점은 여기서 한다.

const SH = { settings: '설정', tests: '문제', results: '결과' };
const DEFAULT_PW = 'toefl1234';
const RESULT_HEADERS = ['제출 시각', '이름', '회차', '총점', '만점', 'M1 단어', 'M1 리딩', 'M2 단어', 'M2 리딩',
  '소요 시간 (M1 + M2)', '틀린 문항', '틀린 답 → 정답', '상세 (JSON)', '기록 ID'];
const LET = ['A', 'B', 'C', 'D'];

function doGet() { return json_({ ok: true, message: '서버가 작동 중이에요.' }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: '잘못된 요청' }); }
  try {
    const fn = API[req.action];
    if (!fn) return json_({ ok: false, error: '알 수 없는 요청: ' + req.action });
    return json_(Object.assign({ ok: true }, fn(req) || {}));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

const API = {
  // ---------- 학생 ----------
  enter(r) {
    checkCode_(r.code);
    return { tests: openTests_().map(testSummary_) };
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
    const g = grade_(t, r.answers || {});
    const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const rec = {
      id, name: clip_(r.name, 60), testId: t.id, finishedAt: Date.now(), used: (r.used || []).map(Number),
      score: g.score, total: g.total, parts: g.parts, rows: g.rows
    };
    appendResult_(rec);
    const showAnswers = setting_('정답공개') !== 'N';
    if (!showAnswers) rec.rows = rec.rows.map(x => ({ k: x.k, mi: x.mi, n: x.n, kind: x.kind, given: x.given, ok: x.ok }));
    return { result: rec, showAnswers };
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
    const sheet = sheet_(SH.tests);
    const rows = sheet.getDataRange().getValues();
    const idx = {}; rows.forEach((row, i) => { if (i) idx[String(row[0])] = i + 1; });
    let added = 0, updated = 0;
    list.forEach(t => {
      const line = [t.id, 'TEST ' + t.id, countOf_(t), JSON.stringify(t)];
      if (idx[String(t.id)]) { sheet.getRange(idx[String(t.id)], 1, 1, 4).setValues([line]); updated++; }
      else { sheet.appendRow(line); added++; }
    });
    return { added, updated, tests: allTests_().map(testSummary_) };
  },
  deleteTest(r) {
    checkPw_(r.pw);
    const sheet = sheet_(SH.tests), rows = sheet.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) if (String(rows[i][0]) === String(r.id)) sheet.deleteRow(i + 1);
    return { tests: allTests_().map(testSummary_) };
  },
  listResults(r) {
    checkPw_(r.pw);
    const sheet = sheet_(SH.results), rows = sheet.getDataRange().getValues();
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]; if (!row[13]) continue;
      let detail = null; try { detail = JSON.parse(row[12]); } catch (e) {}
      out.push({
        id: String(row[13]), finishedAt: row[0] instanceof Date ? row[0].getTime() : Number(row[0]) || 0,
        name: String(row[1]), testId: Number(String(row[2]).replace(/\D/g, '')) || String(row[2]),
        score: Number(row[3]) || 0, total: Number(row[4]) || 0,
        parts: { '0w': row[5], '0r': row[6], '1w': row[7], '1r': row[8] }, usedText: String(row[9]),
        wrong: String(row[10]), rows: detail && detail.rows || null, used: detail && detail.used || null
      });
    }
    out.sort((a, b) => b.finishedAt - a.finishedAt);
    return { results: out };
  },
  deleteResult(r) {
    checkPw_(r.pw);
    const sheet = sheet_(SH.results), rows = sheet.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) if (String(rows[i][13]) === String(r.id)) sheet.deleteRow(i + 1);
    return {};
  }
};

// ---------- 설정 ----------
function settings_() {
  return { code: setting_('입장코드'), open: setting_('열린회차'), showAnswers: setting_('정답공개') !== 'N', pwIsDefault: setting_('관리자비밀번호') === DEFAULT_PW };
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
function openSet_() {
  const s = setting_('열린회차'); if (!s) return null;
  const set = new Set();
  s.split(/[,\s]+/).filter(Boolean).forEach(p => {
    const m = p.match(/^(\d+)\s*[-~]\s*(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) set.add(i); } else if (/^\d+$/.test(p)) set.add(+p);
  });
  return set;
}
function isOpen_(id) { const s = openSet_(); return !s || s.has(Number(id)); }
function openTests_() { return allTests_().filter(t => isOpen_(t.id)); }

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
    if (s.type === 'words') return { type: 'words', start: s.start, text: String(s.text).replace(/\[([a-z]+)\]/g, (a, w) => '[' + w.length + ']') };
    return { type: 'read', kind: s.kind, title: s.title, passage: s.passage,
      questions: s.questions.map(q => ({ n: q.n, q: q.q, c: q.c, insert: q.insert })) };
  }) })) };
}

// ---------- 채점 ----------
function grade_(t, answers) {
  const rows = [], parts = {};
  t.modules.forEach((m, mi) => m.sets.forEach(set => {
    if (set.type === 'words') blanks_(set).forEach(b => {
      const k = mi + '-' + b.n, given = String(answers[k] || '').trim().toLowerCase();
      rows.push({ k, mi, n: b.n, kind: 'w', given: String(answers[k] || ''), correct: b.ans, full: b.full, ok: !!given && (given === b.ans || given === b.full.toLowerCase()) });
    });
    else set.questions.forEach(q => {
      const k = mi + '-' + q.n;
      rows.push({ k, mi, n: q.n, kind: 'r', given: String(answers[k] || ''), correct: q.a, ok: answers[k] === q.a });
    });
  }));
  rows.forEach(r => { const p = parts[r.mi + r.kind] || (parts[r.mi + r.kind] = [0, 0]); p[1]++; if (r.ok) p[0]++; });
  return { rows, parts, score: rows.filter(r => r.ok).length, total: rows.length };
}

// ---------- 결과 ----------
function appendResult_(rec) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const part = k => rec.parts[k] ? rec.parts[k][0] + '/' + rec.parts[k][1] : '';
    const used = rec.used.map(s => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + '분 ' + (s % 60) + '초'; }).join(' + ');
    const wrong = rec.rows.filter(x => !x.ok);
    sheet_(SH.results).appendRow([
      new Date(rec.finishedAt), rec.name, 'TEST ' + rec.testId, rec.score, rec.total,
      part('0w'), part('0r'), part('1w'), part('1r'), used,
      wrong.map(x => 'M' + (x.mi + 1) + '-' + x.n).join(', '),
      clip_(wrong.map(x => 'M' + (x.mi + 1) + '-' + x.n + ': ' + (x.given || '(빈칸)') + ' → ' + (x.kind === 'w' ? x.full : x.correct)).join('; '), 5000),
      JSON.stringify({ used: rec.used, rows: rec.rows }), rec.id
    ]);
  } finally { lock.releaseLock(); }
}

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
  } else if (name === SH.results) {
    sheet.appendRow(RESULT_HEADERS); sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm');
  }
  sheet.setFrozenRows(1); sheet.getRange(1, 1, 1, 14).setFontWeight('bold');
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
