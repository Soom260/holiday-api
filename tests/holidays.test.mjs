// api/holidays.js 시험 · 전역 fetch를 가짜(모의)로 바꿔 실제 공공데이터를 부르지 않고 확인합니다.
// 실행: 이 폴더에서  npm test   (또는  node --test)
// fixtures/는 공식 명세의 필드 구조를 따른 예시 응답입니다. 2026년 10·11·12월은 「2026년 월력요항」(우주항공청)의 공휴일과 같습니다.
// error-key-not-registered.*는 등록되지 않은 키로 실제 호출한 응답 본문(2026-10-24, HTTP 403)을 그대로 옮겼습니다.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import handler from '../api/holidays.js';

const TEST_KEY = 'test-key-1234';
const API = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

// 브라우저가 /api/holidays?… 를 부른 것처럼 함수에 요청을 보냅니다
function call(query, init) {
  return handler.fetch(new Request(`http://localhost/api/holidays${query}`, init));
}

// 공공데이터 서버 흉내: 받은 요청을 기록하고, 정해 둔 응답을 돌려줍니다
function fakeUpstream(body, { status = 200, type = 'application/json;charset=UTF-8' } = {}) {
  return mock.method(globalThis, 'fetch', async () => new Response(body, { status, headers: { 'Content-Type': type } }));
}

function sentUrl(fetchMock) {
  return new URL(String(fetchMock.mock.calls[0].arguments[0]));
}

let errorLog;
beforeEach(() => {
  process.env.DATA_GO_KR_KEY = TEST_KEY;
  errorLog = mock.method(console, 'error', () => {}); // 시험 중 오류 로그는 화면에 찍지 않고 모아 둡니다
});
afterEach(() => {
  mock.restoreAll();
  delete process.env.DATA_GO_KR_KEY;
});

test('여러 건: 배열로 온 item을 날짜순 목록으로 돌려준다', async () => {
  const upstream = fakeUpstream(await fixture('rest-2026-10.json'));
  const res = await call('?year=2026&month=10');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /s-maxage=3600/);
  const body = await res.json();
  assert.equal(body.year, 2026);
  assert.equal(body.month, 10);
  assert.equal(body.count, 3);
  assert.deepEqual(body.items, [
    { date: '2026-10-03', name: '개천절', holiday: true },
    { date: '2026-10-05', name: '대체공휴일', holiday: true },
    { date: '2026-10-09', name: '한글날', holiday: true },
  ]);
  assert.ok(!Number.isNaN(Date.parse(body.fetchedAt)));

  // 공공데이터에 보낸 요청 주소와 변수
  assert.equal(upstream.mock.callCount(), 1);
  const sent = sentUrl(upstream);
  assert.equal(`${sent.origin}${sent.pathname}`, API);
  assert.equal(sent.searchParams.get('solYear'), '2026');
  assert.equal(sent.searchParams.get('solMonth'), '10');
  assert.equal(sent.searchParams.get('_type'), 'json');
  assert.equal(sent.searchParams.get('ServiceKey'), TEST_KEY);
  assert.ok(upstream.mock.calls[0].arguments[1]?.signal instanceof AbortSignal, '시간 제한 신호를 함께 보낸다');

  // 인증키는 응답에 들어가지 않는다
  assert.ok(!JSON.stringify(body).includes(TEST_KEY));
});

test('한 건: 객체로 온 item도 목록 하나로 바꾼다', async () => {
  fakeUpstream(await fixture('rest-2026-12.json'));
  const body = await (await call('?year=2026&month=12')).json();
  assert.equal(body.count, 1);
  assert.deepEqual(body.items, [{ date: '2026-12-25', name: '기독탄신일', holiday: true }]);
});

test('없음: items가 빈 문자열이면 빈 목록(200)을 돌려준다', async () => {
  fakeUpstream(await fixture('rest-2026-11.json'));
  const res = await call('?year=2026&month=11');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /s-maxage=/, '결과 없음도 정상 응답이라 캐시한다');
  const body = await res.json();
  assert.equal(body.count, 0);
  assert.deepEqual(body.items, []);
});

test('결과코드 03(NODATA_ERROR)은 오류가 아니라 결과 없음으로 처리한다', async () => {
  fakeUpstream(JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NODATA_ERROR' } } }));
  const res = await call('?year=2026&month=4');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).count, 0);
});

test('순서가 섞여 와도 날짜순으로 정리하고, 날짜 형식이 틀린 항목은 건너뛴다', async () => {
  fakeUpstream(JSON.stringify({
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: { items: { item: [
        { dateName: '한글날', isHoliday: 'Y', locdate: '20261009' },
        { dateName: '날짜 없음', isHoliday: 'Y' },
        { dateName: '개천절', isHoliday: 'Y', locdate: 20261003 },
      ] }, totalCount: 3 },
    },
  }));
  const body = await (await call('?year=2026&month=10')).json();
  assert.deepEqual(body.items.map((item) => item.name), ['개천절', '한글날']);
});

test('한 자리 월과 앞뒤 공백은 정리해서 보낸다 (month=3 → solMonth=03)', async () => {
  const upstream = fakeUpstream(await fixture('rest-2026-11.json'));
  await call('?year=%202026%20&month=3');
  assert.equal(sentUrl(upstream).searchParams.get('solYear'), '2026');
  assert.equal(sentUrl(upstream).searchParams.get('solMonth'), '03');
});

