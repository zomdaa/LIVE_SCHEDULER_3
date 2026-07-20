import { kv } from '@vercel/kv';
import { waitUntil } from '@vercel/functions';

// 방송 상세 페이지의 "혜택" + "가격(상품)" 정보를 캐싱한다. 이 둘을 같은
// 캐시 엔트리에 같이 넣는 이유는, 카카오/네이버/11번가/SSG는 어차피 같은
// 상세 조회 한 번으로 혜택과 상품 가격이 동시에 나오기 때문 - 따로 캐싱하면
// 같은 외부 API를 두 번 부르게 된다.
// 카드에 바로 붙는 혜택 뱃지 + 가격 추이 데이터는 네 가지 경로로 채워진다:
// 1) API: 네이버/카카오/11번가는 crawl.js의 DETAIL_FETCHERS(action=detail)가
//    이미 구조화된 혜택 텍스트와 products(가격 포함)를 정식 API로 받아온다 -
//    여기선 그 엔드포인트를 서버 대 서버로 그대로 재사용한다 (크롬 확장이나
//    OCR 없이 전체 방송에 자동 적용됨). resolveApiSource()가 카드 url에서
//    platform/id를 역추출한다.
// 2) SSG 전용: m.ssg.com 상세 페이지는 WAF 없이 서버에서 바로 fetch되고,
//    상품 가격이 HTML 안에 disp_cart_data라는 JSON으로 그대로 박혀있다
//    (fetchSsgProducts). 혜택은 여전히 배너 이미지 하나뿐이라 OCR로 읽는다.
// 3) 텍스트: 올리브영/G마켓/오늘의집처럼 별도 API가 없는 곳은 크롬 익스텐션이
//    방송 상세 페이지에서 혜택/상품 텍스트를 DOM에서 직접 찾아 여기로
//    POST한다 (rawText / products).
// 4) OCR: 혜택이 이미지로만 존재하면 익스텐션이 이미지 URL을 POST하고(imageUrl)
//    OCR.space로 읽는다. 텍스트가 있을 땐 이미지+OCR보다 훨씬 정확하므로
//    rawText가 항상 imageUrl보다 우선이다.
// 어느 경로든 한 번 채워지면 캐시에 저장해 같은 방송은 다시 안 부른다.

export const config = { maxDuration: 30 };

const OCR_SPACE_URL = 'https://api.ocr.space/parse/imageurl';
const CACHE_EX = 30 * 24 * 60 * 60; // 30일 - 방송 혜택은 한 번 정해지면 안 바뀐다

function parseBenefit(rawText) {
  const text = rawText || '';
  const discountMatch = text.match(/(\d{1,2})\s*%/);
  const couponMatch = text.match(/([가-힣A-Za-z0-9]{0,10}\s*쿠폰[가-힣A-Za-z0-9\s]{0,10})/);
  const giftMatch = text.match(/([가-힣A-Za-z0-9]{1,15}\s*증정|사은품[^\n]{0,20})/);
  return {
    discount: discountMatch ? `${discountMatch[1]}%` : null,
    coupon: couponMatch ? couponMatch[1].replace(/\s+/g, ' ').trim() : null,
    gift: giftMatch ? giftMatch[0].replace(/\s+/g, ' ').trim() : null,
  };
}

// 카드에 저장된 item.url만으로 어느 플랫폼의 어떤 방송인지 되짚어낸다 -
// crawl.js가 스케줄을 만들 때 쓰는 url 포맷(카카오: /live/{id}, 네이버:
// /lives/{id})과 정확히 맞아야 하므로 실제 캐시 데이터로 검증된 패턴만 쓴다.
// /api/search(라방바 과거 방송)가 주는 링크는 "/lives/"가 아니라 "/replays/"인데,
// 실제로 같은 숫자 id로 crawl.js의 상세 API가 그대로 응답하는 걸 확인했다 -
// 그래서 지난 방송(가격 추이의 주 데이터 소스)도 여기서 같이 잡히게 추가한다
function resolveApiSource(id) {
  const url = String(id || '');
  let m = url.match(/shoppinglive\.kakao\.com\/live\/(\d+)/);
  if (m) return { platform: 'kakao', detailId: m[1] };
  m = url.match(/naver\.com\/(?:lives|replays)\/(\d+)/);
  if (m) return { platform: 'naver', detailId: m[1] };
  m = url.match(/11st\.co\.kr\/page\/live11\/detail\?broadcastNo=(\d+)/);
  if (m) return { platform: '11st', detailId: m[1] };
  if (/m\.ssg\.com\/ssgLive\/detail\.ssg/.test(url)) return { platform: 'ssg', detailId: url };
  return null;
}

