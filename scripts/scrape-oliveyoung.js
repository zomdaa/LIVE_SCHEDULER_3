// GitHub Actions에서 실행: 실제 브라우저(Playwright)로 올리브영 라이브 편성표를 수집해
// Vercel의 /api/ingest 로 전송한다. Vercel 서버 IP가 올리브영 WAF에 막혀 있어
// 직접 크롤링이 안 되기 때문에, 차단되지 않은 GitHub Actions 러너 IP로 대신 수집한다.
const { chromium } = require('playwright');

const BASE = 'https://m.oliveyoung.co.kr/discovery/api/v2/live-shop/display/broadcast-calendar';
const RANGE_DAYS = 14;
const INGEST_URL = process.env.INGEST_URL;
const INGEST_SECRET = process.env.INGEST_SECRET;

function ymd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function toCard(item) {
  const live = item.liveCastingInformation || {};
  return {
    id: item.teaserNo,
    title: item.title || '',
    platform: '올리브영 라이브',
    channel: item.productsInformation?.onlineBrandName || '',
    start: live.castingStartDateTime || live.reservedStartDateTime || null,
    end: live.castingEndDateTime || live.reservedEndDateTime || null,
    status: live.onAirFlag ? 'ONAIR' : 'BEFORE',
    url: item.linkUrlAddress ? ('https://m.oliveyoung.co.kr/m/' + item.linkUrlAddress) : '',
  };
}

async function main() {
  if (!INGEST_SECRET) {
    console.warn('INGEST_SECRET이 설정되지 않았습니다 - 수집 후 전송 없이 로그만 남깁니다');
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();

  const homeRes = await page.goto('https://m.oliveyoung.co.kr/m/mtn/liveshop', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('home page status:', homeRes?.status());

  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
  const items = [];
  const seen = new Set();

  for (let i = 0; i <= RANGE_DAYS; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() + i);
    const dayStr = ymd(d);

    try {
      const res = await page.request.get(`${BASE}/detail?viewStdDate=${dayStr}`, {
        headers: { 'Referer': 'https://m.oliveyoung.co.kr/m/mtn/liveshop' },
      });
      if (res.ok()) {
        const json = await res.json();
        const scheduleItems = json?.data?.scheduleItems;
        if (Array.isArray(scheduleItems)) {
          scheduleItems.forEach((item) => {
            const card = toCard(item);
            if (card.id && !seen.has(card.id)) {
              seen.add(card.id);
              items.push(card);
            }
          });
        }
        console.log(`day ${dayStr}: ${Array.isArray(scheduleItems) ? scheduleItems.length : 0} items`);
      } else {
        console.log(`day ${dayStr}: HTTP ${res.status()}`);
      }
    } catch (e) {
      console.error(`day ${dayStr} failed:`, e.message);
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  await browser.close();

  console.log(`collected ${items.length} items total`);

  if (!INGEST_SECRET) {
    console.log('INGEST_SECRET 없음 - 전송 스킵');
    return;
  }

  const resp = await fetch(INGEST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ingest-secret': INGEST_SECRET,
    },
    body: JSON.stringify({ platform: 'oliveyoung', items }),
  });
  const text = await resp.text();
  console.log('ingest response:', resp.status, text);
  if (!resp.ok) throw new Error('ingest failed: ' + resp.status);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
