export default function LowestPrice({ items }) {
  if (!items || !items.length) return null;

  return (
    <div style={styles.section}>
      <div style={styles.header}>
        <span style={styles.dot} />
        <span style={styles.title}>지금 검색한 브랜드(제품)의 최저가에요!</span>
      </div>
      <div style={styles.list}>
        {items.map((item, idx) => (
          <a
            key={idx}
            href={item.productUrl || '#'}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.card}
          >
            {item.image && <img src={item.image} alt="" loading="lazy" style={styles.image} />}
            <div style={styles.name}>{item.productName}</div>
            {item.lowestPrice ? (
              <div style={styles.price}>{Number(item.lowestPrice).toLocaleString('ko-KR')}원</div>
            ) : null}
          </a>
        ))}
      </div>
    </div>
  );
}

const styles = {
  section: { marginTop: 20 },
  header: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 },
  dot: { width: 6, height: 6, borderRadius: '50%', background: '#ea2804' },
  title: { fontSize: 15, fontWeight: 800, color: '#202020' },
  list: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 },
  card: {
    flex: '0 0 auto',
    width: 108,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    background: '#fff',
    border: '1.5px solid #1a1814',
    boxShadow: '2px 2px 0 #1a1814',
    borderRadius: 12,
    padding: 8,
    textDecoration: 'none',
    color: 'inherit',
  },
  image: { width: '100%', height: 68, borderRadius: 8, objectFit: 'cover', background: '#f3f0e8' },
  name: {
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.3,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  price: { fontSize: 12, fontWeight: 800, color: '#c01f00', whiteSpace: 'nowrap' },
};
