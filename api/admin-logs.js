import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const { key } = req.query;

  if (key !== 'zomda2332') {
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
</style>
</head>
<body>
  <h1>검색어 로그</h1>
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
