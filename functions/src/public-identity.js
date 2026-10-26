const crypto = require('crypto');

function publicIdFor(uid) {
  return `GAL-${crypto.createHash('sha256').update(`gallery:${uid}`).digest('base64url').slice(0, 14)}`;
}

async function ensurePublicId(db, uid) {
  const id = publicIdFor(uid);
  await db.ref(`privateUserIds/gallery/byUid/${uid}`).set(id);
  await db.ref(`privateUserIds/gallery/byPublicId/${id}`).set(uid);
  return id;
}

function publicImage(image, publicId) {
  const value = Object.assign({}, image, { uploaderPublicId: publicId });
  delete value.uploaderUid;
  // 목록에는 미리보기용 썸네일만 공개한다. 원본 R2 주소와 객체 키는
  // getGalleryImageAccess가 스트리머별 공개 기간 또는 통합 구독 권한을 서버에서
  // 확인한 뒤 5분짜리 서명 URL로 제공한다.
  delete value.imageUrl;
  delete value.key;
  delete value.thumbKey;
  return value;
}

function publicComment(comment, publicId) {
  const value = Object.assign({}, comment, { authorPublicId: publicId });
  delete value.uid;
  return value;
}

module.exports = { publicIdFor, ensurePublicId, publicImage, publicComment };
