import { kv } from '@vercel/kv';

function parseLabangDate(str) {
  if (!str || str.length < 8) return null;
  const yy = str.slice(0, 2), mm = str.slice(2, 4), dd = str.slice(4, 6);
  const hh = str.slice(6, 8), mi = str.slice(8, 10) || '00';
  return new Date(`20${yy}-${mm}-${dd}T${hh}:${mi}:00`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { ids, top, debug, cleanup } = req.query;

    if (debug) {
      try {
        const allIds = await kv.smembers('liked-broadcast-ids');
        const items = await Promise.all((allIds || []).map(async (id) => {
          const count = await kv.get('like-count:' + id);
          const meta = await kv.get('like-meta:' + id);
          return { id, count, meta };
        }));
        return res.status(200).json({ now: new Date().toISOString(), items });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (cleanup) {
      try {
        const allIds = await kv.smembers('liked-broadcast-ids');
        let removed = 0;
        for (const id of (allIds || [])) {
          const meta = await kv.get('like-meta:' + id);
          if (!meta?.end) {
            await kv.srem('liked-broadcast-ids', id);
            removed++;
          }
        }
        return res.status(200).json({ removed });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (top) {
      try {
        const allIds = await kv.smembers('liked-broadcast-ids');
        if (!allIds || allIds.length === 0) {
          return res.status(200).json({ items: [] });
        }
        const items = await Promise.all(allIds.map(async (id) => {
          const count = await kv.get('like-count:' + id);
          const meta = await kv.get('like-meta:' + id);
          return {
            id,
            count: typeof count === 'number' ? count : 0,
            title: meta?.title || '',
            url: meta?.url || '',
            platform: meta?.platform || '',
            end: meta?.end || '',
          };
        }));

        const now = new Date();
        const stillLive = items.filter(item => {
          if (!item.end) return false;
          const endDate = parseLabangDate(item.end);
          return !endDate || endDate >= now;
        });

        const sorted = stillLive
          .filter(i => i.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, Number(top) || 5);

        return res.status(200).json({ items: sorted });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

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
    const { id, action, title, url, platform, end } = req.body || {};
    if (!id || !['like', 'unlike'].includes(action)) {
      return res.status(400).json({ error: 'id and valid action are required' });
    }

    const key = 'like-count:' + id;

    try {
      let count;
      if (action === 'like') {
        count = await kv.incr(key);
        await kv.sadd('liked-broadcast-ids', id);
        if (title) {
          await kv.set('like-meta:' + id, { title, url: url || '', platform: platform || '', end: end || '' });
        }
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
