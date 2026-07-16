import { parseLabangDate, fmtDate, dDayLabel } from '../api.js';
import LikeButton from './LikeButton.jsx';

const URGENCY_COLORS = {
  live: '#ff3d2e',
  d1: '#ff5722',
  d3: '#ff8a3d',
  d7: '#ffaf5e',
  far: '#ffd29c',
  ended: '#a89a5f',
};

function urgencyColor(item) {
  const label = dDayLabel(item);
  if (label === '● LIVE') return URGENCY_COLORS.live;
  if (label === '종료') return URGENCY_COLORS.ended;
  const d = parseLabangDate(item.start);
  const days = d ? Math.round((d - new Date()) / 86400000) : 99;
  if (days <= 1) return URGENCY_COLORS.d1;
  if (days <= 3) return URGENCY_COLORS.d3;
  if (days <= 7) return URGENCY_COLORS.d7;
  return URGENCY_COLORS.far;
}

export default function BroadcastCard({ item, likeCount, liked, onToggleLike }) {
  const dt = fmtDate(parseLabangDate(item.start));
  const label = dDayLabel(item);
  const color = urgencyColor(item);

  return (
    <a
      href={item.url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      style={styles.card}
      onClick={(e) => {
        if (!item.url) e.preventDefault();
      }}
    >
      <div style={{ ...styles.dateCol, background: color }}>
        <div style={styles.dateLabel}>{label}</div>
        <div style={styles.dateDay}>{dt.month}/{dt.day}</div>
        <div style={styles.dateTime}>{dt.time}</div>
      </div>
      <div style={styles.info}>
        <span style={styles.platform}>{item.platform || '라이브'}</span>
        <div style={styles.title}>{item.title}</div>
        {item.channel && <div style={styles.channel}>{item.channel}</div>}
      </div>
      {item.id && (
        <LikeButton
          id={item.id}
          liked={liked}
          count={likeCount ?? 0}
          onToggle={onToggleLike}
        />
      )}
    </a>
  );
}

const styles = {
  card: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 10,
    padding: 10,
    background: '#fff',
    borderRadius: 14,
    border: '1.5px solid #1a1814',
    textDecoration: 'none',
    color: 'inherit',
  },
  dateCol: {
    flexShrink: 0,
    width: 60,
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 2px',
    color: '#fff',
  },
  dateLabel: { fontSize: 11, fontWeight: 800 },
  dateDay: { fontSize: 12, fontWeight: 700, marginTop: 2 },
  dateTime: { fontSize: 10, fontWeight: 600, opacity: 0.9 },
  info: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 },
  platform: { fontSize: 11, fontWeight: 700, color: '#8d8d8d' },
  title: {
    fontSize: 14,
    fontWeight: 700,
    color: '#202020',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    lineHeight: 1.3,
  },
  channel: { fontSize: 11, fontWeight: 600, color: '#8d8d8d' },
};
