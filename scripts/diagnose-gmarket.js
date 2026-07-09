// 진단용 스크립트: GitHub Actions 러너의 IP로 G마켓 라이브 페이지가 Cloudflare
// Managed Challenge를 통과하는지 확인한다. 통과하면 실제 방송 데이터를 찾기 위해
// 페이지가 호출하는 네트워크 요청 목록을 로그로 남긴다.
// GitHub Actions 로그를 직접 조회할 수 없어 결과를 /api/debug 로 전송해서 확인한다.
const { chromium } = require('playwright');

const TARGETS = [
  'https://www.gmarket.co.kr/n/live',
  'https://m.gmarket.co.kr/n/live',
];
const DEBUG_URL = 'https://buynoworlive.vercel.app/api/debug?name=gmarket';
const INGEST_SECRET = process.env.INGEST_SECRET;

const lines = [];
function log(...args) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log(line);
  lines.push(line);
}

async function checkUrl(browser, url) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'ko-KR',
  });
  const page = await context.newPage();

  const requests = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/api|json|graphql/i.test(u)) requests.push({ method: req.method(), url: u });
  });

  log(`\n=== ${url} ===`);
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    log('status:', res?.status());
    await page.waitForTimeout(5000); // 챌린지가 자동으로 풀릴 시간을 준다

    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300) || '');
    log('title:', title);
    log('body preview:', bodyText.replace(/\s+/g, ' '));
    log('looks like cloudflare challenge:', /just a moment|잠시만 기다려|checking your browser/i.test(title + bodyText));

    log('captured api-like requests:', requests.length);
    requests.slice(0, 30).forEach((r) => log(' ', r.method, r.url));
  } catch (e) {
    log('failed:', e.message);
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch();
  for (const url of TARGETS) {
    await checkUrl(browser, url);
  }
  await browser.close();
}

main()
  .catch((err) => {
    log('fatal:', err.message);
  })
  .finally(async () => {
    if (!INGEST_SECRET) {
      console.warn('INGEST_SECRET 없음 - 디버그 로그 전송 스킵');
      return;
    }
    try {
      await fetch(DEBUG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ingest-secret': INGEST_SECRET },
        body: JSON.stringify({ text: lines.join('\n') }),
      });
    } catch (e) {
      console.error('failed to send debug log:', e.message);
    }
  });
