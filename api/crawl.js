import { kv } from '@vercel/kv';

// 네이버/카카오/SSG/11번가/올리브영/G마켓 라이브 스케줄을 라방바 없이 각 플랫폼에서
// 직접 가져오는 통합 엔드포인트. Vercel Hobby 플랜의 서버리스 함수 12개 제한 때문에
// 원래 개별 파일(api/crawl-*.js)이었던 것들을 여기 하나로 합쳤다.
// 사용법: GET /api/crawl?platform=naver|kakao|ssg|11st|oliveyoung|gmarket&keyword=...

const CACHE_TTL = 300; // 5분
const MAX_CONCURRENT = 5;

// ---------------------------------------------------------------------------
// 네이버 쇼핑라이브
// (shoppinglive.naver.com /calendar 페이지가 사용하는 API)
// timeline/next 커서 페이지네이션을 "지금"부터 이어가면 당일 스케줄이 끝나는
// 시점(cursor=null)에서 멈춰버려 다음날 이후 데이터를 못 가져온다. timestamp
// 파라미터에 미래 시각을 직접 넣어 호출하면 그 날짜의 스케줄이 정상 반환되는
// 것을 확인했다 - 오늘~+21일 각 날짜의 KST 자정을 anchor timestamp로 개별 조회.
const NAVER_GATEWAY = 'https://apis.naver.com/selectiveweb/live_commerce_web';
const NAVER_ROUTING_KEY = 'real-home-api';
const NAVER_PAGE_SIZE = 30;
const NAVER_MAX_PAGES_PER_DAY = 10;
const NAVER_RANGE_DAYS = 21; // 실측 결과 이 지점부터 방송이 거의 0건으로 수렴함

function naverHeaders() {
  return {
    'Accept': 'application/json',
    'apigw-routing-key': NAVER_ROUTING_KEY,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://shoppinglive.naver.com/calendar',
  };
}

function naverToCard(entry) {
  if (!entry || !entry.broadcast) return null;
  const b = entry.broadcast;
  return {
    id: b.id,
    title: b.title,
    platform: '네이버쇼핑라이브',
    channel: entry.owner?.name || '',
    start: b.expectedStartDate || b.startDate || null,
    end: b.expectedEndDate || b.endDate || null,
    status: b.status,
    url: b.endUrl || ('https://shoppinglive.naver.com/lives/' + b.id),
  };
}

function kstMidnightTimestamp(dayOffset) {
  const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
  shifted.setUTCDate(shifted.getUTCDate() + dayOffset);
  shifted.setUTCHours(0, 0, 0, 0);
  return shifted.getTime() - 9 * 60 * 60 * 1000;
}

async function naverFetchDay(anchorTimestamp, includeCurrent) {
  const items = [];
  const seen = new Set();
  const addCard = (entry) => {
    const card = naverToCard(entry);
    if (card && card.id && !seen.has(card.id)) {
      seen.add(card.id);
      items.push(card);
    }
  };

  let r = await fetch(NAVER_GATEWAY + '/v1/calendar/broadcast/timeline/current?' + new URLSearchParams({
    timestamp: String(anchorTimestamp),
    size: String(NAVER_PAGE_SIZE),
  }), { headers: naverHeaders() });
  if (!r.ok) {
    await new Promise(resolve => setTimeout(resolve, 400));
    r = await fetch(NAVER_GATEWAY + '/v1/calendar/broadcast/timeline/current?' + new URLSearchParams({
      timestamp: String(anchorTimestamp),
      size: String(NAVER_PAGE_SIZE),
    }), { headers: naverHeaders() });
    if (!r.ok) return items;
  }
  const data = await r.json();

  if (includeCurrent && data.currentBroadcast) addCard(data.currentBroadcast);
  (data.nextBroadcasts?.list || []).forEach(addCard);

  let cursor = data.nextBroadcasts?.next || null;
  let page = 0;
  while (cursor && page < NAVER_MAX_PAGES_PER_DAY) {
    page++;
    const nr = await fetch(NAVER_GATEWAY + '/v1/calendar/broadcast/timeline/next?' + new URLSearchParams({
      next: cursor,
      size: String(NAVER_PAGE_SIZE),
    }), { headers: naverHeaders() });
    if (!nr.ok) break;
    const nd = await nr.json();
    const list = nd.list || [];
    list.forEach(addCard);
    cursor = nd.next || null;
    if (list.length === 0) break;
  }

  return items;
}

async function fetchNaverRaw() {
  const anchors = [];
  for (let i = 0; i <= NAVER_RANGE_DAYS; i++) {
    anchors.push(i === 0 ? Date.now() : kstMidnightTimestamp(i));
  }

  // 요청을 동시에 터뜨리면 게이트웨이가 일부를 레이트리밋하는 경향이 있어 살짝 간격을 두고 시작한다
  const results = await Promise.all(anchors.map((ts, idx) =>
    new Promise(resolve => setTimeout(resolve, idx * 150)).then(() => naverFetchDay(ts, idx === 0))
  ));

  const seen = new Set();
  const items = [];
  results.flat().forEach(card => {
    if (card.id && !seen.has(card.id)) {
      seen.add(card.id);
      items.push(card);
    }
  });
  return items;
}

