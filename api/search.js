export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  const encoded = encodeURIComponent(keyword);
  const url = 'https://live.ecomm-data.com/search?keyword=' + encoded;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://live.ecomm-data.com/',
      },
    });

    const html = await response.text();
    
    // 테이블 있는지 확인
    const hasTable = html.includes('|');
    const hasLabang = html.includes('report/labang');
    const preview = html.substring(0, 500);

    res.status(200).json({ hasTable, hasLabang, preview, html_length: html.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
