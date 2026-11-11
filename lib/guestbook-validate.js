// 방명록 입력 검사 · api/guestbook.js와 시험(tests/guestbook.test.mjs)이 함께 씁니다.
// 규칙은 supabase/guestbook.sql의 CHECK 제약과 같습니다: 앞뒤 공백을 뺀 이름 1~20자, 내용 1~200자.
// 글자 수는 DB의 char_length처럼 코드포인트 기준으로 셉니다(이모지 하나 = 1자).

export const NAME_MAX = 20;
export const MESSAGE_MAX = 200;

const CONTROL = /\p{Cc}/u; // 줄바꿈·탭 같은 제어 문자. 한 줄 방명록이므로 받지 않습니다

// 결과: { ok: true, value: { name, message } } 또는 { ok: false, field, error }
export function validateEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, field: null, error: '{"name": "...", "message": "..."} 형식의 JSON으로 보냅니다.' };
  }
  const name = checkText(input.name, '이름', NAME_MAX);
  if (name.error) return { ok: false, field: 'name', error: name.error };
  const message = checkText(input.message, '내용', MESSAGE_MAX);
  if (message.error) return { ok: false, field: 'message', error: message.error };
  return { ok: true, value: { name: name.text, message: message.text } };
}

function checkText(raw, label, max) {
  if (typeof raw !== 'string') return { error: `${label}을(를) 글자로 보냅니다.` };
  const text = raw.trim();
  const length = [...text].length;
  if (length === 0) return { error: `${label}을(를) 입력해 주세요.` };
  if (length > max) return { error: `${label}은(는) ${max}자 이하로 써 주세요. (지금 ${length}자)` };
  if (CONTROL.test(text)) return { error: `${label}에는 줄바꿈이나 제어 문자를 넣을 수 없습니다.` };
  return { text };
}
