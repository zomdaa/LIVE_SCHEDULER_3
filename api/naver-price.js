// 네이버 쇼핑 검색 오픈API로 키워드의 현재 최저가를 가져온다.
// https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Naver API credentials are not configured' });
  }

  try {
    const params = new URLSearchParams({ query: keyword, display: '1', sort: 'asc' });
    const r = await fetch(`https://openapi.naver.com/v1/search/shop.json?${params}`, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    });

    if (!r.ok) {
      return res.status(r.status).json({ error: 'Naver shopping API request failed' });
    }

    const data = await r.json();
    const item = data.items?.[0];
    if (!item) {
      return res.status(404).json({ error: 'no results found', keyword });
    }

    res.status(200).json({
      keyword,
      lowestPrice: item.lprice ? Number(item.lprice) : null,
      productName: (item.title || '').replace(/<\/?b>/g, ''),
      productUrl: item.link || '',
      mallName: item.mallName || '',
      image: item.image || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
