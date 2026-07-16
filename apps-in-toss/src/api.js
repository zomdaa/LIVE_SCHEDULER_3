// 기존 buynoworlive.vercel.app 백엔드를 그대로 재사용한다 - 앱인토스 미니앱은
// 토스 CDN 도메인에서 서빙되므로 상대경로가 아니라 절대 URL로 불러야 한다.
// api/*.js가 전부 Access-Control-Allow-Origin: * 를 내려주고 있어 CORS는 문제 없다.
export const API_BASE = 'https://buynoworlive.vercel.app';

export const CRAWL_PLATFORMS = [
  'naver', 'kakao', 'ssg', '11st', 'oliveyoung', 'gmarket', 'cjonstyle', 'musinsa', 'ohouse',
];

async function safeJson(url) {
  try {
    const r = await fetch(url);
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  }
}

export async function fetchCrawl(platform, keyword) {
  const params = new URLSearchParams({ platform });
  if (keyword) params.set('keyword', keyword);
  const data = await safeJson(`${API_BASE}/api/crawl?${params}`);
  return data?.upcoming || [];
}

export async function fetchAllUpcoming(keyword) {
  const results = await Promise.all(CRAWL_PLATFORMS.map((p) => fetchCrawl(p, keyword)));
  return results.flatMap((items, i) => items.map((item) => ({ ...item, platformKey: CRAWL_PLATFORMS[i] })));
}

export async function fetchPastSearch(keyword) {
  const data = await safeJson(`${API_BASE}/api/search?keyword=${encodeURIComponent(keyword)}`);
  return data?.past || [];
}

export async function fetchLikeMeta(ids) {
  if (!ids.length) return {};
  const data = await safeJson(`${API_BASE}/api/like?ids=${encodeURIComponent(ids.join(','))}&meta=true`);
  return data?.meta || {};
}

export async function fetchLikeCounts(ids) {
  if (!ids.length) return {};
  const data = await safeJson(`${API_BASE}/api/like?ids=${encodeURIComponent(ids.join(','))}`);
  return data?.counts || {};
}

export async function toggleLikeApi({ id, action, title, url, platform, start, end }) {
  try {
    const r = await fetch(`${API_BASE}/api/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, title, url, platform, start, end }),
    });
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  }
}

// 6개 직접 크롤러는 ISO 문자열("2026-07-16T20:00:00")을, 라방바(search.js) 쪽은
// 자체 숫자 포맷("2607092000")을 쓴다 - 기존 index.html의 parseLabangDate와 동일 로직
export function parseLabangDate(str) {
  if (!str || str.length < 8) return null;
  if (str.includes('-')) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }
  const yy = str.slice(0, 2), mm = str.slice(2, 4), dd = str.slice(4, 6);
  const hh = str.slice(6, 8), mi = str.slice(8, 10) || '00';
  return new Date(`20${yy}-${mm}-${dd}T${hh}:${mi}:00`);
}

export function fmtDate(d) {
  if (!d) return { month: '?', day: '?', time: '' };
  return {
    month: d.getMonth() + 1,
    day: d.getDate(),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}

export function daysFromNow(d) {
  if (!d) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((startOfTarget - startOfToday) / (1000 * 60 * 60 * 24));
}

export function dDayLabel(item) {
  const start = parseLabangDate(item.start);
  const end = parseLabangDate(item.end);
  const now = new Date();
  const isEnded = end ? end < now : false;
  const isLive = item.status === 1 && !isEnded;
  const days = daysFromNow(start);

  if (isEnded) return '종료';
  if (isLive) return '● LIVE';
  if (days === 0) {
    const diffMs = start ? start - now : null;
    if (diffMs === null || diffMs <= 0) return '오늘';
    if (diffMs < 60 * 60 * 1000) return `${Math.max(1, Math.round(diffMs / 60000))}분 후`;
    return `${Math.floor(diffMs / (60 * 60 * 1000))}시간 후`;
  }
  if (days === 1) return '내일';
  return `D-${days}`;
}
