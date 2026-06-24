import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { ids } = req.query;
    if (!ids) return res.status(400).json({ error: 'ids is required' });
    const idList = String(ids).split(',').filter(Boolean).slice(0, 50);

    try {
      const counts = {};
      await Promise.all(idList.map(async (id) => {
        const val = await kv.get('like-count:' + id);
        counts[id] = typeof val === 'number' ? val : 0;
      }));
      return res.status(200).json({ counts });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { id, action } = req.body || {};
    if (!id || !['like', 'unlike'].includes(action)) {
      return res.status(400).json({ error: 'id and valid action are required' });
    }

    const key = 'like-count:' + id;

    try {
      let count;
      if (action === 'like') {
        count = await kv.incr(key);
      } else {
        count = await kv.decr(key);
        if (count < 0) {
          count = 0;
          await kv.set(key, 0);
        }
      }
      return res.status(200).json({ id, count });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
