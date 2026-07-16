import { useEffect, useState } from 'react';

const ASSET_BASE = 'https://raw.githubusercontent.com/zomdaa/LIVE_SCHEDULER_3/main/assets';

export default function HeroBand() {
  const [todayLabel, setTodayLabel] = useState('');

  useEffect(() => {
    const today = new Date();
    const yy = String(today.getFullYear()).slice(2);
    setTodayLabel(`${yy}. ${today.getMonth() + 1}. ${today.getDate()}`);
  }, []);

  return (
    <div className="hero-band">
      <div className="hero-content">
        <div className="eyebrow"><span className="dot" />{todayLabel}</div>
        <div className="brand-title">
          <img src={`${ASSET_BASE}/logo-Photoroom.png`} alt="BUY NOW OR LIVE" />
        </div>
        <h1><span className="hero-highlight">지금</span> 살까, <span className="hero-highlight">방송</span> 기다릴까?</h1>
        <p className="sub">지난 라방과 앞으로 있을 라방 스케줄을<br />한눈에 보고 구매 타이밍 잡기!</p>
      </div>
      <div className="hero-deco left">
        <img src={`${ASSET_BASE}/phone_on-Photoroom.png`} alt="" />
      </div>
      <div className="hero-deco right">
        <img src={`${ASSET_BASE}/cart_on-Photoroom.png`} alt="" />
      </div>
    </div>
  );
}
