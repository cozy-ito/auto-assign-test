module.exports = async ({ github, context, core, ...rest }) => {
  const creator = context.payload.pull_request.user.login;

  // 환경 변수에서 사용자명 읽기
  const { jinSJUser } = JSON.parse(process.env.COLLABORATORS);

  // 모든 사용자명이 제대로 설정되었는지 확인
  if (!jinSJUser) {
    core.setFailed("필요한 환경 변수가 설정되지 않았습니다.");
    return;
  }

  // 리뷰어 매핑 정의
  const reviewerMap = {
    [jinSJUser]: [jinSJUser],
  };

  // 해당 사용자의 리뷰어 배열 가져오기
  const reviewers = reviewerMap[creator];

  // 매핑된 리뷰어가 있으면 리뷰어 요청 및 담당자 지정
  if (reviewers) {
    try {
      // 리뷰어 요청
      // await github.rest.pulls.requestReviewers({
      //   owner: context.repo.owner,
      //   repo: context.repo.repo,
      //   pull_number: context.payload.pull_request.number,
      //   reviewers: reviewers,
      // });

      // 본인을 담당자로 지정
      await github.rest.issues.addAssignees({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.pull_request.number,
        assignees: [creator],
      });

      console.log(
        `리뷰어 ${reviewers.join(", ")}와(과) 담당자 ${creator}가 성공적으로 할당되었습니다.`,
      );
    } catch (error) {
      core.setFailed(`리뷰어 할당 중 오류가 발생했습니다: ${error.message}`);
    }
  } else {
    console.log(`${creator}에 대한 리뷰어 매핑을 찾을 수 없습니다.`);
  }

  //* =====================================
  //* 디스코드 커스텀 메시지 보내기 테스트
  //* =====================================
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const discordMentions = JSON.parse(process.env.DISCORD_MENTION);

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

    console.log(pullRequests);

    //* Draft 상태가 아니면서, 생성한 지 오래된 순으로 정렬
    const targetPRs = pullRequests.data
      .filter((pr) => !pr.draft)
      .sort(
        (a, b) =>
          new Date(a.created_at ?? a.updated_at) -
          new Date(b.created_at ?? b.updated_at),
      );

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

        const reviewStatuses = Array.from(reviewStates.entries()).map(
          ([reviewer, state]) => {
            const discordUsername = discordMentions[reviewer] || `${reviewer}`;
            const stateAbbreviations = {
              APPROVED: "Approved",
              CHANGES_REQUESTED: "Changes Requested",
              COMMENTED: "Commented",
            };

            const reviewState =
              stateAbbreviations[state] || state.toLowerCase();
            return state === "APPROVED"
              ? `${discordUsername}(${reviewState})` // APPROVED인 경우 멘션 없이 이름만 표시
              : `<@${discordUsername}>(${reviewState})`; // 나머지 상태인 경우 멘션
          },
        );

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
          (reviewer) => reviewStates.get(reviewer) === "APPROVED",
        );
        const isNotHasPendingReviews = notStartedReviewers.length === 0;

        // 모든 리뷰어가 APPROVED 상태이고 리뷰를 시작하지 않은 리뷰어가 없는 경우
        if (isAllReviewersApproved && isNotHasPendingReviews) {
          const authorMention =
            discordMentions[pr.user.login] || `${pr.user.login}`;
          return `[[${pr.dLabelName}] ${pr.title}](<${pr.html_url}>)\n리뷰어: ${reviewStatusMessage.join(", ")}\n<@${authorMention}>, 모든 리뷰어의 승인 완료! 코멘트를 확인 후 머지해 주세요 🚀`;
        }

        // 일반적인 리마인드 메시지
        return `[[${pr.dLabelName}] ${pr.title}](<${pr.html_url}>)\n리뷰어: ${reviewStatusMessage.join(", ")}`;
      }),
    );

    // 최종 메시지 Discord에 전송
    const response = await fetch(process.env.DISCORD_WEBHOOK, {
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
