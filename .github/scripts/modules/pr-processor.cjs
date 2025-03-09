//* =====================================
//* PR 처리 모듈
//* =====================================

const { getReviews } = require("./github-service.cjs");
const {
  GITHUB_REVIEW_STATES,
  STATE_ABBREVIATIONS,
} = require("./constants.cjs");

/**
 * PR 정보를 처리하여 메시지 배열을 생성합니다.
 * @param {Object} github - GitHub API 클라이언트
 * @param {string} owner - 저장소 소유자
 * @param {string} repo - 저장소 이름
 * @param {Array} pullRequests - PR 목록
 * @param {Object} discordMentions - GitHub 사용자명과 Discord ID 매핑
 * @returns {Array} 메시지 배열
 */
async function generatePRMessages(
  github,
  owner,
  repo,
  pullRequests,
  discordMentions,
) {
  return await Promise.all(
    pullRequests.map(async (pr) => {
      console.log(`PR #${pr.number} "${pr.title}" 처리 중`);
      const reviews = await getReviews(github, owner, repo, pr.number);
      const requestedReviewers = pr.requested_reviewers.map(
        ({ login }) => login,
      );

      // PR 리뷰 상태 분석
      const reviewInfo = analyzeReviewStatuses(
        pr,
        reviews,
        requestedReviewers,
        discordMentions,
      );

      // 메시지 생성
      return generatePRMessage(pr, reviewInfo, discordMentions);
    }),
  );
}

/**
 * PR의 리뷰 상태를 분석합니다.
 * @param {Object} pr - PR 객체
 * @param {Array} reviews - 리뷰 목록
 * @param {Array} requestedReviewers - 요청된 리뷰어 목록
 * @param {Object} discordMentions - GitHub 사용자명과 Discord ID 매핑
 * @returns {Object} 리뷰 정보 객체
 */
function analyzeReviewStatuses(
  pr,
  reviews,
  requestedReviewers,
  discordMentions,
) {
  // 리뷰 상태를 관리하는 Map 객체 생성
  const reviewStates = new Map();
  reviews.forEach((review) => {
    const reviewer = review.user.login;
    const state = review.state;
    if (reviewer !== pr.user.login) {
      // PR 작성자는 제외
      reviewStates.set(reviewer, state);
    }
  });

  // 디버깅용 로그
  console.log(`PR #${pr.number} 리뷰 상태:`, Object.fromEntries(reviewStates));

  // 리뷰어별 상태 메시지 생성
  const reviewStatuses = [...reviewStates].map(([reviewer, state]) => {
    const discordUsername = discordMentions[reviewer] || reviewer;
    const reviewState = STATE_ABBREVIATIONS[state] || state.toLowerCase();

    // 중요: GitHub API 리뷰 상태를 직접 비교 (APPROVED)
    return state === GITHUB_REVIEW_STATES.APPROVED
      ? `${discordUsername}(${reviewState})` // APPROVED인 경우 멘션 없이 이름만 표시
      : `<@${discordUsername}>(${reviewState})`; // 나머지 상태인 경우 멘션
  });

  // 리뷰를 시작하지 않은 리뷰어 추가
  const notStartedReviewers = requestedReviewers.filter(
    (reviewer) => !reviewStates.has(reviewer) && reviewer !== pr.user.login, // PR 작성자 제외
  );

  const notStartedMentions = notStartedReviewers.map((reviewer) => {
    const discordUsername = discordMentions[reviewer] || reviewer;
    return `<@${discordUsername}>(X)`;
  });

  const reviewStatusMessage = [...reviewStatuses, ...notStartedMentions];

  // 모든 리뷰어가 승인했는지 확인 (중요: GITHUB_REVIEW_STATES.APPROVED 사용)
  const isAllReviewersApproved =
    requestedReviewers.length > 0 &&
    requestedReviewers.every(
      (reviewer) =>
        reviewStates.get(reviewer) === GITHUB_REVIEW_STATES.APPROVED,
    );

  const isNotHasPendingReviews = notStartedReviewers.length === 0;

  // 디버깅용 로그
  console.log(`PR #${pr.number} 승인 상태:`, {
    requestedReviewers,
    isAllReviewersApproved,
    isNotHasPendingReviews,
  });

  return {
    reviewStatusMessage,
    isAllReviewersApproved,
    isNotHasPendingReviews,
  };
}

/**
 * PR 정보와 리뷰 상태를 기반으로 메시지를 생성합니다.
 * @param {Object} pr - PR 객체
 * @param {Object} reviewInfo - 리뷰 정보 객체
 * @param {Object} discordMentions - GitHub 사용자명과 Discord ID 매핑
 * @returns {string} 메시지
 */
function generatePRMessage(pr, reviewInfo, discordMentions) {
  const {
    reviewStatusMessage,
    isAllReviewersApproved,
    isNotHasPendingReviews,
  } = reviewInfo;

  // 모든 리뷰어가 APPROVED 상태이고 리뷰를 시작하지 않은 리뷰어가 없는 경우
  if (isAllReviewersApproved && isNotHasPendingReviews) {
    const authorMention = discordMentions[pr.user.login] || pr.user.login;
    console.log(`PR #${pr.number}: 모든 리뷰 승인 완료 메시지 생성`);
    return `[[PR] ${pr.title}](<${pr.html_url}>)\n리뷰어: ${reviewStatusMessage.join(", ")}\n<@${authorMention}>, 모든 리뷰어의 승인 완료! 코멘트를 확인 후 머지해 주세요 🚀`;
  }

  // 일반적인 리마인드 메시지
  return `[[PR] ${pr.title}](<${pr.html_url}>)\n리뷰어: ${reviewStatusMessage.join(", ")}`;
}

module.exports = {
  generatePRMessages,
  analyzeReviewStatuses,
  generatePRMessage,
};
