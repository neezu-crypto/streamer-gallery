## 이 프로젝트의 위치

`streamer-gallery`는 스트리머·시청자가 방송 화면 스크린샷이나 AI 일러스트를 함께 올리고
좋아요·댓글로 상호작용하는 단일 목적 갤러리 사이트다. StreamBet-Market·soop-stock-market·
streamer-life-game·interior-3d-viewer·rocket-game과 **같은 Firebase 프로젝트
(`soop-stock-market`)와 같은 RTDB(`soop-stock-market-default-rtdb`)를 공유**하지만,
지갑/화폐 시스템이 아예 없다(다른 게임들과 잔액을 주고받지 않음) — 로그인은 신원 확인
+ 신고/차단 대상 식별용일 뿐이다.

이미지 원본은 RTDB가 아니라 **Cloudflare R2**(버킷명 `streamer-gallery`)에 저장한다 —
R2는 egress(다운로드 트래픽) 요금이 없어서 장기 운영 비용을 최소화할 수 있다는 이유로
선택(2026-08-22, 사용자 확정). 업로드는 Cloud Function이 발급한 presigned PUT URL로
클라이언트가 R2에 직접 업로드하는 방식(Functions 대역폭을 거치지 않음). R2 API
크리덴셜(Access Key ID/Secret/Account ID)은 반드시 `firebase functions:secrets:set`으로만
저장하고, 어떤 소스 파일에도 하드코딩하거나 커밋하지 않는다.

## 커밋·푸시

- 커밋을 완료하면 별도로 push 여부를 다시 묻지 않고 바로 `git push`까지 진행한다. 커밋
  자체를 언제 할지는 별개 — 사용자가 명시적으로 요청했을 때만 커밋한다는 원칙은 그대로다.

## 구현 후 검증 필수

- 코드를 구현한 뒤 배포·커밋으로 넘어가기 전에 반드시 검증 단계를 거친다. 필드명·파라미터명·
  상태값을 추측하지 말고 실제로 그 데이터를 쓰는 소스 코드를 재확인한다.
- 이미지 업로드 경로(presigned URL 발급 → R2 직접 업로드 → 메타데이터 등록)는 3단계가
  분리돼 있으므로, 업로드는 성공했는데 메타데이터 등록이 실패하는 "고아 파일" 케이스를
  항상 염두에 두고 설계/검증할 것.

## Firebase Functions 배포 주의사항

- 이 Firebase 프로젝트(soop-stock-market)는 다른 여러 자매 사이트의 Cloud Functions와
  같이 쓰인다. `firebase deploy --only functions`처럼 함수명을 지정하지 않고 전체
  배포하면 로컬 소스에 없는 다른 앱 소유 함수들을 삭제 대상으로 인식할 수 있다 —
  반드시 `firebase deploy --only functions:gallery:<함수명>,...` 형태로 이 저장소의
  `codebase`("gallery")를 포함해 변경/추가한 함수만 지정해서 배포한다.
- 배포 전 `firebase deploy --only functions --project soop-stock-market`을 한번 시도해
  "found in your project but do not exist in your local source code" 목록이 뜨면(실제
  삭제되기 전에 중단됨), 그게 지금 시점에 절대 건드리면 안 되는 다른 앱 소유 함수 목록이다.
- **주의(2026-09-04 실제 발생): `codebase`("gallery")는 firebase-tools가 로컬에서 배포
  단위를 구분하는 개념일 뿐, 실제 GCP Cloud Function 리소스 이름은 codebase로
  네임스페이스되지 않는다 — 프로젝트+리전 전체에서 함수 이름이 유일해야 한다.** 최초 배포
  때 이 저장소의 `whoAmI`가 rocket-game의 `whoAmI`(같은 이름으로 export)를 실제로 덮어쓴
  적 있음(로직이 우연히 동일해서 기능 손상은 없었지만 이름을 `galleryCheckAdmin`으로
  바꿔서 재발을 막음). 새 함수를 추가할 때 이름이 다른 자매 저장소와 겹치지 않는지
  `firebase functions:list --project soop-stock-market`으로 먼저 확인할 것.

## database.rules.json 동기화 필수 (2026-09-04)

- 이 파일은 같은 RTDB(`soop-stock-market-default-rtdb`)를 공유하는 6개 레포
  (StreamBet-Market, soop-stock-market, interior-3d-viewer, streamer-life-game,
  rocket-game, streamer-gallery)가 전부 바이트 단위로 동일한 사본을 갖고 있어야
  한다. 이 중 아무 레포에서나 재배포하면 그 레포 로컬 파일 내용으로 실제 서버 규칙이
  통째로 덮어써지기 때문 — 하나만 고치고 넘어가면 나중에 다른 레포에서 무심코
  재배포했을 때 방금 추가한 변경이 조용히 사라진다.
- **이 파일을 수정할 때마다 나머지 5개 레포의 `database.rules.json`에도 동일한 변경을
  그대로 복사(`cp`)해서 diff 0줄 확인 후 커밋한다.**
