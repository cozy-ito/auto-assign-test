//* =====================================
//* 디스코드 커스텀 메시지 보내기
//* =====================================
module.exports = async ({ github, context }) => {
  // 현재 날짜 확인
  const currentDate = new Date();
  const endDate = new Date("2025-03-21T23:59:59Z"); // 2025년 3월 21일 23:59:59 UTC

  // 현재 날짜가 종료 날짜보다 이후인지 확인
  if (currentDate > endDate) {
    console.log(
      "지정된 종료 날짜(2025년 3월 21일)이 지났습니다. 작업을 수행하지 않습니다.",
    );
    return; // 함수 종료
  }

  const owner = context.repo.owner;
  const repo = context.repo.repo;
  let discordMentions;
  const discordWebhook = process.env.DISCORD_WEBHOOK;

  // Discord 멘션 데이터 파싱 강화
  try {
    discordMentions = JSON.parse(process.env.DISCORD_MENTION || "{}");
  } catch (error) {
    console.error("Discord 멘션 데이터 파싱 실패:", error.message);
    discordMentions = {};
  }

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

  try {
    // 열린 PR 목록 가져오기
    const openPRs = await fetchOpenPullRequests(github, owner, repo);
    if (openPRs.length === 0) return;

    // PR 정보 처리하여 메시지 생성
    const messages = await generatePRMessages(
      github,
      owner,
      repo,
      openPRs,
      discordMentions,
      REVIEW_STATES,
      STATE_ABBREVIATIONS,
    );
    if (messages.length === 0) return;

    // Discord로 메시지 전송
    await sendDiscordMessage(discordWebhook, messages);
  } catch (error) {
    console.error("Error processing PR reminders:", error.message);
    console.error(error.stack);
    throw error; // 워크플로우 실패 상태 반환
  }
};

/**
 * 열린 PR 목록을 가져옵니다.
 * @param {Object} github - GitHub API 클라이언트
 * @param {string} owner - 저장소 소유자
 * @param {string} repo - 저장소 이름
 * @returns {Array} Draft가 아닌 열린 PR 목록
 */
async function fetchOpenPullRequests(github, owner, repo) {
  console.log(`${owner}/${repo} 저장소의 PR 정보를 가져오는 중...`);
  const pullRequests = await github.rest.pulls.list({
    owner,
    repo,
    state: "open",
  });

  console.log(`총 ${pullRequests.data.length}개의 열린 PR 발견`);

  //* Draft 상태가 아니면서, 생성한 지 오래된 순으로 정렬
  const targetPRs = pullRequests.data
    .filter((pr) => !pr.draft)
    .sort(
      (a, b) =>
        new Date(a.created_at ?? a.updated_at) -
        new Date(b.created_at ?? b.updated_at),
    );

  // Draft가 아닌 PR이 없는 경우에 실행 중지
  if (targetPRs.length === 0) {
    console.log("Draft가 아닌 열린 PR이 없습니다. 작업을 수행하지 않습니다.");
    return [];
  }

  console.log(`Draft가 아닌 PR ${targetPRs.length}개 처리 중...`);
  return targetPRs;
}

/**
 * 특정 PR의 리뷰 상태를 가져옵니다.
 * @param {Object} github - GitHub API 클라이언트
 * @param {string} owner - 저장소 소유자
 * @param {string} repo - 저장소 이름
 * @param {number} prNumber - PR 번호
 * @returns {Array} 리뷰 목록
 */
async function getReviews(github, owner, repo, prNumber) {
  const reviews = await github.rest.pulls.listReviews({
    owner,
    repo,
    pull_number: prNumber,
  });
  return reviews.data;
}

/**
 * PR 정보를 처리하여 메시지 배열을 생성합니다.
 * @param {Object} github - GitHub API 클라이언트
 * @param {string} owner - 저장소 소유자
 * @param {string} repo - 저장소 이름
 * @param {Array} pullRequests - PR 목록
 * @param {Object} discordMentions - GitHub 사용자명과 Discord ID 매핑
 * @param {Object} REVIEW_STATES - 리뷰 상태 상수
 * @param {Object} STATE_ABBREVIATIONS - 리뷰 상태 약어 매핑
 * @returns {Array} 메시지 배열
 */
async function generatePRMessages(
  github,
  owner,
  repo,
  pullRequests,
  discordMentions,
  REVIEW_STATES,
  STATE_ABBREVIATIONS,
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
        REVIEW_STATES,
        STATE_ABBREVIATIONS,
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
 * @param {Object} REVIEW_STATES - 리뷰 상태 상수
 * @param {Object} STATE_ABBREVIATIONS - 리뷰 상태 약어 매핑
 * @returns {Object} 리뷰 정보 객체
 */
function analyzeReviewStatuses(
  pr,
  reviews,
  requestedReviewers,
  discordMentions,
  REVIEW_STATES,
  STATE_ABBREVIATIONS,
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

  // 리뷰어별 상태 메시지 생성
  const reviewStatuses = [...reviewStates].map(([reviewer, state]) => {
    const discordUsername = discordMentions[reviewer] || reviewer;
    const reviewState = STATE_ABBREVIATIONS[state] || state.toLowerCase();

    return state === REVIEW_STATES.APPROVED
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

  // 모든 리뷰어가 승인했는지 확인
  const isAllReviewersApproved =
    requestedReviewers.length > 0 &&
    requestedReviewers.every(
      (reviewer) => reviewStates.get(reviewer) === REVIEW_STATES.APPROVED,
    );

  const isNotHasPendingReviews = notStartedReviewers.length === 0;

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
    return `[[PR] ${pr.title}](<${pr.html_url}>)\n리뷰어: ${reviewStatusMessage.join(", ")}\n<@${authorMention}>, 모든 리뷰어의 승인 완료! 코멘트를 확인 후 머지해 주세요 🚀`;
  }

  // 일반적인 리마인드 메시지
  return `[[PR] ${pr.title}](<${pr.html_url}>)\n리뷰어: ${reviewStatusMessage.join(", ")}`;
}

/**
 * Discord로 메시지를 전송합니다.
 * @param {string} webhookUrl - Discord 웹훅 URL
 * @param {Array} messages - 전송할 메시지 배열
 * @returns {Promise<void>}
 */
async function sendDiscordMessage(webhookUrl, messages) {
  console.log(`Discord에 ${messages.length}개의 PR 정보 전송 중...`);

  // 타임아웃 옵션 추가
  const fetchOptions = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `🍀 리뷰가 필요한 PR 목록 🍀\n\n${messages.join("\n\n")}`,
      allowed_mentions: {
        parse: ["users"], // 멘션 가능한 사용자만 허용
      },
    }),
    timeout: 10000, // 10초 타임아웃
  };

  try {
    const response = await fetch(webhookUrl, fetchOptions);

    if (response.ok) {
      console.log(`Discord 메시지 전송 성공! 상태 코드: ${response.status}`);
    } else {
      console.error(`Discord 메시지 전송 실패. 상태 코드: ${response.status}`);
      const responseText = await response.text();
      console.error("응답 내용:", responseText);
    }
  } catch (error) {
    console.error("Discord 메시지 전송 중 오류 발생:", error.message);
    throw error;
  }
}
