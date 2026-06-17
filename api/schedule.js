export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  const dates = [];
  const now = new Date();
  for (let i = 0; i <= 6; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${yy}${mm}${dd}`);
  }

  async function getRealUrl(labangId) {
    try {
      const r = await fetch(`https://live.ecomm-data.com/report/labang/${labangId}`, {
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

    const kw = keyword.toLowerCase();
    const matched = allItems.filter(item =>
      item.labang_title?.toLowerCase().includes(kw)
    );

    // 각 방송의 실제 URL 병렬로 가져오기
    const filtered = await Promise.all(matched.map(async (item) => {
      const realUrl = await getRealUrl(item.labang_id);
      return {
        title: item.labang_title,
        platform: item.platform_name,
        platformId: item.platform_id,
        start: item.labang_datetime_start,
        end: item.labang_datetime_end,
        status: item.status,
        id: item.labang_id,
        url: realUrl || `https://live.ecomm-data.com/report/labang/${item.labang_id}`,
      };
    }));

    res.status(200).json({ upcoming: filtered, total: filtered.length, keyword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
