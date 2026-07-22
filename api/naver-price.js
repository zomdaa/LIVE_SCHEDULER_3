import { kv } from '@vercel/kv';

// 네이버 쇼핑 검색 오픈API로 키워드의 인기 모델 최저가를 가져온다.
// https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md
//
// 오픈API 자체엔 찜/리뷰수 필드가 없어서 정확히 그 기준으로 정렬은 불가능하다.
// 대신 정확도순(sort=sim, 네이버 자체 랭킹 - 클릭/구매 등 인기 신호를 반영)으로
// 받아온 뒤 렌탈/구독 상품을 걸러내고 서로 다른 상품을 뽑는다.
// 최대 5개까지 반환하고, 몇 개를 보여줄지(모바일 3 / PC 5)는 프론트에서 정한다.
const MAX_ITEMS = 5;
const RENTAL_KEYWORDS = ['렌탈', '렌트', '구독', '멤버십'];
const CACHE_TTL = 3600; // 네이버 오픈API 일일 쿼터 보호용 - 같은 키워드는 1시간 재사용

function isRental(title) {
  return RENTAL_KEYWORDS.some(kw => title.includes(kw));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  const cleanKeyword = String(keyword).trim();
  const cacheKey = 'naver-price:' + cleanKeyword.toLowerCase();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rateKey = 'rate-naver-price:' + ip;
  try {
    const count = await kv.incr(rateKey);
    if (count === 1) await kv.expire(rateKey, 60);
    if (count > 30) {
      return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' });
    }
  } catch (e) {}

  try {
    const cached = await kv.get(cacheKey);
    // 캐시엔 items만 저장하고 affiliate id는 매번 최신 환경변수 값을 얹는다 -
    // 환경변수가 바뀌어도 캐시가 살아있는 1시간 동안 옛 값이 굳어버리지 않도록
    if (cached) {
      return res.status(200).json({
        ...cached,
        coupangAffiliateId: process.env.COUPANG_AFFILIATE_ID || '',
        cached: true,
      });
    }
  } catch (e) {}

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Naver API credentials are not configured' });
  }

  try {
    const params = new URLSearchParams({ query: cleanKeyword, display: '30', sort: 'sim' });
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
      if (items.length >= MAX_ITEMS) break;
    }

    if (!items.length) {
      return res.status(404).json({ error: 'no results found', keyword: cleanKeyword });
    }

    // 쿠팡 제휴 ID는 서버 환경변수에만 있고 정적 파일인 index.html에서는 직접
    // 읽을 수 없다 - 이미 호출하는 이 응답에 실어 보내 프론트가 쿠팡 링크를
    // 만들 때 쓰게 한다. 캐시된 응답에도 매번 최신 값을 얹어 반환한다
    const responseBody = {
      keyword: cleanKeyword,
      items,
      coupangAffiliateId: process.env.COUPANG_AFFILIATE_ID || '',
    };
    try {
      await kv.set(cacheKey, { keyword: cleanKeyword, items }, { ex: CACHE_TTL });
    } catch (e) {}

    res.status(200).json(responseBody);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