// ---------------------------------------------------------------------------
// 카카오쇼핑라이브
// (shoppinglive.kakao.com /calendar 페이지가 사용하는 API,
// shoppinglive.kakao.com 이 kamp.kakao.com 으로 리버스 프록시하므로 same-origin 으로 호출)
const KAKAO_GATEWAY = 'https://shoppinglive.kakao.com';
const KAKAO_PAGE_SIZE = 50;
const KAKAO_MAX_PAGES_PER_DAY = 10;
const KAKAO_RANGE_DAYS = 21; // 실측 결과 이 지점부터 방송이 거의 0건으로 수렴함

function kakaoHeaders() {
  return {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://shoppinglive.kakao.com/calendar',
  };
}

function kstYmd(kstDate) {
  const y = kstDate.getUTCFullYear();
  const m = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kstDate.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function kakaoToIso(str) {
  if (!str || str.length < 12) return null;
  const y = str.slice(0, 4), mo = str.slice(4, 6), d = str.slice(6, 8);
  const h = str.slice(8, 10), mi = str.slice(10, 12), s = str.slice(12, 14) || '00';
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

function kakaoToCard(item) {
  return {
    id: item.liveContentId,
    title: (item.displayTitle || '').replace(/\n/g, ' '),
    platform: '카카오쇼핑라이브',
    channel: item.liveDisplaySaleChannel?.name || '',
    start: kakaoToIso(item.liveStartAt),
    end: null,
    status: item.liveStatus,
    url: item.landingUrl || ('https://shoppinglive.kakao.com/live/' + item.liveContentId),
  };
}

async function kakaoFetchDay(dayStr) {
  const items = [];
  let cursor = '';
  let page = 0;
  while (page < KAKAO_MAX_PAGES_PER_DAY) {
    page++;
    const params = new URLSearchParams({
      tabId: 'ALL',
      displayFrom: dayStr,
      displayTo: dayStr,
      size: String(KAKAO_PAGE_SIZE),
    });
    if (cursor) params.set('cursor', cursor);

    let r = await fetch(KAKAO_GATEWAY + '/api/v2/live-calendar?' + params, { headers: kakaoHeaders() });
    if (!r.ok) {
      await new Promise(resolve => setTimeout(resolve, 400));
      r = await fetch(KAKAO_GATEWAY + '/api/v2/live-calendar?' + params, { headers: kakaoHeaders() });
      if (!r.ok) break;
    }
    const data = await r.json();
    const contents = data.contents || [];
    contents.forEach(item => {
      if (item.liveStatus !== 'NO_SHOW') items.push(kakaoToCard(item));
    });

    if (data.last || !data.nextCursor || contents.length === 0) break;
    cursor = data.nextCursor;
  }
  return items;
}

async function fetchKakaoRaw() {
  const days = [];
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST로 shift된 시각
  for (let i = 0; i <= KAKAO_RANGE_DAYS; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() + i);
    days.push(kstYmd(d));
  }

  const results = await Promise.all(days.map((day, idx) =>
    new Promise(resolve => setTimeout(resolve, idx * 150)).then(() => kakaoFetchDay(day))
  ));
  const seen = new Set();
  const items = [];
  results.flat().forEach(card => {
    if (card.id && !seen.has(card.id)) {
      seen.add(card.id);
      items.push(card);
    }
  });
  return items;
}

// ---------------------------------------------------------------------------
// SSG.LIVE
// (m.ssg.com 의 "라이브 예고" 탭. Next.js SSR로 렌더링되며 __NEXT_DATA__ 안에
// 예정 방송 목록이 이미 포함되어 있어 별도 API 호출 없이 HTML 한 번으로 충분)
const SSG_SCHEDULE_URL = 'https://m.ssg.com/page/ssglive/next';

function ssgHeaders() {
  return {
    'Accept': 'text/html',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  };
}

function ssgToIso(str) {
  if (!str) return null;
  return str.trim().replace(' ', 'T');
}

function ssgToCard(item) {
  return {
    id: item.id,
    title: item.title || item.mainTitle1 || '',
    platform: 'SSG라이브',
    channel: item.repItemBrandNm || item.brandName || '',
    start: ssgToIso(item.liveStartDate || item.subTitle1),
    end: ssgToIso(item.liveEndDate || item.subTitle2),
    status: 'BEFORE',
    url: item.liveDetailLink || item.livePlayerLink || item.linkUrl || '',
  };
}

// __NEXT_DATA__ 트리를 재귀 탐색해서 dataType이 SSG_LIVE인 컴포넌트의 bannerList를 모두 수집
function collectSsgBannerLists(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectSsgBannerLists(child, out);
    return;
  }
  if (node.dataType === 'SSG_LIVE' && Array.isArray(node.bannerList)) {
    out.push(...node.bannerList);
  }
  for (const key of Object.keys(node)) {
    if (key === 'bannerList') continue;
    collectSsgBannerLists(node[key], out);
  }
}

