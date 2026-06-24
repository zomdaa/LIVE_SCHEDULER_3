import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const logsRaw = await kv.lrange('search-logs', 0, 499); // 최근 500건 기준 집계
    const counts = {};

    for (const item of logsRaw) {
      let parsed;
      try {
        parsed = typeof item === 'string' ? JSON.parse(item) : item;
      } catch {
        continue;
      }
      const kw = (parsed?.keyword || '').trim();
      if (!kw) continue;
      counts[kw] = (counts[kw] || 0) + 1;
    }

    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([keyword, count]) => ({ keyword, count }));

    res.status(200).json({ top });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
