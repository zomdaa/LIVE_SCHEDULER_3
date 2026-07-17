// 방송 상세 페이지에서 "혜택" 정보를 찾아 백엔드로 넘긴다. crawl.js가 이미
// 구조화된 혜택 API를 갖고 있는 네이버/카카오/11번가/무신사는 대상이 아니고,
// 별도 API가 없는 SSG/올리브영/G마켓/CJ온스타일이 대상이다 (오늘의집은 개별
// 방송 상세 URL이 없어 이 방식이 안 맞는다).
//
// 텍스트 우선, 이미지는 보조: G마켓 실제 플레이어(player.sauceflex.com)를
// 열어보니 혜택이 이미지가 아니라 "🎁 라이브 혜택" 같은 제목으로 시작하는 순수
// 텍스트 블록으로 DOM에 그대로 있었다 - 이미지+OCR보다 훨씬 정확하니 이런
// 텍스트 블록을 먼저 찾고, 없을 때만 이미지를 찾아 OCR로 넘긴다.
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

// "🎁 라이브 혜택"처럼 혜택 섹션의 제목으로 보이는 텍스트 노드를 찾은 뒤,
// 부모로 한 단계씩 올라가며 그 혜택 블록만 담고 있는 가장 좁은 컨테이너를
// 찾는다. 클래스명이 CSS 모듈 해시(예: ___d2u7j)라 그대로 하드코딩하면 배포마다
// 깨지니, 대신 "텍스트가 더 이상 늘어나지 않는 지점"으로 판단한다 - 부모로
// 올라갈 때마다 실제 콘텐츠(제목+할인/쿠폰/증정 목록)가 텍스트에 새로 붙는
// 동안은 같은 혜택 블록 안이고, 더 이상 안 늘어나는 순간이 그 블록의 최상위
// 래퍼다. 그 이후로도 계속 올라가면 방송 제목이나 페이지의 다른 영역까지
// 섞이기 시작하므로 딱 거기서 멈춘다 (실제 G마켓 sauceflex 플레이어 DOM으로
// 검증됨: 9자 제목 -> 170자 혜택 블록에서 더 안 늘어나 멈춤, 계속 올라가면
// 199자→방송 제목, 602자→페이지 전체까지 섞임)
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
  // location.href를 그대로 쓰면 안 된다 - 실제로 sauceflex 플레이어에서
  // 쿼리스트링 없이 방문해도 끝에 빈 "?"가 붙는 경우가 있어, index.html이
  // crawl.js에서 받는 깨끗한 item.url("...acdf5", 물음표 없음)과 어긋나
  // 캐시는 저장되는데 카드에는 안 붙는 문제가 있었다. origin+pathname만
  // 써서 쿼리/해시를 항상 제거한다
  const url = location.origin + location.pathname;
  if (await alreadyTried(url)) return;

  const rawText = findBenefitTextBlock();
  const imageUrl = rawText ? null : findBenefitImage();
  if (!rawText && !imageUrl) return;

  await markTried(url);
  try {
    await fetch(BENEFIT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rawText ? { id: url, rawText } : { id: url, imageUrl }),
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
