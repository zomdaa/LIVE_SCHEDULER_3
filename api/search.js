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
    // raw 데이터 첫 번째 항목 확인
    res.status(200).json({ raw: data, first_item: data?.list?.[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
