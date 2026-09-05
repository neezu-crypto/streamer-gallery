// 관리자 판별 이메일 폴백(자매 저장소들과 동일 — adminCenter/adminUids에 uid가
// 아직 등록 안 됐을 때만 쓰인다).
const ADMIN_EMAIL = 'skftodwocks2@gmail.com';

const AUDIT_LOG_CAP = 200; // "최근 처리 내역" — 이 개수를 넘는 오래된 항목은 매 기록 시 삭제

// XSS 방지 — 닉네임/댓글에 <, >, 제어문자를 넣어 저장형 스크립트 주입을 시도하는 것을
// 서버에서부터 차단(자매 저장소들과 동일 정규식).
const FORBIDDEN_TEXT_RE = /[<>\x00-\x1F\x7F]/;

const COMMENT_MAX_LENGTH = 150; // 댓글 전용(2026-09-05 300->150로 축소)
const REPORT_REASON_MAX_LENGTH = 300; // 신고 사유는 댓글보다 여유 있게 유지
const COMMENT_COOLDOWN_MS = 8000; // 연속 댓글 도배 방지 — 계정당 8초에 한 번만 작성 가능
const IMAGE_REPORTS_CAP = 500; // 신고는 유저당-이미지당 1회로 이미 막혀있지만, 방어적으로 상한도 둔다

// 매크로(자동화 스크립트) 방지 쿨다운(2026-09-06 추가, lib/rate-limit.js assertCooldown과
// 짝) — 좋아요는 정상적인 연속 클릭 UX를 막지 않을 정도로 짧게, 업로드는 이미지 하나씩
// 순차 업로드하는 정상 흐름엔 안 걸릴 정도로 넉넉하게 잡는다.
const LIKE_COOLDOWN_MS = 1500;
const REPORT_COOLDOWN_MS = 5000;
const UPLOAD_COOLDOWN_MS = 15000;

// 댓글 내 링크 금지(2026-09-05 추가) — http(s)://, www., 흔한 TLD로 끝나는
// 문자열을 스팸/피싱 링크로 간주해 차단한다. 완벽하진 않지만(축약 URL 등은
// 못 거를 수 있음) 무작위 도배 링크의 절대다수는 이 패턴에 걸린다.
const LINK_RE = /(https?:\/\/|www\.|\.(com|net|org|co\.kr|kr|io|me|ly|gg|tv|xyz|shop|app)\b)/i;

// 프로필(업로드/좋아요/댓글과 무관한 계정 단위 닉네임/SOOP 아이디) — 둘 다 선택 입력.
// SOOP_ID_RE는 자매 저장소들과 동일 규칙(영문 소문자/숫자 2~20자)이라야 avatarUrlFor
// 공식이 실제 SOOP 프로필 이미지 경로와 맞는다.
const PROFILE_NICKNAME_MAX_LENGTH = 12;
const SOOP_ID_RE = /^[a-z0-9]{2,20}$/;

// 카테고리는 고정 목록 — RTDB .indexOn으로 필터링하기 쉽게 문자열 enum으로 둔다.
const CATEGORIES = ['screenshot', 'selfie', 'ai-art', 'fan-art', 'meme', 'etc'];

// 스트리머별 업로드 잠금(2026-09-05 추가) — 기본적으로 모든 스트리머는 업로드가
// 잠겨있고, 별풍선 100개 후원 인증(관리자 수동 확인)을 거쳐야 해금된다. 후원
// 검증 자체는 soop-stock-market의 "동결 해제(후원)"와 동일하게 완전 수동
// (SOOP API로 실제 후원 내역을 자동 확인하지 않음) — 이 상수는 안내 문구
// 표시용일 뿐, 서버가 실제 후원 여부를 검증하지는 않는다.
const UNLOCK_BALLOON_COST = 100;
const UNLOCK_NICKNAME_MAX_LENGTH = 20;

module.exports = {
  ADMIN_EMAIL,
  AUDIT_LOG_CAP,
  FORBIDDEN_TEXT_RE,
  COMMENT_MAX_LENGTH,
  REPORT_REASON_MAX_LENGTH,
  LINK_RE,
  COMMENT_COOLDOWN_MS,
  IMAGE_REPORTS_CAP,
  LIKE_COOLDOWN_MS,
  REPORT_COOLDOWN_MS,
  UPLOAD_COOLDOWN_MS,
  CATEGORIES,
  PROFILE_NICKNAME_MAX_LENGTH,
  SOOP_ID_RE,
  UNLOCK_BALLOON_COST,
  UNLOCK_NICKNAME_MAX_LENGTH,
};
