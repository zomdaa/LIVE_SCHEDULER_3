import { kv } from '@vercel/kv';

// 검색어에 포함되면 인기 검색어 후보에서 제외할 금칙어 목록
const BLOCKED_PATTERNS = [
  '시발', '씨발', 'ㅅㅂ', 'ㅄ', '병신', '지랄', '개새끼', '개새', '새끼',
  '존나', 'ㅈㄴ', '미친', '죽어', '꺼져', '닥쳐', '걸레', '잡놈', '잡년',
  '섹스', '섹시', '자지', '보지', '딸딸이', '자위', '음란', '포르노',
  'fuck', 'shit', 'bitch', 'sex', 'porn',
];

function isBlocked(keyword) {
  const normalized = keyword.toLowerCase().replace(/\s+/g, '');
  return BLOCKED_PATTERNS.some(word => normalized.includes(word));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const logsRaw = await kv.lrange('search-logs', 0, 499);
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
      if (isBlocked(kw)) continue; // 금칙어 포함 검색어는 집계에서 제외

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
