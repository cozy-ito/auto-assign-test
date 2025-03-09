//* =====================================
//* PR 알림 스크립트
//* =====================================
const { generatePRMessages } = require("./modules/pr-processor.cjs");
const { sendDiscordMessage } = require("./modules/discord-service.cjs");
const { safeJsonParse } = require("./modules/utils.cjs");

module.exports = async ({ github, context, core }) => {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const discordWebhook = process.env.DISCORD_WEBHOOK;

  // Discord 멘션 데이터 파싱
  const discordMentions = safeJsonParse(process.env.DISCORD_MENTION, {});

  try {
    // PR 이벤트 타입 확인
    const eventType = context.eventName;
    const action = context.payload.action;

    // 현재 PR 정보 가져오기
    const pullRequest = context.payload.pull_request;

    if (!pullRequest) {
      console.log("처리할 PR 정보 없음");
      return;
    }

    // PR 메시지 생성
    const messages = await generatePRMessages(
      github,
      owner,
      repo,
      [pullRequest],
      discordMentions,
    );

    // 메시지가 없으면 종료
    if (messages.length === 0) {
      console.log("생성된 메시지가 없습니다.");
      return;
    }

    // Discord로 메시지 전송
    await sendDiscordMessage(discordWebhook, messages, {
      headerText: `🔔 PR 알림 (${action}) 🔔`,
    });
  } catch (error) {
    console.error("PR 리마인더 처리 중 오류 발생:", error.message);
    core.setFailed(`PR 리마인더 처리 실패: ${error.message}`);
  }
};
