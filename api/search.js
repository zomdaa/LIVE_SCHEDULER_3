import { kv } from '@vercel/kv';
import { waitUntil } from '@vercel/functions';
import { getSupabase, saveBroadcasts, tsToKstLocal, escapeLike } from '../lib/supabase.js';

// 캐시 미스 시 60개 날짜를 병렬 호출하는데, 응답이 느려지는 상황에서 Vercel
// 기본 타임아웃에 걸리지 않도록 여유를 둔다
export const config = { maxDuration: 60 };

const CONCURRENCY_KEY = 'active-searches';
const MAX_CONCURRENT = 10;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  const cleanKeyword = String(keyword).trim();
  const cacheKey = 'search:' + cleanKeyword.toLowerCase();

  // 레이트리밋/검색어 로그/캐시 조회/백필 시각을 KV 왕복 한 번 걸리는 시간에
  // 병렬로 처리한다 - 순차 실행이면 왕복 4~5번이라 그것만으로 수백 ms를 먹는다
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rateKey = 'rate:' + ip;
  const logEntry = JSON.stringify({ keyword: cleanKeyword, time: new Date().toISOString(), ip });
  const [rateCount, , cached, backfillLastRun] = await Promise.all([
    (async () => {
      const count = await kv.incr(rateKey);
      if (count === 1) await kv.expire(rateKey, 60);
      return count;
    })().catch(() => null),
    (async () => {
      await kv.lpush('search-logs', logEntry);
      await kv.ltrim('search-logs', 0, 999);
    })().catch(() => {}),
    kv.get(cacheKey).catch(() => null),
    kv.get('backfill:lastRun').catch(() => null),
  ]);

  if (rateCount !== null && rateCount > 80) {
    return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' });
  }

  // 캐시 hit이면 동시성 제한과 무관하게 즉시 반환 - 라방바에 새 요청 안 나가므로
  if (cached) {
    return res.status(200).json({ ...cached, cached: true });
  }

  // 1순위: Supabase에 쌓아둔 자체 방송 데이터에서 검색 (라방바 의존도 축소).
  // 여기서 찾으면 라방바 60일치 호출 없이 즉시 반환한다.
  // 실패하거나 결과가 없으면 아래 라방바 폴백으로 그대로 진행.
  try {
    const supabase = getSupabase();
    if (supabase) {
      let query = supabase
        .from('broadcasts')
        .select('labang_id,title,platform,start_at,end_at,url')
        .lt('start_at', new Date().toISOString()) // 이미 시작(방영)된 방송만 = 과거 방송
        .order('start_at', { ascending: false })
        .limit(3);
      for (const term of cleanKeyword.split(/\s+/).filter(Boolean)) {
        query = query.ilike('title', '%' + escapeLike(term) + '%');
      }
      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        if (data.length > 0) {
          const past = data.map(row => ({
            id: row.labang_id,
            title: row.title,
            platform: row.platform,
            start: tsToKstLocal(row.start_at),
            end: tsToKstLocal(row.end_at),
            url: row.url,
          }));
          const responseBody = { past, total: past.length, keyword: cleanKeyword, source: 'supabase' };
          try {
            await kv.set(cacheKey, responseBody, { ex: 7200 });
          } catch (e) {}
          return res.status(200).json(responseBody);
        }

        // 결과 0건이어도 백필(/api/backfill)이 26시간 내에 성공했다면 Supabase가
        // 라방바 90일치를 그대로 미러링 중이라는 뜻 - 라방바 60일치를 다시 훑어도
        // 결과는 같으므로 최악의 병목(수십 초 스캔)을 생략하고 즉시 빈 결과를 준다.
        // 백필이 오래됐거나 실패 중이면 기존 라방바 폴백으로 그대로 진행.
        const backfillFresh = backfillLastRun &&
          (Date.now() - new Date(backfillLastRun).getTime()) < 26 * 60 * 60 * 1000;
        if (backfillFresh) {
          const responseBody = { past: [], total: 0, keyword: cleanKeyword, source: 'supabase' };
          try {
            await kv.set(cacheKey, responseBody, { ex: 1800 }); // 빈 결과는 30분만 캐시
          } catch (e) {}
          return res.status(200).json(responseBody);
        }
      }
    }
  } catch (e) {}

  // 동시 검색 수 제한 체크 (캐시 미스일 때만, 실제 라방바 호출 직전)
  let concurrencySlotTaken = false;
  try {
    const activeCount = await kv.incr(CONCURRENCY_KEY);
    if (activeCount === 1) {
      await kv.expire(CONCURRENCY_KEY, 30); // 혹시 비정상 종료 시 30초 후 자동 리셋
    }
    if (activeCount > MAX_CONCURRENT) {
      await kv.decr(CONCURRENCY_KEY);
      return res.status(429).json({ error: '지금 갑자기 많은 분들이 검색 중이에요..! 잠시 후 다시 시도해봐주세요!' });
    }
    concurrencySlotTaken = true;
  } catch (e) {
    // KV 오류 시에는 동시성 제한 없이 진행 (서비스 가용성 우선)
  }

  const dates = [];
  const now = new Date();
  for (let i = 1; i <= 60; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
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
      try {
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
      } catch (e) {
        // 날짜 하나가 네트워크 에러로 실패해도 60개 중 하나일 뿐이니 전체를 죽이지 않는다
        return [];
      }
    };

    const results = await Promise.all(dates.map(fetchDate));
    const allItems = results.flat();

    const kwTerms = cleanKeyword.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = allItems
      .filter(item => {
        if (!item.labang_title) return false;
        const title = item.labang_title.toLowerCase();
        return kwTerms.every(term => title.includes(term));
      })
      .sort((a, b) => b.labang_datetime_start.localeCompare(a.labang_datetime_start))
      .slice(0, 3);

    const past = await Promise.all(matched.map(async (item) => {
      const realUrl = await getRealUrl(item.labang_id);
      return {
        id: item.labang_id,
        title: item.labang_title,
        platform: item.platform_name,
        start: item.labang_datetime_start,
        end: item.labang_datetime_end,
        url: realUrl || ('https://live.ecomm-data.com/report/labang/' + item.labang_id),
      };
    }));

    const responseBody = { past, total: past.length, keyword: cleanKeyword };

    try {
      await kv.set(cacheKey, responseBody, { ex: 7200 }); // 캐시 2시간으로 연장
    } catch (e) {}

    // 라방바 폴백으로 찾은 결과는 Supabase에 적립해서 다음번 같은 키워드는
    // Supabase에서 바로 찾도록 한다. 응답을 막지 않게 백그라운드로.
    try {
      waitUntil(saveBroadcasts(past, 'labangba').catch(() => {}));
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
