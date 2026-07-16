import { useEffect, useState } from 'react';
import { fetchAllUpcoming, fetchLikeCounts, parseLabangDate } from '../api.js';
import BroadcastCard from '../components/BroadcastCard.jsx';

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Calendar({ liked }) {
  const [status, setStatus] = useState('loading');
  const [byDate, setByDate] = useState({});
  const [days, setDays] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      const items = await fetchAllUpcoming();
      const now = new Date();
      const cutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const filtered = items
        .map((item) => ({ item, start: parseLabangDate(item.start) }))
        .filter((x) => x.start && x.start >= now && x.start <= cutoff)
        .sort((a, b) => a.start - b.start)
        .map((x) => x.item);

      const grouped = {};
      filtered.forEach((item) => {
        const key = dateKey(parseLabangDate(item.start));
        (grouped[key] = grouped[key] || []).push(item);
      });

      const dayList = [];
      for (let i = 0; i <= 7; i++) {
        dayList.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
      }

      if (cancelled) return;
      setByDate(grouped);
      setDays(dayList);
      const firstWithItems = dayList.find((d) => (grouped[dateKey(d)] || []).length > 0);
      setSelected(dateKey(firstWithItems || dayList[0]));
      setStatus('done');

      const ids = filtered.map((i) => i.id).filter(Boolean);
      const counts = await fetchLikeCounts(ids);
      if (!cancelled) Object.entries(counts).forEach(([id, count]) => liked.setCount(id, count));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === 'loading') {
    return <p style={styles.muted}>불러오는 중...</p>;
  }

  const now = new Date();
  const todayKey = dateKey(now);
  const dowLabels = ['일', '월', '화', '수', '목', '금', '토'];
  const items = byDate[selected] || [];
  const selectedDay = days.find((d) => dateKey(d) === selected);

  return (
    <div>
      <header style={styles.header}>
        <h1 style={styles.title}>📅 캘린더</h1>
        <p style={styles.subtitle}>오늘부터 7일간 예정된 전체 방송이에요</p>
      </header>

      <div style={styles.tabs}>
        {days.map((d) => {
          const key = dateKey(d);
          const count = (byDate[key] || []).length;
          const isActive = key === selected;
          return (
            <button
              key={key}
              type="button"
              style={{ ...styles.tab, ...(isActive ? styles.tabActive : null) }}
              onClick={() => setSelected(key)}
            >
              <span style={styles.tabDow}>{key === todayKey ? '오늘' : dowLabels[d.getDay()]}</span>
              <span style={styles.tabDay}>{d.getDate()}</span>
              <span style={{ ...styles.tabDot, visibility: count ? 'visible' : 'hidden' }} />
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <div style={styles.dayHeader}>
          {dateKey(selectedDay) === todayKey ? '오늘 · ' : ''}
          {selectedDay.getMonth() + 1}월 {selectedDay.getDate()}일 ({dowLabels[selectedDay.getDay()]})
        </div>
      )}

      {items.length === 0 ? (
        <p style={styles.muted}>이 날은 예정된 방송이 없어요</p>
      ) : (
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
      )}
    </div>
  );
}

const styles = {
  header: { marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 800, color: '#202020', margin: 0 },
  subtitle: { fontSize: 13, color: '#202020', fontWeight: 700, marginTop: 4 },
  muted: { fontSize: 14, color: '#8d8d8d', marginTop: 20 },
  tabs: { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 10 },
  tab: {
    flex: '0 0 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    width: 44,
    padding: '8px 0 7px',
    border: '1.5px solid rgba(32,32,32,0.12)',
    borderRadius: 12,
    background: '#fff',
    color: '#202020',
    cursor: 'pointer',
  },
  tabActive: { borderColor: '#ea2804', background: '#ea2804', color: '#fff' },
  tabDow: { fontSize: 11, fontWeight: 700, opacity: 0.75 },
  tabDay: { fontSize: 15, fontWeight: 800 },
  tabDot: { width: 4, height: 4, borderRadius: '50%', background: 'currentColor' },
  dayHeader: {
    fontSize: 18,
    fontWeight: 800,
    color: '#202020',
    margin: '18px 0 12px',
    padding: '2px 4px 2px 10px',
    borderLeft: '4px solid #ea2804',
  },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
};
