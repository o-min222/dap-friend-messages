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
  "version: 0.4.0",
  "entry: dap_friend_messages.plugin:activate",
  "min_app_version: 1.4.0",
  "  - window.palette",
  "  - oauth.connect",
]) assert.ok(manifest.includes(line), `plugin.yaml에 '${line}'이 필요합니다.`);
assert.doesNotMatch(manifest, /storage\.private/u, "메모리 세션만 사용하므로 storage.private 권한이 없어야 합니다.");

const entry = await readFile(resolve(root, "dap_friend_messages/plugin.mjs"), "utf8");
assert.doesNotMatch(entry, /^\s*import\s+.+from\s+["'][^./]/mu, "plugin.mjs에는 bare import를 사용할 수 없습니다.");
assert.match(entry, /export function activate\(ctx\)/u);
assert.match(entry, /ctx\.host\.oauth\.connect/u);
assert.match(entry, /ctx\.host\.oauth\.accessToken/u);
assert.match(entry, /OAUTH_SCOPES = Object\.freeze\(\["openid"\]\)/u, "Google OAuth는 openid 최소 scope만 요청해야 합니다.");
assert.match(entry, /ctx\.radialMenu\.addItem/u);
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
assert.match(html, /받은 쪽지/u);
assert.match(html, /쪽지 쓰기/u);
assert.match(html, /친구 관리/u);
assert.match(html, /모임 관리/u);
assert.match(html, /익명으로 보내기/u);
assert.match(html, /받는 사람에게만 익명이며, 운영상 발신자 정보는 서버에 보관됩니다/u);
assert.match(html, /내가 부를 이름/u);
assert.match(html, /Google 이름은 공개하지 않으며 이 별명만 친구에게 보입니다/u);
assert.doesNotMatch(html, /type="file"|업로드/u, "스티커 업로드 UI를 제공하면 안 됩니다.");
assert.doesNotMatch(html, /<textarea[^>]*maxlength=|id="group-name"[^>]*maxlength=/u, "Unicode codepoint 검증 필드에 maxlength를 사용하면 안 됩니다.");
assert.doesNotMatch(html, /id="(?:friend-alias|profile-name)"[^>]*maxlength=/u, "이름 필드는 maxlength 대신 Unicode codepoint 검증을 사용해야 합니다.");

const css = await readFile(resolve(root, "ui/friend-messages.css"), "utf8");
assert.match(css, /\.app-header\s*\{[^}]*-webkit-app-region:\s*drag/su, "상단 헤더는 창 이동 영역이어야 합니다.");
assert.match(css, /\.header-actions\s*\{[^}]*-webkit-app-region:\s*no-drag/su, "헤더 버튼은 클릭 가능해야 합니다.");
assert.match(css, /\.icon-button\s*\{[^}]*-webkit-app-region:\s*no-drag/su, "개별 헤더 버튼도 이동 영역에서 제외해야 합니다.");

const ui = await readFile(resolve(root, "ui/friend-messages-ui.js"), "utf8");
assert.doesNotMatch(ui, /\bfetch\s*\(/u, "네트워크 요청은 main-side에서만 해야 합니다.");
assert.doesNotMatch(ui, /localStorage|sessionStorage/u, "palette는 세션을 저장하면 안 됩니다.");
for (const sticker of ["smile", "cheer", "love", "surprise", "sulk", "cry", "celebrate", "tired"]) assert.match(ui, new RegExp(`["']${sticker}["']`, "u"));
assert.match(ui, /한 번 더 눌러 삭제/u, "모임 삭제는 inline 2단계 확인이어야 합니다.");
assert.match(ui, /내보내기 확정/u, "멤버 내보내기는 inline 2단계 확인이어야 합니다.");
assert.match(ui, /한 번 더 눌러 나가기/u, "모임 나가기는 inline 2단계 확인이어야 합니다.");
assert.match(ui, /anonymous:\s*elements\["anonymous-toggle"\]\.checked === true/u, "익명 선택은 명시적인 boolean으로 전송해야 합니다.");
assert.match(ui, /items\.length === 1[\s\S]*items\[0\]\.id/u, "보낼 대상이 하나면 자동 선택해야 합니다.");
assert.match(ui, /받는 친구\/모임을 선택해 주세요/u, "대상 미선택을 조용히 실패시키면 안 됩니다.");
assert.match(entry, /senderId:\s*anonymous \? ""/u, "익명 쪽지 senderId는 main에서 마스킹해야 합니다.");
assert.match(entry, /senderName:\s*anonymous \? "익명의 친구"/u, "익명 쪽지 senderName은 main에서 마스킹해야 합니다.");
assert.match(ui, /const codepointLength = \(value\) => \[\.\.\.String\(value \|\| ""\)\]\.length/u, "길이는 Unicode codepoint로 계산해야 합니다.");
assert.match(entry, /\[\\p\{Cc\}\\p\{Cf\}\]/u, "main 이름 검증은 Unicode Cc/Cf 문자를 거부해야 합니다.");
assert.match(ui, /\[\\p\{Cc\}\\p\{Cf\}\]/u, "palette 이름 검증은 Unicode Cc/Cf 문자를 거부해야 합니다.");
assert.match(ui, /setCustomValidity/u, "길이 초과는 브라우저 validation으로 알려야 합니다.");

await import(resolve(root, "dap_friend_messages/plugin.mjs"));
console.log(`DAP Friend Messages 검증 완료 (${required.length}개 배포 파일)`);
