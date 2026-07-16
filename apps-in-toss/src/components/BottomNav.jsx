const ICONS = {
  home: (
    <>
      <rect x="3" y="0" width="2" height="1" /><rect x="2" y="1" width="4" height="1" />
      <rect x="1" y="2" width="6" height="1" /><rect x="0" y="3" width="8" height="1" />
      <rect x="0" y="4" width="2" height="1" /><rect x="6" y="4" width="2" height="1" />
      <rect x="0" y="5" width="2" height="1" /><rect x="3" y="5" width="2" height="1" /><rect x="6" y="5" width="2" height="1" />
      <rect x="0" y="6" width="2" height="1" /><rect x="3" y="6" width="2" height="1" /><rect x="6" y="6" width="2" height="1" />
      <rect x="0" y="7" width="8" height="1" />
    </>
  ),
  calendar: (
    <>
      <rect x="0" y="0" width="8" height="1" />
      <rect x="0" y="1" width="1" height="1" /><rect x="7" y="1" width="1" height="1" />
      <rect x="0" y="2" width="8" height="1" />
      <rect x="0" y="3" width="1" height="1" /><rect x="2" y="3" width="1" height="1" /><rect x="4" y="3" width="1" height="1" /><rect x="6" y="3" width="2" height="1" />
      <rect x="0" y="4" width="2" height="1" /><rect x="3" y="4" width="1" height="1" /><rect x="5" y="4" width="1" height="1" /><rect x="7" y="4" width="1" height="1" />
      <rect x="0" y="5" width="1" height="1" /><rect x="2" y="5" width="1" height="1" /><rect x="4" y="5" width="1" height="1" /><rect x="6" y="5" width="2" height="1" />
      <rect x="0" y="6" width="2" height="1" /><rect x="3" y="6" width="1" height="1" /><rect x="5" y="6" width="1" height="1" /><rect x="7" y="6" width="1" height="1" />
      <rect x="0" y="7" width="8" height="1" />
    </>
  ),
  my: (
    <>
      <rect x="2" y="0" width="4" height="1" /><rect x="1" y="1" width="6" height="1" />
      <rect x="1" y="2" width="6" height="1" /><rect x="2" y="3" width="4" height="1" />
      <rect x="0" y="4" width="1" height="1" /><rect x="7" y="4" width="1" height="1" />
      <rect x="0" y="5" width="2" height="1" /><rect x="6" y="5" width="2" height="1" />
      <rect x="0" y="6" width="3" height="1" /><rect x="5" y="6" width="3" height="1" />
      <rect x="0" y="7" width="8" height="1" />
    </>
  ),
};

const TABS = [
  { key: 'home', label: '홈' },
  { key: 'calendar', label: '캘린더' },
  { key: 'my', label: 'MY' },
];

export default function BottomNav({ active, onChange }) {
  return (
    <nav style={styles.nav}>
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            style={{ ...styles.item, color: isActive ? '#c01f00' : '#8d8d8d' }}
            onClick={() => onChange(tab.key)}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 8 8"
              shapeRendering="crispEdges"
              fill="currentColor"
              style={{ opacity: isActive ? 1 : 0.55 }}
            >
              {ICONS[tab.key]}
            </svg>
            <span style={styles.label}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

const styles = {
  nav: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    background: 'rgba(255,255,255,0.9)',
    borderTop: '1.5px solid #1a1814',
    paddingBottom: 'env(safe-area-inset-bottom, 0)',
    zIndex: 50,
  },
  item: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    padding: '8px 0 6px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  label: { fontSize: 11, fontWeight: 700 },
};