// SSG 상세 페이지(m.ssg.com/ssgLive/detail.ssg)는 WAF 없이 서버에서 바로
// fetch된다 - 상품 가격은 <span class="disp_cart_data">{...json...}</span>
// 안에 itemNm/displayPrc로 그대로 박혀있고, 혜택은 여전히 배너 이미지 하나뿐이라
// (sui.ssgcdn.com/cmpt/banner/...) 그 URL만 뽑아서 기존 OCR 경로로 넘긴다
async function fetchSsgProducts(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  });
  if (!r.ok) return { products: [], bannerUrl: null };
  const html = await r.text();

  const products = [];
  const seenItemIds = new Set();
  const cartRe = /class="disp_cart_data"[^>]*>(\{[^<]*\})<\/span>/g;
  let m;
  while ((m = cartRe.exec(html)) && products.length < 20) {
    try {
      const d = JSON.parse(m[1]);
      if (!d.itemNm || !d.displayPrc || seenItemIds.has(d.itemId)) continue;
      seenItemIds.add(d.itemId);
      products.push({
        name: d.itemNm,
        price: Number(d.displayPrc) || null,
        discountRate: null,
        image: null,
        url: d.itemLnkd || '',
      });
    } catch (e) {}
  }

  const bannerMatch = html.match(/https:\/\/sui\.ssgcdn\.com\/cmpt\/banner\/[^"'\s)]+/);
  return { products, bannerUrl: bannerMatch ? bannerMatch[0] : null };
}

// crawl.js의 기존 상세 API(action=detail)를 서버 대 서버로 재사용한다 -
// 카카오/네이버/11번가 API 호출 로직을 여기 따로 복제하지 않고, 이미
// 캐싱/레이트리밋까지 갖춰진 그 엔드포인트를 그대로 호출한다. SSG는 crawl.js에
// 없는 별도 경로라 fetchSsgProducts로 직접 처리한다
async function fetchApiBenefit(id, source, baseUrl) {
  try {
    let benefits = [];
    let benefitImages = [];
    let products = [];

    if (source.platform === 'ssg') {
      const ssgData = await fetchSsgProducts(source.detailId);
      products = ssgData.products;
      benefitImages = ssgData.bannerUrl ? [ssgData.bannerUrl] : [];
    } else {
      const r = await fetch(`${baseUrl}/api/crawl?action=detail&platform=${source.platform}&id=${source.detailId}`);
      if (!r.ok) return null;
      const data = await r.json();
      benefits = data.detail?.benefits || [];
      benefitImages = data.detail?.benefitImages || [];
      products = data.detail?.products || [];
    }

    let raw = '';
    let resultSource = source.platform === 'ssg' ? 'ssg' : 'api';
    if (benefits.length) {
      raw = benefits.join(' · ').slice(0, 2000);
    } else if (benefitImages[0]) {
      // 네이버/SSG는 혜택이 텍스트가 아니라 배너 이미지로만 있는 경우가 많다 -
      // 이미 있는 OCR 경로를 재사용한다
      raw = (await runOcr(benefitImages[0])).slice(0, 2000);
      resultSource += '-ocr';
      // bannerUrl도 없으면 진짜 혜택이 없는 방송 - raw는 빈 채로 "없음"을 캐싱해서
      // 매번 다시 조회하지 않게 한다 (뱃지는 어차피 parsed가 비면 안 뜬다)
    }
    const parsed = parseBenefit(raw);
    const result = { id, raw, parsed, products, source: resultSource, cachedAt: new Date().toISOString() };
    try { await kv.set('benefit:' + id, result, { ex: CACHE_EX }); } catch (e) {}
    return result;
  } catch (e) {
    return null;
  }
}

async function runOcr(imageUrl) {
  const apiKey = process.env.OCR_SPACE_API_KEY || process.env.OCR_SPACE_KEY;
  if (!apiKey) throw new Error('OCR_SPACE_API_KEY가 설정되지 않았어요');
  const params = new URLSearchParams({
    apikey: apiKey,
    url: imageUrl,
    language: 'kor',
    OCREngine: '2',
    scale: 'true',
    isOverlayRequired: 'false',
  });
  const r = await fetch(`${OCR_SPACE_URL}?${params}`);
  if (!r.ok) throw new Error('OCR 요청 실패: ' + r.status);
  const data = await r.json();
  if (data.IsErroredOnProcessing) {
    throw new Error(Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(', ') : 'OCR 처리 오류');
  }
  return data.ParsedResults?.[0]?.ParsedText || '';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rateKey = 'rate-benefit:' + ip;
  try {
    const count = await kv.incr(rateKey);
    if (count === 1) await kv.expire(rateKey, 60);
    if (count > 30) {
      return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' });
    }
  } catch (e) {}

  if (req.method === 'GET') {
    const { id, ids } = req.query;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${proto}://${host}`;

    if (ids) {
      // 캘린더처럼 카드가 많은 화면에서 카드 수만큼 요청을 안 쏘도록 배치 조회 지원
      const idList = String(ids).split(',').filter(Boolean).slice(0, 100);
      try {
        const results = {};
        const misses = [];
        await Promise.all(idList.map(async (bid) => {
          const cached = await kv.get('benefit:' + bid);
          const source = resolveApiSource(bid);
          if (cached) {
            results[bid] = cached;
            // products 필드를 추가하기 전에 캐싱된(혜택 텍스트만 있는) 오래된
            // 레코드는 products가 아예 없다(undefined) - 빈 배열([])과 구분해서,
            // "한 번도 상품을 확인한 적 없음"인 경우만 백그라운드로 다시 채운다.
            // 빈 배열은 이미 확인했는데 진짜 상품이 없는 경우라 다시 안 부른다
            if (source && cached.products === undefined) misses.push({ bid, source });
            return;
          }
          if (source) misses.push({ bid, source });
        }));
        // 카카오/네이버 API(+OCR 폴백) 호출은 미스가 많으면(날짜를 처음 열 때 등)
        // 30초 제한을 넘겨 요청 전체가 504로 죽어버릴 수 있다 - 실제로 겪은 문제라
        // 이미 캐시된 결과는 즉시 응답하고, 미스는 응답을 막지 않고 백그라운드에서
        // 채운다. 이번 응답엔 안 잡히지만 다음 로드부터는 캐시에서 바로 나온다
        if (misses.length) {
          const toFetch = misses.slice(0, 30);
          waitUntil((async () => {
            const CHUNK = 5;
            for (let i = 0; i < toFetch.length; i += CHUNK) {
              const chunk = toFetch.slice(i, i + CHUNK);
              await Promise.all(chunk.map(({ bid, source }) => fetchApiBenefit(bid, source, baseUrl)));
            }
          })());
        }
        return res.status(200).json({ benefits: results });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
    if (!id) return res.status(400).json({ error: 'id or ids is required' });
    try {
      const cached = await kv.get('benefit:' + id);
      const source = resolveApiSource(id);
      if (cached) {
        if (source && cached.products === undefined) waitUntil(fetchApiBenefit(id, source, baseUrl));
        return res.status(200).json({ benefit: cached });
      }
      if (source) {
        const result = await fetchApiBenefit(id, source, baseUrl);
        return res.status(200).json({ benefit: result });
      }
      return res.status(200).json({ benefit: null });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { id, imageUrl, rawText, products } = req.body || {};
    if (!id || (!imageUrl && !rawText && !products)) {
      return res.status(400).json({ error: 'id and (imageUrl or rawText or products) are required' });
    }

    try {
      const cached = await kv.get('benefit:' + id);
      // products가 새로 온 경우엔 캐시된 값이라도 상품 목록을 갱신한다 - 혜택
      // 텍스트/이미지는 방송당 한 번 확정되면 안 바뀌지만, 상품 목록은 익스텐션이
      // 같은 방송 페이지를 여러 번 방문할 때마다(가격 변동 등으로) 최신화할 가치가 있다
      if (cached && !products) return res.status(200).json({ benefit: cached, cached: true });
    } catch (e) {}

    try {
      let raw = '';
      let resultSource = 'text';
      if (rawText) {
        // 상세 페이지 DOM에 혜택이 텍스트로 이미 있는 경우(예: G마켓의 sauceflex
        // 플레이어)는 OCR 없이 그 텍스트를 바로 쓴다 - 이미지보다 훨씬 정확하다.
        raw = String(rawText).slice(0, 2000);
      } else if (imageUrl) {
        raw = (await runOcr(imageUrl)).slice(0, 2000);
        resultSource = 'ocr';
      } else {
        resultSource = 'products-only';
      }
      const parsed = parseBenefit(raw);
      const result = {
        id, raw, parsed,
        products: Array.isArray(products) ? products.slice(0, 20) : [],
        source: resultSource,
        cachedAt: new Date().toISOString(),
      };
      try {
        await kv.set('benefit:' + id, result, { ex: CACHE_EX });
      } catch (e) {}
      return res.status(200).json({ benefit: result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
