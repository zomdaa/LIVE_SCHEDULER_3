import { requestNotificationAgreement } from '@apps-in-toss/web-framework';

// 콘솔에서 "알림 동의문"을 만들고 "기능성 캠페인"에 연결하면 발급되는 코드.
// 아직 콘솔 설정 전이라 비워둠 - 값이 없으면 동의 요청을 시도하지 않고 에러를 던진다.
const NOTIFICATION_TEMPLATE_CODE = '';

// requestNotificationAgreement는 콜백 스타일 API라 Promise로 감싸서 async/await로 쓸 수 있게 한다.
// 반환되는 cleanup은 반드시 호출해야 리스너가 중복 등록되지 않는다 (문서 명시 사항)
export function requestNotificationConsent() {
  return new Promise((resolve, reject) => {
    if (!NOTIFICATION_TEMPLATE_CODE) {
      reject(new Error('NOTIFICATION_TEMPLATE_CODE가 설정되지 않았어요. 콘솔에서 알림 동의문을 먼저 만들어주세요.'));
      return;
    }
    const cleanup = requestNotificationAgreement({
      options: { templateCode: NOTIFICATION_TEMPLATE_CODE },
      onEvent: ({ type }) => {
        cleanup();
        resolve(type); // 'newAgreement' | 'alreadyAgreed' | 'agreementRejected'
      },
      onError: (error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    });
  });
}
