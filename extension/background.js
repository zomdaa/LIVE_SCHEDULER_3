// Vercel 서버 IP가 올리브영/오늘의집 WAF나 G마켓 Cloudflare 챌린지에 막혀 있어,
// 대신 이 확장프로그램이 설치된 실제 브라우저(실사용자 IP)로 주기적으로
// 이 사이트들을 방문해 편성표를 수집하고 /api/ingest 로 전송한다.

const INGEST_URL = 'https://buynoworlive.vercel.app/api/ingest';
const ALARM_NAME = 'scheduleSync';
const PERIOD_MINUTES = 20;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: PERIOD_MINUTES });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: PERIOD_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runAll();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'RUN_NOW') {
    runAll().then(sendResponse).catch((e) => sendResponse({ error: e.message }));
    return true; // 비동기 응답
  }
});

async function getSecret() {
  const { ingestSecret } = await chrome.storage.local.get('ingestSecret');
  return ingestSecret || '';
}

async function getOcrApiKey() {
  const { ocrApiKey } = await chrome.storage.local.get('ocrApiKey');
  return ocrApiKey || '';
}

async function runAll() {
  const secret = await getSecret();
  if (!secret) {
    const result = { error: '팝업에서 시크릿을 먼저 입력해주세요' };
    await chrome.storage.local.set({ lastRun: new Date().toISOString(), lastResult: result });
    return result;
  }

  const [oliveyoungResult, gmarketResult, ohouseResult] = await Promise.allSettled([
    collectOliveyoung(),
    collectGmarket(),
    collectOhouse(),
  ]);

  const summary = {};

  if (oliveyoungResult.status === 'fulfilled') {
    const ok = await ingest('oliveyoung', oliveyoungResult.value, secret);
    summary.oliveyoung = { count: oliveyoungResult.value.length, ingested: ok };
  } else {
    summary.oliveyoung = { error: oliveyoungResult.reason?.message || String(oliveyoungResult.reason) };
  }

  if (gmarketResult.status === 'fulfilled') {
    const ok = await ingest('gmarket', gmarketResult.value, secret);
    summary.gmarket = { count: gmarketResult.value.length, ingested: ok, debug: gmarketResult.value._debug };
  } else {
    summary.gmarket = { error: gmarketResult.reason?.message || String(gmarketResult.reason) };
  }

  if (ohouseResult.status === 'fulfilled') {
    const ok = await ingest('ohouse', ohouseResult.value, secret);
    summary.ohouse = { count: ohouseResult.value.length, ingested: ok };
  } else {
    summary.ohouse = { error: ohouseResult.reason?.message || String(ohouseResult.reason) };
  }

  await chrome.storage.local.set({ lastRun: new Date().toISOString(), lastResult: summary });
  return summary;
}

async function ingest(platform, items, secret) {
  try {
    const resp = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': secret },
      body: JSON.stringify({ platform, items }),
    });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 올리브영: 백그라운드 fetch만으로 충분 (WAF는 IP 기반, 실사용자 IP라 통과됨)
const OY_BASE = 'https://m.oliveyoung.co.kr/discovery/api/v2/live-shop/display/broadcast-calendar';
const OY_RANGE_DAYS = 14;

function ymd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
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

async function collectOliveyoung() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
  const items = [];
  const seen = new Set();

  for (let i = 0; i <= OY_RANGE_DAYS; i++) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() + i);
    const dayStr = ymd(d);
    try {
      const res = await fetch(`${OY_BASE}/detail?viewStdDate=${dayStr}`, {
        headers: { 'Referer': 'https://m.oliveyoung.co.kr/m/mtn/liveshop' },
      });
      if (res.ok) {
        const json = await res.json();
        const scheduleItems = json?.data?.scheduleItems;
        if (Array.isArray(scheduleItems)) {
          scheduleItems.forEach((item) => {
            const card = oyToCard(item);
            if (card.id && !seen.has(card.id)) {
              seen.add(card.id);
              items.push(card);
            }
          });
        }
      }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 150));
  }

  return items;
}

// ---------------------------------------------------------------------------
// G마켓: Cloudflare Managed Challenge 때문에 fetch만으로는 안 되고,
// 실제 탭을 열어 페이지가 로드된 뒤 __NEXT_DATA__ 를 읽어야 한다.
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

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finish, 15000); // 안전장치
  });
}

