//* =====================================
//* 디스코드 리뷰 리마인더
//* =====================================

const { fetchOpenPullRequests } = require("./modules/github-service.cjs");
const { generatePRMessages } = require("./modules/pr-processor.cjs");
const { sendDiscordMessage } = require("./modules/discord-service.cjs");
const { isAfterEndDate, safeJsonParse } = require("./modules/utils.cjs");

module.exports = async ({ github, context }) => {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const discordWebhook = process.env.DISCORD_WEBHOOK;

  // Discord 멘션 데이터 파싱
  const discordMentions = safeJsonParse(process.env.DISCORD_MENTION, {});

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
