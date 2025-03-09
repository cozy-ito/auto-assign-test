//* =====================================
//* 리뷰 제출 시 Discord 알림 모듈
//* =====================================
const { sendDiscordMessage } = require("./modules/discord-service.cjs");
const { safeJsonParse } = require("./modules/utils.cjs");
const { getReviews } = require("./modules/github-service.cjs");

module.exports = async ({ github, context, core }) => {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const discordWebhook = process.env.DISCORD_WEBHOOK;

  // Discord 멘션 데이터 파싱
  const discordMentions = safeJsonParse(process.env.DISCORD_MENTION, {});

  try {
    // 현재 리뷰 이벤트 정보 추출
    const { pull_request, review } = context.payload;

    if (!pull_request || !review) {
      console.log("풀 리퀘스트 또는 리뷰 정보 없음");
      return;
    }

    // 리뷰어 정보 추출
    const reviewerLogin = review.user.login;
    const reviewerDiscord = discordMentions[reviewerLogin] || {
      id: reviewerLogin,
      displayName: reviewerLogin,
    };

    // 리뷰 상태에 따른 메시지 생성
    let reviewMessage = "";
    switch (review.state) {
      case "APPROVED":
        reviewMessage = "승인 ✅";
        break;
      case "CHANGES_REQUESTED":
        reviewMessage = "변경 요청 ⚠️";
        break;
      case "COMMENTED":
        reviewMessage = "코멘트 💬";
        break;
      default:
        reviewMessage = "리뷰 상태 알 수 없음 ❓";
    }

    // PR의 모든 리뷰 가져오기
    const reviews = await getReviews(github, owner, repo, pull_request.number);

    // 리뷰 상태 확인
    const reviewStates = new Map();
    reviews.forEach((rev) => {
      const {
        user: { login },
        state,
      } = rev;
      if (login !== pull_request.user.login) {
        reviewStates.set(login, state);
      }
    });

    // 요청된 리뷰어 찾기
    const requestedReviewers =
      pull_request.requested_reviewers?.map((r) => r.login) || [];

    // 아직 리뷰하지 않은 리뷰어 찾기
    const pendingReviewers = requestedReviewers.filter(
      (reviewer) =>
        !reviewStates.has(reviewer) ||
        ["COMMENTED", "DISMISSED"].includes(reviewStates.get(reviewer)),
    );

    // 보류 중인 리뷰어 멘션 생성
    const pendingReviewerMentions = pendingReviewers
      .map((reviewer) => {
        const discordInfo = discordMentions[reviewer] || { id: reviewer };
        return `<@${discordInfo.id}>`;
      })
      .join(" ");

    // 디스코드 메시지 포맷팅
    let message = `[[PR] ${pull_request.title}](<${pull_request.html_url}>)
리뷰어: <@${reviewerDiscord.id}> (${reviewerDiscord.displayName})
리뷰 상태: ${reviewMessage}

리뷰 내용:
\`\`\`
${review.body || "상세 리뷰 내용 없음"}
\`\`\``;

    // 보류 중인 리뷰어가 있다면 멘션 추가
    if (pendingReviewerMentions) {
      message += `\n⏳ 아직 리뷰하지 않은 리뷰어들: ${pendingReviewerMentions}
리뷰를 완료해 주세요! 🔍`;
    }

    // Discord로 메시지 전송
    await sendDiscordMessage(discordWebhook, [message]);
  } catch (error) {
    console.error("리뷰 알림 처리 중 오류 발생:", error.message);
    core.setFailed(`리뷰 알림 처리 실패: ${error.message}`);
  }
};
