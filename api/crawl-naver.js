import { kv } from '@vercel/kv';

// 네이버 쇼핑라이브 내부 API (shoppinglive.naver.com /calendar 페이지가 사용하는 API)
// GATEWAY_URL: apis.naver.com/selectiveweb/live_commerce_web, 라우팅 키 헤더 필요
const GATEWAY = 'https://apis.naver.com/selectiveweb/live_commerce_web';
const ROUTING_KEY = 'real-home-api';
const PAGE_SIZE = 30; // 서버측 상한 (그 이상이면 400 에러)
const MAX_PAGES = 15; // 무한루프 방지용 안전장치
const RANGE_DAYS = 6; // 오늘 ~ +6일 (라방바 스케줄 API와 동일한 범위)
const CACHE_KEY = 'crawl-naver:raw';
const CACHE_TTL = 300; // 5분

const CONCURRENCY_KEY = 'active-crawl-naver';
const MAX_CONCURRENT = 5;

function naverHeaders() {
  return {
    'Accept': 'application/json',
    'apigw-routing-key': ROUTING_KEY,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://shoppinglive.naver.com/calendar',
  };
}

function toCard(entry) {
  if (!entry || !entry.broadcast) return null;
  const b = entry.broadcast;
  return {
    id: b.id,
    title: b.title,
    platform: '네이버쇼핑라이브',
    channel: entry.owner?.name || '',
    start: b.expectedStartDate || b.startDate || null,
    end: b.expectedEndDate || b.endDate || null,
    status: b.status,
    url: b.endUrl || ('https://shoppinglive.naver.com/lives/' + b.id),
  };
}

async function fetchRawSchedule() {
  const items = [];
  const seen = new Set();
  const cutoff = Date.now() + RANGE_DAYS * 24 * 60 * 60 * 1000;

  const addCard = (entry) => {
    const card = toCard(entry);
    if (card && card.id && !seen.has(card.id)) {
      seen.add(card.id);
      items.push(card);
    }
  };

  const r = await fetch(GATEWAY + '/v1/calendar/broadcast/timeline/current?' + new URLSearchParams({
    timestamp: String(Date.now()),
    size: String(PAGE_SIZE),
  }), { headers: naverHeaders() });
  if (!r.ok) throw new Error('naver calendar api failed: ' + r.status);
  const data = await r.json();

  if (data.currentBroadcast) addCard(data.currentBroadcast);
  (data.nextBroadcasts?.list || []).forEach(addCard);

  let cursor = data.nextBroadcasts?.next || null;
  let page = 0;
  while (cursor && page < MAX_PAGES) {
    page++;
    const nr = await fetch(GATEWAY + '/v1/calendar/broadcast/timeline/next?' + new URLSearchParams({
      next: cursor,
      size: String(PAGE_SIZE),
    }), { headers: naverHeaders() });
    if (!nr.ok) break;
    const nd = await nr.json();
    const list = nd.list || [];
    list.forEach(addCard);
    cursor = nd.next || null;

    const lastStart = list[list.length - 1]?.broadcast?.expectedStartDate;
    if (lastStart && new Date(lastStart).getTime() > cutoff) break;
    if (list.length === 0) break;
  }

  return items.filter(item => {
    if (!item.start) return true;
    return new Date(item.start).getTime() <= cutoff;
  });
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

    res.status(200).json({ upcoming, total: upcoming.length, keyword: cleanKeyword, platform: '네이버쇼핑라이브' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (concurrencySlotTaken) {
      try { await kv.decr(CONCURRENCY_KEY); } catch (e) {}
    }
  }
}
