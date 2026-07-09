import { kv } from '@vercel/kv';

// GitHub Actions 로그는 저장소 admin 권한 없이는 조회할 수 없어서,
// 진단 스크립트가 실행 결과 텍스트를 여기로 보내면 GET으로 확인할 수 있게 하는 임시 엔드포인트.
// (G마켓/올리브영 파이프라인 검증이 끝나면 삭제할 임시 디버그용, 1시간 후 자동 만료)
const KEY_PREFIX = 'debug-log:';
const TTL_SECONDS = 60 * 60; // 1시간

export default async function handler(req, res) {
  const secret = req.headers['x-ingest-secret'] || req.query.secret;
  if (!secret || secret !== process.env.INGEST_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const name = String(req.query.name || 'default');
  const key = KEY_PREFIX + name;

  if (req.method === 'POST') {
    const { text } = req.body || {};
    try {
      await kv.set(key, String(text || ''), { ex: TTL_SECONDS });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'GET') {
    try {
      const text = await kv.get(key);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(text || '');
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
