import { useState } from 'react';
import { fetchAllUpcoming, fetchPastSearch, fetchLikeCounts, parseLabangDate } from '../api.js';
import BroadcastCard from '../components/BroadcastCard.jsx';

const QUICK_KEYWORDS = ['로보락', '하기스', '미닉스', 'DJI'];

export default function Home({ liked }) {
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [upcoming, setUpcoming] = useState([]);
  const [past, setPast] = useState([]);

  async function runSearch(kw) {
    const cleaned = kw.trim();
    if (!cleaned) return;
    setKeyword(cleaned);
    setStatus('loading');

    const [rawUpcoming, rawPast] = await Promise.all([
      fetchAllUpcoming(cleaned),
      fetchPastSearch(cleaned),
    ]);

    const now = new Date();
    const cutoff = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    const stillUpcoming = [];
    const endedFromUpcoming = [];
    rawUpcoming.forEach((item) => {
      const start = parseLabangDate(item.start);
      if (start && start > cutoff) return;
      const end = parseLabangDate(item.end);
      const isEnded = end ? end < now : false;
      (isEnded ? endedFromUpcoming : stillUpcoming).push(item);
    });

    const sortedUpcoming = stillUpcoming.sort((a, b) => {
      const da = parseLabangDate(a.start);
      const db = parseLabangDate(b.start);
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    });
    const sortedPast = [...endedFromUpcoming, ...rawPast].sort((a, b) =>
      String(b.start).localeCompare(String(a.start))
    );

    setUpcoming(sortedUpcoming);
    setPast(sortedPast);
    setStatus('done');

    const ids = [...sortedUpcoming, ...sortedPast].map((i) => i.id).filter(Boolean);
    const counts = await fetchLikeCounts(ids);
    Object.entries(counts).forEach(([id, count]) => liked.setCount(id, count));
  }

  const total = upcoming.length + past.length;

  return (
    <div>
      <header style={styles.header}>
        <h1 style={styles.title}>BUY NOW OR LIVE</h1>
        <p style={styles.subtitle}>지난 라방과 앞으로 있을 라방을 한눈에!</p>
      </header>

      <div style={styles.searchRow}>
        <input
          style={styles.input}
          placeholder="브랜드명 혹은 제품명을 입력해보세요!"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch(keyword)}
        />
        <button type="button" style={styles.searchBtn} onClick={() => runSearch(keyword)}>
          찾기
        </button>
      </div>

      <div style={styles.chips}>
        {QUICK_KEYWORDS.map((kw) => (
          <button key={kw} type="button" style={styles.chip} onClick={() => runSearch(kw)}>
            {kw}
          </button>
        ))}
      </div>

      {status === 'loading' && <p style={styles.muted}>불러오는 중...</p>}
      {status === 'done' && total === 0 && <p style={styles.muted}>검색 결과가 없어요</p>}

      {status === 'done' && upcoming.length > 0 && (
        <Section title="예정 방송" items={upcoming} liked={liked} />
      )}
      {status === 'done' && past.length > 0 && (
        <Section title="지난 방송 · 최근 3개월" items={past} liked={liked} />
      )}
    </div>
  );
}

function Section({ title, items, liked }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={styles.sectionTitle}>{title}</div>
      <div style={styles.list}>
        {items.map((item, idx) => (
          <BroadcastCard
            key={item.id || idx}
            item={item}
            liked={item.id ? liked.isLiked(item.id) : false}
            likeCount={item.id ? liked.counts[item.id] : undefined}
            onToggleLike={() => liked.toggle(item)}
          />
        ))}
      </div>
    </div>
  );
}

const styles = {
  header: { marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 800, color: '#202020', margin: 0 },
  subtitle: { fontSize: 13, color: '#8d8d8d', marginTop: 4 },
  searchRow: { display: 'flex', gap: 8 },
  input: {
    flex: 1,
    padding: '12px 14px',
    borderRadius: 12,
    border: '1.5px solid #1a1814',
    fontSize: 14,
    outline: 'none',
  },
  searchBtn: {
    padding: '0 18px',
    borderRadius: 12,
    border: '1.5px solid #1a1814',
    background: '#ea2804',
    color: '#fff',
    fontWeight: 800,
    fontSize: 14,
    cursor: 'pointer',
  },
  chips: { display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  chip: {
    padding: '6px 12px',
    borderRadius: 9999,
    border: '1px solid rgba(0,0,0,0.15)',
    background: '#fff',
    fontSize: 12,
    fontWeight: 700,
    color: '#575757',
    cursor: 'pointer',
  },
  muted: { fontSize: 14, color: '#8d8d8d', marginTop: 20 },
  sectionTitle: { fontSize: 15, fontWeight: 800, color: '#202020', marginBottom: 10 },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
};