async function fetchSsgRaw() {
  const r = await fetch(SSG_SCHEDULE_URL, { headers: ssgHeaders() });
  if (!r.ok) throw new Error('ssg live page failed: ' + r.status);
  const html = await r.text();

  const startTag = '__NEXT_DATA__" type="application/json"';
  const idx = html.indexOf(startTag);
  if (idx === -1) throw new Error('ssg __NEXT_DATA__ not found');
  const scriptStart = html.indexOf('>', idx) + 1;
  const scriptEnd = html.indexOf('</script>', scriptStart);
  const nextData = JSON.parse(html.slice(scriptStart, scriptEnd));

  const banners = [];
  collectSsgBannerLists(nextData, banners);

  const seen = new Set();
  const items = [];
  for (const item of banners) {
    const card = ssgToCard(item);
    if (card.id && !seen.has(card.id)) {
      seen.add(card.id);
      items.push(card);
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// 11번가 LIVE11
// (m.11st.co.kr 의 "편성표" 페이지: /page/sub?pageId=LIVE11TIMETBLPAGE)
// 범용 PUI(페이지 빌더) 시스템을 사용하며, 최초 호출로 오늘 스케줄 + 날짜별
// 방송 개수(캐러셀 탭)를 받고, 방송이 있는(broadcastCount>0) 날짜만 carrSn을
// 재사용해 selectDate로 개별 조회한다. (broadcastCount가 0인 날짜를 조회하면
// 서버가 조용히 "오늘" 데이터로 폴백하므로 반드시 스킵해야 함. 날짜 범위는
// 하드코딩하지 않고 편성표 탭이 실제로 제공하는 폭(-7일~+14일)을 그대로 따른다)
const ST11_BASE = 'https://apis.11st.co.kr/pui/v2/page';
const ST11_PAGE_ID = 'LIVE11TIMETBLPAGE';

function headers11st() {
  return {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Referer': 'https://m.11st.co.kr/page/sub?pageId=LIVE11TIMETBLPAGE',
  };
}

// data: [ {carrSn, type, blockList:[{type, list:[...]}, ...]}, ... ] 형태를 재귀 탐색해서
// 주어진 block type의 list 항목들을 모두 수집
function collectBlockLists(node, type, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) collectBlockLists(child, type, out);
    return;
  }
  if (node.type === type && Array.isArray(node.list)) {
    out.push(...node.list);
  }
  for (const key of Object.keys(node)) {
    if (key === 'list') continue;
    collectBlockLists(node[key], type, out);
  }
}

function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function mToD(kstDate) {
  return `${kstDate.getUTCMonth() + 1}.${kstDate.getUTCDate()}`;
}

function st11ToCard(item, kstDate) {
  const y = kstDate.getUTCFullYear();
  const m = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kstDate.getUTCDate()).padStart(2, '0');
  const time = /^\d{1,2}:\d{2}$/.test(item.liveTime || '') ? item.liveTime : (item.liveScheduleTime || '00:00');
  return {
    id: item.broadcastNo,
    title: item.title || '',
    platform: '11번가 라이브11',
    channel: item.channelInfo?.title || '',
    start: `${y}-${m}-${d}T${time.padStart(5, '0')}:00`,
    end: null,
    status: item.liveStatus || '',
    url: item.liveDetailsUrl ? item.liveDetailsUrl.replace(/^http:/, 'https:') : '',
  };
}

async function st11FetchTodayAndTabs() {
  const r = await fetch(`${ST11_BASE}?pageId=${ST11_PAGE_ID}`, { headers: headers11st() });
  if (!r.ok) throw new Error('11st timetable page failed: ' + r.status);
  const json = await r.json();

  const tabs = [];
  collectBlockLists(json.data, 'Tabs_TimeTable', tabs);
  const products = [];
  collectBlockLists(json.data, 'ProductList_Live11', products);

  let carrSn = null;
  const findCarrSn = (node) => {
    if (!node || typeof node !== 'object' || carrSn) return;
    if (Array.isArray(node)) { node.forEach(findCarrSn); return; }
    if (node.type === 'Tabs_TimeTable') { carrSn = node.carrSn; return; }
    Object.values(node).forEach(findCarrSn);
  };
  findCarrSn(json.data);

  return { tabs, products, carrSn };
}

async function st11FetchDay(carrSn, dateObj) {
  const dayStr = kstYmd(dateObj);
  let r = await fetch(`${ST11_BASE}?pageId=${ST11_PAGE_ID}&carrSn=${carrSn}&selectDate=${dayStr}`, { headers: headers11st() });
  if (!r.ok) {
    await new Promise(resolve => setTimeout(resolve, 400));
    r = await fetch(`${ST11_BASE}?pageId=${ST11_PAGE_ID}&carrSn=${carrSn}&selectDate=${dayStr}`, { headers: headers11st() });
    if (!r.ok) return [];
  }
  const json = await r.json();
  const products = [];
  collectBlockLists(json.data, 'ProductList_Live11', products);
  return products;
}

