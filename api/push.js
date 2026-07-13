import { kv } from '@vercel/kv';
import webpush from 'web-push';
import crypto from 'crypto';

// 웹푸시 알림 - 예약(schedule)된 방송 시작 시각이 되면 외부 크론이 주기적으로
// 호출하는 check-due가 실제로 브라우저 푸시 서비스에 알림을 쏴준다.
// (Vercel Hobby 크론은 하루 1번뿐이라 자체 스케줄러로는 분 단위 트리거가 불가능함)

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:zomdaaa@gmail.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

function memberKey(broadcastId, endpoint) {
  const hash = crypto.createHash('sha1').update(endpoint).digest('hex').slice(0, 16);
  return `${broadcastId}::${hash}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.method === 'GET' ? req.query.action : req.body?.action;

  if (action === 'public-key') {
    if (!VAPID_PUBLIC) return res.status(500).json({ error: 'VAPID not configured' });
    return res.status(200).json({ publicKey: VAPID_PUBLIC });
  }

  if (req.method === 'POST' && action === 'schedule') {
    const { subscription, broadcast } = req.body || {};
    if (!subscription?.endpoint || !broadcast?.id || !broadcast?.startAt) {
      return res.status(400).json({ error: 'subscription and broadcast{id,startAt} are required' });
    }
    const member = memberKey(broadcast.id, subscription.endpoint);
    try {
      await kv.set('push-payload:' + member, {
        subscription,
        title: broadcast.title || '',
        url: broadcast.url || '',
        platform: broadcast.platform || '',
      }, { ex: 9 * 24 * 60 * 60 }); // 캘린더가 다루는 7일보다 여유있게
      await kv.zadd('push-schedule', { score: broadcast.startAt, member });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'cancel') {
    const { subscription, broadcastId } = req.body || {};
    if (!subscription?.endpoint || !broadcastId) {
      return res.status(400).json({ error: 'subscription and broadcastId are required' });
    }
    const member = memberKey(broadcastId, subscription.endpoint);
    try {
      await kv.zrem('push-schedule', member);
      await kv.del('push-payload:' + member);
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === 'check-due') {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return res.status(500).json({ error: 'VAPID not configured' });
    const secret = req.method === 'GET' ? req.query.secret : req.body?.secret;
    if (!process.env.PUSH_CRON_SECRET || secret !== process.env.PUSH_CRON_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const due = await kv.zrange('push-schedule', 0, Date.now(), { byScore: true });
      let sent = 0, failed = 0;
      for (const member of due) {
        const payload = await kv.get('push-payload:' + member);
        await kv.zrem('push-schedule', member);
        await kv.del('push-payload:' + member);
        if (!payload) continue;
        try {
          await webpush.sendNotification(payload.subscription, JSON.stringify({
            title: `🔴 ${payload.platform || '라이브'} 방송 시작!`,
            body: payload.title || '',
            url: payload.url || '/',
          }));
          sent++;
        } catch (err) {
          failed++;
        }
      }
      return res.status(200).json({ checked: due.length, sent, failed });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'unknown action' });
}
