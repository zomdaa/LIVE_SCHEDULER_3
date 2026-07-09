import { kv } from '@vercel/kv';

// 11번가 LIVE11 내부 API (m.11st.co.kr 의 "편성표" 페이지: /page/sub?pageId=LIVE11TIMETBLPAGE)
// 범용 PUI(페이지 빌더) 시스템을 사용하며, 최초 호출로 오늘 스케줄 + 날짜별 방송 개수(캐러셀 탭)를
// 받고, 방송이 있는(broadcastCount>0) 날짜만 carrSn을 재사용해 selectDate로 개별 조회한다.
// (broadcastCount가 0인 날짜를 조회하면 서버가 조용히 "오늘" 데이터로 폴백하므로 반드시 스킵해야 함)
const BASE = 'https://apis.11st.co.kr/pui/v2/page';
const PAGE_ID = 'LIVE11TIMETBLPAGE';
const RANGE_DAYS = 6; // 오늘 ~ +6일
const CACHE_KEY = 'crawl-11st:raw';
const CACHE_TTL = 300; // 5분

const CONCURRENCY_KEY = 'active-crawl-11st';
const MAX_CONCURRENT = 5;

function headers11st() {
  return {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Referer': 'https://m.11st.co.kr/page/sub?pageId=LIVE11TIMETBLPAGE',
  };
}

// data: [ {carrSn, type, blockList:[{type, list:[...]}, ...]}, ... ] 형태를 재귀 탐색해서
// 주어진 block type의 list 항목들을 모두 수집
function collectBlockLists(node, type, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectBlockLists(child, type, out);
    return;
  }
  if (node.type === type && Array.isArray(node.list)) {
    out.push(...node.list);
  }
  for (const key of Object.keys(node)) {
    if (key === 'list') continue;
    collectBlockLists(node[key], type, out);
  }
}

// Vercel 서버는 UTC로 동작하므로 KST(UTC+9) 기준 "오늘"을 명시적으로 계산한다
function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function mToD(kstDate) {
  return `${kstDate.getUTCMonth() + 1}.${kstDate.getUTCDate()}`;
}

function ymd(kstDate) {
  const y = kstDate.getUTCFullYear();
  const m = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kstDate.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function toCard(item, kstDate) {
  const y = kstDate.getUTCFullYear();
  const m = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kstDate.getUTCDate()).padStart(2, '0');
  const time = /^\d{1,2}:\d{2}$/.test(item.liveTime || '') ? item.liveTime : (item.liveScheduleTime || '00:00');
  return {
    id: item.broadcastNo,
    title: item.title || '',
    platform: '11번가 라이브11',
    channel: item.channelInfo?.title || '',
    start: `${y}-${m}-${d}T${time.padStart(5, '0')}:00`,
    end: null,
    status: item.liveStatus || '',
    url: item.liveDetailsUrl ? item.liveDetailsUrl.replace(/^http:/, 'https:') : '',
  };
}

async function fetchTodayAndTabs() {
  const r = await fetch(`${BASE}?pageId=${PAGE_ID}`, { headers: headers11st() });
  if (!r.ok) throw new Error('11st timetable page failed: ' + r.status);
  const json = await r.json();

  const tabs = [];
  collectBlockLists(json.data, 'Tabs_TimeTable', tabs);
  const products = [];
  collectBlockLists(json.data, 'ProductList_Live11', products);

  let carrSn = null;
  const findCarrSn = (node) => {
    if (!node || typeof node !== 'object' || carrSn) return;
    if (Array.isArray(node)) { node.forEach(findCarrSn); return; }
    if (node.type === 'Tabs_TimeTable') { carrSn = node.carrSn; return; }
    Object.values(node).forEach(findCarrSn);
  };
  findCarrSn(json.data);

  return { tabs, products, carrSn };
}

async function fetchDaySchedule(carrSn, dateObj) {
  const r = await fetch(`${BASE}?pageId=${PAGE_ID}&carrSn=${carrSn}&selectDate=${ymd(dateObj)}`, { headers: headers11st() });
  if (!r.ok) return [];
  const json = await r.json();
  const products = [];
  collectBlockLists(json.data, 'ProductList_Live11', products);
  return products;
}

async function fetchRawSchedule() {
  const { tabs, products, carrSn } = await fetchTodayAndTabs();

  const now = nowKST();
  const days = [];
  for (let i = 0; i <= RANGE_DAYS; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() + i);
    days.push(d);
  }

  const items = [];
  const seen = new Set();
  const addAll = (list, dateObj) => {
    list.forEach(item => {
      const card = toCard(item, dateObj);
      if (card.id && !seen.has(card.id)) {
        seen.add(card.id);
        items.push(card);
      }
    });
  };

  // 오늘(day[0])은 이미 받아온 데이터를 재사용
  addAll(products, days[0]);

  const tabByDate = new Map(tabs.map(t => [t.date, t]));
  const futureDays = days.slice(1).filter(d => {
    const tab = tabByDate.get(mToD(d));
    return tab && tab.broadcastCount > 0;
  });

  if (carrSn && futureDays.length > 0) {
    const results = await Promise.all(futureDays.map(d => fetchDaySchedule(carrSn, d)));
    results.forEach((list, idx) => addAll(list, futureDays[idx]));
  }

  return items;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  const cleanKeyword = keyword ? String(keyword).trim() : '';

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rateKey = 'rate:' + ip;
  try {
    const count = await kv.incr(rateKey);
    if (count === 1) await kv.expire(rateKey, 60);
    if (count > 20) {
      return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' });
    }
  } catch (e) {}

  let rawItems = null;
  try {
    rawItems = await kv.get(CACHE_KEY);
  } catch (e) {}

  let concurrencySlotTaken = false;
  try {
    if (!rawItems) {
      const activeCount = await kv.incr(CONCURRENCY_KEY);
      if (activeCount === 1) await kv.expire(CONCURRENCY_KEY, 30);
      if (activeCount > MAX_CONCURRENT) {
        await kv.decr(CONCURRENCY_KEY);
        return res.status(429).json({ error: '지금 갑자기 많은 분들이 검색 중이에요..! 잠시 후 다시 시도해봐주세요!' });
      }
      concurrencySlotTaken = true;
    }
  } catch (e) {}

  try {
    if (!rawItems) {
      rawItems = await fetchRawSchedule();
      try {
        await kv.set(CACHE_KEY, rawItems, { ex: CACHE_TTL });
      } catch (e) {}
    }

    let upcoming = rawItems;
    if (cleanKeyword) {
      const kwTerms = cleanKeyword.toLowerCase().split(/\s+/).filter(Boolean);
      upcoming = rawItems.filter(item => {
        if (!item.title) return false;
        const title = item.title.toLowerCase();
        return kwTerms.every(term => title.includes(term));
      });
    }

    upcoming = [...upcoming].sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    res.status(200).json({ upcoming, total: upcoming.length, keyword: cleanKeyword, platform: '11번가 라이브11' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (concurrencySlotTaken) {
      try { await kv.decr(CONCURRENCY_KEY); } catch (e) {}
    }
  }
}
