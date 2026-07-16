const HEART_PATH =
  'M12 20.5C12 20.5 3 15 3 8.8C3 5.7 5.4 3.5 8.2 3.5C9.8 3.5 11.2 4.3 12 5.6C12.8 4.3 14.2 3.5 15.8 3.5C18.6 3.5 21 5.7 21 8.8C21 15 12 20.5 12 20.5Z';

export default function LikeButton({ liked, count, onToggle }) {
  return (
    <button
      type="button"
      style={{ ...styles.btn, ...(liked ? styles.btnLiked : null) }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path
          d={HEART_PATH}
          stroke="currentColor"
          strokeWidth="1.8"
          fill={liked ? 'currentColor' : 'none'}
        />
      </svg>
      <span style={styles.count}>{count}</span>
    </button>
  );
}

const styles = {
  btn: {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    width: 40,
    border: 'none',
    borderRadius: 10,
    background: 'rgba(0,0,0,0.05)',
    color: '#8d8d8d',
    cursor: 'pointer',
  },
  btnLiked: { color: '#ff3b5c' },
  count: { fontSize: 10, fontWeight: 700 },
};
