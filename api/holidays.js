// 연·월을 받아 한국천문연구원 특일 정보(공휴일)를 실시간으로 조회하고 JSON으로 돌려주는 Vercel 함수입니다.
//
//   주소    /api/holidays?year=2026&month=10
//   인증키  Vercel 환경 변수 DATA_GO_KR_KEY (코드·저장소·로그·응답에는 적지 않습니다)
//   명세    https://www.data.go.kr/data/15012690/openapi.do  → 공휴일 정보 조회(getRestDeInfo)
//
// 흐름: ① 요청 변수 읽기 → ② 입력 검사 → ③ 인증키 확인 → ④ 외부 호출 → ⑤ 응답 확인 → ⑥ 정리해서 돌려주기

const API_URL = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
const TIMEOUT_MS = 8000; // 공공데이터 서버를 기다리는 최대 시간
const CACHE_OK = 'public, s-maxage=3600, stale-while-revalidate=86400'; // CDN이 1시간 보관하고, 그 뒤 하루 동안은 옛 응답을 주면서 새로 받아 둡니다
const SOURCE = '한국천문연구원 특일 정보(공공데이터포털)';

// 공공데이터포털 오류 코드별로 확인할 점 (API 상세 화면의 '오픈API 에러코드 안내'를 줄여 옮겼습니다)
const HINTS = {
  '01': '공공데이터포털 내부 오류입니다. 잠시 뒤 다시 시도합니다.',
  '04': 'HTTP 요청 처리에 실패했습니다. 요청 주소와 방식을 확인합니다.',
  '05': '기관 서버의 응답 대기시간이 지났습니다. 잠시 뒤 다시 시도합니다.',
  '10': '요청 변수의 이름이나 형식을 명세와 비교합니다.',
  '12': '요청한 서비스가 없습니다. API_URL에 오타가 없는지 확인합니다.',
  '20': '인증키가 빠졌거나 이 API의 이용 권한이 없습니다. 활용신청 승인 상태를 확인합니다.',
  '22': '오늘 호출 허용량을 넘었습니다. 응답 캐시 설정을 확인하고, 호출량이 초기화된 뒤 다시 시도합니다.',
  '23': '짧은 시간에 요청이 몰렸습니다. 잠시 뒤 다시 시도합니다.',
  '30': '등록되지 않은 인증키입니다. DATA_GO_KR_KEY 값(일반 인증키 Decoding)과 활용신청 상태를 확인합니다.',
  '31': '인증키 사용 기한이 끝났습니다. 공공데이터포털에서 이용 기간을 확인합니다.',
};

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fail(405, 'METHOD', '이 주소는 GET 요청만 받습니다.');
    }

    // ① 요청 변수 읽기: 주소의 ? 뒤에 붙은 year, month
    const params = new URL(request.url).searchParams;
    const yearText = (params.get('year') ?? '').trim();
    const monthText = (params.get('month') ?? '').trim();

    // ② 입력 검사: 잘못된 입력은 외부 API를 부르기 전에 400으로 돌려보냅니다
    if (!/^\d{4}$/.test(yearText) || Number(yearText) < 2000 || Number(yearText) > 2099) {
      return fail(400, 'BAD_YEAR', 'year는 2000~2099 사이의 네 자리 연도로 보냅니다. 예: ?year=2026&month=10');
    }
    if (!/^\d{1,2}$/.test(monthText) || Number(monthText) < 1 || Number(monthText) > 12) {
      return fail(400, 'BAD_MONTH', 'month는 1~12 사이의 숫자로 보냅니다. 예: ?year=2026&month=10');
    }
    const year = Number(yearText);
    const month = Number(monthText);

    // ③ 인증키 확인: 키는 Vercel 환경 변수에만 둡니다
    const key = readKey(process.env.DATA_GO_KR_KEY);
    if (!key) {
      console.error('[holidays] 환경 변수 DATA_GO_KR_KEY가 없습니다.');
      return fail(500, 'NO_KEY', '서버에 공공데이터 인증키가 설정되지 않았습니다.', {
        hint: 'Vercel 프로젝트 Settings → Environment Variables에 DATA_GO_KR_KEY를 추가한 뒤 다시 배포합니다.',
      });
    }

    // ④ 외부 호출: URLSearchParams가 요청 변수를 안전하게 이어 붙입니다
    const url = new URL(API_URL);
    url.search = new URLSearchParams({
      ServiceKey: key,
      solYear: String(year),
      solMonth: String(month).padStart(2, '0'),
      pageNo: '1',
      numOfRows: '30',
      _type: 'json', // 명세: 기본은 XML, json을 넣으면 JSON으로 받습니다
    }).toString();

    let status;
    let text;
    try {
      const upstream = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      status = upstream.status;
      text = await upstream.text();
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        console.error(`[holidays] ${TIMEOUT_MS / 1000}초 시간 초과 (${year}-${month})`);
        return fail(502, 'UPSTREAM_TIMEOUT',
          `공공데이터 서버가 ${TIMEOUT_MS / 1000}초 안에 답하지 않았습니다. 잠시 뒤 다시 시도해 주세요.`);
      }
      console.error(`[holidays] 연결 실패 ${error?.name ?? ''} (${year}-${month})`);
      return fail(502, 'UPSTREAM_NETWORK', '공공데이터 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    }

    // ⑤ 응답 확인: 공통 오류 코드 → HTTP 상태 → XML 오류 → JSON 결과코드 순서로 봅니다
    //    인증키 오류는 HTTP 403과 함께 본문에 코드(예: 30)가 오므로 HTTP 상태보다 먼저 읽습니다
    const common = readCommonError(text);
    if (common.code) {
      return upstreamError(common.code, common.message, year, month);
    }
    if (status < 200 || status >= 300) {
      console.error(`[holidays] 공공데이터 HTTP ${status} (${year}-${month})`);
      return fail(502, 'UPSTREAM_HTTP', `공공데이터 서버가 HTTP ${status} 오류로 답했습니다. 잠시 뒤 다시 시도해 주세요.`);
    }
    if (text.trim().startsWith('<')) {
      const xml = readXml(text);
      if (xml.code === '00') {
        return fail(502, 'UPSTREAM_FORMAT', '공공데이터 서버가 JSON 대신 XML로 답했습니다.', {
          hint: '요청 변수에 _type=json이 들어 있는지 확인합니다.',
        });
      }
      return upstreamError(xml.code, xml.message, year, month);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error(`[holidays] JSON이 아닌 응답 (${year}-${month})`);
      return fail(502, 'UPSTREAM_FORMAT', '공공데이터 서버의 응답을 읽지 못했습니다(JSON 형식이 아닙니다).');
    }
    const header = data?.response?.header;
    if (!header) {
      return fail(502, 'UPSTREAM_FORMAT', '공공데이터 서버의 응답 형식이 명세와 다릅니다.');
    }
    const resultCode = String(header.resultCode ?? '');
    if (resultCode !== '00' && resultCode !== '03') { // 03(NODATA_ERROR)은 '결과 없음'으로 처리합니다
      return upstreamError(resultCode, header.resultMsg, year, month);
    }

    // ⑥ 정리해서 돌려주기: item이 하나(객체)·여럿(배열)·없음("") 어느 경우든 배열로 바꿉니다
    const items = resultCode === '03' ? [] : toList(data.response.body?.items)
      .map(toHoliday)
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date));

    return Response.json(
      { year, month, count: items.length, items, source: SOURCE, fetchedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': CACHE_OK } },
    );
  },
};

