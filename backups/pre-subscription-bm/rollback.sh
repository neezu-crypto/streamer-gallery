#!/usr/bin/env bash
# 구독제 BM 전환(gallery/unlockedStreamers 영구해금 → streamerFirstUpload+
# streamerUnlockedUntil 30일 구독) 되돌리기용 롤백 스크립트.
#
# 사용법: 이 폴더에서 실행
#   bash rollback.sh
#
# 자동 일괄 실행이 아니라, 되돌리는 각 단계 직전에 사람이 직접 확인(yes 입력)해야
# 다음 단계로 넘어간다 - 실수로 전체가 한 번에 실행되는 걸 방지하기 위한 의도적
# 설계. 특정 단계만 건너뛰려면 그 단계에서 "no"를 입력하면 된다.
#
# 전제: commit-hashes-after.txt가 존재해야 함(구독제 전환 작업이 끝나면서
# 자동으로 기록됨) - 없으면 아직 전환 작업이 안 끝난 것이므로 되돌릴 게 없음.
set -euo pipefail
cd "$(dirname "$0")"

confirm() {
  read -r -p "$1 (yes/no): " ans
  [ "$ans" = "yes" ]
}

if [ ! -f commit-hashes-after.txt ]; then
  echo "commit-hashes-after.txt가 없습니다 - 구독제 전환 작업이 아직 완료되지 않은 것 같습니다. 중단."
  exit 1
fi

PROJECT="soop-stock-market"
GITHUB_ROOT="/Users/jaechanpark/Documents/GitHub"

echo "=== 1. RTDB 데이터 되돌리기 ==="
if confirm "gallery/unlockedStreamers를 백업($(pwd)/unlockedStreamers.json)으로 덮어쓰고, streamerFirstUpload/streamerUnlockedUntil 노드를 삭제할까요?"; then
  firebase database:set /gallery/unlockedStreamers unlockedStreamers.json --project "$PROJECT"
  firebase database:remove /gallery/streamerFirstUpload --project "$PROJECT"
  firebase database:remove /gallery/streamerUnlockedUntil --project "$PROJECT"
else
  echo "1단계 건너뜀"
fi

echo "=== 2. RTDB 규칙 되돌리기 ==="
if confirm "database.rules.json.before를 streamer-gallery에 복사하고 배포할까요?"; then
  cp database.rules.json.before "$GITHUB_ROOT/streamer-gallery/database.rules.json"
  (cd "$GITHUB_ROOT/streamer-gallery" && firebase deploy --only database --project "$PROJECT")
else
  echo "2단계 건너뜀"
fi

echo "=== 3. 코드 되돌리기 (각 레포에서 git revert, 레포별로 개별 확인) ==="
while IFS=': ' read -r repo hash; do
  [ -z "$repo" ] && continue
  if confirm "$repo 레포의 커밋 $hash 를 git revert 할까요?(그 뒤 push까지)"; then
    (cd "$GITHUB_ROOT/$repo" && git revert --no-edit "$hash" && git push)
  else
    echo "$repo 건너뜀"
  fi
done < commit-hashes-after.txt

echo "=== 4. Cloud Functions 이전 버전으로 재배포 ==="
if confirm "registerImage/requestStreamerUnlock/adminApproveStreamerUnlock을 방금 revert된 코드로 재배포할까요?"; then
  (cd "$GITHUB_ROOT/streamer-gallery" && firebase deploy --only functions:gallery:registerImage,functions:gallery:requestStreamerUnlock,functions:gallery:adminApproveStreamerUnlock --project "$PROJECT")
else
  echo "4단계 건너뜀"
fi

echo "=== 완료 ==="
echo "확인: firebase database:get /gallery/unlockedStreamers --project $PROJECT"
