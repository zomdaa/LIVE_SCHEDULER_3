import { saveBroadcasts } from '../lib/supabase.js';

// 크롤링으로 모은 방송 데이터를 Supabase broadcasts 테이블에 upsert하는 엔드포인트.
// POST /api/db-save
// body: { source: 'naver'|'kakao'|'gmarket'|'ssg'|'oliveyoung'|'labangba', items: [{ id, title, platform, start, end, url }] }
// (items 배열만 보내면 source는 'labangba'로 저장)
// ingest.js와 동일하게 x-ingest-secret 헤더로 보호 - DB에 아무나 쓰지 못하도록.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-ingest-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-ingest-secret'];
  if (!secret || secret !== process.env.INGEST_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = req.body || {};
  const items = Array.isArray(body) ? body : body.items;
  const source = (!Array.isArray(body) && body.source) || 'labangba';
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }
  if (items.length > 2000) {
    return res.status(400).json({ error: 'too many items (max 2000)' });
  }

  try {
    const result = await saveBroadcasts(items, source);
    if (result.error) {
      return res.status(500).json({ ok: false, error: result.error });
    }
    return res.status(200).json({ ok: true, saved: result.saved });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
