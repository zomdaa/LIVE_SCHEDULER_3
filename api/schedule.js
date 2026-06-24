import { kv } from '@vercel/kv';

const CONCURRENCY_KEY = 'active-searches';
const MAX_CONCURRENT = 10;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  const cleanKeyword = String(keyword).trim();
  const cacheKey = 'schedule:' + cleanKeyword.toLowerCase();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rateKey = 'rate:' + ip;
  try {
    const count = await kv.incr(rateKey);
    if (count === 1) {
      await kv.expire(rateKey, 60);
    }
    if (count > 20) {
      return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' });
    }
  } catch (e) {}

  try {
    const cached = await kv.get(cacheKey);
    if (cached) {
      return res.status(200).json({ ...cached, cached: true });
    }
  } catch (e) {}

  let concurrencySlotTaken = false;
  try {
    const activeCount = await kv.incr(CONCURRENCY_KEY);
    if (activeCount === 1) {
      await kv.expire(CONCURRENCY_KEY, 30);
    }
    if (activeCount > MAX_CONCURRENT) {
      await kv.decr(CONCURRENCY_KEY);
      return res.status(429).json({ error: '지금 갑자기 많은 분들이 검색 중이에요..! 잠시 후 다시 시도해봐주세요!' });
    }
    concurrencySlotTaken = true;
  } catch (e) {}

  const dates = [];
  const now = new Date();
  for (let i = 0; i <= 6; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(yy + mm + dd);
  }

  async function getRealUrl(labangId) {
    try {
      const r = await fetch('https://live.ecomm-data.com/report/labang/' + labangId, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
      });
      const html = await r.text();
      const infoMatch = html.match(/"labang_url_info":"([^"]+)"/);
      const replayMatch = html.match(/"labang_url_replay":"([^"]+)"/);
      const liveMatch = html.match(/"labang_url_live":"([^"]+)"/);
      const url = (infoMatch && infoMatch[1]) || (replayMatch && replayMatch[1]) || (liveMatch && liveMatch[1]) || null;
      return url ? url.replace(/\\u0026/g, '&') : null;
    } catch {
      return null;
    }
  }

  try {
    const fetchDate = async (date) => {
      const r = await fetch('https://live.ecomm-data.com/api/schedule/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': '*/*',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          'Origin': 'https://live.ecomm-data.com',
          'Referer': 'https://live.ecomm-data.com/schedule/lb',
        },
        body: JSON.stringify({ date }),
      });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data?.list) ? data.list : [];
    };

    const results = await Promise.all(dates.map(fetchDate));
    const allItems = results.flat();

    const kwTerms = cleanKeyword.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = allItems.filter(item => {
      if (!item.labang_title) return false;
      const title = item.labang_title.toLowerCase();
      return kwTerms.every(term => title.includes(term));
    });

    const upcoming = await Promise.all(filtered.map(async (item) => {
      const realUrl = await getRealUrl(item.labang_id);
      return {
        title: item.labang_title,
        platform: item.platform_name,
        start: item.labang_datetime_start,
        end: item.labang_datetime_end,
        status: item.status,
        id: item.labang_id,
        url: realUrl || ('https://live.ecomm-data.com/report/labang/' + item.labang_id),
      };
    }));

    upcoming.sort((a, b) => a.start.localeCompare(b.start));

    const responseBody = { upcoming, total: upcoming.length, keyword: cleanKeyword };

    try {
      await kv.set(cacheKey, responseBody, { ex: 7200 }); // 캐시 2시간으로 연장
    } catch (e) {}

    res.status(200).json(responseBody);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (concurrencySlotTaken) {
      try { await kv.decr(CONCURRENCY_KEY); } catch (e) {}
    }
  }
}
