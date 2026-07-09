import { kv } from '@vercel/kv';

// 올리브영 라이브 내부 API (m.oliveyoung.co.kr 의 "라이브" 탭 편성표)
// 날짜별 방송 상세는 viewStdDate 파라미터가 YYYYMMDD 형식이어야 동작한다
// (달력 요약 API의 date 필드는 "YYYY-MM-DD" 로 표시되지만 detail 호출 시 대시 없는 형식을 요구함)
const BASE = 'https://m.oliveyoung.co.kr/discovery/api/v2/live-shop/display/broadcast-calendar';
const RANGE_DAYS = 6; // 오늘 ~ +6일
const CACHE_KEY = 'crawl-oliveyoung:raw';
const CACHE_TTL = 300; // 5분

const CONCURRENCY_KEY = 'active-crawl-oliveyoung';
const MAX_CONCURRENT = 5;

function oyHeaders() {
  return {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Referer': 'https://m.oliveyoung.co.kr/m/mtn/liveshop',
  };
}

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function toCard(item) {
  const live = item.liveCastingInformation || {};
  return {
    id: item.teaserNo,
    title: item.title || '',
    platform: '올리브영 라이브',
    channel: item.productsInformation?.onlineBrandName || '',
    start: live.castingStartDateTime || live.reservedStartDateTime || null,
    end: live.castingEndDateTime || live.reservedEndDateTime || null,
    status: live.onAirFlag ? 'ONAIR' : 'BEFORE',
    url: item.linkUrlAddress ? ('https://m.oliveyoung.co.kr/m/' + item.linkUrlAddress) : '',
  };
}

async function fetchDaySchedule(dayStr) {
  const r = await fetch(BASE + '/detail?viewStdDate=' + dayStr, { headers: oyHeaders() });
  if (!r.ok) return [];
  const json = await r.json();
  const items = json?.data?.scheduleItems;
  if (!Array.isArray(items)) return [];
  return items.map(toCard);
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

    res.status(200).json({ upcoming, total: upcoming.length, keyword: cleanKeyword, platform: '올리브영 라이브' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (concurrencySlotTaken) {
      try { await kv.decr(CONCURRENCY_KEY); } catch (e) {}
    }
  }
}
