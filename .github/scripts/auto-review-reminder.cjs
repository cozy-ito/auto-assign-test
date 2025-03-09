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
  const discordMentions = JSON.parse(process.env.DISCORD_MENTION);
  const discordWebhook = process.env.DISCORD_WEBHOOK;

  //* 특정 PR의 리뷰 상태 가져오기
  async function getReviews(owner, repo, prNumber) {
    const reviews = await github.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });
    return reviews.data;
  }

  try {
    const pullRequests = await github.rest.pulls.list({
      owner,
      repo,
      state: "open",
    });

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
      return; // 함수 종료
    }

    const messages = await Promise.all(
      targetPRs.map(async (pr) => {
        const reviews = await getReviews(owner, repo, pr.number);
        const requestedReviewers = pr.requested_reviewers.map(
          ({ login }) => login,
        );

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

        const reviewStatuses = [...reviewStates].map(([reviewer, state]) => {
          const discordUsername = discordMentions[reviewer] || `${reviewer}`;
          const STATE_ABBREVIATIONS = {
            APPROVED: "Approved",
            CHANGES_REQUESTED: "Changes Requested",
            COMMENTED: "Commented",
          };

          const reviewState = STATE_ABBREVIATIONS[state] || state.toLowerCase();
          return state === STATE_ABBREVIATIONS.APPROVED
            ? `${discordUsername}(${reviewState})` // APPROVED인 경우 멘션 없이 이름만 표시
            : `<@${discordUsername}>(${reviewState})`; // 나머지 상태인 경우 멘션
        });

        // 리뷰를 시작하지 않은 리뷰어 추가
        const notStartedReviewers = requestedReviewers.filter(
          (reviewer) =>
            !reviewStates.has(reviewer) && reviewer !== pr.user.login, // PR 작성자 제외
        );
        const notStartedMentions = notStartedReviewers.map((reviewer) => {
          return `<@${discordMentions[reviewer]}>(X)`;
        });

        const reviewStatusMessage = [...reviewStatuses, ...notStartedMentions];

        const isAllReviewersApproved = requestedReviewers.every(
          (reviewer) =>
            reviewStates.get(reviewer) === STATE_ABBREVIATIONS.APPROVED,
        );
        const isNotHasPendingReviews = notStartedReviewers.length === 0;

        // 모든 리뷰어가 APPROVED 상태이고 리뷰를 시작하지 않은 리뷰어가 없는 경우
        if (isAllReviewersApproved && isNotHasPendingReviews) {
          const authorMention =
            discordMentions[pr.user.login] || `${pr.user.login}`;
          return `[[PR] ${pr.title}](<${pr.html_url}>)\n리뷰어: ${reviewStatusMessage.join(", ")}\n<@${authorMention}>, 모든 리뷰어의 승인 완료! 코멘트를 확인 후 머지해 주세요 🚀`;
        }

        // 일반적인 리마인드 메시지
        return `[[PR] ${pr.title}](<${pr.html_url}>)\n리뷰어: ${reviewStatusMessage.join(", ")}`;
      }),
    );

    // 최종 메시지 Discord에 전송
    const response = await fetch(discordWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `🍀 리뷰가 필요한 PR 목록 🍀\n\n${messages.join("\n\n")}`,
        allowed_mentions: {
          parse: ["users"], // 멘션 가능한 사용자만 허용
        },
      }),
    });

    console.log("Response status:", response.status);
  } catch (error) {
    console.error("Error processing PR reminders:", error.message);
    throw error; // 워크플로우 실패 상태 반환
  }
};
