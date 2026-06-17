export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  try {
    const response = await fetch('https://alltimeprice.com/search/?search=' + encodeURIComponent(keyword), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    });

    const html = await response.text();
    const hasProduct = html.includes('/product/?pid=');
    const preview = html.substring(0, 1500);

    res.status(200).json({ hasProduct, html_length: html.length, preview });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
