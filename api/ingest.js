import { kv } from '@vercel/kv';

// 브라우저 확장프로그램이 실제 사용자 IP로 수집한 스케줄 데이터를 받아
// 해당 플랫폼의 크롤러가 읽는 KV 캐시 키에 그대로 저장한다.
// Vercel 서버 IP가 차단된 플랫폼(올리브영, G마켓, 오늘의집)을 위한 우회 경로.
const ALLOWED_PLATFORMS = new Set(['oliveyoung', 'gmarket', 'ohouse']);
const TTL_SECONDS = 6 * 60 * 60; // 6시간 (GitHub Actions가 그보다 훨씬 자주 갱신함)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-ingest-secret'];
  if (!secret || secret !== process.env.INGEST_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { platform, items } = req.body || {};
  if (!ALLOWED_PLATFORMS.has(platform) || !Array.isArray(items)) {
    return res.status(400).json({ error: 'invalid payload' });
  }

  try {
    await kv.set(`crawl-${platform}:raw`, items, { ex: TTL_SECONDS });
    await kv.set(`crawl-${platform}:ingestedAt`, new Date().toISOString(), { ex: TTL_SECONDS });
    return res.status(200).json({ ok: true, count: items.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
