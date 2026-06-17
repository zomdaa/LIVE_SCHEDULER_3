export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  const cleanKeyword = String(keyword).normalize('NFC').trim();
  const encoded = encodeURIComponent(cleanKeyword);

  try {
    const response = await fetch('https://live.ecomm-data.com/search?keyword=' + encoded, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://live.ecomm-data.com/',
      },
    });

    const html = await response.text();
    const hasLabang = html.includes('report/labang');
    const hasPipe = html.includes('|');
    const preview = html.substring(0, 1500);

    return res.status(200).json({
      original_keyword: keyword,
      clean_keyword: cleanKeyword,
      encoded_used: encoded,
      status: response.status,
      hasLabang,
      hasPipe,
      html_length: html.length,
      preview,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
