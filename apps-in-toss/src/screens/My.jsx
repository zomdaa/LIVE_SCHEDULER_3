import { useEffect, useState } from 'react';
import { fetchLikeMeta, parseLabangDate } from '../api.js';
import BroadcastCard from '../components/BroadcastCard.jsx';

export default function My({ liked }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = [...liked.likedIds];
      if (!ids.length) {
        setStatus('empty');
        return;
      }
      const meta = await fetchLikeMeta(ids);
      const now = new Date();
      const list = ids
        .map((id) => meta[id])
        .filter(Boolean)
        .filter((item) => {
          const start = parseLabangDate(item.start);
          const end = parseLabangDate(item.end) || (start ? new Date(start.getTime() + 2 * 60 * 60 * 1000) : null);
          return !end || end >= now;
        });
      if (cancelled) return;
      setItems(list);
      setStatus(list.length ? 'done' : 'empty');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liked.likedIds]);

  return (
    <div className="content-wrap">
      <header style={styles.header}>
        <h1 style={styles.title}>🙋 MY</h1>
        <p style={styles.subtitle}>찜한 방송을 모아봐요</p>
      </header>

      {status === 'loading' && <p style={styles.muted}>불러오는 중...</p>}
      {status === 'empty' && <p style={styles.muted}>찜한 방송이 없어요</p>}

      {status === 'done' && (
        <div style={styles.list}>
          {items.map((item) => (
            <BroadcastCard
              key={item.id}
              item={item}
              liked
              likeCount={liked.counts[item.id]}
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
  subtitle: { fontSize: 13, color: '#8d8d8d', marginTop: 4 },
  muted: { fontSize: 14, color: '#8d8d8d', marginTop: 20 },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
};
