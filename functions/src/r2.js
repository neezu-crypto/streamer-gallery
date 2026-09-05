const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getDatabase } = require('firebase-admin/database');
const { randomUUID } = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { requireTrustedAccount, assertNotBanned } = require('./lib/auth');
const { FORBIDDEN_TEXT_RE, CATEGORIES } = require('./constants');

// R2 크리덴셜은 Firebase Secret Manager로만 주입한다 — 소스에 절대 하드코딩하지 않는다.
// `firebase functions:secrets:set R2_ACCESS_KEY_ID --project soop-stock-market` /
// `firebase functions:secrets:set R2_SECRET_ACCESS_KEY --project soop-stock-market`로
// 최초 1회 등록해야 이 함수들을 배포/실행할 수 있다.
const R2_ACCESS_KEY_ID = defineSecret('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = defineSecret('R2_SECRET_ACCESS_KEY');

// 계정 ID·버킷명·공개 URL은 자격증명이 아니라 식별자라 시크릿으로 다루지 않는다
// (다른 자매 저장소들이 storageBucket 등을 firebase-init.js에 평문으로 두는 것과 동일 원칙).
const R2_ACCOUNT_ID = '8fe39a69fb377472a64192f9c1b4666e';
const R2_BUCKET_NAME = 'streamer-gallery';
const R2_PUBLIC_BASE_URL = 'https://pub-aa5574dbd45e4404b18ab8efaae54e67.r2.dev';

const ALLOWED_CONTENT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB — presigned URL에 ContentLength를 서명해 실제 업로드 바이트 수를 강제한다.
const THUMB_MAX_BYTES = 3 * 1024 * 1024; // 클라이언트가 canvas로 리사이즈해 만든 JPEG 썸네일 — 3MB면 충분히 넉넉한 상한.

function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID.value(),
      secretAccessKey: R2_SECRET_ACCESS_KEY.value(),
    },
  });
}

// 1단계: 클라이언트가 R2에 직접 PUT할 수 있는 presigned URL을 발급 (Functions 대역폭을
// 거치지 않음). contentType/fileSize를 여기서 미리 검증하고 서명에 포함시켜, 클라이언트가
// 나중에 실제 PUT 요청에서 다른 타입/크기로 바꿔치기할 수 없게 한다.
// 실제 썸네일(2026-09-05 추가) — 클라이언트가 canvas로 리사이즈한 JPEG 썸네일을
// 원본과 별도 키(images/{imageId}_thumb.jpg)로 같이 올릴 수 있게 URL을 하나 더 발급한다.
// 클라이언트가 리사이즈를 먼저 끝내고 정확한 blob 크기를 알고 나서 이 함수를 불러야
// ContentLength 서명이 실제 업로드 바이트 수와 맞는다(원본과 동일한 원칙).
const requestImageUpload = onCall({ secrets: [R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY] }, async (request) => {
  const uid = await requireTrustedAccount(request);
  await assertNotBanned(uid);

  const { contentType, fileSize, thumbFileSize } = request.data || {};
  const ext = ALLOWED_CONTENT_TYPES[contentType];
  if (!ext) throw new HttpsError('invalid-argument', '지원하지 않는 이미지 형식입니다. (jpg/png/webp/gif만 가능)');
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES) {
    throw new HttpsError('invalid-argument', '이미지 용량은 15MB 이하여야 합니다.');
  }
  if (!Number.isFinite(thumbFileSize) || thumbFileSize <= 0 || thumbFileSize > THUMB_MAX_BYTES) {
    throw new HttpsError('invalid-argument', '썸네일 생성에 실패했습니다. 다른 이미지로 시도해 주세요.');
  }

  const imageId = randomUUID();
  const key = `images/${imageId}.${ext}`;
  const thumbKey = `images/${imageId}_thumb.jpg`;
  const client = getR2Client();
  const uploadUrl = await getSignedUrl(client, new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    ContentLength: fileSize,
  }), { expiresIn: 300 });
  const thumbUploadUrl = await getSignedUrl(client, new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: thumbKey,
    ContentType: 'image/jpeg',
    ContentLength: thumbFileSize,
  }), { expiresIn: 300 });

  return { uploadUrl, thumbUploadUrl, imageId, key, thumbKey };
});

// 2단계: 클라이언트가 R2 업로드 성공 후 호출 — 메타데이터를 RTDB에 기록해야 갤러리에 노출된다.
// (R2 업로드는 성공했는데 이 호출이 실패하면 "고아 파일"이 남는다 — 지금은 재시도 큐 없이
// 클라이언트가 실패 시 알림만 띄우는 수준. 고아 파일 정리는 추후 관리자 도구에서 다룰 것.)
const registerImage = onCall(async (request) => {
  const uid = await requireTrustedAccount(request);
  await assertNotBanned(uid);

  const { imageId, key, thumbKey, streamerId, streamerName, category, width, height } = request.data || {};
  if (!imageId || !key || typeof key !== 'string' || !key.startsWith(`images/${imageId}.`)) {
    throw new HttpsError('invalid-argument', '잘못된 요청입니다.');
  }
  if (!thumbKey || typeof thumbKey !== 'string' || thumbKey !== `images/${imageId}_thumb.jpg`) {
    throw new HttpsError('invalid-argument', '잘못된 요청입니다.');
  }
  if (!CATEGORIES.includes(category)) {
    throw new HttpsError('invalid-argument', '올바르지 않은 카테고리입니다.');
  }
  const name = (streamerName || '').trim().slice(0, 20);
  if (!name || FORBIDDEN_TEXT_RE.test(name)) {
    throw new HttpsError('invalid-argument', '스트리머 이름을 확인해 주세요.');
  }
  if (!streamerId || typeof streamerId !== 'string') {
    throw new HttpsError('invalid-argument', '스트리머를 목록에서 선택해 주세요.');
  }

  const db = getDatabase();
  // 스트리머별 업로드 잠금은 2026-09-06부로 폐지 — 이제 로그인(신뢰 계정)한
  // 누구나 잠긴 스트리머 이미지도 올릴 수 있다. 다만 그 이미지의 상세보기는
  // 여전히 해금 전까지 막혀있다(js/gallery-detail.js의 잠금 체크는 그대로 유지).

  const existing = await db.ref(`gallery/images/${imageId}`).get();
  if (existing.exists()) throw new HttpsError('already-exists', '이미 등록된 이미지입니다.');

  const imageUrl = `${R2_PUBLIC_BASE_URL}/${key}`;
  const thumbUrl = `${R2_PUBLIC_BASE_URL}/${thumbKey}`;
  // width/height는 매소너리 그리드가 이미지 로드를 기다리지 않고 비율대로 배치하는
  // 용도일 뿐 보안과 무관 — 값이 이상하면 그냥 저장 안 하고 클라이언트가 기본 비율로
  // 대체하게 둔다(치명적 오류로 취급하지 않음).
  const hasValidDimensions = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
  await db.ref(`gallery/images/${imageId}`).set({
    streamerId,
    streamerName: name,
    category,
    imageUrl,
    thumbUrl,
    key,
    thumbKey,
    ...(hasValidDimensions ? { width, height } : {}),
    uploaderUid: uid,
    createdAt: Date.now(),
    likeCount: 0,
    commentCount: 0,
  });

  return { imageId, imageUrl, thumbUrl };
});

module.exports = { requestImageUpload, registerImage, getR2Client, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY };
