# 월별 공휴일 조회 · Vercel 함수 예제

**사용자가 연·월을 고르면 Vercel 함수가 공공데이터(한국천문연구원 특일 정보)를 그 자리에서 조회해 목록으로 보여 주는 예제**입니다. 인증키는 Vercel 환경 변수에 두고, 함수는 서울 리전(`icn1`)에서 실행하며, 같은 조건의 응답은 CDN 캐시에 1시간 보관해 공공데이터 호출 수를 줄입니다. 외부 패키지 없이 HTML과 JavaScript만 씁니다.

```text
사용자가 연·월 선택 → 브라우저가 fetch('/api/holidays?year=2026&month=10')
  → Vercel CDN: 같은 조건의 저장된 응답이 있으면 바로 돌려줌(HIT)
  → 없으면 함수 api/holidays.js 실행(서울 icn1): 입력 검사 → 환경 변수의 인증키로 공공데이터 호출 → JSON 정리
  → 화면: 불러오는 중 · 결과 있음 · 결과 없음 · 오류
```

## 파일 역할

| 파일 | 역할 |
|---|---|
| `index.html` | 연·월 선택 화면. `/api/holidays`를 부르고 네 가지 상태를 보여 줍니다 |
| `api/holidays.js` | Vercel 함수. 입력 검사, 인증키 확인, 공공데이터 호출, 응답 정리, 캐시 헤더 |
| `vercel.json` | 함수 리전을 서울(`icn1`)로 정합니다 |
| `package.json` | `"type": "module"`(ESM 문법 사용), Node.js 24, 시험 명령 |
| `tests/holidays.test.mjs` | 가짜 공공데이터 응답으로 정상·결과 없음·잘못된 입력·키 없음·상위 오류를 확인하는 시험 |
| `tests/fixtures/` | 시험과 연습 모드에 쓰는 예시 응답 |
| `scripts/dev.mjs` | 수업용 로컬 시험 서버. 화면과 함수를 한 주소에서 엽니다 |
| `.vercelignore` | Vercel에 올리지 않을 파일(시험·로컬 도구·설명서) |
| `.env.example` | 로컬에서 실제 키를 쓸 때 복사해 `.env.local`로 만드는 틀 |

## 1. 로컬에서 먼저 확인하기 (Node.js가 있을 때)

터미널에서 `node --version`으로 Node.js 22 이상인지 확인하고, 이 폴더에서 실행합니다.

```bash
npm test                     # 시험이 모두 ✔(pass)이면 통과
node scripts/dev.mjs --mock  # 연습 모드 → 브라우저에서 http://localhost:3000
```

연습 모드는 공공데이터 대신 `tests/fixtures`의 예시 응답을 씁니다. 2026년 10월(여러 건), 11월(없음), 12월(한 건), 9월(상위 오류)을 골라 네 가지 화면 상태를 봅니다. 주소창에 `http://localhost:3000/?year=2026&month=13`을 넣으면 잘못된 입력 화면이 나옵니다.

실제 공공데이터를 로컬에서 부르려면 `.env.example`을 복사해 이름을 `.env.local`로 바꾸고 `DATA_GO_KR_KEY=` 뒤에 일반 인증키(Decoding)를 넣은 뒤 `node scripts/dev.mjs`로 엽니다. `.env.local`은 `.gitignore`에 있어 저장소에 올라가지 않습니다.

시험 서버는 수업용이라 Vercel과 완전히 같지는 않습니다. CDN 캐시(`x-vercel-cache`), 리전, 배포 보호, 대시보드 로그는 배포한 뒤 Vercel에서 확인합니다.

## 2. Vercel 가입과 저장소 연결 (Import)

