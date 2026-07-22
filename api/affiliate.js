import { kv } from '@vercel/kv';

// 애드픽 "커미션 링크 생성" API를 감싼다. 애드픽 API는 키를 URL 경로에 그대로
// 박아서 호출하는 방식이라(https://biz.adpick.co.kr/api/{apikey}/link?url=...)
// 클라이언트에서 직접 부르면 키가 그대로 노출된다 - 그래서 여기서 서버 대 서버로만
// 호출하고, 프론트는 우리 자신의 이 엔드포인트만 호출한다.
// 같은 상품 URL은 캐싱한다 - 애드픽 쪽 레이트리밋이 분당 60회(linkonly=true)라
// 캐싱 없이 쓰면 검색 몇 번만 해도 금방 걸린다. 링크 자체는 바뀔 이유가 없으니
// 오래 캐싱해도 안전하다.

export const config = { maxDuration: 15 };

const CACHE_EX = 30 * 24 * 60 * 60; // 30일

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const cacheKey = 'affiliate-link:' + url;
  try {
    const cached = await kv.get(cacheKey);
    if (cached) return res.status(200).json({ link: cached });
  } catch (e) {}

  const apiKey = process.env.ADPICK_API_KEY;
  // 키가 아직 없거나(승인 전 등) 애드픽 쪽에서 실패해도 원본 링크로 계속
  // 동작해야 하니, 에러를 던지지 않고 항상 200 + link:null로 조용히 응답한다 -
  // 프론트는 이걸 "커미션 링크 없음 = 원본 링크 유지"로 처리한다
  if (!apiKey) return res.status(200).json({ link: null });

  try {
    const params = new URLSearchParams({ url: String(url), linkonly: 'true', p_data: 'buynoworlive' });
    const r = await fetch(`https://biz.adpick.co.kr/api/${apiKey}/link?${params}`);
    if (!r.ok) return res.status(200).json({ link: null });
    const data = await r.json();
    if (data.status !== 'success' || !data.commissionlink) {
      return res.status(200).json({ link: null });
    }
    try { await kv.set(cacheKey, data.commissionlink, { ex: CACHE_EX }); } catch (e) {}
    return res.status(200).json({ link: data.commissionlink });
  } catch (err) {
    return res.status(200).json({ link: null });
  }
}
