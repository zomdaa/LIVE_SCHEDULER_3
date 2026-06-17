export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  const encoded = encodeURIComponent(keyword);

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
      const match = html.match(/"labang_url_info":"([^"]+)"/);
      return match ? match[1].replace(/\\u0026/g, '&') : null;
    } catch {
      return null;
    }
  }

  try {
    const response = await fetch('https://live.ecomm-data.com/search?keyword=' + encoded, {
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
      const linkMatch = line.match(/\[([^\]]+)\]\((https:\/\/live\.ecomm-data\.com\/report\/labang\/([a-f0-9]+))\)/);
      if (!linkMatch) continue;
      const labangUrl = linkMatch[2];
      const labangId = linkMatch[3];
      if (seen.has(labangUrl)) continue;
      const dateMatch = line.match(/(\d{2}\.\d{2}\.\d{2})\s*\(([월화수목금토일])\)\s*(\d{2}:\d{2})/);
      if (!dateMatch) continue;
      seen.add(labangUrl);
      let rawTitle = linkMatch[1];
      const platforms = ['네이버쇼핑LIVE','카카오쇼핑LIVE','11번가LIVE','G마켓LIVE','쿠팡라이브','올리브영LIVE','그립','인터파크LIVE','SK스토아','현대Hmall','쓱라이브','롯데온라이브','공영라방','NS홈쇼핑','온스타일','GS샵LIVE','롯데홈쇼핑','GS홈쇼핑'];
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
        labangId,
        labangUrl,
        date: dateMatch[1] + ' (' + dateMatch[2] + ') ' + dateMatch[3],
        platform,
      });
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const within30Days = results
      .filter(item => {
        const m = item.date.match(/(\d{2})\.(\d{2})\.(\d{2})\s*\([^)]+\)\s*(\d{2}:\d{2})/);
        if (!m) return false;
        const d = new Date('20' + m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':00');
        return d >= thirtyDaysAgo && d <= now;
      })
      .sort((a, b) => {
        const toDate = str => {
          const m = str.match(/(\d{2})\.(\d{2})\.(\d{2})\s*\([^)]+\)\s*(\d{2}:\d{2})/);
          return m ? new Date('20' + m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':00') : new Date(0);
        };
        return toDate(b.date) - toDate(a.date);
      })
      .slice(0, 8);

    const past = await Promise.all(within30Days.map(async (item) => {
      const realUrl = await getRealUrl(item.labangId);
      return {
        title: item.title,
        platform: item.platform,
        date: item.date,
        url: realUrl || item.labangUrl,
      };
    }));

    res.status(200).json({ past, total: past.length, keyword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
