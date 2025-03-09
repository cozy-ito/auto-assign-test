module.exports = async ({ github, context, core }) => {
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
};

/**
 * 객체의 각 속성에 대해 다른 속성들의 값 중 지정된 개수만큼 랜덤하게 선택하여 배열로 반환합니다.
 * @param {Object} obj - 입력 객체
 * @param {number} count - 각 속성에 할당할 랜덤 값의 개수
 * @returns {Object} 각 속성에 랜덤 값 배열이 할당된 새 객체
 */
function getRandomValuesForProperties(obj, count) {
  // 유효성 검사
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("첫 번째 인자는 객체여야 합니다.");
  }

  if (count <= 0) {
    throw new Error("count는 양수여야 합니다.");
  }

  const result = {};
  const entries = Object.entries(obj);

  // 객체의 각 속성에 대해 처리
  for (const [key, value] of entries) {
    // 현재 속성을 제외한 다른 속성들의 값 목록
    const otherValues = entries.filter(([k]) => k !== key).map(([, v]) => v);

    // 요청한 count가 가능한 최대값을 초과하면 조정
    const actualCount = Math.min(count, otherValues.length);

    // 랜덤하게 값 선택
    const selectedValues = getRandomUniqueValues(otherValues, actualCount);

    // 결과 객체에 할당
    result[key] = selectedValues;
  }

  return result;
}

/**
 * 배열에서 중복 없이 지정된 개수만큼 랜덤하게 요소를 선택합니다.
 * @param {Array} array - 선택할 요소가 있는 배열
 * @param {number} count - 선택할 요소 개수
 * @returns {Array} 선택된 요소들의 배열
 */
function getRandomUniqueValues(array, count) {
  // 배열 복사
  const arrayCopy = [...array];
  const result = [];

  // 요소를 랜덤하게 선택
  for (let i = 0; i < count; i++) {
    const randomIndex = Math.floor(Math.random() * arrayCopy.length);
    result.push(arrayCopy[randomIndex]);
    // 선택된 요소는 제거하여 중복 방지
    arrayCopy.splice(randomIndex, 1);
  }

  return result;
}
