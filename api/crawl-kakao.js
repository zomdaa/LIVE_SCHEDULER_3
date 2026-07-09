import { kv } from '@vercel/kv';

// 카카오쇼핑라이브 내부 API (shoppinglive.kakao.com /calendar 페이지가 사용하는 API)
// shoppinglive.kakao.com 이 kamp.kakao.com 으로 리버스 프록시하므로 same-origin 으로 호출
const GATEWAY = 'https://shoppinglive.kakao.com';
const PAGE_SIZE = 50;
const MAX_PAGES_PER_DAY = 10; // 하루 안에서 커서 페이지네이션 상한 (무한루프 방지)
const RANGE_DAYS = 6; // 오늘 ~ +6일
const CACHE_KEY = 'crawl-kakao:raw';
const CACHE_TTL = 300; // 5분

const CONCURRENCY_KEY = 'active-crawl-kakao';
const MAX_CONCURRENT = 5;

function kakaoHeaders() {
  return {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://shoppinglive.kakao.com/calendar',
  };
}

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function toIso(str) {
  if (!str || str.length < 12) return null;
  const y = str.slice(0, 4), mo = str.slice(4, 6), d = str.slice(6, 8);
  const h = str.slice(8, 10), mi = str.slice(10, 12), s = str.slice(12, 14) || '00';
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

function toCard(item) {
  return {
    id: item.liveContentId,
    title: (item.displayTitle || '').replace(/\n/g, ' '),
    platform: '카카오쇼핑라이브',
    channel: item.liveDisplaySaleChannel?.name || '',
    start: toIso(item.liveStartAt),
    end: null,
    status: item.liveStatus,
    url: item.landingUrl || ('https://shoppinglive.kakao.com/live/' + item.liveContentId),
  };
}

async function fetchDaySchedule(dayStr) {
  const items = [];
  let cursor = '';
  let page = 0;
  while (page < MAX_PAGES_PER_DAY) {
    page++;
    const params = new URLSearchParams({
      tabId: 'ALL',
      displayFrom: dayStr,
      displayTo: dayStr,
      size: String(PAGE_SIZE),
    });
    if (cursor) params.set('cursor', cursor);

    const r = await fetch(GATEWAY + '/api/v2/live-calendar?' + params, { headers: kakaoHeaders() });
    if (!r.ok) break;
    const data = await r.json();
    const contents = data.contents || [];
    contents.forEach(item => {
      if (item.liveStatus !== 'NO_SHOW') items.push(toCard(item));
    });

    if (data.last || !data.nextCursor || contents.length === 0) break;
    cursor = data.nextCursor;
  }
  return items;
}

async function fetchRawSchedule() {
  const days = [];
  const now = new Date();
  for (let i = 0; i <= RANGE_DAYS; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    days.push(ymd(d));
  }

  const results = await Promise.all(days.map(fetchDaySchedule));
  const seen = new Set();
  const items = [];
  results.flat().forEach(card => {
    if (card.id && !seen.has(card.id)) {
      seen.add(card.id);
      items.push(card);
    }
  });
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

    res.status(200).json({ upcoming, total: upcoming.length, keyword: cleanKeyword, platform: '카카오쇼핑라이브' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (concurrencySlotTaken) {
      try { await kv.decr(CONCURRENCY_KEY); } catch (e) {}
    }
  }
}