// 오류 응답: 상태 코드와 한국어 안내를 JSON으로 보내고, 캐시에는 저장하지 않습니다
function fail(status, code, message, extra = {}) {
  return Response.json({ error: message, code, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function upstreamError(code, message, year, month) {
  console.error(`[holidays] 공공데이터 오류 코드 ${code || '-'} ${message || ''} (${year}-${month})`);
  const label = [code && `코드 ${code}`, message].filter(Boolean).join(' · ');
  return fail(502, 'UPSTREAM_ERROR', `공공데이터 서버가 오류를 알렸습니다${label ? ` (${label})` : ''}.`, {
    upstreamCode: code || null,
    hint: HINTS[code] ?? '잠시 뒤 다시 시도하고, 계속되면 공공데이터포털의 명세와 활용신청 상태를 확인합니다.',
  });
}

// 공공데이터포털의 Encoding 키(%2B 같은 글자가 들어 있음)를 넣었어도 한 번 풀어서 씁니다
function readKey(raw) {
  const key = String(raw ?? '').trim();
  if (!/%[0-9A-Fa-f]{2}/.test(key)) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

// 인증키 오류 같은 공통 오류는 OpenAPI_ServiceResponse의 cmmMsgHeader에 담겨 옵니다.
// _type=json이면 JSON, 아니면 XML이고, HTTP 상태는 403 같은 오류입니다(2026-10-24 확인)
function readCommonError(text) {
  const body = text.trim();
  if (body.startsWith('<')) return body.includes('<cmmMsgHeader>') ? readXml(body) : {};
  try {
    const head = JSON.parse(body)?.OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (!head) return {};
    return { code: String(head.returnReasonCode ?? ''), message: head.returnAuthMsg || head.errMsg || '' };
  } catch {
    return {};
  }
}

// XML 오류 응답에서 코드와 메시지를 꺼냅니다 (예: <returnReasonCode>30</returnReasonCode>)
function readXml(text) {
  const pick = (tag) => text.match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`))?.[1] ?? '';
  return {
    code: pick('returnReasonCode') || pick('resultCode'),
    message: pick('returnAuthMsg') || pick('errMsg') || pick('resultMsg'),
  };
}

// items.item은 결과가 하나면 객체, 여럿이면 배열, 없으면 빈 문자열("")로 옵니다
function toList(items) {
  const item = items && typeof items === 'object' ? items.item : undefined;
  if (Array.isArray(item)) return item;
  if (item && typeof item === 'object') return [item];
  return [];
}

function toHoliday(item) {
  const d = String(item?.locdate ?? '');
  if (!/^\d{8}$/.test(d)) return null;
  return {
    date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
    name: String(item.dateName ?? '').trim(),
    holiday: item.isHoliday === 'Y',
  };
}
