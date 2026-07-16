import { useState } from 'react';
import { requestNotificationConsent } from '../notifications.js';

const RESULT_LABEL = {
  newAgreement: '알림 동의 완료! 이제 라이브 알림을 받을 수 있어요.',
  alreadyAgreed: '이미 알림에 동의하셨어요.',
  agreementRejected: '알림 동의를 거부하셨어요. 나중에 다시 시도할 수 있어요.',
};

export default function NotificationOptIn() {
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [message, setMessage] = useState('');

  async function handleClick() {
    setStatus('loading');
    try {
      const result = await requestNotificationConsent();
      setMessage(RESULT_LABEL[result] || result);
      setStatus('done');
    } catch (err) {
      setMessage(err.message);
      setStatus('error');
    }
  }

  return (
    <div style={styles.box}>
      <div style={styles.title}>🔔 라이브 알림</div>
      <p style={styles.desc}>찜한 방송이 시작되기 전에 토스 알림으로 알려드려요.</p>
      <button type="button" style={styles.btn} onClick={handleClick} disabled={status === 'loading'}>
        {status === 'loading' ? '요청 중...' : '알림 받기'}
      </button>
      {message && <p style={{ ...styles.desc, color: status === 'error' ? '#c01f00' : '#2a9d3f' }}>{message}</p>}
    </div>
  );
}

const styles = {
  box: {
    marginTop: 20,
    padding: 16,
    background: '#fff',
    borderRadius: 14,
    border: '1.5px solid #1a1814',
  },
  title: { fontSize: 15, fontWeight: 800, color: '#202020', marginBottom: 4 },
  desc: { fontSize: 13, color: '#8d8d8d', lineHeight: 1.5, marginBottom: 10 },
  btn: {
    padding: '10px 16px',
    borderRadius: 10,
    border: '1.5px solid #1a1814',
    background: '#ea2804',
    color: '#fff',
    fontWeight: 800,
    fontSize: 13,
    cursor: 'pointer',
  },
};
