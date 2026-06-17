export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fmtDate = d => String(d.getFullYear()).slice(2) + pad(d.getMonth()+1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes());

  const end = fmtDate(now);
  const start3m = new Date(now);
  start3m.setMonth(start3m.getMonth() - 3);
  const start = fmtDate(start3m);

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
    const response = await fetch('https://live.ecomm-data.com/api/search2/show', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Origin': 'https://live.ecomm-data.com',
        'Referer': 'https://live.ecomm-data.com/search?keyword=' + encodeURIComponent(keyword),
      },
      body: JSON.stringify({
        page: 1,
        size: 2,
        order: ['datetime_start/desc'],
        search: ['all', keyword],
        during: [start, end],
        type: 2,
      }),
    });

    const data = await response.json();
    const list = data?.list || data?.data || data?.result || [];

    const past = await Promise.all(list.map(async (item) => {
      const labangId = item.labang_id;
      const realUrl = await getRealUrl(labangId);

      const ds = item.labang_datetime_start || '';
      const date = ds.length >= 10
        ? '20' + ds.slice(0,2) + '.' + ds.slice(2,4) + '.' + ds.slice(4,6) + ' ' + ds.slice(6,8) + ':' + ds.slice(8,10)
        : ds;

      return {
        title: item.labang_title,
        platform: item.platform_name,
        date,
        url: realUrl || ('https://live.ecomm-data.com/report/labang/' + labangId),
      };
    }));

    res.status(200).json({ past, total: past.length, keyword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
