const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireTrustedAccount, assertNotBanned } = require('./lib/auth');
const { FORBIDDEN_TEXT_RE, COMMENT_MAX_LENGTH } = require('./constants');

// 좋아요 토글. gallery/likes/{imageId}/{uid}가 "이 uid가 좋아요했다"의 근거이고,
// gallery/userLikes/{uid}/{imageId}는 그 반대 방향 조회(내가 좋아요한 이미지 목록)를
// 한 번의 읽기로 하기 위한 미러다. images/{imageId}/likeCount는 트랜잭션으로 증감시켜
// 동시 클릭에도 카운트가 어긋나지 않게 한다 — 다만 like 플래그 자체는 트랜잭션 밖에서
// 별도로 쓰기 때문에, 극히 짧은 순간 동시 클릭이 겹치면 카운트와 플래그가 잠깐 어긋날
// 수 있다(비금전적 좋아요 수치라 허용 가능한 수준으로 판단, 클라이언트에서 버튼을
// 처리 중 비활성화해 실사용 빈도를 낮춘다).
const toggleLike = onCall(async (request) => {
  const uid = await requireTrustedAccount(request);
  await assertNotBanned(uid);
  const { imageId } = request.data || {};
  if (!imageId || typeof imageId !== 'string') throw new HttpsError('invalid-argument', '잘못된 요청입니다.');

  const db = getDatabase();
  const imageSnap = await db.ref(`gallery/images/${imageId}`).get();
  if (!imageSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 이미지입니다.');

  const likeRef = db.ref(`gallery/likes/${imageId}/${uid}`);
  const alreadyLiked = (await likeRef.get()).exists();
  const delta = alreadyLiked ? -1 : 1;

  const countResult = await db.ref(`gallery/images/${imageId}/likeCount`).transaction((current) => Math.max(0, (current || 0) + delta));
  if (!countResult.committed) throw new HttpsError('aborted', '잠시 후 다시 시도해 주세요.');

  if (alreadyLiked) {
    await Promise.all([likeRef.remove(), db.ref(`gallery/userLikes/${uid}/${imageId}`).remove()]);
  } else {
    await Promise.all([likeRef.set(true), db.ref(`gallery/userLikes/${uid}/${imageId}`).set(true)]);
  }

  return { liked: !alreadyLiked, likeCount: countResult.snapshot.val() };
});

const postComment = onCall(async (request) => {
  const uid = await requireTrustedAccount(request);
  await assertNotBanned(uid);
  const { imageId, text } = request.data || {};
  if (!imageId || typeof imageId !== 'string') throw new HttpsError('invalid-argument', '잘못된 요청입니다.');
  const trimmed = (text || '').trim();
  if (!trimmed) throw new HttpsError('invalid-argument', '댓글 내용을 입력해 주세요.');
  if (trimmed.length > COMMENT_MAX_LENGTH) throw new HttpsError('invalid-argument', `댓글은 ${COMMENT_MAX_LENGTH}자 이하로 입력해 주세요.`);
  if (FORBIDDEN_TEXT_RE.test(trimmed)) throw new HttpsError('invalid-argument', '허용되지 않는 문자가 포함되어 있습니다.');

  const db = getDatabase();
  const imageSnap = await db.ref(`gallery/images/${imageId}`).get();
  if (!imageSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 이미지입니다.');

  const commentRef = db.ref(`gallery/comments/${imageId}`).push();
  await commentRef.set({ uid, text: trimmed, createdAt: Date.now() });
  await db.ref(`gallery/images/${imageId}/commentCount`).transaction((current) => (current || 0) + 1);

  return { commentId: commentRef.key };
});

const reportImage = onCall(async (request) => {
  const uid = await requireTrustedAccount(request);
  await assertNotBanned(uid);
  const { imageId, reason } = request.data || {};
  if (!imageId || typeof imageId !== 'string') throw new HttpsError('invalid-argument', '잘못된 요청입니다.');
  const trimmedReason = (reason || '').trim().slice(0, COMMENT_MAX_LENGTH);
  if (FORBIDDEN_TEXT_RE.test(trimmedReason)) throw new HttpsError('invalid-argument', '허용되지 않는 문자가 포함되어 있습니다.');

  const db = getDatabase();
  const imageSnap = await db.ref(`gallery/images/${imageId}`).get();
  if (!imageSnap.exists()) throw new HttpsError('not-found', '존재하지 않는 이미지입니다.');

  const reportRef = db.ref('gallery/imageReports').push();
  await reportRef.set({ imageId, reporterUid: uid, reason: trimmedReason, createdAt: Date.now() });
  return { reportId: reportRef.key };
});

module.exports = { toggleLike, postComment, reportImage };
