// 1회성 마이그레이션 — gallery/images/{id}에 같이 있던 likeCount/commentCount를
// gallery/imageStats/{id}로 옮긴다(RTDB 실시간 구독이 좋아요/댓글마다 이미지 목록
// 전체를 재전송하는 문제를 없애기 위한 스키마 분리, 2026-09-06).
//
// 사용법:
//   firebase database:get /gallery/images --project soop-stock-market -o backup.json
//   node scripts/migrate-image-stats.js backup.json
// → imageStats-patch.json / images-cleanup-patch.json 생성. 실제 적용은:
//   firebase database:update /gallery/imageStats -d imageStats-patch.json --project soop-stock-market
//   firebase database:update /gallery/images -d images-cleanup-patch.json --project soop-stock-market
//
// 이미 likeCount/commentCount가 없는 이미지(마이그레이션이 이미 된 것)는 건너뛰므로
// 재실행해도 안전하다.
//
// 주의(2026-09-06 사고로 확인): images-cleanup-patch.json은 반드시 "이미지ID/필드명"
// 형태의 평평한(flat) 키여야 한다. { "이미지ID": { likeCount: null, commentCount: null } }
// 처럼 중첩 객체로 만들면 firebase database:update가 그 경로 전체를 "새 값(=거의 빈
// 객체)"으로 통째로 치환해버려서 해당 이미지의 나머지 필드(imageUrl/streamerName 등)까지
// 전부 날아간다 — 실제로 이 버그로 이미지 5개가 전멸했다가 백업으로 복구한 적 있다.
// 특정 리프 필드만 지우려면 반드시 update() 최상위 키 자체에 슬래시를 포함해야 한다.
const fs = require('fs');
const path = require('path');

const backupPath = process.argv[2];
if (!backupPath) {
  console.error('사용법: node scripts/migrate-image-stats.js <gallery-images-backup.json>');
  process.exit(1);
}

const images = JSON.parse(fs.readFileSync(backupPath, 'utf8')) || {};
const statsPatch = {};
const cleanupPatch = {};
let migrated = 0;

for (const [imageId, img] of Object.entries(images)) {
  if (!img || (!('likeCount' in img) && !('commentCount' in img))) continue;
  statsPatch[imageId] = {
    likeCount: img.likeCount || 0,
    commentCount: img.commentCount || 0,
  };
  cleanupPatch[`${imageId}/likeCount`] = null;
  cleanupPatch[`${imageId}/commentCount`] = null;
  migrated++;
}

const outDir = path.dirname(backupPath);
fs.writeFileSync(path.join(outDir, 'imageStats-patch.json'), JSON.stringify(statsPatch, null, 2));
fs.writeFileSync(path.join(outDir, 'images-cleanup-patch.json'), JSON.stringify(cleanupPatch, null, 2));

console.log(`대상 이미지 ${migrated}개 / 전체 ${Object.keys(images).length}개`);
console.log('생성됨:', path.join(outDir, 'imageStats-patch.json'));
console.log('생성됨:', path.join(outDir, 'images-cleanup-patch.json'));
