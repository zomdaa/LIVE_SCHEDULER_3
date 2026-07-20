// 방송 상세 페이지에서 "혜택"과 "상품(가격)" 정보를 찾아 백엔드로 넘긴다.
// crawl.js가 이미 구조화된 API를 갖고 있는 네이버/카카오/11번가/SSG는 대상이
// 아니고(서버에서 직접 처리), 별도 API가 없는 올리브영/G마켓/오늘의집이 대상이다.
// (CJ온스타일은 대상 페이지 자체가 스케줄 목록 공용 URL이라 여기선 사실상 동작하지
// 않는다 - 실제 개별 방송 데이터는 crawl.js의 스케줄 API 응답에 이미 있음)
//
// 사이트마다 DOM 구조가 완전히 달라서 플랫폼별로 추출 함수를 따로 둔다:
// - G마켓(player.sauceflex.com): 혜택은 "🎁 라이브 혜택"으로 시작하는 순수
//   텍스트 블록, 상품은 li[class*="ProductGridView-module__root__"] 카드
// - 올리브영(m.oliveyoung.co.kr): 상품/혜택 둘 다 li[class*="ArticleTemplate_item__"]
//   카드 형태로 나오는데, "정가...라이브특가...원" 패턴이 있으면 상품, 없으면 혜택
// - 오늘의집(store.ohou.se): 여러 브랜드의 방송이 한 기획전 페이지에 다 모여있어
//   (개별 방송 URL이 없음) .product-info 카드를 브랜드별로 묶어서 처리한다
//
// id로 crawl.js 내부의 platform별 id 포맷을 그대로 맞추려면 각 페이지에서 그
// 값을 다시 파싱해야 하는데 검증이 어려워 위험하다. 대신 페이지 URL 자체
// (location.origin+pathname)를 캐시 키로 쓴다 - index.html도 카드의 item.url로
// 조회하므로 양쪽이 절대 어긋나지 않는다. 오늘의집만 예외로, 모든 방송이 같은
// URL을 공유해서 대신 "ohouse-brand:{브랜드명}"을 키로 쓴다 (crawl.js의
// ohouseToCard가 만드는 item.id가 "ohouse-{채널}-{시작시각}" 형식이라 이미
// 브랜드명을 알고 있고, index.html 쪽에서 그에 맞춰 조회 키를 바꿔줘야 한다)

const BENEFIT_API = 'https://buynoworlive.vercel.app/api/benefit';
const BENEFIT_KEYWORDS = /혜택|benefit|event|이벤트|쿠폰|coupon|증정|사은품|할인|promotion|프로모션/i;
const SEEN_KEY = 'benefitSeenUrls';
const SEEN_TTL_MS = 6 * 60 * 60 * 1000; // 같은 방송 페이지를 반복 방문해도 6시간엔 한 번만 시도

async function alreadyTried(key) {
  try {
    const { [SEEN_KEY]: seen = {} } = await chrome.storage.local.get(SEEN_KEY);
    const at = seen[key];
    return typeof at === 'number' && Date.now() - at < SEEN_TTL_MS;
  } catch (e) {
    return false;
  }
}

async function markTried(key) {
  try {
    const { [SEEN_KEY]: seen = {} } = await chrome.storage.local.get(SEEN_KEY);
    seen[key] = Date.now();
    // 무한정 쌓이지 않게 최근 200개만 유지
    const entries = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 200);
    await chrome.storage.local.set({ [SEEN_KEY]: Object.fromEntries(entries) });
  } catch (e) {}
}

async function postBenefit(payload) {
  try {
    await fetch(BENEFIT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // 실패해도 조용히 무시 - 다음 6시간 뒤 재시도됨
  }
}

// "🎁 라이브 혜택"처럼 혜택 섹션의 제목으로 보이는 텍스트 노드를 찾은 뒤,
// 부모로 한 단계씩 올라가며 그 혜택 블록만 담고 있는 가장 좁은 컨테이너를
// 찾는다. 클래스명이 CSS 모듈 해시(예: ___d2u7j)라 그대로 하드코딩하면 배포마다
// 깨지니, 대신 "텍스트가 더 이상 늘어나지 않는 지점"으로 판단한다 (실제 G마켓
// sauceflex 플레이어 DOM으로 검증됨: 9자 제목 -> 170자 혜택 블록에서 멈춤)
function findBenefitTextBlock() {
  const heading = [...document.querySelectorAll('*')].find(
    (el) => el.children.length === 0 && /🎁|라이브\s*혜택/.test(el.textContent || '')
  );
  if (!heading) return null;

  let node = heading;
  let text = (node.textContent || '').trim();
  let parent = node.parentElement;
  while (parent) {
    const parentText = (parent.textContent || '').trim();
    if (parentText.length <= text.length) break;
    node = parent;
    text = parentText;
    parent = node.parentElement;
  }
  return text || null;
}

// 페이지 안에서 "혜택스러운" 이미지를 찾는다 (텍스트 블록을 못 찾았을 때만 폴백)
function findBenefitImage() {
  const imgs = [...document.querySelectorAll('img')];
  const candidates = imgs.filter((img) => {
    const haystack = `${img.className || ''} ${img.id || ''} ${img.alt || ''}`;
    return BENEFIT_KEYWORDS.test(haystack);
  });
  const pool = candidates.length > 0 ? candidates : imgs;

  let best = null;
  let bestArea = 0;
  for (const img of pool) {
    const rect = img.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area <= 0) continue;
    if (candidates.length === 0 && area < 10000) continue;
    if (area > bestArea) {
      bestArea = area;
      best = img;
    }
  }
  if (!best) return null;
  return best.currentSrc || best.src || best.dataset.src || null;
}

