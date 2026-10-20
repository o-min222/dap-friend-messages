import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "plugin.yaml",
  "package.json",
  "dap_friend_messages/plugin.mjs",
  "palette/index.html",
  "ui/friend-messages.css",
  "ui/friend-messages-ui.js",
  "assets/friend-messages.svg",
  "README.md",
  "LICENSE",
];

for (const path of required) assert.ok((await stat(resolve(root, path))).isFile(), `${path} 파일이 필요합니다.`);

const manifest = await readFile(resolve(root, "plugin.yaml"), "utf8");
for (const line of [
  "id: dap.friend_messages",
  "version: 0.5.2",
  "entry: dap_friend_messages.plugin:activate",
  "min_app_version: 1.4.0",
  "  - window.palette",
  "  - oauth.connect",
]) assert.ok(manifest.includes(line), `plugin.yaml에 '${line}'이 필요합니다.`);
assert.doesNotMatch(manifest, /storage\.private/u, "메모리 세션만 사용하므로 storage.private 권한이 없어야 합니다.");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(packageJson.version, "0.5.2", "plugin.yaml과 package.json 버전이 같아야 합니다.");

const entry = await readFile(resolve(root, "dap_friend_messages/plugin.mjs"), "utf8");
assert.doesNotMatch(entry, /^\s*import\s+.+from\s+["'][^./]/mu, "plugin.mjs에는 bare import를 사용할 수 없습니다.");
assert.match(entry, /export function activate\(ctx\)/u);
assert.match(entry, /ctx\.host\.oauth\.connect/u);
assert.match(entry, /ctx\.host\.oauth\.accessToken/u);
assert.match(entry, /OAUTH_SCOPES = Object\.freeze\(\["openid"\]\)/u, "Google OAuth는 openid 최소 scope만 요청해야 합니다.");
assert.match(entry, /ctx\.radialMenu\.addItem/u);
assert.match(entry, /ctx\.trayMenu\?\.addItem/u, "tray menu에 쪽지 상태를 노출해야 합니다.");
assert.match(entry, /trayHandle\?\.update/u, "unread 변화는 tray handle.update로 반영해야 합니다.");
assert.match(entry, /ctx\.host\.bubble\.speak\(NEW_MESSAGE_NOTICE\)/u, "새 쪽지는 내용 없는 host bubble로 알려야 합니다.");
assert.match(entry, /seenMessageIds === null/u, "첫 state는 알림 기준선으로 삼아야 합니다.");
assert.match(entry, /width:\s*410[\s\S]*height:\s*620/u, "palette는 compact 410px 폭이어야 합니다.");
for (const action of ["updateFriendAlias", "updateProfileName", "createGroup", "updateGroup", "inviteGroup", "respondGroupInvite", "removeGroupMember", "leaveGroup", "deleteGroup", "sendMessage"]) assert.match(entry, new RegExp(`${action}:?\\s*["']${action}["']`, "u"));
assert.match(entry, /invite\?\.direction === "incoming"/u, "받은 초대에는 incoming만 노출해야 합니다.");
assert.match(entry, /https:\/\/vowrjkctldqxizvleogd\.supabase\.co\/functions\/v1\/friend-messages/u);
assert.match(entry, /sb_publishable_Dgxv-IINi9MZLWRYnQAuug_MmvlpXsl/u);
assert.doesNotMatch(entry, /ctx\.host\.storage|localStorage/u, "토큰이나 세션을 영구 저장하면 안 됩니다.");
assert.doesNotMatch(entry, /service_role\s*[:=]\s*["'][^"']+/iu, "service_role secret을 포함하면 안 됩니다.");
assert.equal(entry.match(/\bsetInterval\s*\(/gu)?.length, 1, "polling interval은 하나만 생성해야 합니다.");

const html = await readFile(resolve(root, "palette/index.html"), "utf8");
assert.doesNotMatch(html, /https?:\/\//u, "palette는 외부 리소스를 로드하면 안 됩니다.");
assert.match(html, /\.\.\/ui\/friend-messages-ui\.js/u);
assert.match(html, /aria-live/u);
assert.match(html, /E2EE 아님/u);
assert.match(html, /본문 텔레메트리 미기록/u);
assert.match(html, /id="friend-thread-list"/u);
assert.match(html, /id="group-thread-list"/u);
assert.match(html, /id="anonymous-thread-list"/u);
assert.match(html, /id="view-detail"/u);
assert.match(html, /id="tab-manage"[^>]*aria-controls="view-manage"/u);
assert.match(html, /id="view-manage"[^>]*aria-labelledby="manage-title"/u);
assert.doesNotMatch(html, /id="tab-(?:friends|groups)"|id="view-(?:friends|groups)"/u, "친구와 모임은 하나의 관리 탭에 있어야 합니다.");
assert.match(html, /누구에게 쪽지를 보낼까요/u);
assert.match(html, /친구 관리/u);
assert.match(html, /모임 관리/u);
assert.match(html, /익명으로 보내기/u);
assert.match(html, /받는 사람에게만 익명이며, 운영상 발신자 정보는 서버에 보관됩니다/u);
assert.match(html, /내가 부를 이름/u);
assert.match(html, /Google 이름은 공개하지 않으며 이 별명만 친구에게 보입니다/u);
assert.match(html, /id="profile-edit-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="profile-form"/u);
assert.match(html, /id="profile-form" hidden/u, "공개 별명 입력은 기본 상태에서 숨겨야 합니다.");
assert.match(html, /id="friend-add-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="friend-form"/u);
assert.match(html, /id="friend-form"[^>]* hidden/u, "친구 추가 입력은 기본 상태에서 숨겨야 합니다.");
assert.doesNotMatch(html, /type="file"|업로드/u, "스티커 업로드 UI를 제공하면 안 됩니다.");
assert.doesNotMatch(html, /<textarea[^>]*maxlength=|id="group-name"[^>]*maxlength=/u, "Unicode codepoint 검증 필드에 maxlength를 사용하면 안 됩니다.");
assert.doesNotMatch(html, /id="(?:friend-alias|profile-name)"[^>]*maxlength=/u, "이름 필드는 maxlength 대신 Unicode codepoint 검증을 사용해야 합니다.");

const css = await readFile(resolve(root, "ui/friend-messages.css"), "utf8");
assert.match(css, /\.tabs\{grid-template-columns:repeat\(2,1fr\)\}/u, "상단 navigation은 2탭이어야 합니다.");
assert.match(css, /\.view\{overflow-x:hidden\}/u, "380px에서 가로 overflow가 없어야 합니다.");
assert.match(css, /\.app-header\s*\{[^}]*-webkit-app-region:\s*drag/su, "상단 헤더는 창 이동 영역이어야 합니다.");
assert.match(css, /\.header-actions\s*\{[^}]*-webkit-app-region:\s*no-drag/su, "헤더 버튼은 클릭 가능해야 합니다.");
assert.match(css, /\.icon-button\s*\{[^}]*-webkit-app-region:\s*no-drag/su, "개별 헤더 버튼도 이동 영역에서 제외해야 합니다.");
assert.match(css, /\.app\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/su, "좁은 창에서도 목록과 배지가 가로로 잘리지 않아야 합니다.");

const ui = await readFile(resolve(root, "ui/friend-messages-ui.js"), "utf8");
assert.doesNotMatch(ui, /\bfetch\s*\(/u, "네트워크 요청은 main-side에서만 해야 합니다.");
assert.doesNotMatch(ui, /localStorage|sessionStorage/u, "palette는 세션을 저장하면 안 됩니다.");
for (const sticker of ["smile", "cheer", "love", "surprise", "sulk", "cry", "celebrate", "tired"]) assert.match(ui, new RegExp(`["']${sticker}["']`, "u"));
assert.match(ui, /한 번 더 눌러 삭제/u, "모임 삭제는 inline 2단계 확인이어야 합니다.");
assert.match(ui, /내보내기 확정/u, "멤버 내보내기는 inline 2단계 확인이어야 합니다.");
assert.match(ui, /한 번 더 눌러 나가기/u, "모임 나가기는 inline 2단계 확인이어야 합니다.");
assert.match(ui, /anonymous:\s*elements\["anonymous-toggle"\]\.checked === true/u, "익명 선택은 명시적인 boolean으로 전송해야 합니다.");
assert.match(ui, /selectedTarget\.type === "anonymous"/u, "익명 1:1 pseudo-thread에는 작성기를 노출하면 안 됩니다.");
assert.match(ui, /message\.anonymous && message\.targetType !== "group"/u, "익명 1:1은 친구에게 귀속하지 않아야 합니다.");
assert.match(ui, /message\.targetType === "group" && message\.targetId === target\.id/u, "익명 모임 쪽지는 groupId로만 귀속해야 합니다.");
assert.match(entry, /senderId:\s*anonymous \? ""/u, "익명 쪽지 senderId는 main에서 마스킹해야 합니다.");
assert.match(entry, /senderName:\s*anonymous \? "익명의 친구"/u, "익명 쪽지 senderName은 main에서 마스킹해야 합니다.");
assert.match(entry, /targetType === "group" \? String\(raw\.group_id \|\| raw\.target_id \|\| ""\) : ""/u, "익명 direct의 raw target_id는 버려야 합니다.");
assert.match(ui, /const codepointLength = \(value\) => \[\.\.\.String\(value \|\| ""\)\]\.length/u, "길이는 Unicode codepoint로 계산해야 합니다.");
assert.match(entry, /\[\\p\{Cc\}\\p\{Cf\}\]/u, "main 이름 검증은 Unicode Cc/Cf 문자를 거부해야 합니다.");
assert.match(ui, /\[\\p\{Cc\}\\p\{Cf\}\]/u, "palette 이름 검증은 Unicode Cc/Cf 문자를 거부해야 합니다.");
assert.match(ui, /setCustomValidity/u, "길이 초과는 브라우저 validation으로 알려야 합니다.");
assert.match(ui, /friendAliasDraft/u, "친구 별칭 실패 시 입력 초안을 보존해야 합니다.");
assert.match(ui, /message\.notice === "공개 별명을 바꿨어요\."/u, "프로필 편집기는 성공 notice 뒤에만 닫아야 합니다.");

await import(resolve(root, "dap_friend_messages/plugin.mjs"));
console.log(`DAP Friend Messages 검증 완료 (${required.length}개 배포 파일)`);
