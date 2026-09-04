const { onCall } = require('firebase-functions/v2/https');
const { requireAuth, isAdmin } = require('./lib/auth');

// 클라이언트가 관리자 UI 판별을 위해 호출하는 가벼운 전용 함수 — 자매 저장소들과
// 동일한 패턴. adminCenter/adminUids는 .read:false라 클라이언트가 직접 읽을 수
// 없으므로, 판별 결과만 반환한다.
// 함수명을 galleryCheckAdmin으로 둔다(단순 whoAmI가 아님) — Cloud Functions 이름은
// firebase.json의 codebase로 격리되지 않고 프로젝트+리전 전체에서 유일해야 한다
// (2026-09-04 실제 발견: rocket-game도 동일하게 whoAmI를 export하고 있어서, 이 저장소가
// whoAmI로 처음 배포됐을 때 rocket-game의 whoAmI 리소스를 그대로 덮어썼었다 — 다행히
// 로직이 우연히 동일해 기능 손상은 없었지만, 이름이 겹치면 codebase가 달라도 서로
// 덮어쓴다는 뜻이라 반드시 프로젝트 전역에서 유일한 이름을 써야 한다).
const galleryCheckAdmin = onCall(async (request) => {
  const uid = requireAuth(request);
  const email = request.auth.token && request.auth.token.email;
  return { isAdmin: await isAdmin(uid, email) };
});

module.exports = { galleryCheckAdmin };
