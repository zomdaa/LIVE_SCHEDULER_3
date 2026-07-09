import { kv } from '@vercel/kv';

// SSG.LIVE 내부 페이지 (m.ssg.com 의 "라이브 예고" 탭)
// 이 페이지는 Next.js SSR 로 렌더링되며 __NEXT_DATA__ 안에 예정 방송 목록이
// 이미 포함되어 있어 별도 API 호출 없이 HTML 한 번 요청으로 전체 예고 스케줄을 얻을 수 있다.
const SCHEDULE_URL = 'https://m.ssg.com/page/ssglive/next';
const CACHE_KEY = 'crawl-ssg:raw';
const CACHE_TTL = 300; // 5분

const CONCURRENCY_KEY = 'active-crawl-ssg';
const MAX_CONCURRENT = 5;

function ssgHeaders() {
  return {
    'Accept': 'text/html',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  };
}

function toIso(str) {
  if (!str) return null;
  return str.trim().replace(' ', 'T');
}

function toCard(item) {
  return {
    id: item.id,
    title: item.title || item.mainTitle1 || '',
    platform: 'SSG라이브',
    channel: item.repItemBrandNm || item.brandName || '',
    start: toIso(item.liveStartDate || item.subTitle1),
    end: toIso(item.liveEndDate || item.subTitle2),
    status: 'BEFORE',
    url: item.liveDetailLink || item.livePlayerLink || item.linkUrl || '',
  };
}

// __NEXT_DATA__ 트리를 재귀 탐색해서 dataType이 SSG_LIVE인 컴포넌트의 bannerList를 모두 수집
function collectBannerLists(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectBannerLists(child, out);
    return;
  }
  if (node.dataType === 'SSG_LIVE' && Array.isArray(node.bannerList)) {
    out.push(...node.bannerList);
  }
  for (const key of Object.keys(node)) {
    if (key === 'bannerList') continue;
    collectBannerLists(node[key], out);
  }
}

async function fetchRawSchedule() {
  const r = await fetch(SCHEDULE_URL, { headers: ssgHeaders() });
  if (!r.ok) throw new Error('ssg live page failed: ' + r.status);
  const html = await r.text();

  const startTag = '__NEXT_DATA__" type="application/json"';
  const idx = html.indexOf(startTag);
  if (idx === -1) throw new Error('ssg __NEXT_DATA__ not found');
  const scriptStart = html.indexOf('>', idx) + 1;
  const scriptEnd = html.indexOf('</script>', scriptStart);
  const nextData = JSON.parse(html.slice(scriptStart, scriptEnd));

  const banners = [];
  collectBannerLists(nextData, banners);

  const seen = new Set();
  const items = [];
  for (const item of banners) {
    const card = toCard(item);
    if (card.id && !seen.has(card.id)) {
      seen.add(card.id);
      items.push(card);
    }
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

    res.status(200).json({ upcoming, total: upcoming.length, keyword: cleanKeyword, platform: 'SSG라이브' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (concurrencySlotTaken) {
      try { await kv.decr(CONCURRENCY_KEY); } catch (e) {}
    }
  }
}
