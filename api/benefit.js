import { kv } from '@vercel/kv';
import { waitUntil } from '@vercel/functions';

// 방송 상세 페이지의 "혜택" 정보를 캐싱한다. 카드에 바로 붙는 혜택 뱃지는
// 세 가지 경로로 채워진다:
// 1) API: 네이버/카카오는 crawl.js의 DETAIL_FETCHERS(action=detail)가 이미
//    구조화된 혜택 텍스트를 정식 API로 받아온다 - 여기선 그 엔드포인트를
//    서버 대 서버로 그대로 재사용한다 (크롬 확장이나 OCR 없이 전체 방송에
//    자동 적용됨). resolveApiSource()가 카드 url에서 platform/id를 역추출한다.
// 2) 텍스트: SSG/올리브영/G마켓/CJ온스타일처럼 별도 API가 없는 곳은 크롬
//    익스텐션이 방송 상세 페이지에서 혜택 텍스트를 DOM에서 직접 찾아 여기로
//    POST한다 (rawText).
// 3) OCR: 혜택이 이미지로만 존재하면 익스텐션이 이미지 URL을 POST하고(imageUrl)
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
// /lives/{id})과 정확히 맞아야 하므로 실제 캐시 데이터로 검증된 패턴만 쓴다
function resolveApiSource(id) {
  const url = String(id || '');
  let m = url.match(/shoppinglive\.kakao\.com\/live\/(\d+)/);
  if (m) return { platform: 'kakao', detailId: m[1] };
  m = url.match(/naver\.com\/lives\/(\d+)/);
  if (m) return { platform: 'naver', detailId: m[1] };
  return null;
}

// crawl.js의 기존 상세 API(action=detail)를 서버 대 서버로 재사용한다 -
// 카카오/네이버 API 호출 로직을 여기 따로 복제하지 않고, 이미 캐싱/레이트리밋까지
// 갖춰진 그 엔드포인트를 그대로 호출한다
async function fetchApiBenefit(id, source, baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/api/crawl?action=detail&platform=${source.platform}&id=${source.detailId}`);
    if (!r.ok) return null;
    const data = await r.json();
    const benefits = data.detail?.benefits || [];
    let raw;
    let resultSource;
    if (benefits.length) {
      raw = benefits.join(' · ').slice(0, 2000);
      resultSource = 'api';
    } else {
      // 네이버는 혜택이 텍스트가 아니라 배너 이미지로만 있는 경우가 많다
      // (benefits는 비어있고 benefitImages만 채워짐) - 이미 있는 OCR 경로를 재사용한다
      const bannerUrl = data.detail?.benefitImages?.[0];
      if (!bannerUrl) return null;
      raw = (await runOcr(bannerUrl)).slice(0, 2000);
      resultSource = 'api-ocr';
    }
    const parsed = parseBenefit(raw);
    const result = { id, raw, parsed, source: resultSource, cachedAt: new Date().toISOString() };
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
          if (cached) { results[bid] = cached; return; }
          const source = resolveApiSource(bid);
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
      if (cached) return res.status(200).json({ benefit: cached });
      const source = resolveApiSource(id);
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
    const { id, imageUrl, rawText } = req.body || {};
    if (!id || (!imageUrl && !rawText)) {
      return res.status(400).json({ error: 'id and (imageUrl or rawText) are required' });
    }

    try {
      const cached = await kv.get('benefit:' + id);
      if (cached) return res.status(200).json({ benefit: cached, cached: true });
    } catch (e) {}

    try {
      // 상세 페이지 DOM에 혜택이 텍스트로 이미 있는 경우(예: G마켓의 sauceflex
      // 플레이어)는 OCR 없이 그 텍스트를 바로 쓴다 - 이미지보다 훨씬 정확하다.
      // 텍스트가 없을 때만 이미지 URL로 OCR을 돌린다
      const raw = rawText ? String(rawText).slice(0, 2000) : await runOcr(imageUrl);
      const parsed = parseBenefit(raw);
      const result = { id, raw, parsed, source: rawText ? 'text' : 'ocr', cachedAt: new Date().toISOString() };
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
