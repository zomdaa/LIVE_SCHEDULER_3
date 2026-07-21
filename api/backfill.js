import { kv } from '@vercel/kv';
import { getSupabase, saveBroadcasts } from '../lib/supabase.js';

// 라방바 과거 스케줄을 통째로 Supabase broadcasts에 적재하는 백필 엔드포인트.
// GET /api/backfill?days=90        → 어제부터 90일치 적재
// GET /api/backfill?days=45&skip=45 → 46~90일 전 구간만 적재 (타임아웃 시 분할용)
//
// 매일 새벽 Vercel 크론이 days=3으로 호출해서 최근 방송을 계속 쌓고,
// 동시에 RETENTION_DAYS(3개월) 지난 행을 정리한다.
//
// 인증: x-ingest-secret이 맞으면 무제한. 없으면(크론 포함) KV 락으로
// 20분에 1회만 허용 - 데이터가 민감하지 않고 upsert라 멱등이므로
// 남용해봐야 라방바 호출 낭비뿐이고, 그마저 스로틀로 막는다.
export const config = { maxDuration: 60 };

const LOCK_KEY = 'backfill-lock';
const LOCK_TTL = 20 * 60; // 20분
const MAX_DAYS = 90;
const RETENTION_DAYS = 90; // 3개월 보관
const UPSERT_CHUNK = 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const secret = req.headers['x-ingest-secret'];
  const authed = Boolean(secret && secret === process.env.INGEST_SECRET);
  if (!authed) {
    try {
      const locked = await kv.set(LOCK_KEY, new Date().toISOString(), { nx: true, ex: LOCK_TTL });
      if (locked !== 'OK' && locked !== true) {
        return res.status(429).json({ error: '백필이 최근에 실행됐어요. 20분 후 다시 시도해주세요.' });
      }
    } catch (e) {
      // KV가 죽어있으면 스로틀을 보장할 수 없으니 비인증 호출은 거부
      return res.status(503).json({ error: 'throttle unavailable' });
    }
  }

  const days = Math.min(MAX_DAYS, Math.max(1, parseInt(req.query.days, 10) || 3));
  const skip = Math.min(MAX_DAYS, Math.max(0, parseInt(req.query.skip, 10) || 0));

  const dates = [];
  const now = new Date();
  for (let i = skip + 1; i <= skip + days; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(yy + mm + dd);
  }

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
      return [];
    }
  };

  try {
    const results = await Promise.all(dates.map(fetchDate));
    const allItems = results.flat();

    // 백필은 방송당 실제 플랫폼 URL을 일일이 해석하기엔 건수가 너무 많아서
    // 라방바 리포트 페이지 URL을 저장한다 (검색 폴백과 동일한 폴백 URL)
    const cards = allItems
      .filter(it => it && it.labang_id && it.labang_title)
      .map(it => ({
        id: it.labang_id,
        title: it.labang_title,
        platform: it.platform_name,
        start: it.labang_datetime_start,
        end: it.labang_datetime_end,
        url: 'https://live.ecomm-data.com/report/labang/' + it.labang_id,
      }));

    let saved = 0;
    const errors = [];
    for (let i = 0; i < cards.length; i += UPSERT_CHUNK) {
      const result = await saveBroadcasts(cards.slice(i, i + UPSERT_CHUNK), 'labangba');
      saved += result.saved || 0;
      if (result.error) errors.push(result.error);
    }

    // 보관 기간(3개월) 지난 행 정리
    let deleted = null;
    try {
      const supabase = getSupabase();
      if (supabase) {
        const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const { count, error } = await supabase
          .from('broadcasts')
          .delete({ count: 'exact' })
          .lt('start_at', cutoff);
        if (!error) deleted = count;
      }
    } catch (e) {}

    return res.status(200).json({
      ok: errors.length === 0,
      days,
      skip,
      fetched: cards.length,
      saved,
      deleted,
      errors: errors.length ? errors : undefined,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
