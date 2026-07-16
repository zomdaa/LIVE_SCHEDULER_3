import { kv } from '@vercel/kv';
import webpush from 'web-push';
import crypto from 'crypto';

// 웹푸시 알림 - 예약(schedule)된 방송 시작 시각이 되면 외부 크론이 주기적으로
// 호출하는 check-due가 실제로 브라우저 푸시 서비스에 알림을 쏴준다.
// (Vercel Hobby 크론은 하루 1번뿐이라 자체 스케줄러로는 분 단위 트리거가 불가능함)

// 같은 순간에 알림이 몰릴 수 있어 발송 루프에 여유를 준다 (아래 CHECK_CONCURRENCY 참고)
export const config = { maxDuration: 60 };

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

const CHECK_CONCURRENCY = 10; // 순차 발송이면 알림이 몰릴 때 크론 주기 안에 다 못 보낼 수 있어 병렬화

async function sendDuePush(member) {
  try {
    const payload = await kv.get('push-payload:' + member);
    await kv.zrem('push-schedule', member);
    await kv.del('push-payload:' + member);
    if (!payload) return 'skipped';
    await webpush.sendNotification(payload.subscription, JSON.stringify({
      title: '🔔 알림 걸어둔 방송이 곧 시작합니다!',
      body: `${formatKstDateTime(payload.startAt)} · ${payload.title || ''}`,
      url: payload.url || '/',
    }));
    return 'sent';
  } catch (err) {
    return 'failed';
  }
}

// 고정 개수의 워커가 큐를 나눠 처리하는 방식 - Promise.all(items.map(...))처럼
// 한꺼번에 다 쏘지 않고, 동시에 최대 CHECK_CONCURRENCY개만 진행되게 제한한다
async function processDueQueue(members, limit) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < members.length) {
      const i = cursor++;
      results[i] = await sendDuePush(members[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, members.length) }, worker));
  return results;
}

// Vercel 서버리스 함수는 UTC로 도니, startAt(epoch ms)을 KST 벽시계 문자열로
// 보이려면 명시적으로 +9시간을 더한 뒤 getUTC*로 읽어야 서버 로컬 TZ에 안 흔들린다
function formatKstDateTime(startAt) {
  if (!startAt) return '';
  const kst = new Date(startAt + 9 * 60 * 60 * 1000);
  const mm = kst.getUTCMonth() + 1;
  const dd = kst.getUTCDate();
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
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
        startAt: broadcast.startAt,
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
      const results = await processDueQueue(due, CHECK_CONCURRENCY);
      const sent = results.filter(r => r === 'sent').length;
      const failed = results.filter(r => r === 'failed').length;
      return res.status(200).json({ checked: due.length, sent, failed });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'unknown action' });
}
