import { kv } from '@vercel/kv';

// 네이버 쇼핑라이브 내부 API (shoppinglive.naver.com /calendar 페이지가 사용하는 API)
// GATEWAY_URL: apis.naver.com/selectiveweb/live_commerce_web, 라우팅 키 헤더 필요
//
// timeline/current 에서 timeline/next 로 "지금"부터 이어서 커서 페이지네이션하면
// 당일 스케줄이 끝나는 시점(cursor=null)에서 멈춰버려 다음날 이후 데이터를 못 가져온다.
// 하지만 timestamp 파라미터에 미래 시각을 직접 넣어 호출하면 그 날짜의 스케줄이 정상
// 반환되는 것을 확인했다 (예: KST 자정으로 호출 -> 그날 하루 전체를 next 페이지네이션으로 순회 가능).
// 그래서 오늘~+6일 각 날짜의 KST 자정을 anchor timestamp 로 개별 조회한다.
const GATEWAY = 'https://apis.naver.com/selectiveweb/live_commerce_web';
const ROUTING_KEY = 'real-home-api';
const PAGE_SIZE = 30; // 서버측 상한 (그 이상이면 400 에러)
const MAX_PAGES_PER_DAY = 10; // 하루 안에서 커서 페이지네이션 상한 (무한루프 방지)
const RANGE_DAYS = 21; // 오늘 ~ +21일 (실측 결과 이 지점부터 방송이 거의 0건으로 수렴함)
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

// Vercel 서버는 UTC로 동작하므로 KST(UTC+9) 자정의 실제 Unix timestamp(ms)를 명시적으로 계산한다
function kstMidnightTimestamp(dayOffset) {
  const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
  shifted.setUTCDate(shifted.getUTCDate() + dayOffset);
  shifted.setUTCHours(0, 0, 0, 0);
  return shifted.getTime() - 9 * 60 * 60 * 1000;
}

async function fetchDaySchedule(anchorTimestamp, includeCurrent) {
  const items = [];
  const seen = new Set();
  const addCard = (entry) => {
    const card = toCard(entry);
    if (card && card.id && !seen.has(card.id)) {
      seen.add(card.id);
      items.push(card);
    }
  };

  let r = await fetch(GATEWAY + '/v1/calendar/broadcast/timeline/current?' + new URLSearchParams({
    timestamp: String(anchorTimestamp),
    size: String(PAGE_SIZE),
  }), { headers: naverHeaders() });
  if (!r.ok) {
    // 병렬 요청 버스트에 대한 일시적 레이트리밋으로 추정되는 실패는 한 번 재시도
    await new Promise(resolve => setTimeout(resolve, 400));
    r = await fetch(GATEWAY + '/v1/calendar/broadcast/timeline/current?' + new URLSearchParams({
      timestamp: String(anchorTimestamp),
      size: String(PAGE_SIZE),
    }), { headers: naverHeaders() });
    if (!r.ok) return items;
  }
  const data = await r.json();

  if (includeCurrent && data.currentBroadcast) addCard(data.currentBroadcast);
  (data.nextBroadcasts?.list || []).forEach(addCard);

  let cursor = data.nextBroadcasts?.next || null;
  let page = 0;
  while (cursor && page < MAX_PAGES_PER_DAY) {
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
    if (list.length === 0) break;
  }

  return items;
}

async function fetchRawSchedule() {
  const anchors = [];
  for (let i = 0; i <= RANGE_DAYS; i++) {
    anchors.push(i === 0 ? Date.now() : kstMidnightTimestamp(i));
  }

  // 7개 요청을 동시에 터뜨리면 게이트웨이가 일부를 레이트리밋하는 경향이 있어 살짝 간격을 두고 시작한다
  const results = await Promise.all(anchors.map((ts, idx) =>
    new Promise(resolve => setTimeout(resolve, idx * 150)).then(() => fetchDaySchedule(ts, idx === 0))
  ));

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

    res.status(200).json({ upcoming, total: upcoming.length, keyword: cleanKeyword, platform: '네이버쇼핑라이브' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (concurrencySlotTaken) {
      try { await kv.decr(CONCURRENCY_KEY); } catch (e) {}
    }
  }
}