test('잘못된 입력은 400이고, 공공데이터를 부르지 않는다', async () => {
  const upstream = fakeUpstream('{}');
  const cases = [
    ['?year=abcd&month=10', 'BAD_YEAR'],
    ['?year=1999&month=1', 'BAD_YEAR'],
    ['?year=20261&month=1', 'BAD_YEAR'],
    ['?month=10', 'BAD_YEAR'],
    ['?year=2026&month=13', 'BAD_MONTH'],
    ['?year=2026&month=0', 'BAD_MONTH'],
    ['?year=2026&month=1.5', 'BAD_MONTH'],
    ['?year=2026', 'BAD_MONTH'],
    ['?year=2026&month=%3Cscript%3E', 'BAD_MONTH'],
  ];
  for (const [query, code] of cases) {
    const res = await call(query);
    assert.equal(res.status, 400, query);
    assert.equal(res.headers.get('cache-control'), 'no-store', query);
    const body = await res.json();
    assert.equal(body.code, code, query);
    assert.match(body.error, /예: \?year=2026&month=10/, query);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('인증키가 없으면 500과 설정 안내를 돌려주고, 공공데이터를 부르지 않는다', async () => {
  const upstream = fakeUpstream('{}');
  for (const value of [undefined, '   ']) {
    if (value === undefined) delete process.env.DATA_GO_KR_KEY;
    else process.env.DATA_GO_KR_KEY = value;
    const res = await call('?year=2026&month=10');
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.code, 'NO_KEY');
    assert.match(body.hint, /Environment Variables/);
  }
  assert.equal(upstream.mock.callCount(), 0);
});

test('Encoding 키를 넣어도 한 번만 인코딩해서 보낸다', async () => {
  process.env.DATA_GO_KR_KEY = 'ab%2Bcd%2Fef%3D%3D'; // Encoding 키 모양
  const upstream = fakeUpstream(await fixture('rest-2026-11.json'));
  await call('?year=2026&month=11');
  const raw = String(upstream.mock.calls[0].arguments[0]);
  assert.equal(sentUrl(upstream).searchParams.get('ServiceKey'), 'ab+cd/ef==');
  assert.ok(raw.includes('ServiceKey=ab%2Bcd%2Fef%3D%3D'), raw);
  assert.ok(!raw.includes('%252B'), '두 번 인코딩하지 않는다');
});

test('등록되지 않은 인증키(HTTP 403, 본문 JSON·XML)는 502와 확인할 점을 돌려준다', async () => {
  // 실제로는 _type=json이면 JSON, 없으면 XML 본문이 HTTP 403과 함께 옵니다
  for (const [name, type] of [['error-key-not-registered.json', 'application/json'], ['error-key-not-registered.xml', 'application/xml']]) {
    const upstream = fakeUpstream(await fixture(name), { status: 403, type });
    const res = await call('?year=2026&month=10');
    assert.equal(res.status, 502, name);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.code, 'UPSTREAM_ERROR', name);
    assert.equal(body.upstreamCode, '30', name);
    assert.match(body.error, /코드 30 · 등록되지 않은 서비스키/);
    assert.match(body.hint, /DATA_GO_KR_KEY/);
    upstream.mock.restore();
  }
  // 로그에는 원인이 남고, 인증키는 남지 않는다
  const logged = errorLog.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
  assert.match(logged, /코드 30/);
  assert.ok(!logged.includes(TEST_KEY));
});

test('JSON 결과코드가 00이 아니면(22 호출 한도 초과) 502', async () => {
  fakeUpstream(await fixture('error-limit.json'));
  const res = await call('?year=2026&month=10');
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.upstreamCode, '22');
  assert.match(body.hint, /캐시/);
});

test('JSON 대신 정상 XML이 오면 _type=json을 확인하라고 안내한다', async () => {
  fakeUpstream('<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header></response>',
    { type: 'text/xml' });
  const res = await call('?year=2026&month=10');
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.code, 'UPSTREAM_FORMAT');
  assert.match(body.hint, /_type=json/);
});

test('상위 HTTP 오류(503)는 502', async () => {
  fakeUpstream('Service Unavailable', { status: 503, type: 'text/plain' });
  const res = await call('?year=2026&month=10');
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.code, 'UPSTREAM_HTTP');
  assert.match(body.error, /503/);
});

test('JSON도 XML도 아닌 응답과 헤더가 없는 JSON은 502', async () => {
  fakeUpstream('Unauthorized', { type: 'text/plain' });
  assert.equal((await (await call('?year=2026&month=10')).json()).code, 'UPSTREAM_FORMAT');
  mock.restoreAll();
  fakeUpstream('{"result":"ok"}');
  const res = await call('?year=2026&month=10');
  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, 'UPSTREAM_FORMAT');
});

test('시간 초과는 502와 다시 시도 안내', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  });
  const res = await call('?year=2026&month=10');
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.code, 'UPSTREAM_TIMEOUT');
  assert.match(body.error, /8초/);
});

test('연결 실패(네트워크 오류)는 502', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });
  const res = await call('?year=2026&month=10');
  assert.equal(res.status, 502);
  assert.equal((await res.json()).code, 'UPSTREAM_NETWORK');
});

test('GET이 아닌 요청은 405', async () => {
  const upstream = fakeUpstream('{}');
  const res = await call('?year=2026&month=10', { method: 'POST', body: 'x' });
  assert.equal(res.status, 405);
  assert.equal(upstream.mock.callCount(), 0);
});
