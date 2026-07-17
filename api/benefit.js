import { kv } from '@vercel/kv';

// 방송 상세 페이지의 "혜택" 배너 이미지를 OCR로 읽어서 텍스트로 캐싱한다.
// DETAIL_FETCHERS(crawl.js)가 이미 구조화된 혜택 데이터를 주는 네이버/카카오/
// 11번가/무신사와 달리, SSG/올리브영/G마켓/CJ온스타일/오늘의집은 혜택이
// 이미지로만 존재해서 별도 API가 없다 - 크롬 익스텐션이 방송 상세 페이지에서
// 혜택 이미지 URL을 감지해 여기로 넘기면, 같은 방송은 한 번만 OCR을 돌리고
// 그 다음부터는 캐시에서 꺼내 쓴다.

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
    if (ids) {
      // 캘린더처럼 카드가 많은 화면에서 카드 수만큼 요청을 안 쏘도록 배치 조회 지원
      const idList = String(ids).split(',').filter(Boolean).slice(0, 100);
      try {
        const results = {};
        await Promise.all(idList.map(async (bid) => {
          const cached = await kv.get('benefit:' + bid);
          if (cached) results[bid] = cached;
        }));
        return res.status(200).json({ benefits: results });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
    if (!id) return res.status(400).json({ error: 'id or ids is required' });
    try {
      const cached = await kv.get('benefit:' + id);
      return res.status(200).json({ benefit: cached || null });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { id, imageUrl } = req.body || {};
    if (!id || !imageUrl) return res.status(400).json({ error: 'id and imageUrl are required' });

    try {
      const cached = await kv.get('benefit:' + id);
      if (cached) return res.status(200).json({ benefit: cached, cached: true });
    } catch (e) {}

    try {
      const raw = await runOcr(imageUrl);
      const parsed = parseBenefit(raw);
      const result = { id, raw, parsed, cachedAt: new Date().toISOString() };
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
