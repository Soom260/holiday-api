// 방명록 입력 검사 시험 · Supabase에 접속하지 않습니다.
// 실행: 이 폴더에서  npm test   (또는  node --test)
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntry, NAME_MAX, MESSAGE_MAX } from '../lib/guestbook-validate.js';
import handler from '../api/guestbook.js';

const ENV = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'];

// ── validateEntry ─────────────────────────────────────────────

test('정상 입력은 앞뒤 공백을 빼고 통과한다', () => {
  assert.deepEqual(validateEntry({ name: '  수민 ', message: ' 안녕하세요!  ' }),
    { ok: true, value: { name: '수민', message: '안녕하세요!' } });
});

test('이름 경계값: 20자는 통과, 21자는 거절', () => {
  assert.equal(validateEntry({ name: '가'.repeat(NAME_MAX), message: 'hi' }).ok, true);
  const r = validateEntry({ name: '가'.repeat(NAME_MAX + 1), message: 'hi' });
  assert.equal(r.ok, false);
  assert.equal(r.field, 'name');
  assert.match(r.error, /20자 이하/);
});

test('내용 경계값: 200자는 통과, 201자는 거절', () => {
  assert.equal(validateEntry({ name: 'a', message: 'x'.repeat(MESSAGE_MAX) }).ok, true);
  const r = validateEntry({ name: 'a', message: 'x'.repeat(MESSAGE_MAX + 1) });
  assert.equal(r.ok, false);
  assert.equal(r.field, 'message');
});

test('빈 값과 공백만 있는 값은 거절', () => {
  for (const [name, message, field] of [['', 'hi', 'name'], ['   ', 'hi', 'name'], ['a', '', 'message'], ['a', ' 　 ', 'message']]) {
    const r = validateEntry({ name, message });
    assert.equal(r.ok, false, JSON.stringify({ name, message }));
    assert.equal(r.field, field);
  }
});

test('앞뒤 공백은 글자 수에 넣지 않는다', () => {
  assert.equal(validateEntry({ name: `  ${'a'.repeat(NAME_MAX)}  `, message: 'hi' }).ok, true);
});

test('이모지는 DB(char_length)처럼 한 글자로 센다', () => {
  assert.equal(validateEntry({ name: '😀'.repeat(NAME_MAX), message: 'hi' }).ok, true);
  assert.equal(validateEntry({ name: '😀'.repeat(NAME_MAX + 1), message: 'hi' }).ok, false);
});

test('줄바꿈·탭 같은 제어 문자는 거절', () => {
  assert.equal(validateEntry({ name: 'a', message: '첫 줄\n둘째 줄' }).ok, false);
  assert.equal(validateEntry({ name: 'a\tb', message: 'hi' }).ok, false);
});

test('글자가 아닌 값과 빠진 칸은 거절', () => {
  for (const input of [{ name: 123, message: 'hi' }, { name: 'a', message: null }, { name: 'a' }, { message: 'hi' },
    { name: ['a'], message: 'hi' }]) {
    assert.equal(validateEntry(input).ok, false, JSON.stringify(input));
  }
});

test('객체가 아닌 본문은 거절', () => {
  for (const input of [null, undefined, 'text', 42, [], ['a', 'b']]) {
    const r = validateEntry(input);
    assert.equal(r.ok, false);
    assert.equal(r.field, null);
  }
});

// ── api/guestbook.js: DB에 가기 전에 끝나는 경우만 확인합니다 ─────────

function call(method, body, headers = { 'Content-Type': 'application/json' }) {
  return handler.fetch(new Request('http://localhost/api/guestbook', { method, headers, body }));
}

let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  mock.method(console, 'error', () => {});
  // 혹시라도 외부로 나가면 시험이 실패하도록 막아 둡니다
  mock.method(globalThis, 'fetch', async () => { throw new Error('시험 중 외부 호출 금지'); });
});
afterEach(() => {
  mock.restoreAll();
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

test('POST 잘못된 입력은 키를 보기 전에 400', async () => {
  const res = await call('POST', JSON.stringify({ name: '', message: 'hi' }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'BAD_INPUT');
  assert.equal(body.field, 'name');
});

test('POST JSON이 아니면 400, Content-Type이 다르면 415, 너무 크면 413', async () => {
  assert.equal((await call('POST', '{name:')).status, 400);
  assert.equal((await call('POST', 'name=a', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await call('POST', JSON.stringify({ name: 'a', message: 'x'.repeat(5000) }))).status, 413);
});

test('POST 올바른 입력인데 키가 없으면 500과 안내, 키 값은 응답에 없다', async () => {
  const res = await call('POST', JSON.stringify({ name: 'a', message: 'hi' }));
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.code, 'NO_KEY');
  assert.match(body.hint, /SUPABASE_SECRET_KEY/);
});

test('GET 키가 없으면 500', async () => {
  const res = await call('GET', undefined, {});
  assert.equal(res.status, 500);
  assert.match((await res.json()).hint, /SUPABASE_PUBLISHABLE_KEY/);
});

test('허용하지 않는 방식은 405', async () => {
  const res = await call('DELETE', undefined, {});
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD, POST');
});
