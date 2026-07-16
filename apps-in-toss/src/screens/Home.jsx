import { useEffect, useRef, useState } from 'react';
import {
  fetchAllUpcoming, fetchPastSearch, fetchLikeCounts, fetchLowestPrice, fetchPopularKeywords,
  getRecentKeywords, saveRecentKeyword, makeVerdict, parseLabangDate,
} from '../api.js';
import BroadcastCard from '../components/BroadcastCard.jsx';
import LowestPrice from '../components/LowestPrice.jsx';
import Verdict from '../components/Verdict.jsx';
import HeroBand from '../components/HeroBand.jsx';

const DEFAULT_KEYWORDS = ['로보락', '하기스', '미닉스', 'DJI'];

export default function Home({ liked }) {
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [upcoming, setUpcoming] = useState([]);
  const [past, setPast] = useState([]);
  const [lowestPrice, setLowestPrice] = useState([]);
  const [verdict, setVerdict] = useState(null);
  const [chips, setChips] = useState(DEFAULT_KEYWORDS);
  const [searchedKeyword, setSearchedKeyword] = useState('');
  const searchBtnRef = useRef(null);

  // 클릭할 때마다 눌리는 느낌의 바운스 애니메이션을 다시 재생시킨다 -
  // 클래스를 이미 갖고 있으면 재부착해도 재생이 안 되니 강제로 리플로우를 일으킨다
  function playBounce() {
    const btn = searchBtnRef.current;
    if (!btn) return;
    btn.classList.remove('bounce');
    void btn.offsetWidth;
    btn.classList.add('bounce');
  }

  useEffect(() => {
    const recent = getRecentKeywords();
    if (recent.length > 0) {
      setChips(recent);
      return;
    }
    fetchPopularKeywords().then((top) => {
      if (top.length > 0) setChips(top);
    });
  }, []);

  async function runSearch(kw) {
    const cleaned = kw.trim();
    if (!cleaned) return;
    saveRecentKeyword(cleaned);
    setKeyword(cleaned);
    setSearchedKeyword(cleaned);
    setStatus('loading');
    setLowestPrice([]);
    setVerdict(null);

    fetchLowestPrice(cleaned).then((items) => setLowestPrice(items.slice(0, 3)));

    const [rawUpcoming, rawPast] = await Promise.all([
      fetchAllUpcoming(cleaned),
      fetchPastSearch(cleaned),
    ]);

    const now = new Date();
    const cutoff = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    const stillUpcoming = [];
    const endedFromUpcoming = [];
    rawUpcoming.forEach((item) => {
      const start = parseLabangDate(item.start);
      if (start && start > cutoff) return;
      const end = parseLabangDate(item.end);
      const isEnded = end ? end < now : false;
      (isEnded ? endedFromUpcoming : stillUpcoming).push(item);
    });

    const sortedUpcoming = stillUpcoming.sort((a, b) => {
      const da = parseLabangDate(a.start);
      const db = parseLabangDate(b.start);
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    });
    const sortedPast = [...endedFromUpcoming, ...rawPast].sort((a, b) =>
      String(b.start).localeCompare(String(a.start))
    );

    setUpcoming(sortedUpcoming);
    setPast(sortedPast);
    setVerdict(makeVerdict(sortedUpcoming, sortedPast));
    setStatus('done');

    const ids = [...sortedUpcoming, ...sortedPast].map((i) => i.id).filter(Boolean);
    const counts = await fetchLikeCounts(ids);
    Object.entries(counts).forEach(([id, count]) => liked.setCount(id, count));
  }

  const total = upcoming.length + past.length;

  return (
    <div>
      <HeroBand />
      <div className="content-wrap" style={{ paddingTop: 0 }}>
      <div className="search-wrap">
        <input
          placeholder="브랜드명 혹은 제품명을 입력해보세요!"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            playBounce();
            runSearch(keyword);
          }}
        />
        <button
          ref={searchBtnRef}
          type="button"
          onClick={() => {
            playBounce();
            runSearch(keyword);
          }}
        >
          찾기
        </button>
      </div>

      <div className="chips">
        {chips.map((kw) => (
          <button key={kw} type="button" className="chip" onClick={() => runSearch(kw)}>
            {kw}
          </button>
        ))}
      </div>

      {status === 'done' && <Verdict verdict={verdict} />}

      {status === 'done' && (
        <div className="price-row">
          <a
            className="price-link coupang"
            href={`https://alltimeprice.com/search/?search=${encodeURIComponent(searchedKeyword)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            쿠팡 최저가 확인하기 →
          </a>
          <a
            className="price-link naver"
            href={`https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent(searchedKeyword)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            네이버 최저가 확인하기 →
          </a>
        </div>
      )}

      <LowestPrice items={lowestPrice} />

      {status === 'loading' && <p style={styles.muted}>불러오는 중...</p>}
      {status === 'done' && total === 0 && <p style={styles.muted}>검색 결과가 없어요</p>}

      {status === 'done' && upcoming.length > 0 && (
        <Section title="예정 방송" items={upcoming} liked={liked} />
      )}
      {status === 'done' && past.length > 0 && (
        <Section title="지난 방송 · 최근 3개월" items={past} liked={liked} />
      )}
      </div>
    </div>
  );
}

function Section({ title, items, liked }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={styles.sectionTitle}>{title}</div>
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
    </div>
  );
}

const styles = {
  muted: { fontSize: 14, color: '#8d8d8d', marginTop: 20 },
  sectionTitle: { fontSize: 15, fontWeight: 800, color: '#202020', marginBottom: 10 },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
};
