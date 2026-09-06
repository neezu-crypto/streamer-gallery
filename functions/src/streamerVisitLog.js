const { onCall } = require('firebase-functions/v2/https');
const { getDatabase, ServerValue } = require('firebase-admin/database');
const { requireAuth, getVerifiedStreamerNickname } = require('./lib/auth');

function todayKeyKST() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().split('T')[0];
}

// 인증 스트리머가 갤러리에 접속하면 관리자 디스코드로 알림이 가게 한다
// (2026-09-06 추가, StreamBet-Market의 logBettingMarketVisit/soop-stock-market의
// logStockMarketVisit/streamer-life-game의 logLifeGameVisit과 동일 패턴). 실제
// 발송은 admin-center의 RTDB 트리거가 담당하고, 이 함수는 여러 앱이 공유하는
// verifiedStreamerVisits 큐에 항목 하나만 쌓는다. 인증 여부·닉네임 조회는 이미
// deleteOwnImage가 쓰던 getVerifiedStreamerNickname(lib/auth.js)를 그대로
// 재사용 — 새 스키마 도입 안 함. market 값은 admin-center PRESENCE_APPS와
// 동일한 'gallery'를 재사용.
const logGalleryVisit = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = getDatabase();

  const nickname = await getVerifiedStreamerNickname(uid);
  if (!nickname) return { ok: true, logged: false };

  const dateKey = todayKeyKST();
  const dedupRef = db.ref(`verifiedStreamerVisitDedup/gallery/${uid}/${dateKey}`);
  let alreadyLogged = false;
  await dedupRef.transaction((cur) => {
    if (cur) {
      alreadyLogged = true;
      return; // abort, 값 유지
    }
    return true;
  });
  if (alreadyLogged) return { ok: true, logged: false };

  const vSnap = await db.ref('streamerVerifications').orderByChild('uid').equalTo(uid).limitToFirst(1).get();
  const vEntry = vSnap.exists() ? Object.values(vSnap.val())[0] : null;

  await db.ref('verifiedStreamerVisits').push({
    uid,
    nickname,
    soopId: (vEntry && vEntry.soopId) || '',
    market: 'gallery',
    visitedAt: ServerValue.TIMESTAMP,
  });
  return { ok: true, logged: true };
});

module.exports = { logGalleryVisit };
