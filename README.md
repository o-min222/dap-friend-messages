# DAP Friend Messages

친구 또는 최대 8명의 모임에 100자 종이 쪽지와 내장 스티커를 보내는 DAP 플러그인입니다. 하단 `쪽지` 탭에는 받은 봉투만 최신순으로 표시되며, 봉투를 열면 같은 자리에서 종이가 펼쳐졌다가 서버 `expires_at`(약 5초)에 사라집니다. 보내기는 하단 `친구` 탭의 친구·모임 상세에서 시작합니다.

## 기능

- 사용자가 버튼을 누를 때만 Google 연결
- Google OAuth는 계정 식별에 필요한 `openid` scope만 요청하며 email/profile scope는 요청하지 않음
- A–F와 숫자로 된 6자리 친구 코드, 친구 차단·삭제
- 콘텐츠 아래에 고정된 아이콘 전용 `쪽지`·`친구` 하단 내비게이션과 미열람·초대 배지 제공
- 친구 화면 맨 위 프로필 행에서 내 공개 별명과 친구 코드를 확인하고 프로필 수정을 바로 시작
- 친구 화면의 `친구`·`모임` 세부 탭으로 목록을 한 번에 하나씩 표시하며, 받은 초대는 모임 목록의 구분된 행으로 표시
- 44px 관리 메뉴에서 친구 추가와 새 모임 만들기를 시작
- 프로필 수정, 친구 추가·상세, 모임 생성·상세는 키보드 초점이 갇히는 인팔레트 dialog에서 처리
- 친구 상세에서 내 화면 전용 별칭을 수정하거나 공개 별명으로 되돌리고, 차단·삭제·쪽지 보내기 수행
- Google 이름 대신 친구에게 보여 줄 20자 이내 공개 별명을 프로필 상세에서 설정
- 친구 1명 또는 모임 전체에 쪽지 전송
- 받은 쪽지만 최신순으로 보여 주는 단일 쪽지함. 열기 전에는 본문을 받거나 표시하지 않음
- 친구·모임 관리 상세에서 여는 자동 높이 작성기, 숨겨진 스티커 트레이, 익명 토글
- 친구 또는 모임에 보낼 때 받는 사람에게 발신자를 숨기는 익명 전송
- 익명 1:1 쪽지는 어떤 친구에게서 왔는지 추론하지 않고 읽기 전용 `익명 쪽지`함에만 표시. 익명 모임 쪽지만 해당 모임에 표시
- 본문 또는 내장 스티커 중 하나 이상, 본문 최대 100자
- 고정 sticker ID: `smile`, `cheer`, `love`, `surprise`, `sulk`, `cry`, `celebrate`, `tired`
- 업로드 없는 앱 내장 preset만 제공
- 모임 생성·이름 변경·친구 초대·초대 수락/거절·멤버 내보내기·나가기·삭제
- 모임은 최대 8명. 모임장만 이름 변경·초대·내보내기·삭제 가능하며 일반 멤버만 나가기 가능
- 모임 전송은 서버가 모든 수신자와 발신자의 친구·차단 상태를 재검사하며, 하나라도 실패하면 전체 전송 취소
- palette가 닫혀도 동작하는 10초 single-flight polling. 첫 조회는 알림 기준선으로만 사용하고 이후 새 message ID만 중복 없이 감지
- 새 쪽지는 발신자·본문·개수 없이 `새 쪽지가 도착했어요.`라고 알리고 tray에는 전체 미열람 수 표시
- 본문은 사용자가 봉투를 연 `open` 응답에서만 수신

## Edge action adapter

wire action 이름은 `dap_friend_messages/plugin.mjs`의 `BACKEND_ACTIONS` 한곳에서 조정합니다.

| action | payload |
| --- | --- |
| `state` | 없음 |
| `connect` | `friendCode`, `alias` |
| `updateFriendAlias` | `friendId`, `alias` (`null`이면 삭제) |
| `updateProfileName` | `displayName` |
| `sendMessage` | `targetType`, `targetId`, `body`, `stickerId`, `anonymous`, `clientNonce` |
| `open` | `messageId` |
| `remove` / `block` / `unblock` | `friendId` |
| `createGroup` | `name`, `memberIds` |
| `updateGroup` | `groupId`, `name` |
| `inviteGroup` | `groupId`, `memberIds` |
| `respondGroupInvite` | `inviteId`, `accept` |
| `removeGroupMember` | `groupId`, `memberId` |
| `leaveGroup` / `deleteGroup` | `groupId` |

Endpoint: `https://vowrjkctldqxizvleogd.supabase.co/functions/v1/friend-messages`

## 보안과 개인정보

- Google refresh token은 DAP Host만 보관합니다.
- Google OAuth에서는 backend의 계정 식별에 필요한 `openid` scope만 요청합니다.
- Google 이름은 친구에게 공개하지 않고 사용자가 정한 공개 별명만 표시합니다. 친구에게 붙인 별칭은 내 화면에서만 사용합니다.
- Edge opaque session은 플러그인 메모리에만 유지하고 palette에는 전달하지 않습니다.
- 모든 네트워크 요청은 main-side에서만 수행합니다.
- 전송은 TLS, 서버 데이터는 저장 암호화를 사용하지만 종단간 암호화(E2EE)는 아닙니다.
- 익명 전송은 받는 사람에게만 익명이며, 운영과 악용 대응을 위해 발신자 정보는 서버에 보관됩니다.
- 쪽지 본문은 로그·분석·오류 보고 텔레메트리에 기록하지 않습니다.
- 시스템 알림에는 본문, 발신자, 대상, 익명 여부를 넣지 않습니다.
- publishable key만 사용하고 `service_role` 또는 secret key를 사용하지 않습니다.

## 검증

```sh
npm test
npm run check
```
