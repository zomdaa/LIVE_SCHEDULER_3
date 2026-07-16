export default function Verdict({ verdict }) {
  if (!verdict) return null;

  return (
    <div style={styles.box}>
      <div style={styles.label}>💬 타이밍 분석</div>
      <div style={styles.title}>{verdict.title}</div>
      <div style={styles.text}>{verdict.body}</div>
    </div>
  );
}

const styles = {
  box: {
    background: '#fff8e8',
    borderRadius: 20,
    padding: '20px 20px 18px',
    marginTop: 16,
    border: '2.5px solid #2d2a26',
    boxShadow: '3px 3px 0 #2d2a26',
  },
  label: { fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: '#c01f00', marginBottom: 8 },
  title: { fontSize: 19, fontWeight: 800, color: '#c01f00', marginBottom: 6, lineHeight: 1.3 },
  text: { fontSize: 14, fontWeight: 500, color: '#4a3520', lineHeight: 1.6 },
};