// G마켓 sauceflex 플레이어: 상품 카드 li[class*="ProductGridView-module__root__"],
// "브랜드+상품명 정가X원할인율Y%판매가Z원구매하기" 패턴
function extractGmarketProducts() {
  const items = [...document.querySelectorAll('li[class*="ProductGridView-module__root__"]')];
  const PRICE_RE = /^(.*?)정가\s*([\d,]+)원할인율\s*(\d+)%판매가\s*([\d,]+)원구매하기$/;
  const products = [];
  items.forEach((li) => {
    const text = li.textContent.trim().replace(/\s+/g, '');
    const m = text.match(PRICE_RE);
    if (!m) return;
    products.push({
      name: m[1].trim(),
      price: Number(m[4].replace(/,/g, '')),
      discountRate: Number(m[3]),
      image: li.querySelector('img')?.src || null,
      url: null,
    });
  });
  return products;
}

// 올리브영: li[class*="ArticleTemplate_item__"] 카드가 상품/혜택 리스트 둘 다에
// 재사용된다 - "정가...라이브특가...원" 패턴이 있으면 상품, 없으면 혜택 문구
function extractOliveyoung() {
  const items = [...document.querySelectorAll('li[class*="ArticleTemplate_item__"]')];
  const PRICE_RE = /^(.*?)정가\s*([\d,]+)원라이브특가\s*([\d,]+)원(?:(\d+)%)?$/;
  const products = [];
  const benefits = [];
  items.forEach((li) => {
    const text = li.textContent.trim();
    if (!text) return;
    const m = text.match(PRICE_RE);
    if (m) {
      products.push({
        name: m[1].trim(),
        price: Number(m[3].replace(/,/g, '')),
        discountRate: m[4] ? Number(m[4]) : null,
        image: li.querySelector('img')?.src || null,
        url: null,
      });
    } else {
      benefits.push(text.replace(/\s+/g, ' '));
    }
  });
  return { products, rawText: benefits.join(' · ') || null };
}

// 오늘의집: 기획전 페이지 하나에 여러 브랜드의 방송이 다 모여있다. 브랜드명이
// .product-brand로 각 상품 카드에 박혀있어, 이걸로 브랜드별 상품 목록을 묶는다
function extractOhouseByBrand() {
  const infos = [...document.querySelectorAll('.product-info')];
  const byBrand = {};
  infos.forEach((info) => {
    const brand = info.querySelector('.product-brand')?.textContent.trim();
    const name = info.querySelector('.product-name')?.textContent.trim();
    if (!brand || !name) return;
    const priceText = info.querySelector('.price')?.textContent || '';
    const m = priceText.match(/(\d+)%\s*([\d,]+)/);
    const product = {
      name,
      price: m ? Number(m[2].replace(/,/g, '')) : null,
      discountRate: m ? Number(m[1]) : null,
      image: info.closest('article,li')?.querySelector('img')?.src || null,
      url: null,
    };
    (byBrand[brand] = byBrand[brand] || []).push(product);
  });
  return byBrand;
}

async function runOhouse() {
  const byBrand = extractOhouseByBrand();
  const brands = Object.keys(byBrand);
  for (const brand of brands) {
    const key = 'ohouse-brand:' + brand;
    if (await alreadyTried(key)) continue;
    await markTried(key);
    await postBenefit({ id: key, products: byBrand[brand] });
  }
}

async function runSingleBroadcastPage() {
  // location.href를 그대로 쓰면 안 된다 - sauceflex 플레이어처럼 쿼리스트링
  // 없이 방문해도 끝에 빈 "?"가 붙는 경우가 있어, index.html이 crawl.js에서
  // 받는 깨끗한 item.url과 어긋나 캐시는 저장되는데 카드에는 안 붙는 문제가
  // 있었다. origin+pathname만 써서 쿼리/해시를 항상 제거한다
  const url = location.origin + location.pathname;
  if (await alreadyTried(url)) return;

  let rawText = null;
  let imageUrl = null;
  let products = [];

  if (location.hostname.includes('sauceflex')) {
    rawText = findBenefitTextBlock();
    if (!rawText) imageUrl = findBenefitImage();
    products = extractGmarketProducts();
  } else if (location.hostname.includes('oliveyoung')) {
    const extracted = extractOliveyoung();
    rawText = extracted.rawText;
    products = extracted.products;
  } else {
    // CJ온스타일 등 아직 전용 로직이 없는 곳은 기존처럼 텍스트/이미지 폴백만 시도
    rawText = findBenefitTextBlock();
    if (!rawText) imageUrl = findBenefitImage();
  }

  if (!rawText && !imageUrl && products.length === 0) return;

  await markTried(url);
  await postBenefit({ id: url, ...(rawText ? { rawText } : imageUrl ? { imageUrl } : {}), products });
}

async function run() {
  if (location.hostname.includes('ohou.se')) {
    await runOhouse();
  } else {
    await runSingleBroadcastPage();
  }
}

// SPA 렌더링이라 초기 로드 직후엔 콘텐츠가 아직 없을 수 있어 약간 기다렸다가
// 한 번 시도하고, 이후 DOM 변화(지연 로딩 등)에도 한 번 더 반응한다
setTimeout(run, 2500);

let debounceTimer = null;
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(run, 1500);
});
observer.observe(document.body, { childList: true, subtree: true });
