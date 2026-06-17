export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  const encoded = encodeURIComponent(keyword);
  const url = `https://live.ecomm-data.com/search?keyword=${encoded}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://live.ecomm-data.com/',
      },
    });

    const html = await response.text();
    const results = [];
    const seen = new Set();
    const lines = html.split('\n');

    for (const line of lines) {
      if (!line.trim().startsWith('|')) continue;

      const linkMatch = line.match(/\[([^\]]+)\]\((https:\/\/live\.ecomm-data\.com\/report\/labang\/[a-f0-9]+)\)/);
      if (!linkMatch) continue;

      const url = linkMatch[2];
      if (seen.has(url)) continue;

      const dateMatch = line.match(/(\d{2}\.\d{2}\.\d{2})\s*\(([월화수목금토일])\)\s*(\d{2}:\d{2})/);
      if (!dateMatch) continue;

      seen.add(url);

      let rawTitle = linkMatch[1];
      const platforms = ['네이버쇼핑LIVE', '카카오쇼핑LIVE', '11번가LIVE', 'G마켓LIVE', '쿠팡라이브', '올리브영LIVE', '그립', '인터파크LIVE', 'SK스토아', '현대Hmall', '쓱라이브', '롯데온라이브', '공영라방', 'NS홈쇼핑', '온스타일', 'GS샵LIVE'];
      let platform = '기타';
      for (const p of platforms) {
        if (rawTitle.includes(p)) {
          platform = p;
          rawTitle = rawTitle.replace(p, '').replace(/brand_logo/g, '').trim();
          break;
        }
      }

      results.push({
        title: rawTitle.replace(/brand_logo/g, '').trim(),
        url,
        date: `${dateMatch[1]} (${dateMatch[2]}) ${dateMatch[3]}`,
        platform,
      });
    }

    res.status(200).json({ past: results, total: results.length, keyword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
