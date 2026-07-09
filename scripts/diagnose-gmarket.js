// 진단용 스크립트: GitHub Actions 러너의 IP로 G마켓 라이브 페이지가 Cloudflare
// Managed Challenge를 통과하는지 확인한다. 통과하면 실제 방송 데이터를 찾기 위해
// 페이지가 호출하는 네트워크 요청 목록을 로그로 남긴다.
// 결과는 GitHub Actions 웹 UI의 Actions 탭 → 이 워크플로우 실행 → diagnose-gmarket
// job 로그에서 직접 확인한다.
const { chromium } = require('playwright');

const TARGETS = [
  'https://www.gmarket.co.kr/n/live',
  'https://m.gmarket.co.kr/n/live',
];

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

  console.log(`\n=== ${url} ===`);
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('status:', res?.status());
    await page.waitForTimeout(5000); // 챌린지가 자동으로 풀릴 시간을 준다

    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300) || '');
    console.log('title:', title);
    console.log('body preview:', bodyText.replace(/\s+/g, ' '));
    console.log('looks like cloudflare challenge:', /just a moment|잠시만 기다려|checking your browser/i.test(title + bodyText));

    console.log('captured api-like requests:', requests.length);
    requests.slice(0, 30).forEach((r) => console.log(' ', r.method, r.url));
  } catch (e) {
    console.error('failed:', e.message);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