async function fetch11stRaw() {
  const { tabs, products, carrSn } = await st11FetchTodayAndTabs();

  const now = nowKST();
  const items = [];
  const seen = new Set();
  const addAll = (list, dateObj) => {
    list.forEach(item => {
      const card = st11ToCard(item, dateObj);
      if (card.id && !seen.has(card.id)) {
        seen.add(card.id);
        items.push(card);
      }
    });
  };

  // 오늘은 이미 받아온 데이터를 재사용
  addAll(products, now);

  // 탭 목록(-7일~+14일 고정 폭)에서 오늘 이후이고 방송이 있는 날짜만 골라 개별 조회.
  // 배열 위치(= 오늘로부터의 실제 날짜 오프셋)를 필터링 전에 매겨둬야 날짜가 밀리지 않는다
  const todayLabel = mToD(now);
  const todayIdx = tabs.findIndex(t => t.date === todayLabel);
  const futureDays = [];
  if (todayIdx !== -1) {
    for (let i = todayIdx + 1; i < tabs.length; i++) {
      if (tabs[i].broadcastCount > 0) {
        const d = new Date(now);
        d.setUTCDate(now.getUTCDate() + (i - todayIdx));
        futureDays.push(d);
      }
    }
  }

  if (carrSn && futureDays.length > 0) {
    const results = await Promise.all(futureDays.map((d, idx) =>
      new Promise(resolve => setTimeout(resolve, idx * 150)).then(() => st11FetchDay(carrSn, d))
    ));
    results.forEach((list, idx) => addAll(list, futureDays[idx]));
  }

  return items;
}

// ---------------------------------------------------------------------------
// 올리브영 라이브
// (m.oliveyoung.co.kr 의 "라이브" 탭 편성표. 날짜별 방송 상세는 viewStdDate
// 파라미터가 YYYYMMDD 형식이어야 동작함. Vercel 서버 IP가 올리브영 WAF에
// 막혀 있어 실제로는 브라우저 확장프로그램이 /api/ingest 로 채워주는
// KV 캐시에 의존한다 - 아래 fetch는 캐시가 비어 있을 때의 보조 시도일 뿐)
const OY_BASE = 'https://m.oliveyoung.co.kr/discovery/api/v2/live-shop/display/broadcast-calendar';
const OY_RANGE_DAYS = 14; // 편성표 캘린더가 실제로 제공하는 폭

function oyHeaders() {
  return {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Referer': 'https://m.oliveyoung.co.kr/m/mtn/liveshop',
  };
}

