-- ============================================================
-- "이따라방!" 과거 방송 데이터 저장용 Supabase 스키마
-- Supabase 대시보드 > SQL Editor에 붙여넣고 Run 하면 됩니다.
-- (여러 번 실행해도 안전하도록 if not exists 처리)
-- ============================================================

-- gen_random_uuid()용 (Supabase는 기본 활성화지만 안전하게)
create extension if not exists pgcrypto;

-- ILIKE '%키워드%' 검색이 데이터 쌓여도 느려지지 않도록 트라이그램 인덱스 사용
create extension if not exists pg_trgm;

-- ------------------------------------------------------------
-- broadcasts: 방송 1건 = 1행. labang_id 기준으로 중복 방지(upsert)
-- ------------------------------------------------------------
create table if not exists broadcasts (
  id         uuid primary key default gen_random_uuid(),
  labang_id  text not null unique,          -- 라방바 ID 또는 자체 크롤러 ID
  title      text,
  platform   text,                          -- 예: '네이버쇼핑라이브'
  brand      text,                          -- 제목에서 추출한 브랜드명
  start_at   timestamptz,
  end_at     timestamptz,
  url        text,
  source     text,                          -- 'naver' | 'kakao' | 'gmarket' | 'ssg' | 'oliveyoung' | 'labangba'
  created_at timestamptz not null default now()
);

-- 검색 패턴: title ILIKE '%키워드%' AND start_at < now() ORDER BY start_at DESC
create index if not exists broadcasts_title_trgm_idx on broadcasts using gin (title gin_trgm_ops);
create index if not exists broadcasts_start_at_idx   on broadcasts (start_at desc);

-- ------------------------------------------------------------
-- benefits: 방송별 혜택 정보 (OCR 결과 등)
-- ------------------------------------------------------------
create table if not exists benefits (
  id            uuid primary key default gen_random_uuid(),
  broadcast_id  uuid references broadcasts (id) on delete cascade,
  discount_rate text,
  coupon        text,
  gift          text,
  raw_text      text,                       -- OCR 원문
  created_at    timestamptz not null default now()
);

create index if not exists benefits_broadcast_id_idx on benefits (broadcast_id);

-- ------------------------------------------------------------
-- RLS: anon 키로는 읽기만 가능, 쓰기는 서버(service_role 키)만.
-- 서버리스 함수는 SUPABASE_SERVICE_KEY를 쓰므로 RLS를 우회해 쓰기 가능.
-- ------------------------------------------------------------
alter table broadcasts enable row level security;
alter table benefits   enable row level security;

drop policy if exists "public read broadcasts" on broadcasts;
create policy "public read broadcasts" on broadcasts for select using (true);

drop policy if exists "public read benefits" on benefits;
create policy "public read benefits" on benefits for select using (true);
