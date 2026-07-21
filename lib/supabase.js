import { createClient } from '@supabase/supabase-js';

// Supabase 클라이언트 + 방송 데이터 저장 헬퍼.
// api/ 폴더 밖에 있어야 Vercel 서버리스 함수 개수(Hobby 12개 제한)에 잡히지 않는다.

let client = null;

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

// 라방바 자체 형식("2607092000" = YYMMDDHHmm)과 크롤러 ISO 형식("2026-07-09T20:00:00")
// 둘 다 KST 기준 timestamptz 문자열로 변환한다.
export function toTimestamptz(value) {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (m) return `20${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`;
  m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    const time = m[2].length === 5 ? m[2] + ':00' : m[2];
    // 오프셋 없는 ISO는 KST 로컬 시각으로 간주 (크롤러들이 KST를 그대로 준다)
    return `${m[1]}T${time}${m[3] || '+09:00'}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// timestamptz → 프론트 parseLabangDate가 처리하는 KST 로컬 문자열("2026-07-09T20:00:00")
export function tsToKstLocal(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19);
}

// 제목에서 브랜드 추출: "[브랜드]"류 괄호가 있으면 그 안, 없으면 첫 단어
export function extractBrand(title) {
  if (!title) return null;
  const bracket = title.match(/^\s*[\[(【]([^\])】]{1,30})[\])】]/);
  if (bracket) return bracket[1].trim();
  const first = title.trim().split(/\s+/)[0];
  return first && first.length <= 20 ? first : null;
}

// ILIKE 패턴에 들어가는 사용자 입력의 와일드카드 무력화
export function escapeLike(term) {
  return term.replace(/[\\%_]/g, '\\$&');
}

// 검색/스케줄 응답 카드 → broadcasts 테이블 행
export function toBroadcastRow(item, source) {
  if (!item || item.id == null || !item.title) return null;
  return {
    labang_id: String(item.id),
    title: item.title,
    platform: item.platform || null,
    brand: extractBrand(item.title),
    start_at: toTimestamptz(item.start),
    end_at: toTimestamptz(item.end),
    url: item.url || null,
    source: source || 'labangba',
  };
}

// broadcasts에 upsert (labang_id 기준 중복 방지). 저장 실패가 검색 응답을
// 막으면 안 되므로 throw하지 않고 결과 객체만 반환한다.
export async function saveBroadcasts(items, source) {
  const supabase = getSupabase();
  if (!supabase) return { saved: 0, error: 'supabase not configured' };

  // 같은 배치 안에 labang_id가 중복되면 upsert가 통째로 실패하므로 먼저 제거
  const byId = new Map();
  for (const item of items || []) {
    const row = toBroadcastRow(item, source);
    if (row) byId.set(row.labang_id, row);
  }
  const rows = [...byId.values()];
  if (rows.length === 0) return { saved: 0 };

  const { error } = await supabase
    .from('broadcasts')
    .upsert(rows, { onConflict: 'labang_id' });
  if (error) return { saved: 0, error: error.message };
  return { saved: rows.length };
}
