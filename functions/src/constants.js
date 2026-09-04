// 관리자 판별 이메일 폴백(자매 저장소들과 동일 — adminCenter/adminUids에 uid가
// 아직 등록 안 됐을 때만 쓰인다).
const ADMIN_EMAIL = 'skftodwocks2@gmail.com';

const AUDIT_LOG_CAP = 200; // "최근 처리 내역" — 이 개수를 넘는 오래된 항목은 매 기록 시 삭제

// XSS 방지 — 닉네임/댓글에 <, >, 제어문자를 넣어 저장형 스크립트 주입을 시도하는 것을
// 서버에서부터 차단(자매 저장소들과 동일 정규식).
const FORBIDDEN_TEXT_RE = /[<>\x00-\x1F\x7F]/;

const COMMENT_MAX_LENGTH = 300;

// 카테고리는 고정 목록 — RTDB .indexOn으로 필터링하기 쉽게 문자열 enum으로 둔다.
const CATEGORIES = ['screenshot', 'ai-art', 'fan-art', 'meme', 'etc'];

module.exports = {
  ADMIN_EMAIL,
  AUDIT_LOG_CAP,
  FORBIDDEN_TEXT_RE,
  COMMENT_MAX_LENGTH,
  CATEGORIES,
};
