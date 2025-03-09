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
  // 브랜치 보호 규칙 확인
  let protectionRules = {
    requiresApproval: false,
    requiredApprovingReviewCount: 0,
  };
  try {
    // 기본 브랜치 이름 가져오기
    const repoInfo = await github.rest.repos.get({ owner, repo });
    const defaultBranch = repoInfo.data.default_branch;

    // 보호 규칙 가져오기
    protectionRules = await getBranchProtectionRules(
      github,
      owner,
      repo,
      defaultBranch,
    );
    console.log(`${owner}/${repo} 레포지토리 보호 규칙:`, protectionRules);
  } catch (error) {
    console.warn(`보호 규칙 정보 가져오기 실패:`, error.message);
  }

  // 레포지토리 협력자 목록 가져오기
  let hasCollaborators = false;
  try {
    const collaborators = await github.rest.repos.listCollaborators({
      owner,
      repo,
      per_page: 1,
    });
    hasCollaborators = collaborators.data.length > 0;
    console.log(`${owner}/${repo} 레포지토리 협력자 여부:`, hasCollaborators);
  } catch (error) {
    console.warn(`협력자 정보 가져오기 실패:`, error.message);
    hasCollaborators = true;
  }

  return await Promise.all(
    pullRequests.map(async (pr) => {
      console.log(`PR #${pr.number} "${pr.title}" 처리 중`);
      const reviews = await getReviews(github, owner, repo, pr.number);
      const requestedReviewers =
        pr.requested_reviewers?.map(({ login }) => login) || [];

      // PR 리뷰 상태 분석 - 보호 규칙 정보 추가 전달
      const reviewInfo = analyzeReviewStatuses(
        pr,
        reviews,
        requestedReviewers,
        discordMentions,
        hasCollaborators,
        protectionRules,
      );

      // 메시지 생성
      return generatePRMessage(
        pr,
        reviewInfo,
        discordMentions,
        hasCollaborators,
        protectionRules,
      );
    }),
  );
}

/**
 * 레포지토리의 브랜치 보호 규칙을 확인하여 PR 승인이 필요한지 확인합니다.
 * @param {Object} github - GitHub API 클라이언트
 * @param {string} owner - 저장소 소유자
 * @param {string} repo - 저장소 이름
 * @param {string} branch - 브랜치 이름 (일반적으로 'main' 또는 'master')
 * @returns {Object} 보호 규칙 정보 객체 { requiresApproval, requiredApprovingReviewCount }
 */
async function getBranchProtectionRules(github, owner, repo, branch = "main") {
  try {
    // 브랜치 보호 규칙 가져오기
    const response = await github.rest.repos.getBranchProtection({
      owner,
      repo,
      branch,
    });

    // 보호 규칙이 있는 경우
    if (response.data && response.data.required_pull_request_reviews) {
      const rules = response.data.required_pull_request_reviews;

      // 필요한 승인 수 확인
      const requiredApprovingReviewCount =
        rules.required_approving_review_count || 0;

      return {
        requiresApproval: requiredApprovingReviewCount > 0,
        requiredApprovingReviewCount,
        dismissStaleReviews: rules.dismiss_stale_reviews || false,
        requireCodeOwnerReviews: rules.require_code_owner_reviews || false,
        restrictDismissals: rules.restrict_dismissals || false,
      };
    } else {
      // 보호 규칙이 없는 경우
      return {
        requiresApproval: false,
        requiredApprovingReviewCount: 0,
        dismissStaleReviews: false,
        requireCodeOwnerReviews: false,
        restrictDismissals: false,
      };
    }
  } catch (error) {
    // 오류 발생 시 (보호 규칙이 없는 경우나 접근 권한 문제 등)
    console.warn(`브랜치 보호 규칙 확인 중 오류 발생:`, error.message);

    return {
      requiresApproval: false,
      requiredApprovingReviewCount: 0,
      dismissStaleReviews: false,
      requireCodeOwnerReviews: false,
      restrictDismissals: false,
    };
  }
}

/**
 * PR의 리뷰 상태를 분석합니다.
 * @param {Object} pr - PR 객체
 * @param {Array} reviews - 리뷰 목록
 * @param {Array} requestedReviewers - 요청된 리뷰어 목록
 * @param {Object} discordMentions - GitHub 사용자명과 Discord ID 매핑
 * @param {boolean} hasCollaborators - 레포지토리에 협력자가 있는지 여부
 * @returns {Object} 리뷰 정보 객체
 */