// 올리브영 API는 UTC(Z suffix)로 내려주는데, 다른 플랫폼들은 전부 KST naive
// 문자열이라 프론트엔드에서 통일해서 정렬/비교할 수 있도록 형식을 맞춘다
function utcToKstNaive(utcStr) {
  if (!utcStr) return null;
  const d = new Date(utcStr);
  if (isNaN(d.getTime())) return null;
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  const h = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  const s = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${mi}:${s}`;
}

function oyToCard(item) {
  const live = item.liveCastingInformation || {};
  return {
    id: item.teaserNo,
    title: item.title || '',
    platform: '올리브영 라이브',
    channel: item.productsInformation?.onlineBrandName || '',
    start: utcToKstNaive(live.castingStartDateTime || live.reservedStartDateTime),
    end: utcToKstNaive(live.castingEndDateTime || live.reservedEndDateTime),
    status: live.onAirFlag ? 'ONAIR' : 'BEFORE',
    url: item.linkUrlAddress ? ('https://m.oliveyoung.co.kr/m/' + item.linkUrlAddress) : '',
  };
}

async function oyFetchDay(dayStr) {
  let r = await fetch(OY_BASE + '/detail?viewStdDate=' + dayStr, { headers: oyHeaders() });
  if (!r.ok) {
    await new Promise(resolve => setTimeout(resolve, 400));
    r = await fetch(OY_BASE + '/detail?viewStdDate=' + dayStr, { headers: oyHeaders() });
    if (!r.ok) return [];
  }
  const json = await r.json();
  const items = json?.data?.scheduleItems;
  if (!Array.isArray(items)) return [];
  return items.map(oyToCard);
}

async function fetchOliveyoungRaw() {
  const days = [];
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST로 shift된 시각
  for (let i = 0; i <= OY_RANGE_DAYS; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() + i);
    days.push(kstYmd(d));
  }

  const results = await Promise.all(days.map((day, idx) =>
    new Promise(resolve => setTimeout(resolve, idx * 150)).then(() => oyFetchDay(day))
  ));
  const seen = new Set();
  const items = [];
  results.flat().forEach(card => {
    if (card.id && !seen.has(card.id)) {
      seen.add(card.id);
      items.push(card);
    }
  });
  return items;
}

// ---------------------------------------------------------------------------
// G마켓 라이브
// (m.gmarket.co.kr/n/live/schedule 의 __NEXT_DATA__ 안에 오늘 기준 -3일~+7일
// 전체 스케줄이 이미 포함되어 있음을 실제 브라우저로 확인했다. 하지만 이
// 도메인 전체가 Cloudflare Managed Challenge로 보호되어 있어 서버사이드
// fetch는 항상 403으로 막힌다 (실제 확인함) - 브라우저 확장프로그램이
// /api/ingest 로 채워주는 KV 캐시를 읽기만 한다. 직접 fetch는 시도하지 않음.
function gmarketToCard(item) {
  return {
    id: item.broadcastSeq,
    title: item.broadcastTitle || '',
    platform: 'G마켓 라이브',
    channel: item.seller?.name || '',
    start: item.broadcastStartDate || null,
    end: item.broadcastEndDate || null,
    status: item.broadcastStatus || '',
    url: item.landingUrl || '',
  };
}

async function fetchGmarketRaw() {
  // Cloudflare에 막혀 서버사이드로는 수집 불가 - 항상 빈 배열 (ingest로만 채워짐)
  return [];
}

// ---------------------------------------------------------------------------
// CJ온스타일
// (display.cjonstyle.com 의 "라이브 편성표" 페이지가 쓰는 구식 Backbone.js 기반
// REST API. 인증/WAF 없이 바로 호출 가능. bdStrDtm/bdEndDtm 은 epoch ms라서
// 그대로 Date에 넣으면 되고, 응답 자체에는 진행상태 필드가 없어 지금 시각과
// 비교해서 직접 계산한다. 오늘 기준 +13일 정도까지만 실제 데이터가 있음)
const CJ_BASE = 'https://display.cjonstyle.com';
const CJ_RANGE_DAYS = 13;

function cjHeaders() {
  return {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://display.cjonstyle.com/p/tv/tvSchedule?broadType=live',
  };
}

function cjStatus(startMs, endMs) {
  const now = Date.now();
  if (endMs && now > endMs) return 'END';
  if (startMs && now >= startMs) return 'ONAIR';
  return 'BEFORE';
}

function cjToCard(item) {
  return {
    id: item.pgmCd,
    title: item.pgmNm || '',
    platform: 'CJ온스타일',
    channel: item.itemList?.[0]?.brandName || '',
    start: utcToKstNaive(item.bdStrDtm),
    end: utcToKstNaive(item.bdEndDtm),
    status: cjStatus(item.bdStrDtm, item.bdEndDtm),
    url: CJ_BASE + '/p/tv/tvSchedule?broadType=live',
  };
}

async function cjFetchDay(dayStr) {
  const params = new URLSearchParams({ bdDt: dayStr, isMobile: 'false', broadType: 'live', isEmployee: 'false' });
  let r = await fetch(`${CJ_BASE}/c/rest/tv/tvSchedule?${params}`, { headers: cjHeaders() });
  if (!r.ok) {
    await new Promise(resolve => setTimeout(resolve, 400));
    r = await fetch(`${CJ_BASE}/c/rest/tv/tvSchedule?${params}`, { headers: cjHeaders() });
    if (!r.ok) return [];
  }
  const json = await r.json();
  const list = json?.result?.programList;
  return Array.isArray(list) ? list.map(cjToCard) : [];
}

async function fetchCjRaw() {
  const days = [];
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST로 shift된 시각
  for (let i = 0; i <= CJ_RANGE_DAYS; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() + i);
    days.push(kstYmd(d));
  }

  const results = await Promise.all(days.map((day, idx) =>
    new Promise(resolve => setTimeout(resolve, idx * 150)).then(() => cjFetchDay(day))
  ));
  const seen = new Set();
  const items = [];
  results.flat().forEach(card => {
    if (card.id && !seen.has(card.id)) {
      seen.add(card.id);
      items.push(card);
    }
  });
  return items;
}

// ---------------------------------------------------------------------------
// 무신사 라이브
// (www.musinsa.com/campaign/musinsa_live/0 페이지가 쓰는 API. 페이지 자체엔
// __NEXT_DATA__가 있지만 실제 편성 데이터는 하이드레이션 후 별도 fetch로
// 채워진다 - performance.getEntriesByType('resource')로 실제 브라우저 요청을
// 확인해서 찾음. "라이브 편성표" 모듈(LIVECOMMERCE 타입)의 chartList가 곧
// 스케줄 목록이고, 날짜별 브랜드 탭들은 각 방송의 상품 목록이라 스케줄
// 자체에는 필요 없음. 인증 불필요.
const MUSINSA_API = 'https://api.musinsa.com/api2/campaign/cpcms/v2/musinsa_live/link-tabs/0/modules';

function musinsaHeaders() {
  return {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://www.musinsa.com/campaign/musinsa_live/0',
  };
}

function musinsaParseTime(text) {
  const m = String(text || '').match(/(오전|오후)\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = parseInt(m[2], 10);
  if (m[1] === '오후' && h !== 12) h += 12;
  if (m[1] === '오전' && h === 12) h = 0;
  return { h: String(h).padStart(2, '0'), m: m[3] };
}

function musinsaToCard(item, nowKst) {
  const time = musinsaParseTime(item.onAirTimeText) || { h: '00', m: '00' };
  const itemMonth = Number(item.onAirDateTextM);
  const itemDay = Number(item.onAirDateTextD);
  let year = nowKst.getUTCFullYear();
  // 연말/연초 경계에서 항목의 월이 현재보다 한참 이전이면 다음 해로 넘어간 것
  if (itemMonth && itemMonth < nowKst.getUTCMonth() + 1 - 6) year += 1;
  const month = String(itemMonth).padStart(2, '0');
  const day = String(itemDay).padStart(2, '0');
  const url = item.link ? (item.link.startsWith('http') ? item.link : 'https://www.musinsa.com' + item.link) : '';
  return {
    id: item.idx,
    title: (item.title || '').replace(/ㅣ/g, ' - '),
    platform: '무신사 라이브',
    channel: '',
    start: `${year}-${month}-${day}T${time.h}:${time.m}:00`,
    end: null,
    status: item.todayYn === 'Y' ? 'ONAIR' : 'BEFORE',
    url,
  };
}

async function fetchMusinsaRaw() {
  const r = await fetch(MUSINSA_API, { headers: musinsaHeaders() });
  if (!r.ok) return [];
  const json = await r.json();
  const modules = json?.data;
  if (!Array.isArray(modules)) return [];
  const liveModule = modules.find(m => m.moduleType === 'LIVECOMMERCE');
  const chartList = liveModule?.content?.chartList;
  if (!Array.isArray(chartList)) return [];

  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const seen = new Set();
  const items = [];
  chartList.forEach(item => {
    const card = musinsaToCard(item, nowKst);
    if (card.id && !seen.has(card.id)) {
      seen.add(card.id);
      items.push(card);
    }
  });
  return items;
}

// ---------------------------------------------------------------------------
// 방송 상세(판매 상품/혜택) 조회 - 캘린더 카드 클릭 시 뜨는 팝업용.
// 네이버/카카오/11번가는 상세 API가 인증 없이 열려 있어 바로 호출 가능하고,
// G마켓은 Cloudflare가 이 API도 막고 있어 조회 불가 (팝업에서는 기본 정보만 표시).

// 혜택이 구조화된 텍스트 필드 없이 "배너 이미지"로만 제공되는 경우가 많아
// (네이버 broadcastBanner, 카카오 eventLiveBanner) OCR.space 무료 API로
// 이미지 속 텍스트를 읽어온다. 월 25,000건까지 무료, 카드 등록 불필요.
// OCR_SPACE_API_KEY 환경변수가 없으면 그냥 빈 배열을 반환해 조용히 스킵된다 -
// 구조화된 텍스트 필드가 이미 있는 방송에서는 호출하지 않아 무료 한도를 아낀다.
const OCR_SPACE_API = 'https://api.ocr.space/parse/imageurl';

async function ocrExtractText(imageUrl) {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey || !imageUrl) return [];
  try {
    const params = new URLSearchParams({
      apikey: apiKey,
      url: imageUrl,
      language: 'kor',
      OCREngine: '2',
      scale: 'true',
      isOverlayRequired: 'false',
    });
    // OCR.space의 /parse/imageurl 엔드포인트는 POST를 받지 않는다 (404 Cannot POST) - GET만 동작함
    const r = await fetch(`${OCR_SPACE_API}?${params}`);
    if (!r.ok) return [];
    const data = await r.json();
    if (data.IsErroredOnProcessing) return [];
    const text = data.ParsedResults?.[0]?.ParsedText || '';
    return text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length >= 2);
  } catch (e) {
    return [];
  }
}

// 네이버/11번가는 "혜택" 전용 필드가 따로 없고 짧은 한 줄짜리 description을 그대로
// 쓰는데, 실제로는 "신성한쇼핑 x 로보락"처럼 그냥 콜라보/기획전 이름인 경우가 많아
// 진짜 혜택(할인/적립/증정 등)처럼 안 보이면 걸러낸다. 걸러지면 아래 배너 OCR로 폴백된다
function looksLikeBenefit(text) {
  if (!text) return false;
  return /[0-9]|%|원|쿠폰|적립|할인|무료|사은품|증정|이벤트|추첨|한정|특가|캐시백|포인트|선착순/.test(text);
}

async function fetchNaverDetail(id) {
  const r = await fetch(`${NAVER_GATEWAY}/v1/broadcast/${id}`, { headers: naverHeaders() });
  if (!r.ok) return null;
  const d = await r.json();
  const benefits = [];
  if (d.description && looksLikeBenefit(d.description)) benefits.push(d.description);

  if (benefits.length === 0) {
    const bannerUrl = typeof d.broadcastBanner === 'string'
      ? d.broadcastBanner
      : (d.broadcastBanner?.imageUrl || d.broadcastBanner?.url || null);
    if (bannerUrl) {
      const lines = await ocrExtractText(bannerUrl);
      if (lines.length) benefits.push(lines.join('\n'));
    }
  }

  const products = (d.shoppingProducts || []).map(p => ({
    name: p.name || p.productName || '',
    image: p.image || '',
    price: p.price ?? null,
    discountRate: p.discountRate ?? null,
    url: p.productEndUrl || p.productBridgeUrl || '',
  }));
  return {
    title: d.title || '',
    channel: d.nickname || '',
    image: d.standByImage || d.previewImage || '',
    url: d.broadcastEndUrl || `https://shoppinglive.naver.com/lives/${id}`,
    benefits,
    products,
  };
}

