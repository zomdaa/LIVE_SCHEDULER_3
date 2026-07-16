import { useState } from 'react';
import BottomNav from './components/BottomNav.jsx';
import Home from './screens/Home.jsx';
import Calendar from './screens/Calendar.jsx';
import My from './screens/My.jsx';
import { useLiked } from './hooks/useLiked.js';

const SCREENS = { home: Home, calendar: Calendar, my: My };

export default function App() {
  const [tab, setTab] = useState('home');
  const liked = useLiked();
  const Screen = SCREENS[tab];

  return (
    <div style={styles.page}>
      <main style={styles.main}>
        <Screen liked={liked} />
      </main>
      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}

const styles = {
  page: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Pretendard", sans-serif',
    background: '#f9f7f3',
    minHeight: '100vh',
    boxSizing: 'border-box',
  },
  main: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '20px 16px 84px',
  },
};
