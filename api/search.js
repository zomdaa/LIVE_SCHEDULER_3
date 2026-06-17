export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const r = await fetch('https://live.ecomm-data.com/api/schedule/list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Origin': 'https://live.ecomm-data.com',
        'Referer': 'https://live.ecomm-data.com/schedule/lb',
      },
      body: JSON.stringify({ date: '260501' }),
    });

    const data = await r.json();
    return res.status(200).json({
      status: r.status,
      count: data?.list?.length || 0,
      sample: data?.list?.slice(0, 2) || [],
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
