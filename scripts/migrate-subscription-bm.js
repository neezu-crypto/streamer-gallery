#!/usr/bin/env node
// 구독제 BM 전환 1회성 마이그레이션 (영구 해금 → 30일 구독).
//
// 1) gallery/images 전체를 스캔해 streamerId별 최초 createdAt을
//    gallery/streamerFirstUpload/{streamerId}에 백필.
// 2) 기존 gallery/unlockedStreamers(영구 해금 기록)는 새 규칙과 무관하게
//    예외 없이 통일(사용자 확정 결정 - 과거 결제 이력 상관없이 streamerFirstUpload
//    기준으로만 재평가) - 마이그레이션 후 이 노드는 삭제.
//
// 재실행해도 안전: 이미 streamerFirstUpload가 있는 스트리머는 항상 "더 이른"
// createdAt으로만 갱신(멱등적). 실행 전 backups/pre-subscription-bm/에 이미
// images.json/unlockedStreamers.json 백업이 있으므로 별도 백업 없이 바로 진행.
//
//   node scripts/migrate-subscription-bm.js
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT = 'soop-stock-market';

console.log('gallery/images 읽는 중...');
const raw = execSync(`firebase database:get /gallery/images --project ${PROJECT}`, {
  maxBuffer: 1024 * 1024 * 50
}).toString();
const images = JSON.parse(raw) || {};

const firstUploadByStreamer = {};
Object.values(images).forEach((img) => {
  if (!img || !img.streamerId || !Number.isFinite(img.createdAt)) return;
  const cur = firstUploadByStreamer[img.streamerId];
  if (cur === undefined || img.createdAt < cur) {
    firstUploadByStreamer[img.streamerId] = img.createdAt;
  }
});

const streamerCount = Object.keys(firstUploadByStreamer).length;
if (!streamerCount) {
  console.error('streamerFirstUpload로 백필할 항목이 없음(gallery/images가 비어있거나 형식이 다름) - 중단.');
  process.exit(1);
}
console.log(streamerCount + '명의 스트리머 최초 업로드 시각을 백필합니다...');

const patchFile = path.join(os.tmpdir(), 'streamer-first-upload-patch.json');
fs.writeFileSync(patchFile, JSON.stringify(firstUploadByStreamer));
execSync(`firebase database:update /gallery/streamerFirstUpload ${patchFile} --project ${PROJECT} -f`, { stdio: 'inherit' });
fs.unlinkSync(patchFile);

console.log('gallery/unlockedStreamers(영구 해금 기록) 삭제 중 - 새 구독제 규칙으로 통일(사용자 확정 결정)...');
execSync(`firebase database:remove /gallery/unlockedStreamers --project ${PROJECT} -f`, { stdio: 'inherit' });

console.log('완료: streamerFirstUpload ' + streamerCount + '명 백필, unlockedStreamers 삭제됨.');