function analyzeReviewStatuses(
  pr,
  reviews,
  requestedReviewers,
  discordMentions,
  hasCollaborators,
  protectionRules,
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
  console.log(`PR #${pr.number} 요청된 리뷰어:`, requestedReviewers);

  // 리뷰어별 상태 메시지 생성
  const reviewStatuses = [...reviewStates].map(([reviewer, state]) => {
    const discordInfo = discordMentions[reviewer] || {
      id: reviewer,
      displayName: reviewer,
    };
    const discordId =
      typeof discordInfo === "object" ? discordInfo.id : discordInfo;
    const displayName =
      typeof discordInfo === "object" ? discordInfo.displayName : reviewer;
    const reviewState = STATE_ABBREVIATIONS[state] || state.toLowerCase();

    // 중요: GitHub API 리뷰 상태를 직접 비교 (APPROVED)
    return state === GITHUB_REVIEW_STATES.APPROVED
      ? `${displayName}(${reviewState})` // APPROVED인 경우 표시 이름 사용
      : `<@${discordId}>(${reviewState})`; // 나머지 상태인 경우 멘션
  });

  // 리뷰를 시작하지 않은 리뷰어 추가
  const notStartedReviewers = requestedReviewers.filter(
    (reviewer) => !reviewStates.has(reviewer) && reviewer !== pr.user.login, // PR 작성자 제외
  );

  const notStartedMentions = notStartedReviewers.map((reviewer) => {
    const discordInfo = discordMentions[reviewer] || {
      id: reviewer,
      displayName: reviewer,
    };
    const displayName =
      typeof discordInfo === "object" ? discordInfo.displayName : reviewer;
    return `<@${displayName}>(X)`;
  });

  const reviewStatusMessage = [...reviewStatuses, ...notStartedMentions];

  // 할당된 리뷰어가 없는 경우
  const hasNoRequestedReviewers = requestedReviewers.length === 0;

  // 승인된 리뷰 수 계산
  const approvedReviewCount = [...reviewStates.values()].filter(
    (state) => state === GITHUB_REVIEW_STATES.APPROVED,
  ).length;

  // 보호 규칙과 협력자 유무에 따라 승인 완료 상태 결정
  const isApprovalComplete =
    !hasCollaborators || // 협력자가 없으면 무조건 승인 완료
    !protectionRules.requiresApproval || // 보호 규칙에서 승인이 필요하지 않으면 완료
    approvedReviewCount >= protectionRules.requiredApprovingReviewCount; // 필요한 승인 수 충족

  // 모든 리뷰어가 승인했는지 확인
  const isAllReviewersApproved =
    hasNoRequestedReviewers || // 리뷰어가 없으면 true
    requestedReviewers.every(
      (reviewer) =>
        reviewStates.get(reviewer) === GITHUB_REVIEW_STATES.APPROVED,
    );

  // 보류 중인 리뷰가 없는지 확인
  const isNotHasPendingReviews = notStartedReviewers.length === 0;

  // 디버깅용 로그
  console.log(`PR #${pr.number} 승인 상태:`, {
    hasCollaborators,
    hasNoRequestedReviewers,
    approvedReviewCount,
    isApprovalComplete,
    isAllReviewersApproved,
    isNotHasPendingReviews,
  });

  return {
    reviewStatusMessage,
    isAllReviewersApproved,
    isNotHasPendingReviews,
    hasNoRequestedReviewers,
    approvedReviewCount,
    isApprovalComplete,
    approvedReviewCount,
    isApprovalComplete,
    requiredApprovingReviewCount: protectionRules.requiredApprovingReviewCount,
  };
}

/**
 * PR 정보와 리뷰 상태를 기반으로 메시지를 생성합니다.
 * @param {Object} pr - PR 객체
 * @param {Object} reviewInfo - 리뷰 정보 객체
 * @param {Object} discordMentions - GitHub 사용자명과 Discord ID 매핑
 * @param {boolean} hasCollaborators - 레포지토리에 협력자가 있는지 여부
 * @returns {string} 메시지
 */
function generatePRMessage(pr, reviewInfo, discordMentions, hasCollaborators) {
  const {
    reviewStatusMessage,
    isAllReviewersApproved,
    isNotHasPendingReviews,
    hasNoRequestedReviewers,
    approvedReviewCount,
    isApprovalComplete,
  } = reviewInfo;

  // PR 작성자 언급을 위한 Discord ID
  const authorMention = discordMentions[pr.user.login] || pr.user.login;

  // 머지 가능 여부 확인
  const canMerge = isApprovalComplete && isNotHasPendingReviews;

  // 디버깅을 위해 현재 상태 로깅
  console.log(`PR #${pr.number} 상태:`, {
    canMerge,
    hasNoRequestedReviewers,
    approvedReviewCount,
    reviewStatusMessage: reviewStatusMessage.length,
  });

  if (canMerge) {
    // 머지 가능한 경우의 메시지 생성
    let approvalMessage;

    if (!hasCollaborators) {
      // 협력자가 없는 경우
      approvalMessage =
        "모든 리뷰어의 승인 완료! 코멘트를 확인 후 머지해 주세요 🚀";
    } else if (approvedReviewCount > 0) {
      // 승인을 받은 경우 (이 조건을 먼저 확인)
      if (isAllReviewersApproved) {
        approvalMessage =
          "모든 리뷰어의 승인 완료! 코멘트를 확인 후 머지해 주세요 🚀";
      } else {
        approvalMessage =
          "필요한 승인 수를 만족했습니다! 코멘트를 확인 후 머지해 주세요 🚀";
      }
    } else if (hasNoRequestedReviewers) {
      // 리뷰어가 없는 경우 (승인 확인 후 검사)
      approvalMessage =
        "할당된 리뷰어가 없지만, 머지 규칙에 따라 적어도 하나의 승인이 필요합니다.";
    } else {
      // 그 외의 경우는 기본 메시지
      approvalMessage = "머지 준비가 완료되었습니다.";
    }

    console.log(`PR #${pr.number}: ${approvalMessage}`);

    // 리뷰어 목록 포함 여부 결정
    // 협력자가 있고 리뷰어가 있을 때만 리뷰어 목록 표시
    const showReviewers = hasCollaborators && reviewStatusMessage.length > 0;
    const reviewerListMessage = showReviewers
      ? `리뷰어: ${reviewStatusMessage.join(", ")}\n`
      : "";

    return `[[PR] ${pr.title}](<${pr.html_url}>)\n${reviewerListMessage}<@${authorMention}>, ${approvalMessage}`;
  }

  // 머지 불가능한 일반 메시지
  const showReviewers = reviewStatusMessage.length > 0;
  return `[[PR] ${pr.title}](<${pr.html_url}>)\n${showReviewers ? `리뷰어: ${reviewStatusMessage.join(", ")}` : "리뷰어가 없습니다."}`;
}

module.exports = {
  generatePRMessages,
  analyzeReviewStatuses,
  generatePRMessage,
};
