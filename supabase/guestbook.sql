-- 한 줄 방명록 표 · Supabase SQL Editor 또는 MCP(apply_migration)로 한 번 실행합니다.
--
-- 읽기  누구나(anon, authenticated) select만 가능 · RLS 정책 + 권한 둘 다로 막습니다
-- 쓰기  공개 역할에는 권한이 없습니다. 서버 함수(api/guestbook.js)가 secret 키로만 저장합니다
-- 검사  api에서 먼저 검사하지만, DB도 같은 규칙(앞뒤 공백 제외 이름 1~20자, 내용 1~200자)을 지킵니다

create table if not exists public.guestbook (
  id         bigint generated always as identity primary key,
  name       text        not null,
  message    text        not null,
  created_at timestamptz not null default now(),
  constraint guestbook_name_len    check (name = btrim(name) and char_length(name) between 1 and 20),
  constraint guestbook_message_len check (message = btrim(message) and char_length(message) between 1 and 200)
);

-- 최근 글 20개를 빠르게 읽기 위한 색인
create index if not exists guestbook_created_at_idx on public.guestbook (created_at desc);

-- RLS: 켜 두면 정책이 허용한 것만 됩니다
alter table public.guestbook enable row level security;

drop policy if exists "guestbook_public_read" on public.guestbook;
create policy "guestbook_public_read"
  on public.guestbook
  for select
  to anon, authenticated
  using (true);

-- 권한: 공개 역할은 기본으로 받은 권한을 모두 거둔 뒤 select만 다시 줍니다
revoke all on table public.guestbook from anon, authenticated;
grant select on table public.guestbook to anon, authenticated;

-- 서버 함수(secret 키 = service_role)는 RLS를 건너뛰지만 표 권한은 따로 필요합니다
-- (최근 Supabase 프로젝트는 새 표에 자동으로 권한을 주지 않습니다)
grant select, insert on table public.guestbook to service_role;