async function fetchKakaoDetail(id) {
  const r = await fetch(`${KAKAO_GATEWAY}/api/v2/live-pages/${id}`, { headers: kakaoHeaders() });
  if (!r.ok) return null;
  const d = await r.json();
  const benefits = [];
  if (d.mainBenefit && looksLikeBenefit(d.mainBenefit)) benefits.push(d.mainBenefit);
  (d.liveBaseBenefits || []).forEach(b => {
    if (!b || !b.title) return;
    benefits.push(b.contents ? `${b.title}: ${b.contents}` : b.title);
  });

  if (benefits.length === 0) {
    const bannerUrl = d.eventLiveBanner?.imageBanner?.imageUrl || d.eventLiveBanner?.shortCutBanner?.imageUrl || null;
    if (bannerUrl) {
      const lines = await ocrExtractText(bannerUrl);
      if (lines.length) benefits.push(lines.join('\n'));
    }
  }

  let products = [];
  const moduleId = d.liveProductDisplayModules?.[0]?.id;
  if (moduleId) {
    const pr = await fetch(`${KAKAO_GATEWAY}/api/v1/products/module/${moduleId}?page=0&size=20`, { headers: kakaoHeaders() });
    if (pr.ok) {
      const pd = await pr.json();
      products = (pd.contents || []).map(p => ({
        name: p.name || '',
        image: p.imageUrl || '',
        price: p.discountedPrice ?? p.originalPrice ?? null,
        discountRate: p.discountedPercentage ?? null,
        url: p.productUrl || '',
      }));
    }
  }

  return {
    title: (d.title || '').replace(/\n/g, ' '),
    channel: d.liveDisplaySaleChannel?.name || '',
    image: d.imageUrl || '',
    url: `https://shoppinglive.kakao.com/live/${id}`,
    benefits,
    products,
  };
}

