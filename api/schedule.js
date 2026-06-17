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

    // 디버그: 첫 5개 raw 데이터 확인
    return res.status(200).json({
      debug: allItems.slice(0, 5).map(i => ({
        title: i.labang_title,
        platform_id: i.platform_id,
        pid: i.pid,
        labang_id: i.labang_id,
      }))
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
