// 서버(Apps Script)에 요청을 보낸다. 본문을 문자열로 보내면 브라우저가 사전 확인 없이 바로 전송한다.
window.api = async function api(action, body) {
  if (!window.API_URL) throw new Error('서버 주소가 아직 설정되지 않았어요. config.js를 확인하세요.');
  let res;
  try {
    res = await fetch(window.API_URL, { method: 'POST', body: JSON.stringify(Object.assign({ action }, body || {})) });
  } catch (e) { throw new Error('서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.'); }
  let j;
  try { j = await res.json(); } catch (e) { throw new Error('서버 응답을 읽을 수 없어요. 잠시 후 다시 시도해 주세요.'); }
  if (!j.ok) throw new Error(j.error || '요청이 실패했어요.');
  return j;
};