const ST11_LIVE_SVC = 'https://live11-svc.11st.co.kr';

async function fetch11stDetail(id) {
  const r = await fetch(`${ST11_LIVE_SVC}/v1/broadcasts/${id}/detail`, { headers: headers11st() });
  if (!r.ok) return null;
  const d = await r.json();
  const benefits = [];
  if (d.description && looksLikeBenefit(d.description)) benefits.push(d.description);
  const products = (d.products || []).map(p => ({
    name: p.name || '',
    image: p.thumbnail || '',
    price: p.discountedPrice ? Number(String(p.discountedPrice).replace(/,/g, '')) : (p.price ? Number(String(p.price).replace(/,/g, '')) : null),
    discountRate: p.discountRate ? Number(p.discountRate) : null,
    url: p.no ? `https://m.11st.co.kr/products/${p.no}` : '',
  }));
  return {
    title: d.title || '',
    channel: d.channelInfo?.title || '',
    image: d.verticalImage || '',
    url: d.linkUrl || d.vodLinkUrl || '',
    benefits,
    products,
  };
}

// 무신사 라이브 캠페인 페이지는 서버사이드 렌더링된 HTML에 혜택 배너 이미지가
// <div class="live-teasing__section__visual"><img src="..."></div> 형태로 그대로
// 박혀있다 (구조화된 텍스트/상품 API 없음 - 방송 시작 전에는 상품 목록 자체가 없음).
// 이미지 1~3장을 OCR로 읽어 혜택 텍스트로 쓴다.
async function fetchMusinsaDetail(campaignId) {
  const r = await fetch(`https://www.musinsa.com/app/liveshop/campaign/${campaignId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!r.ok) return null;
  const html = await r.text();

  const titleMatch = html.match(/id="fbOgTitle"[^>]*content="([^"]*)"/);
  const imageMatch = html.match(/id="fbOgImage"[^>]*content="([^"]*)"/);

  const bannerUrls = [];
  const sectionRe = /<section class="live-teasing__section">([\s\S]*?)<\/section>/g;
  let s;
  while ((s = sectionRe.exec(html)) && bannerUrls.length < 4) {
    const block = s[1];
    const title = block.match(/live-teasing__section__header__title">([^<]*)</)?.[1] || '';
    if (/Coming Soon/i.test(title)) continue;
    const img = block.match(/live-teasing__section__visual">\s*<img src="([^"]+)"/)?.[1];
    if (img) bannerUrls.push(img.startsWith('//') ? `https:${img}` : img);
  }

  // 매 캠페인마다 새로 생성되는(해시가 매번 다른) "라이브 접속 방법" 안내 이미지가
  // 끼어있는데, HTML 구조로는 다른 배너와 구분이 안 되고 이미지 자체 내용이
  // 항상 같은 문구를 담고 있다 - OCR 결과 안에서 그 문구가 나온 이미지 자체를 통째로 버린다
  const ocrResults = await Promise.all(bannerUrls.map(url => ocrExtractText(url)));
  const benefits = ocrResults
    .filter(lines => lines.length && !lines.some(l => /접속\s*방법|라이브\s*화면\s*터치/.test(l)))
    .map(lines => lines.join('\n'));

  return {
    title: titleMatch ? titleMatch[1] : '',
    channel: '',
    image: imageMatch ? imageMatch[1] : '',
    url: `https://www.musinsa.com/app/liveshop/campaign/${campaignId}`,
    benefits,
    products: [],
  };
}

