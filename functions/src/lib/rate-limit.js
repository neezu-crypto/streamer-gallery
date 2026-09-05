const { getDatabase } = require('firebase-admin/database');
const { HttpsError } = require('firebase-functions/v2/https');

// 매크로(자동화 스크립트) 방지용 공용 쿨다운(2026-09-06 추가) — 좋아요/신고/업로드에
// 계정당 액션 타입별 최소 간격을 강제한다. 클라이언트의 disabled=true는 버튼 연타만
// 막을 뿐, 스크립트가 Cloud Function을 직접 호출하면 무력하므로 서버에서 다시 막는다.
// gallery/userActionCooldowns/{uid}/{actionKey}에 마지막 실행 시각만 기록하는 서버
// 내부 상태라, 클라이언트가 읽을 필요 없어 RTDB 규칙에 별도 노드를 두지 않았다
// (Admin SDK는 규칙을 우회하므로 기본 deny로도 클라이언트 접근은 이미 막혀있다).
async function assertCooldown(uid, actionKey, cooldownMs) {
  const ref = getDatabase().ref(`gallery/userActionCooldowns/${uid}/${actionKey}`);
  const lastAt = (await ref.get()).val() || 0;
  const now = Date.now();
  if (now - lastAt < cooldownMs) {
    const waitSec = Math.ceil((cooldownMs - (now - lastAt)) / 1000);
    throw new HttpsError('resource-exhausted', `너무 빠르게 반복하고 있어요. ${waitSec}초 후에 다시 시도해 주세요.`);
  }
  await ref.set(now);
}

module.exports = { assertCooldown };
