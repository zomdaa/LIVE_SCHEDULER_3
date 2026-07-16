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
      <Screen liked={liked} />
      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}

const styles = {
  page: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Pretendard", sans-serif',
    minHeight: '100vh',
    boxSizing: 'border-box',
  },
};
