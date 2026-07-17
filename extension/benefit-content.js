// 방송 상세 페이지에서 "혜택" 배너 이미지를 찾아 백엔드로 OCR을 요청한다.
// crawl.js가 이미 구조화된 혜택 API를 갖고 있는 네이버/카카오/11번가/무신사는
// 대상이 아니고, 이미지로만 혜택이 존재하는 SSG/올리브영/G마켓/CJ온스타일만
// 대상이다 (오늘의집은 개별 방송 상세 URL이 없어 이 방식이 안 맞는다).
//
// id로 crawl.js 내부의 platform별 id 포맷(teaserNo, broadcastSeq 등)을 그대로
// 맞추려면 각 페이지에서 그 값을 다시 파싱해야 하는데, 실제 방송 상세 페이지를
// 직접 열어보며 검증할 방법이 없어 값이 어긋날 위험이 크다. 대신 훨씬 안전한
// 방법으로, 페이지 URL 자체(location.href)를 캐시 키로 쓴다 - index.html도
// 카드의 item.url로 조회하면 되므로 양쪽이 절대 어긋나지 않는다.

const BENEFIT_API = 'https://buynoworlive.vercel.app/api/benefit';
const BENEFIT_KEYWORDS = /혜택|benefit|event|이벤트|쿠폰|coupon|증정|사은품|할인|promotion|프로모션/i;
const SEEN_KEY = 'benefitSeenUrls';
const SEEN_TTL_MS = 6 * 60 * 60 * 1000; // 같은 방송 페이지를 반복 방문해도 6시간엔 한 번만 시도

async function alreadyTried(url) {
  try {
    const { [SEEN_KEY]: seen = {} } = await chrome.storage.local.get(SEEN_KEY);
    const at = seen[url];
    return typeof at === 'number' && Date.now() - at < SEEN_TTL_MS;
  } catch (e) {
    return false;
  }
}

async function markTried(url) {
  try {
    const { [SEEN_KEY]: seen = {} } = await chrome.storage.local.get(SEEN_KEY);
    seen[url] = Date.now();
    // 무한정 쌓이지 않게 최근 200개만 유지
    const entries = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 200);
    await chrome.storage.local.set({ [SEEN_KEY]: Object.fromEntries(entries) });
  } catch (e) {}
}

// 페이지 안에서 "혜택스러운" 이미지를 찾는다. class/id/alt에 키워드가 있는 것을
// 우선하고, 여러 개면 화면에 보이는 면적이 가장 큰 걸 고른다 (작은 아이콘 오탐 방지)
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
    // 후보 풀이 키워드 매칭 없이 전체 이미지로 대체된 경우엔, 너무 작은(아이콘류)
    // 이미지는 애초에 혜택 배너일 가능성이 낮으니 걸러낸다
    if (candidates.length === 0 && area < 10000) continue;
    if (area > bestArea) {
      bestArea = area;
      best = img;
    }
  }
  if (!best) return null;
  return best.currentSrc || best.src || best.dataset.src || null;
}

async function run() {
  const url = location.href;
  if (await alreadyTried(url)) return;

  const imageUrl = findBenefitImage();
  if (!imageUrl) return;

  await markTried(url);
  try {
    await fetch(BENEFIT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: url, imageUrl }),
    });
  } catch (e) {
    // 실패해도 조용히 무시 - 다음 6시간 뒤 재시도됨
  }
}

// SPA 렌더링이라 초기 로드 직후엔 이미지가 아직 없을 수 있어 약간 기다렸다가
// 한 번 시도하고, 이후 DOM 변화(이미지 지연 로딩 등)에도 한 번 더 반응한다
setTimeout(run, 2500);

let debounceTimer = null;
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(run, 1500);
});
observer.observe(document.body, { childList: true, subtree: true });
