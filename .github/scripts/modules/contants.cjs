//* =====================================
//* 상수 정의 모듈
//* =====================================

// 리뷰 상태 상수 정의
const REVIEW_STATES = {
  APPROVED: "APPROVED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  COMMENTED: "COMMENTED",
};

// 리뷰 상태 약어 매핑을 상수로 정의
const STATE_ABBREVIATIONS = {
  [REVIEW_STATES.APPROVED]: "Approved",
  [REVIEW_STATES.CHANGES_REQUESTED]: "Changes Requested",
  [REVIEW_STATES.COMMENTED]: "Commented",
};

module.exports = {
  REVIEW_STATES,
  STATE_ABBREVIATIONS,
};
