import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const { key } = req.query;

  if (!process.env.ADMIN_LOGS_KEY || key !== process.env.ADMIN_LOGS_KEY) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(403).send('<h2>접근 권한이 없습니다.</h2>');
  }

  let logs = [];
  try {
    const raw = await kv.lrange('search-logs', 0, 199); // 최근 200개
    logs = raw.map(item => {
      try {
        return typeof item === 'string' ? JSON.parse(item) : item;
      } catch {
        return { keyword: String(item), time: '', ip: '' };
      }
    });
  } catch (e) {
    logs = [];
  }

  // 올리브영/G마켓/오늘의집은 GitHub Actions ingest에 전적으로 의존하므로,
  // 그 파이프라인이 멈춰도 조용히 빈 결과만 나오지 않도록 마지막 갱신 시각을 노출한다
  const INGEST_PLATFORMS = [
    { key: 'oliveyoung', label: '올리브영' },
    { key: 'gmarket', label: 'G마켓' },
    { key: 'ohouse', label: '오늘의집' },
  ];
  const STALE_MS = 6 * 60 * 60 * 1000; // ingest.js의 TTL과 동일한 기준
  const now = Date.now();
  const platformStatus = await Promise.all(INGEST_PLATFORMS.map(async (p) => {
    let ingestedAt = null;
    try {
      ingestedAt = await kv.get(`crawl-${p.key}:ingestedAt`);
    } catch (e) {}
    const ts = ingestedAt ? new Date(ingestedAt) : null;
    const stale = !ts || (now - ts.getTime()) > STALE_MS;
    return { ...p, timeStr: ts ? ts.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '갱신 기록 없음', stale };
  }));

  const statusRows = platformStatus.map(p =>
    `<tr><td>${p.label}</td><td>${p.timeStr}</td><td>${p.stale ? '<span class="bad">⚠ 지연/정지 의심</span>' : '<span class="ok">정상</span>'}</td></tr>`
  ).join('');

  const rows = logs.map(log => {
    const time = log.time ? new Date(log.time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
    return `<tr><td>${time}</td><td>${log.keyword || '-'}</td><td>${log.ip || '-'}</td></tr>`;
  }).join('');

  const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<title>검색어 로그</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #f9f7f3; padding: 2rem; color: #202020; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  p { color: #8d8d8d; font-size: 13px; margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; }
  th, td { padding: 10px 14px; text-align: left; font-size: 13px; border-bottom: 1px solid #eee; }
  th { background: #f3f0e8; font-weight: 700; }
  tr:last-child td { border-bottom: none; }
  .ok { color: #2a9d3f; font-weight: 700; }
  .bad { color: #ea2804; font-weight: 700; }
  h2 { font-size: 15px; margin: 2rem 0 0.5rem; }
</style>
</head>
<body>
  <h1>검색어 로그</h1>
  <h2>GitHub Actions ingest 상태</h2>
  <p>6시간 넘게 갱신 안 되면 지연/정지 의심</p>
  <table>
    <thead><tr><th>플랫폼</th><th>마지막 갱신</th><th>상태</th></tr></thead>
    <tbody>${statusRows}</tbody>
  </table>
  <h2>검색어 로그</h2>
  <p>최근 ${logs.length}건 (최신순)</p>
  <table>
    <thead><tr><th>시간</th><th>검색어</th><th>IP</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">로그가 없습니다.</td></tr>'}</tbody>
  </table>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