const DETAIL_FETCHERS = {
  naver: fetchNaverDetail,
  kakao: fetchKakaoDetail,
  '11st': fetch11stDetail,
  musinsa: fetchMusinsaDetail,
};

// ---------------------------------------------------------------------------

const PLATFORMS = {
  naver: { cacheKey: 'crawl-naver:raw', label: '네이버쇼핑라이브', fetchRaw: fetchNaverRaw },
  kakao: { cacheKey: 'crawl-kakao:raw', label: '카카오쇼핑라이브', fetchRaw: fetchKakaoRaw },
  ssg: { cacheKey: 'crawl-ssg:raw', label: 'SSG라이브', fetchRaw: fetchSsgRaw },
  '11st': { cacheKey: 'crawl-11st:raw', label: '11번가 라이브11', fetchRaw: fetch11stRaw },
  oliveyoung: { cacheKey: 'crawl-oliveyoung:raw', label: '올리브영 라이브', fetchRaw: fetchOliveyoungRaw },
  gmarket: { cacheKey: 'crawl-gmarket:raw', label: 'G마켓 라이브', fetchRaw: fetchGmarketRaw },
  cjonstyle: { cacheKey: 'crawl-cjonstyle:raw', label: 'CJ온스타일', fetchRaw: fetchCjRaw },
  musinsa: { cacheKey: 'crawl-musinsa:raw', label: '무신사 라이브', fetchRaw: fetchMusinsaRaw },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { platform, keyword, action, id } = req.query;
  const config = PLATFORMS[platform];
  if (!config) {
    return res.status(400).json({ error: 'platform must be one of: ' + Object.keys(PLATFORMS).join(', ') });
  }
  const cleanKeyword = keyword ? String(keyword).trim() : '';

  // 상세 팝업 조회는 검색 한 번에 8개 플랫폼을 동시에 부르는 목록 조회보다
  // 훨씬 가볍고, 카드를 여러 개 눌러보는 것도 자연스러운 사용 패턴이라
  // 목록 조회와 같은 한도를 공유하면 쉽게 429가 나버린다 - 별도 카운터로 분리
  const isDetail = action === 'detail';
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rateKey = (isDetail ? 'rate-detail:' : 'rate:') + ip;
  const rateLimit = isDetail ? 60 : 20;
  try {
    const count = await kv.incr(rateKey);
    if (count === 1) await kv.expire(rateKey, 60);
    if (count > rateLimit) {
      return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' });
    }
  } catch (e) {}

  if (action === 'detail') {
    if (!id) return res.status(400).json({ error: 'id is required' });
    const fetchDetail = DETAIL_FETCHERS[platform];
    if (!fetchDetail) {
      return res.status(200).json({ detail: null });
    }
    const detailCacheKey = `crawl-detail:${platform}:${id}`;
    try {
      const cached = await kv.get(detailCacheKey);
      if (cached) return res.status(200).json({ detail: cached });
    } catch (e) {}
    try {
      const detail = await fetchDetail(String(id));
      if (detail) {
        try { await kv.set(detailCacheKey, detail, { ex: CACHE_TTL }); } catch (e) {}
      }
      return res.status(200).json({ detail });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  let rawItems = null;
  try {
    rawItems = await kv.get(config.cacheKey);
  } catch (e) {}

  const concurrencyKey = 'active-crawl:' + platform;
  let concurrencySlotTaken = false;
  try {
    if (!rawItems) {
      const activeCount = await kv.incr(concurrencyKey);
      if (activeCount === 1) await kv.expire(concurrencyKey, 30);
      if (activeCount > MAX_CONCURRENT) {
        await kv.decr(concurrencyKey);
        return res.status(429).json({ error: '지금 갑자기 많은 분들이 검색 중이에요..! 잠시 후 다시 시도해봐주세요!' });
      }
      concurrencySlotTaken = true;
    }
  } catch (e) {}

  try {
    if (!rawItems) {
      rawItems = await config.fetchRaw();
      // 빈 결과를 캐싱하면 일시적 실패가 5분간 그대로 굳어버리니, 뭔가 있을 때만 저장한다
      if (rawItems.length > 0) {
        try {
          await kv.set(config.cacheKey, rawItems, { ex: CACHE_TTL });
        } catch (e) {}
      }
    }

    let upcoming = rawItems;
    if (cleanKeyword) {
      const kwTerms = cleanKeyword.toLowerCase().split(/\s+/).filter(Boolean);
      upcoming = rawItems.filter(item => {
        if (!item.title) return false;
        const title = item.title.toLowerCase();
        return kwTerms.every(term => title.includes(term));
      });
    }

    upcoming = [...upcoming].sort((a, b) => (a.start || '').localeCompare(b.start || ''));

    res.status(200).json({ upcoming, total: upcoming.length, keyword: cleanKeyword, platform: config.label });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (concurrencySlotTaken) {
      try { await kv.decr(concurrencyKey); } catch (e) {}
    }
  }
}
