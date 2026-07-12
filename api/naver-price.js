// 네이버 쇼핑 검색 오픈API로 키워드의 인기 모델 3개 최저가를 가져온다.
// https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md
//
// 오픈API 자체엔 찜/리뷰수 필드가 없어서 정확히 그 기준으로 정렬은 불가능하다.
// 대신 정확도순(sort=sim, 네이버 자체 랭킹 - 클릭/구매 등 인기 신호를 반영)으로
// 받아온 뒤 렌탈/구독 상품을 걸러내고 상위 3개 서로 다른 상품을 뽑는다.
const RENTAL_KEYWORDS = ['렌탈', '렌트', '구독', '멤버십'];

function isRental(title) {
  return RENTAL_KEYWORDS.some(kw => title.includes(kw));
}

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
    const params = new URLSearchParams({ query: keyword, display: '30', sort: 'sim' });
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
    const seen = new Set();
    const items = [];

    for (const raw of data.items || []) {
      const title = (raw.title || '').replace(/<\/?b>/g, '');
      if (!title || isRental(title)) continue;
      const dedupeKey = raw.productId || title;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      items.push({
        productName: title,
        lowestPrice: raw.lprice ? Number(raw.lprice) : null,
        productUrl: raw.link || '',
        mallName: raw.mallName || '',
        image: raw.image || '',
      });
      if (items.length >= 3) break;
    }

    if (!items.length) {
      return res.status(404).json({ error: 'no results found', keyword });
    }

    res.status(200).json({ keyword, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
