// 한 줄 방명록 Vercel 함수 · Supabase 표 public.guestbook (supabase/guestbook.sql)
//
//   GET  /api/guestbook   최근 20개를 새 글부터 돌려줍니다      → 공개 키(SUPABASE_PUBLISHABLE_KEY), RLS의 읽기 정책을 따릅니다
//   POST /api/guestbook   {"name": "...", "message": "..."} 저장 → 입력 검사 뒤 서버 전용 키(SUPABASE_SECRET_KEY)로 저장합니다
//
// 키는 Vercel 환경 변수에서만 읽고, 코드·저장소·로그·응답에는 적지 않습니다.
// 공개 역할(anon)은 select 권한만 있으므로, 브라우저가 Supabase에 직접 글을 쓸 수는 없습니다.
import { createClient } from '@supabase/supabase-js';
import { validateEntry } from '../lib/guestbook-validate.js';

const TABLE = 'guestbook';
const COLUMNS = 'id, name, message, created_at';
const LIMIT = 20;
const MAX_BODY = 4096; // 이름 20자 + 내용 200자를 넉넉히 담는 크기(바이트)

export default {
  async fetch(request) {
    if (request.method === 'GET' || request.method === 'HEAD') return list();
    if (request.method === 'POST') return create(request);
    return fail(405, 'METHOD', '이 주소는 GET과 POST 요청만 받습니다.', {}, { Allow: 'GET, HEAD, POST' });
  },
};

async function list() {
  const db = client('SUPABASE_PUBLISHABLE_KEY');
  if (db.error) return db.error;

  const { data, error } = await db.client
    .from(TABLE).select(COLUMNS).order('created_at', { ascending: false }).limit(LIMIT);
  if (error) return dbError('읽기', error);

  return json(200, { count: data.length, items: data.map(toEntry), fetchedAt: new Date().toISOString() });
}

async function create(request) {
  // ① 본문 읽기: JSON만, 너무 큰 본문은 받지 않습니다
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return fail(415, 'BAD_TYPE', 'Content-Type: application/json 으로 보냅니다.');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) {
    return fail(413, 'TOO_LARGE', '보낸 내용이 너무 큽니다.');
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, 'BAD_JSON', 'JSON 형식이 올바르지 않습니다.');
  }

  // ② 입력 검사: 잘못된 입력은 DB에 가기 전에 400으로 돌려보냅니다
  const checked = validateEntry(body);
  if (!checked.ok) return fail(400, 'BAD_INPUT', checked.error, { field: checked.field });

  // ③ 저장: 서버 전용 키로만 씁니다
  const db = client('SUPABASE_SECRET_KEY');
  if (db.error) return db.error;

  const { data, error } = await db.client.from(TABLE).insert(checked.value).select(COLUMNS).single();
  if (error) return dbError('저장', error);

  return json(201, { item: toEntry(data) });
}

function client(keyName) {
  const url = (process.env.SUPABASE_URL ?? '').trim();
  const key = (process.env[keyName] ?? '').trim();
  if (!url || !key) {
    const missing = [!url && 'SUPABASE_URL', !key && keyName].filter(Boolean).join(', ');
    console.error(`[guestbook] 환경 변수가 없습니다: ${missing}`);
    return {
      error: fail(500, 'NO_KEY', '서버에 Supabase 설정이 없습니다.', {
        hint: `Vercel 프로젝트 Settings → Environment Variables에 ${missing}을(를) 추가한 뒤 다시 배포합니다.`,
      }),
    };
  }
  return {
    client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }),
  };
}

// DB 오류 원문은 로그에만 남기고, 응답에는 고칠 방법만 담습니다
function dbError(action, error) {
  console.error(`[guestbook] ${action} 실패 code=${error.code ?? '-'} ${error.message ?? ''}`);
  if (error.code === '23514') {
    return fail(400, 'BAD_INPUT', '이름은 1~20자, 내용은 1~200자로 써 주세요.');
  }
  return fail(502, 'DB_ERROR', `방명록을 ${action}하지 못했습니다. 잠시 뒤 다시 시도해 주세요.`);
}

function toEntry(row) {
  return { id: row.id, name: row.name, message: row.message, createdAt: row.created_at };
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function fail(status, code, error, extra = {}, headers = {}) {
  return json(status, { error, code, ...extra }, headers);
}
