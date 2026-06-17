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

    // __NEXT_DATA__ 에서 검색 결과 파싱
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!nextDataMatch) {
      return res.status(200).json({ past: [], total: 0, keyword });
    }

    const nextData = JSON.parse(nextDataMatch[1]);
    const list = nextData?.props?.pageProps?.ss_data?.list || [];

    const top2 = list.slice(0, 2);

    const past = await Promise.all(top2.map(async (item) => {
      const labangId = item.labang_id;
      const realUrl = await getRealUrl(labangId);
      const ds = item.labang_datetime_start || '';
      const date = ds.length >= 8
        ? '20' + ds.slice(0,2) + '.' + ds.slice(2,4) + '.' + ds.slice(4,6) + ' (' + ['월','화','수','목','금','토','일'][new Date('20'+ds.slice(0,2)+'-'+ds.slice(2,4)+'-'+ds.slice(4,6)).getDay()] + ') ' + ds.slice(6,8) + ':' + (ds.slice(8,10) || '00')
        : '';

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
