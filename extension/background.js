// Vercel 서버 IP가 올리브영 WAF / G마켓 Cloudflare 챌린지에 막혀 있어,
// 대신 이 확장프로그램이 설치된 실제 브라우저(실사용자 IP)로 주기적으로
// 두 사이트를 방문해 편성표를 수집하고 /api/ingest 로 전송한다.

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

async function runAll() {
  const secret = await getSecret();
  if (!secret) {
    const result = { error: '팝업에서 시크릿을 먼저 입력해주세요' };
    await chrome.storage.local.set({ lastRun: new Date().toISOString(), lastResult: result });
    return result;
  }

  const [oliveyoungResult, gmarketResult] = await Promise.allSettled([
    collectOliveyoung(),
    collectGmarket(),
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