async function collectGmarket() {
  // Cloudflare가 백그라운드(비활성) 탭을 의심할 수 있어 실제로 포커스를 주는 활성 탭으로 연다
  const tab = await chrome.tabs.create({ url: 'https://m.gmarket.co.kr/n/live/schedule', active: true });
  try {
    await waitForTabComplete(tab.id);
    await new Promise((r) => setTimeout(r, 2500)); // 클라이언트 JS 안정화 대기

    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN', // window.__NEXT_DATA__ 는 페이지 자체 스크립트가 만든 값이라 MAIN world에서 읽어야 함
      func: () => {
        try {
          const nd = window.__NEXT_DATA__;
          const pageProps = nd?.props?.pageProps;
          const sched = pageProps?.initialStates?.schedule;
          const catalogs = sched?.liveCatalogs || [];
          const lives = catalogs.flatMap((c) => c.lives || []);
          return {
            lives,
            debug: {
              hasNextData: !!nd,
              hasPageProps: !!pageProps,
              pagePropsKeys: pageProps ? Object.keys(pageProps) : [],
              hasSchedule: !!sched,
              catalogCount: catalogs.length,
              livesCount: lives.length,
            },
          };
        } catch (e) {
          return { lives: [], debug: { error: e.message } };
        }
      },
    });

    const payload = injection?.[0]?.result || { lives: [], debug: {} };
    const rawLives = payload.lives || [];
    const seen = new Set();
    const items = [];
    rawLives.forEach((item) => {
      const card = gmarketToCard(item);
      if (card.id && !seen.has(card.id)) {
        seen.add(card.id);
        items.push(card);
      }
    });
    items._debug = payload.debug;
    return items;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// 오늘의집: store.ohou.se 도 Akamai WAF가 IP 기반으로 데이터센터를 막아서
// 백그라운드 fetch만으로 충분하다(올리브영과 같은 패턴, G마켓처럼 탭은 불필요).
// 개별 방송 API가 없고 브랜드별 세션이 전부 하나의 기획전 페이지(id 15276)
// 안에 페이지빌더 블록으로 쌓여있다. 브랜드명은 텍스트 구분선으로 나오지만
// 날짜/요일/시간은 각 섹션 첫 이미지 안에 그려져 있어 OCR.space로 읽는다.
const OHOUSE_EXHIBITION_ID = '15276';
const OCR_SPACE_API = 'https://api.ocr.space/parse/imageurl';

async function ocrExtractText(imageUrl, apiKey) {
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
    const r = await fetch(`${OCR_SPACE_API}?${params}`);
    if (!r.ok) return [];
    const data = await r.json();
    if (data.IsErroredOnProcessing) return [];
    const text = data.ParsedResults?.[0]?.ParsedText || '';
    return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 2);
  } catch (e) {
    return [];
  }
}

function collectOhouseSections(units) {
  const flat = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && node.props?.value) flat.push({ type: 'text', value: node.props.value });
    if (node.type === 'image' && node.props) flat.push({ type: 'image', src: node.props.src || node.props.url });
    if (Array.isArray(node.children)) node.children.forEach(walk);
  }
  walk(units);

  const sections = [];
  let current = null;
  flat.forEach((entry) => {
    if (entry.type === 'text') {
      const m = entry.value.match(/^-+\s*([^-]+?)\s*-+$/);
      if (m) {
        current = { brand: m[1].trim(), image: null };
        sections.push(current);
      }
      return;
    }
    if (entry.type === 'image' && current && !current.image) {
      current.image = entry.src;
    }
  });
  return sections.filter((s) => s.image);
}

function ohouseParseStart(text, nowKst) {
  // "07.16"의 마침표를 OCR이 가끔 놓쳐서 "0716"처럼 붙어나오기도 해 두 패턴 다 시도한다
  let m = text.match(/(\d{1,2})\s*\.\s*(\d{1,2})[^\d]{0,12}?(오전|오후)?\s*(\d{1,2})\s*시/);
  let month, day;
  if (m) {
    month = parseInt(m[1], 10);
    day = parseInt(m[2], 10);
  } else {
    m = text.match(/(\d{2})(\d{2})[^\d]{0,12}?(오전|오후)?\s*(\d{1,2})\s*시/);
    if (!m) return null;
    month = parseInt(m[1], 10);
    day = parseInt(m[2], 10);
  }
  let hour = parseInt(m[4], 10);
  if (m[3] === '오후' && hour !== 12) hour += 12;
  if (m[3] === '오전' && hour === 12) hour = 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23) return null;

  let year = nowKst.getUTCFullYear();
  if (month < nowKst.getUTCMonth() + 1 - 6) year += 1;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  return `${year}-${mm}-${dd}T${hh}:00:00`;
}

async function collectOhouse() {
  const ocrApiKey = await getOcrApiKey();
  if (!ocrApiKey) return [];

  const res = await fetch(`https://store.ohou.se/api/exhibitions/${OHOUSE_EXHIBITION_ID}`);
  if (!res.ok) return [];
  const data = await res.json();
  const detail = data.exhibition?.details?.[0];
  if (!detail) return [];
  let units;
  try { units = JSON.parse(detail.units); } catch (e) { return []; }

  const sections = collectOhouseSections(units).slice(0, 60);
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const now = Date.now();
  const pageUrl = `https://store.ohou.se/exhibitions/${OHOUSE_EXHIBITION_ID}`;

  const items = [];
  for (const s of sections) {
    const lines = await ocrExtractText(s.image, ocrApiKey);
    const text = lines.join(' ');
    const start = ohouseParseStart(text, nowKst);
    if (!start) continue;
    if (new Date(start).getTime() < now) continue;
    items.push({
      id: `ohouse-${s.brand}-${start}`,
      title: `${s.brand} 라이브`,
      platform: '오늘의집',
      channel: s.brand,
      start,
      end: null,
      status: 'BEFORE',
      url: pageUrl,
    });
  }
  return items;
}