1. <https://vercel.com/signup>에서 **Continue with GitHub**를 눌러 가입합니다. 플랜을 물으면 **Hobby**(무료·개인 비상업)를 고릅니다.
2. 이 폴더의 파일을 GitHub 저장소에 올립니다(숨김 파일 `.gitignore`, `.vercelignore` 포함). 이미 있는 개인 프로젝트 저장소에 넣을 때는 `api/`, `vercel.json`, `package.json`을 저장소 최상위에 둡니다.
3. Vercel 대시보드에서 **Add New… → Project**를 누릅니다(주소 <https://vercel.com/new>). 저장소 목록에 내 저장소가 없으면 같은 화면의 **Configure GitHub App**에서 그 저장소를 허용합니다.
4. 저장소 옆 **Import**를 누르고 설정 화면에서 확인합니다.
   - **Project Name**: 주소가 `이름.vercel.app`이 됩니다
   - **Framework Preset**: Other
   - **Root Directory**: 저장소 최상위면 그대로 둡니다
   - **Environment Variables**: Key `DATA_GO_KR_KEY`, Value 공공데이터포털 마이페이지의 일반 인증키(Decoding)
5. **Deploy**를 누르고, 끝나면 대시보드에서 **Domains**의 주소를 엽니다.

이후에는 `main`에 Push할 때마다 운영(Production) 배포가, 다른 브랜치에 Push하면 미리보기(Preview) 배포가 자동으로 만들어집니다.

## 3. 환경 변수와 리전

- 환경 변수는 프로젝트 **Settings → Environment Variables**에서 관리합니다. 종류를 고르는 칸이 있으면 값이 다시 보이지 않는 **Secret**을 고르고, 적용 환경은 **Production**과 **Preview**를 체크합니다.
- 환경 변수를 추가하거나 바꾼 뒤에는 **다시 배포해야** 새 값이 적용됩니다. **Deployments → 최신 배포의 ⋯ → Redeploy**를 누르거나 새 커밋을 Push합니다.
- 함수 리전은 `vercel.json`의 `"regions": ["icn1"]`이 정합니다. Hobby는 리전 하나를 고를 수 있고, 이 값이 프로젝트 설정보다 우선합니다.

## 4. 배포 확인

1. 운영 주소를 열어 이번 달 공휴일이 보이는지 확인합니다.
2. 주소창에 `https://이름.vercel.app/api/holidays?year=2026&month=10`을 넣어 함수의 JSON 응답을 직접 봅니다.
3. **캐시**: 개발자 도구(F12) → Network → `holidays` 요청 → Response Headers의 `x-vercel-cache`를 봅니다. 같은 조건을 처음 부르면 `MISS`, 다시 부르면 `HIT`입니다. 화면의 '가져온 시각'이 그대로면 CDN에 저장된 응답이 온 것입니다.
4. **리전**: 대시보드 **Logs**에서 방금 요청을 눌러 Function 정보의 실행 위치가 `icn1`인지 봅니다. 응답 헤더 `x-vercel-id`에도 요청이 거친 리전과 함수가 실행된 리전이 적힙니다.
5. **로그**: 함수의 `console.error` 줄과 상태 코드가 Logs에 남습니다. Hobby는 최근 1시간 로그를 보여 줍니다.

## 5. 검증표

| 상황 | 해 보는 방법 | 기대 결과 |
|---|---|---|
| 결과 있음 | 2026년 10월 조회 | 3일(개천절·대체공휴일·한글날)과 가져온 시각 |
| 결과 없음 | 2026년 11월 조회 | '공휴일이 없습니다' 안내 |
| 잘못된 입력 | `/api/holidays?year=2026&month=13` | 400과 고칠 방법이 담긴 JSON, 화면에는 오류 안내 |
| 키 없음 | 로컬에서 키 없이 `node scripts/dev.mjs` 후 조회 | 500과 환경 변수 설정 안내 |
| 상위 오류 | 연습 모드에서 2026년 9월 조회, 또는 `npm test` | 502와 '확인할 점' 안내, 다시 시도 버튼 |
| 캐시 | 같은 조건을 두 번 조회 | `x-vercel-cache`가 MISS → HIT |
| 리전 | Logs 또는 `x-vercel-id` | `icn1` |
| 휴대전화 폭 | 휴대전화로 운영 주소 열기 | 가로 넘침 없음 |

## 6. 내 프로젝트의 API로 바꿀 때

| 바꿀 곳 | 내용 |
|---|---|
| 파일 이름 | `api/holidays.js` → `api/내기능.js` (주소가 `/api/내기능`이 됩니다) |
| `API_URL` | 공공데이터포털 API 상세 화면의 요청주소 |
| ② 입력 검사 | 내 화면에서 사용자가 고르는 조건(지역 코드, 날짜, 검색어 등)의 허용 범위 |
| ④ 요청 변수 | 명세의 필수 요청 변수, JSON으로 받는 방법(`_type=json`, `returnType=json` 등 API마다 다름) |
| ⑥ 정리 | `toHoliday`처럼 화면에 필요한 필드만 골라 담기 |
| `CACHE_OK` | 데이터가 바뀌는 주기에 맞춘 캐시 시간(실시간 측정값은 짧게, 하루 단위 자료는 길게) |
| `index.html` | `showList`에서 항목을 그리는 부분 |

## 7. 한 줄 방명록 (Supabase)

`/guestbook.html`에서 이름(1~20자)과 한 줄 메시지(1~200자)를 남기면 `api/guestbook.js`가 Supabase 표 `public.guestbook`에 저장합니다.

| 파일 | 역할 |
|---|---|
| `supabase/guestbook.sql` | 표, CHECK 제약, RLS(누구나 읽기만), 권한. Supabase SQL Editor에서 한 번 실행합니다 |
| `api/guestbook.js` | `GET` 최근 20개(공개 키) · `POST` 입력 검사 뒤 저장(서버 전용 secret 키) |
| `lib/guestbook-validate.js` | 입력 검사 규칙. 함수와 시험이 함께 씁니다 |
| `guestbook.html` | 불러오는 중 · 글 있음 · 글 없음 · 오류 네 가지 상태와 입력 칸 |
| `tests/guestbook.test.mjs` | 입력 검사와 키 없음·잘못된 요청 시험(Supabase에 접속하지 않음) |

- 공개 역할(`anon`, `authenticated`)은 `select`만 할 수 있어 브라우저가 Supabase에 직접 글을 쓸 수 없습니다. 쓰기는 함수가 `SUPABASE_SECRET_KEY`로만 합니다.
- Vercel 환경 변수 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`가 필요합니다. 로컬에서는 `.env.local`에 같은 이름으로 넣고 `node scripts/dev.mjs` 후 <http://localhost:3000/guestbook.html>을 엽니다.

## 공식 문서

- 한국천문연구원 특일 정보: https://www.data.go.kr/data/15012690/openapi.do
- Vercel 함수 시작하기: https://vercel.com/docs/functions/quickstart
- 함수 리전: https://vercel.com/docs/functions/configuring-functions/region
- 환경 변수: https://vercel.com/docs/environment-variables
- CDN 캐시: https://vercel.com/docs/caching/cdn-cache
- Git 연결과 배포: https://vercel.com/docs/git
- 런타임 로그: https://vercel.com/docs/logs/runtime
- Hobby 요금제: https://vercel.com/docs/plans/hobby
