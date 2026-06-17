export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  // 오늘부터 30일치 날짜 생성
  const dates = [];
  const now = new Date();
  for (let i = 0; i <= 30; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${yy}${mm}${dd}`);
  }

  try {
    // 병렬로 날짜별 편성표 fetch (최대 7일치만 — 너무 많으면 느려짐)
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

    // 오늘 + 앞으로 6일 = 7일치 병렬 fetch
    const results = await Promise.all(dates.slice(0, 7).map(fetchDate));
    const allItems = results.flat();

    // 브랜드명으로 필터링 (제목에 키워드 포함)
    const kw = keyword.toLowerCase();
    const filtered = allItems.filter(item =>
      item.labang_title?.toLowerCase().includes(kw)
    ).map(item => ({
      title: item.labang_title,
      platform: item.platform_name,
      start: item.labang_datetime_start,
      end: item.labang_datetime_end,
      status: item.status,
      id: item.labang_id,
      url: item.labang_id ? `https://live.ecomm-data.com/report/labang/${item.labang_id}` : null,
    }));

    res.status(200).json({ upcoming: filtered, total: filtered.length, keyword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
