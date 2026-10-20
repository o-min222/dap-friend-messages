# DAP Friend Messages

친구 코드로 1:1 친구를 연결하고 100자 이내 쪽지를 주고받는 DAP 플러그인입니다. DAP 1.4.0 이상의 Host-managed Google OAuth와 Supabase Edge Function을 사용합니다.

## 기능

- 사용자가 버튼을 눌렀을 때만 Google 동의 화면 열기
- A–F와 숫자로 구성된 6자리 친구 코드
- 친구 연결·삭제·차단·차단 해제
- 친구 목록과 열지 않은 쪽지 메타데이터 표시
- 친구에게 100자 이내 쪽지 전송
- 10초 간격 single-flight polling 및 수동 새로고침
- 쪽지를 열 때만 본문을 받아 표시하고 서버 `expires_at`에 화면에서 제거

## 인증과 데이터 흐름

1. 사용자가 palette의 **Google로 연결** 버튼을 누릅니다.
2. 플러그인은 `ctx.host.oauth.connect()`를 `provider: "google"`, `connectionId: "google"`, `openid email profile` scope로 호출합니다.
3. Google refresh token은 DAP Host의 보호 저장소에 남고 플러그인에는 전달되지 않습니다.
4. Host에서 받은 짧은 수명의 Google access token을 Edge Function의 `{ action: "session" }` 요청에 한 번 사용합니다.
5. Edge Function이 반환한 opaque `session_token`은 플러그인 메모리에만 보관하며 재시작 시 사라집니다.
6. 이후 요청은 opaque Bearer로 아래 action만 호출합니다. 401이면 Google access token을 새로 받아 세션 교환을 한 번만 재시도합니다.

Endpoint: `https://vowrjkctldqxizvleogd.supabase.co/functions/v1/friend-messages`

| action | payload |
| --- | --- |
| `state` | 없음 |
| `connect` | `friend_code` |
| `send` | `recipient_id`, `body`, `client_nonce` |
| `open` | `message_id` |
| `remove` | `friend_id` |
| `block` | `friend_id` |
| `unblock` | `friend_id` |

## 개인정보 및 보안

- 네트워크 전송은 TLS로 보호되고 서버 저장 데이터는 저장 암호화를 사용합니다.
- 이 서비스는 종단간 암호화(E2EE)가 아닙니다. 서버는 기능 제공을 위해 쪽지 본문을 처리할 수 있습니다.
- 쪽지 본문은 로그·분석·오류 보고 등 텔레메트리에 기록하지 않습니다.
- Google refresh token은 DAP Host가 보관하며 플러그인은 접근할 수 없습니다.
- Edge opaque session은 메모리에만 존재하고 만료 또는 플러그인 종료 시 폐기합니다.
- palette에는 Google/opaque 토큰을 전달하지 않습니다.
- publishable key는 공개 클라이언트 식별자이며 `service_role` 또는 secret key를 사용하지 않습니다.

## 검증

```sh
npm test
npm run check
```

외부 런타임 의존성이 없어 설치 단계가 필요하지 않습니다.
