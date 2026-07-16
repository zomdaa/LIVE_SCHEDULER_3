import { useEffect, useState } from 'react';

// 기존 buynoworlive.vercel.app 백엔드를 그대로 재사용한다 - 앱인토스 미니앱은
// 별도 도메인(토스 CDN)에서 서빙되므로 상대경로가 아니라 절대 URL로 불러야 한다.
// 모든 api/*.js가 Access-Control-Allow-Origin: * 를 이미 내려주고 있어 CORS는 문제 없다.
const API_BASE = 'https://buynoworlive.vercel.app';
const PLATFORMS = ['naver', 'kakao'];

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

export default function App() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    Promise.all(
      PLATFORMS.map((p) =>
        fetch(`${API_BASE}/api/crawl?platform=${p}`)
          .then((r) => (r.ok ? r.json() : { upcoming: [] }))
          .catch(() => ({ upcoming: [] }))
      )
    )
      .then((results) => {
        const all = results
          .flatMap((r) => r.upcoming || [])
          .filter((it) => it.start)
          .sort((a, b) => a.start.localeCompare(b.start))
          .slice(0, 10);
        setItems(all);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, []);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>BUY NOW OR LIVE</h1>
        <p style={styles.subtitle}>앱인토스 첫 화면 - 기존 백엔드 연동 확인용</p>
      </header>

      {status === 'loading' && <p style={styles.muted}>불러오는 중...</p>}
      {status === 'error' && <p style={styles.muted}>불러오지 못했어요</p>}

      <div style={styles.list}>
        {items.map((item) => (
          <a
            key={item.id}
            href={item.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.card}
          >
            <div style={styles.cardDate}>{fmtDate(item.start)}</div>
            <div style={styles.cardBody}>
              <div style={styles.cardPlatform}>{item.platform}</div>
              <div style={styles.cardTitle}>{item.title}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

const styles = {
  page: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Pretendard", sans-serif',
    background: '#f9f7f3',
    minHeight: '100vh',
    padding: '20px 16px 40px',
    boxSizing: 'border-box',
  },
  header: { marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 800, color: '#202020', margin: 0 },
  subtitle: { fontSize: 13, color: '#8d8d8d', marginTop: 4 },
  muted: { fontSize: 14, color: '#8d8d8d' },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: {
    display: 'flex',
    gap: 12,
    padding: 12,
    background: '#fff',
    borderRadius: 12,
    border: '1.5px solid #1a1814',
    textDecoration: 'none',
    color: 'inherit',
  },
  cardDate: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 800,
    color: '#ea2804',
    minWidth: 74,
  },
  cardBody: { minWidth: 0 },
  cardPlatform: { fontSize: 11, fontWeight: 700, color: '#8d8d8d' },
  cardTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#202020',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};
