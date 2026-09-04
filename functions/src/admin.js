const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, isAdmin } = require('./lib/auth');
const { logAudit } = require('./lib/audit');
const { getR2Client, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = require('./r2');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

async function requireAdmin(request) {
  const uid = requireAuth(request);
  const email = request.auth.token && request.auth.token.email;
  if (!(await isAdmin(uid, email))) {
    throw new HttpsError('permission-denied', '관리자만 사용할 수 있습니다.');
  }
  return uid;
}

// 이미지 삭제 — RTDB 메타데이터(이미지 본체·좋아요·댓글·이 이미지 대상 신고들)와
// R2에 올라간 실제 파일을 함께 정리한다. 좋아요 미러(userLikes/{uid}/{imageId})는
// gallery/likes/{imageId} 목록을 먼저 읽어야만 정리 대상 uid를 알 수 있으므로,
// 삭제 순서상 반드시 읽기가 지우기보다 먼저 와야 한다(안 그러면 미러가 고아로 남음).
const adminDeleteImage = onCall({ secrets: [R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY] }, async (request) => {
  const uid = await requireAdmin(request);
  const { imageId } = request.data || {};
  if (!imageId || typeof imageId !== 'string') throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  const db = getDatabase();
  const [imageSnap, likesSnap, reportsSnap] = await Promise.all([
    db.ref(`gallery/images/${imageId}`).get(),
    db.ref(`gallery/likes/${imageId}`).get(),
    db.ref('gallery/imageReports').orderByChild('imageId').equalTo(imageId).get(),
  ]);
  if (!imageSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 이미지입니다.');

  const updates = {};
  updates[`gallery/images/${imageId}`] = null;
  updates[`gallery/likes/${imageId}`] = null;
  updates[`gallery/comments/${imageId}`] = null;
  if (likesSnap.exists()) {
    likesSnap.forEach((child) => { updates[`gallery/userLikes/${child.key}/${imageId}`] = null; });
  }
  if (reportsSnap.exists()) {
    reportsSnap.forEach((child) => { updates[`gallery/imageReports/${child.key}`] = null; });
  }
  await db.ref().update(updates);

  const key = imageSnap.val().key;
  if (key) {
    try {
      await getR2Client().send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    } catch (e) {
      console.error('R2 파일 삭제 실패(메타데이터는 이미 삭제됨):', key, e);
    }
  }

  await logAudit(uid, (request.auth.token && request.auth.token.email) || uid, 'gallery.deleteImage', imageId);
  return { deleted: true };
});

const adminDeleteComment = onCall(async (request) => {
  const uid = await requireAdmin(request);
  const { imageId, commentId } = request.data || {};
  if (!imageId || !commentId) throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  const db = getDatabase();
  const commentRef = db.ref(`gallery/comments/${imageId}/${commentId}`);
  if (!(await commentRef.get()).exists()) throw new HttpsError('not-found', '존재하지 않는 댓글입니다.');

  await commentRef.remove();
  await db.ref(`gallery/images/${imageId}/commentCount`).transaction((current) => Math.max(0, (current || 0) - 1));
  await logAudit(uid, (request.auth.token && request.auth.token.email) || uid, 'gallery.deleteComment', `${imageId}/${commentId}`);
  return { deleted: true };
});

const adminDismissImageReport = onCall(async (request) => {
  const uid = await requireAdmin(request);
  const { reportId } = request.data || {};
  if (!reportId) throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  const db = getDatabase();
  const reportRef = db.ref(`gallery/imageReports/${reportId}`);
  if (!(await reportRef.get()).exists()) throw new HttpsError('not-found', '존재하지 않는 신고입니다.');

  await reportRef.remove();
  await logAudit(uid, (request.auth.token && request.auth.token.email) || uid, 'gallery.dismissReport', reportId);
  return { dismissed: true };
});

// 게임별 정지 관리(2026-09-05 추가, 신규 게임 온보딩 체크리스트) — StreamBet-Market의
// banAccount/unbanAccount와 동일 패턴이지만 이름은 다르게 짓는다. Cloud Functions
// 리소스 이름은 codebase로 네임스페이스되지 않아(2026-09-04 whoAmI 충돌 사고로 확인)
// banAccount/unbanAccount는 이미 StreamBet-Market이 선점 중이라 그대로 쓰면 그 함수를
// 덮어쓴다. bannedAccounts/{uid}/games/gallery에 쓰고, assertNotBanned(lib/auth.js)가
// 이미 이 경로를 읽고 있으므로 별도 검증 로직 변경은 필요 없다.
const banGalleryAccount = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = (request.auth.token && (request.auth.token.name || request.auth.token.email)) || adminUid;
  const { uid, reason } = request.data || {};
  if (!uid) throw new HttpsError('invalid-argument', '대상 uid를 입력해 주세요.');
  if (!reason || !reason.trim()) throw new HttpsError('invalid-argument', '정지 사유를 입력해 주세요.');

  await getDatabase().ref('bannedAccounts/' + uid + '/games/gallery').set({
    reason: reason.trim(),
    bannedAt: Date.now(),
    bannedBy: adminUid,
    bannedByName: adminName,
  });
  await logAudit(adminUid, adminName, '계정 정지', uid + ' · ' + reason.trim());
  return { status: 'banned' };
});

const unbanGalleryAccount = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = (request.auth.token && (request.auth.token.name || request.auth.token.email)) || adminUid;
  const { uid } = request.data || {};
  if (!uid) throw new HttpsError('invalid-argument', '대상 uid를 입력해 주세요.');

  await getDatabase().ref('bannedAccounts/' + uid + '/games/gallery').remove();
  await logAudit(adminUid, adminName, '계정 정지 해제', uid);
  return { status: 'unbanned' };
});

module.exports = { adminDeleteImage, adminDeleteComment, adminDismissImageReport, banGalleryAccount, unbanGalleryAccount };
