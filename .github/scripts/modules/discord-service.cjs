//* =====================================
//* Discord 서비스 모듈
//* =====================================

/**
 * Discord로 메시지를 전송합니다.
 * @param {string} webhookUrl - Discord 웹훅 URL
 * @param {Array} messages - 전송할 메시지 배열
 * @returns {Promise<void>}
 */
async function sendDiscordMessage(webhookUrl, messages) {
  if (!webhookUrl) {
    console.error("Discord 웹훅 URL이 제공되지 않았습니다.");
    throw new Error("Discord 웹훅 URL이 필요합니다.");
  }

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
      throw new Error(`Discord 메시지 전송 실패: ${response.status}`);
    }
  } catch (error) {
    console.error("Discord 메시지 전송 중 오류 발생:", error.message);
    throw error;
  }
}

module.exports = {
  sendDiscordMessage,
};
