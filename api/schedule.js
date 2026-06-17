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
    dates.push(yy + mm + dd);
  }

  function buildUrl(platformId, pid, labangId) {
    if (!pid) return 'https://live.ecomm-data.com/report/labang/' + labangId;
    switch (platformId) {
      case 'kakao': return 'https://shoppinglive.kakao.com/live/' + pid;
      case 'naver': return 'https://shoppinglive.naver.com/livebridge/' + pid;
      case '11st':  return 'http://m.11st.co.kr/page/live11/detail?broadcastNo=' + pid;
      default:      return 'https://live.ecomm-data.com/report/labang/' + labangId;
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

    const kwTerms = keyword.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const filtered = allItems.filter(item => {
      if (!item.labang_title) return false;
      const title = item.labang_title.toLowerCase();
      return kwTerms.every(term => title.includes(term));
    });

    const debugSample = filtered.slice(0, 5).map(item => ({
      title: item.labang_title,
      platform_id: item.platform_id,
      platform_name: item.platform_name,
      pid: item.pid,
      labang_id: item.labang_id,
      built_url: buildUrl(item.platform_id, item.pid, item.labang_id),
    }));

    return res.status(200).json({ debug_count: filtered.length, debug_sample: debugSample });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
