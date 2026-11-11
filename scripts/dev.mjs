// 수업용 로컬 시험 서버 · 정적 파일(index.html 등)과 api/ 함수를 한 주소에서 함께 엽니다.
//
//   node scripts/dev.mjs           실제 호출. .env.local의 DATA_GO_KR_KEY를 읽습니다(없으면 함수가 500을 돌려줍니다)
//   node scripts/dev.mjs --mock    연습 모드. 공공데이터 대신 tests/fixtures의 예시 응답을 씁니다(인증키 불필요)
//   PORT=4000 node scripts/dev.mjs 다른 포트로 열기 (기본 3000)
//
// Vercel과 완전히 같지는 않습니다. CDN 캐시(x-vercel-cache), 함수 지역, 배포 보호, 대시보드 로그가 없습니다.
// 배포 전에 화면과 함수가 함께 동작하는지 확인하는 용도로만 씁니다. 함수 파일을 고치면 다음 요청부터 바로 반영됩니다.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 3000);
const MOCK = process.argv.includes('--mock');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
};

loadEnvFile(join(ROOT, '.env.local'));
if (MOCK) installMock();

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  try {
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) await runFunction(req, res, url);
    else await serveFile(req, res, url);
  } catch (error) {
    console.error('[dev] 서버 오류:', error);
    if (!res.headersSent) send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, '시험 서버 오류: 터미널을 확인하세요.');
  }
  console.log(`${req.method} ${url.pathname}${url.search} → ${res.statusCode} (${Date.now() - started}ms)`);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n수업용 로컬 시험 서버 · http://localhost:${PORT}`);
  console.log('- 정적 파일과 api/ 함수를 함께 엽니다. Vercel과 완전히 같지는 않습니다(CDN 캐시·지역·배포 보호 없음).');
  console.log(`- 인증키 DATA_GO_KR_KEY: ${process.env.DATA_GO_KR_KEY ? '있음(값은 표시하지 않음)' : '없음'}`);
  console.log(`- 연습 모드: ${MOCK ? '켜짐 · 예시 응답이 있는 달: 2026년 9월(상위 오류)·10월(여러 건)·11월(없음)·12월(한 건)' : '꺼짐'}`);
  console.log('- 끝낼 때는 Ctrl+C\n');
});

// /api/이름 → api/이름.js 의 export default { fetch(request) } 를 실행합니다
async function runFunction(req, res, url) {
  const name = url.pathname.slice('/api/'.length).replace(/\/$/, '');
  const file = join(ROOT, 'api', `${name}.js`);
  if (!/^[\w-]+$/.test(name) || !existsSync(file)) {
    return send(res, 404, { 'Content-Type': 'application/json; charset=utf-8' },
      JSON.stringify({ error: `함수 파일이 없습니다: api/${name || '(이름 없음)'}.js` }));
  }
  const mod = await import(`${pathToFileURL(file).href}?v=${Date.now()}`); // 고친 내용을 매번 새로 읽습니다
  const handler = mod.default?.fetch ? (request) => mod.default.fetch(request) : mod[req.method];
  if (typeof handler !== 'function') {
    return send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' },
      `api/${name}.js에서 export default { fetch(request) { … } } 형식을 찾지 못했습니다.`);
  }
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  const request = new Request(url, { method: req.method, headers: toHeaders(req.headers), body });
  const response = await handler(request);
  const headers = {};
  response.headers.forEach((value, key) => { headers[key] = value; });
  const data = req.method === 'HEAD' ? '' : Buffer.from(await response.arrayBuffer());
  send(res, response.status, headers, data);
}

// 프로젝트 폴더의 정적 파일을 보냅니다. 숨김 파일(.env.local 등)과 폴더 밖 경로는 열지 않습니다
async function serveFile(req, res, url) {
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(ROOT, `.${path}`);
  const hidden = path.split('/').some((part) => part.startsWith('.') || part === 'node_modules');
  if (hidden || !file.startsWith(ROOT + sep) || !(await isFile(file))) {
    return send(res, 404, { 'Content-Type': 'text/html; charset=utf-8' },
      '<!doctype html><meta charset="utf-8"><title>404</title><p>404 · 파일이 없습니다.</p>');
  }
  let data = await readFile(file);
  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  if (MOCK && type.startsWith('text/html') && process.env.MOCK_BANNER !== '0') {
    data = Buffer.from(String(data).replace(/<body([^>]*)>/i, `<body$1>${MOCK_BANNER}`));
  }
  send(res, 200, { 'Content-Type': type, 'Cache-Control': 'no-store' }, req.method === 'HEAD' ? '' : data);
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function toHeaders(nodeHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

// .env.local의 KEY=VALUE 줄을 읽어 환경 변수로 넣습니다(이미 있는 값은 그대로 둡니다)
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (value && process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

// 연습 모드: apis.data.go.kr로 가는 요청만 가로채 예시 응답을 돌려줍니다
function installMock() {
  const realFetch = globalThis.fetch;
  const fixtures = join(ROOT, 'tests', 'fixtures');
  const SAMPLES = {
    '2026-09': ['error-key-not-registered.json', 'application/json', 403], // 키가 틀렸을 때의 실제 응답처럼 HTTP 403
    '2026-10': ['rest-2026-10.json', 'application/json;charset=UTF-8'],
    '2026-11': ['rest-2026-11.json', 'application/json;charset=UTF-8'],
    '2026-12': ['rest-2026-12.json', 'application/json;charset=UTF-8'],
  };
  const delayMs = Number(process.env.MOCK_DELAY_MS || 400);
  process.env.DATA_GO_KR_KEY ||= 'practice-mode-key';
  globalThis.fetch = async (input, init = {}) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.hostname !== 'apis.data.go.kr') return realFetch(input, init);
    await wait(delayMs, init.signal);
    const month = `${target.searchParams.get('solYear')}-${target.searchParams.get('solMonth')}`;
    const sample = SAMPLES[month];
    if (!sample) {
      console.log(`[연습 모드] ${month} 예시 응답이 없습니다. 예시가 있는 달: ${Object.keys(SAMPLES).join(', ')}`);
      return new Response('<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>'
        + '<returnAuthMsg>연습 모드 예시 없음: 2026년 9~12월만 있습니다</returnAuthMsg>'
        + '<returnReasonCode>99</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>',
      { headers: { 'Content-Type': 'text/xml;charset=UTF-8' } });
    }
    return new Response(await readFile(join(fixtures, sample[0])), { status: sample[2] ?? 200, headers: { 'Content-Type': sample[1] } });
  };
}

function wait(ms, signal) {
  return new Promise((ok, fail) => {
    const timer = setTimeout(ok, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); fail(signal.reason); }, { once: true });
  });
}

const MOCK_BANNER = '<div role="note" style="background:#fef3c7;color:#78350f;padding:8px 16px;'
  + 'font:14px/1.5 -apple-system,\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;text-align:center">'
  + '연습 모드 · 공공데이터 대신 예시 응답을 씁니다 (2026년 10월 여러 건 · 11월 없음 · 12월 한 건 · 9월 상위 오류)</div>';
