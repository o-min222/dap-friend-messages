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
  "version: 0.9.0",
  "entry: dap_friend_messages.plugin:activate",
  "min_app_version: 1.4.0",
  "  - window.palette",
  "  - oauth.connect",
]) assert.ok(manifest.includes(line), `plugin.yaml에 '${line}'이 필요합니다.`);
assert.doesNotMatch(manifest, /storage\.private/u, "메모리 세션만 사용하므로 storage.private 권한이 없어야 합니다.");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(packageJson.version, "0.9.0", "plugin.yaml과 package.json 버전이 같아야 합니다.");

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
assert.match(html, /id="message-list"[^>]*aria-live="polite"/u);
assert.doesNotMatch(html, /id="view-detail"|id="thread-list"|id="detail-back"/u, "쪽지함에 연락처 상세 depth가 있으면 안 됩니다.");
assert.match(html, /id="tab-manage"[^>]*aria-controls="view-manage"/u);
assert.match(html, /id="view-manage"[^>]*aria-labelledby="manage-title"/u);
assert.doesNotMatch(html, /id="tab-(?:friends|groups)"|id="view-(?:friends|groups)"/u, "친구와 모임은 하나의 관리 탭에 있어야 합니다.");
assert.match(html, /id="home-title" tabindex="-1">쪽지/u, "쪽지 목록 focus fallback 대상이 있어야 합니다.");
assert.match(html, /id="message-list"[^>]*aria-live="polite"[^>]*aria-relevant="additions removals"[^>]*aria-atomic="false"/u, "쪽지 목록은 반복 전체 낭독을 줄이는 live-region 설정이어야 합니다.");
assert.match(html, /id="manage-title" tabindex="-1">관리/u);
assert.match(html, /id="friends-title" tabindex="-1">친구/u);
assert.match(html, /id="groups-title" tabindex="-1">모임/u);
assert.match(html, /익명으로 보내기/u);
assert.match(html, /받는 사람에게만 익명이며, 운영상 발신자 정보는 서버에 보관됩니다/u);
assert.match(html, /내가 부를 이름/u);
assert.match(html, /Google 이름은 공개하지 않으며 이 별명만 친구에게 보입니다/u);
assert.match(html, /id="manage-dialog"[^>]*role="dialog"[^>]*aria-modal="true"/u, "관리 입력은 modal dialog에 있어야 합니다.");
assert.match(html, /id="invite-panel" hidden/u, "받은 초대 응답은 dialog 상세에서 처리해야 합니다.");
assert.match(html, /id="manage-menu-trigger"[^>]*aria-label="관리 메뉴"[^>]*title="관리 메뉴"/u);
assert.match(html, /id="menu-panel" hidden[\s\S]*id="menu-profile"[\s\S]*id="menu-friend-add"[\s\S]*id="menu-group-add"/u, "프로필·친구 추가·모임 생성은 관리 메뉴 안에 있어야 합니다.");
assert.match(html, /id="compose-panel"[^>]*hidden/u, "보내기는 관리 dialog 안에서 시작해야 합니다.");
assert.match(html, /id="group-message"[^>]*>모임 전체에 쪽지 보내기/u);
const manageView = html.match(/<section id="view-manage"[\s\S]*?<\/section>\s*<\/div>\s*<div id="manage-dialog-backdrop"/u)?.[0] || "";
assert.doesNotMatch(manageView.replace(/<div id="manage-dialog-backdrop"[\s\S]*/u, ""), /<(?:input|select|textarea)\b/u, "관리 목록 바깥에는 입력 필드가 없어야 합니다.");
assert.equal(manageView.match(/<button\b/gu)?.length, 1, "관리 첫 화면에는 관리 메뉴 외 action control이 없어야 합니다.");
assert.doesNotMatch(manageView, /profile-row|friend-add-trigger|group-add-trigger|invite-section|invite-list/u, "관리 첫 화면에는 프로필·추가·초대 별도 block이 없어야 합니다.");
assert.doesNotMatch(html, /type="file"|업로드/u, "스티커 업로드 UI를 제공하면 안 됩니다.");
assert.doesNotMatch(html, /<textarea[^>]*maxlength=|id="group-name"[^>]*maxlength=/u, "Unicode codepoint 검증 필드에 maxlength를 사용하면 안 됩니다.");
assert.doesNotMatch(html, /id="(?:friend-alias|profile-name)"[^>]*maxlength=/u, "이름 필드는 maxlength 대신 Unicode codepoint 검증을 사용해야 합니다.");

const css = await readFile(resolve(root, "ui/friend-messages.css"), "utf8");
assert.match(css, /@media\(prefers-color-scheme:dark\)\{[^}]*--accent:#a68bd3[^}]*\}\.primary-button\{color:#191817\}\.primary-button:disabled\{opacity:1;background:#6f657b;color:#f5f0e8\}/u, "dark primary button은 기본·disabled 상태 모두 4.5:1 이상 대비여야 합니다.");
assert.match(css, /\.tabs\{grid-template-columns:repeat\(2,1fr\)\}/u, "상단 navigation은 2탭이어야 합니다.");
assert.match(css, /\.view\{overflow-x:hidden\}/u, "380px에서 가로 overflow가 없어야 합니다.");
assert.match(css, /\.composer-bar\{[^}]*grid-template-columns:44px minmax\(0,1fr\) 44px 44px/su, "380px compact composer가 가로로 넘치면 안 됩니다.");
assert.match(css, /overscroll-behavior:contain/u, "상세 timeline은 palette 밖으로 스크롤을 전파하면 안 됩니다.");
assert.match(css, /\.app-header\s*\{[^}]*-webkit-app-region:\s*drag/su, "상단 헤더는 창 이동 영역이어야 합니다.");
assert.match(css, /\.header-actions\s*\{[^}]*-webkit-app-region:\s*no-drag/su, "헤더 버튼은 클릭 가능해야 합니다.");
assert.match(css, /\.icon-button\s*\{[^}]*-webkit-app-region:\s*no-drag/su, "개별 헤더 버튼도 이동 영역에서 제외해야 합니다.");
assert.match(css, /\.app\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/su, "좁은 창에서도 목록과 배지가 가로로 잘리지 않아야 합니다.");
assert.match(css, /@media\(prefers-color-scheme:dark\)\{\.management-icon-action:hover,\.manage-row:hover\{background:#40354f;color:var\(--ink\)\}\.manage-avatar\{background:#40354f;color:var\(--ink\)\}\}/u, "dark mode 관리 아이콘은 4.5:1 이상 대비 색을 사용해야 합니다.");

const ui = await readFile(resolve(root, "ui/friend-messages-ui.js"), "utf8");
assert.doesNotMatch(ui, /\bfetch\s*\(/u, "네트워크 요청은 main-side에서만 해야 합니다.");
assert.doesNotMatch(ui, /localStorage|sessionStorage/u, "palette는 세션을 저장하면 안 됩니다.");
for (const sticker of ["smile", "cheer", "love", "surprise", "sulk", "cry", "celebrate", "tired"]) assert.match(ui, new RegExp(`["']${sticker}["']`, "u"));
assert.match(ui, /한 번 더 눌러 삭제/u, "모임 삭제는 inline 2단계 확인이어야 합니다.");
assert.match(ui, /내보내기 확정/u, "멤버 내보내기는 inline 2단계 확인이어야 합니다.");
assert.match(ui, /한 번 더 눌러 나가기/u, "모임 나가기는 inline 2단계 확인이어야 합니다.");
assert.match(ui, /anonymous:\s*anonymousSelected === true/u, "익명 선택은 명시적인 boolean으로 전송해야 합니다.");
assert.match(ui, /pendingSend = \{ targetKey: targetKey\(selectedTarget\), operationId, draftRevision, snapshot: draftSnapshot\(\) \}/u, "전송은 operationId와 대상·초안 identity를 잠가야 합니다.");
assert.match(ui, /completedSend && message\.sentTo === completedSend\.targetKey && pendingMatchesDraft\(completedSend\)/u, "일치하는 전송 성공만 초안을 초기화해야 합니다.");
assert.match(ui, /\[\.\.\.model\.messages\]\.sort\([\s\S]*new Date\(right\.createdAt\)[\s\S]*left\.id\.localeCompare\(right\.id\)/u, "받은 쪽지는 createdAt 내림차순과 id로 안정 정렬해야 합니다.");
assert.match(ui, /message\.anonymous && message\.targetType !== "group"\) return "익명의 친구"/u, "익명 direct는 generic label만 보여야 합니다.");
assert.match(ui, /let messageRecords = new Map\(\)/u, "쪽지 DOM은 id별 record로 재사용해야 합니다.");
assert.match(ui, /function messageSignature\(message\)/u, "변경된 쪽지만 교체할 수 있도록 signature가 있어야 합니다.");
assert.match(ui, /message-list"\]\.insertBefore/u, "정렬 변경은 기존 DOM 이동으로 처리해야 합니다.");
assert.doesNotMatch(ui, /message-list"\]\.replaceChildren/u, "polling 때 쪽지 목록 전체를 교체하면 focus가 끊깁니다.");
assert.match(ui, /renderMeta\.openedMessageId[\s\S]*messageRecords\.get\(renderMeta\.openedMessageId\)\?\.node\.focus/u, "열린 종이 쪽지는 inline 교체 후 초점을 받아야 합니다.");
assert.match(ui, /fallback\?\.node \|\| elements\["home-title"\]/u, "만료된 focused 쪽지는 인접 항목이나 홈 제목으로 초점을 복원해야 합니다.");
assert.doesNotMatch(ui, /renderThreads|renderDetail|openTarget|targetMessages|unreadFor/u, "연락처 thread/detail 흐름이 남으면 안 됩니다.");
assert.doesNotMatch(html, /PAPER CONTACTS|friend-thread-list|group-thread-list|anonymous-thread-list/u, "홈에는 분리된 연락처 섹션을 두면 안 됩니다.");
assert.doesNotMatch(css, /transition:\s*all/u, "전체 속성 transition을 사용하면 안 됩니다.");
assert.match(entry, /senderId:\s*anonymous \? ""/u, "익명 쪽지 senderId는 main에서 마스킹해야 합니다.");
assert.match(entry, /senderName:\s*anonymous \? "익명의 친구"/u, "익명 쪽지 senderName은 main에서 마스킹해야 합니다.");
assert.match(entry, /targetType === "group" \? String\(raw\.group_id \|\| raw\.target_id \|\| ""\) : ""/u, "익명 direct의 raw target_id는 버려야 합니다.");
assert.match(ui, /const codepointLength = \(value\) => \[\.\.\.String\(value \|\| ""\)\]\.length/u, "길이는 Unicode codepoint로 계산해야 합니다.");
assert.match(entry, /\[\\p\{Cc\}\\p\{Cf\}\]/u, "main 이름 검증은 Unicode Cc/Cf 문자를 거부해야 합니다.");
assert.match(ui, /\[\\p\{Cc\}\\p\{Cf\}\]/u, "palette 이름 검증은 Unicode Cc/Cf 문자를 거부해야 합니다.");
assert.match(ui, /setCustomValidity/u, "길이 초과는 브라우저 validation으로 알려야 합니다.");
assert.match(ui, /role="dialog"|manage-dialog/u, "관리 상세는 dialog로 열려야 합니다.");
assert.match(ui, /event\.key === "Escape"/u, "Escape로 dialog를 닫을 수 있어야 합니다.");
assert.match(ui, /document\.activeElement/u, "dialog는 Tab 초점 순환을 관리해야 합니다.");
assert.match(ui, /pendingDialogOperation\?\.operationId === message\.operationId/u, "편집기는 일치하는 요청 응답에만 반응해야 합니다.");
assert.doesNotMatch(ui, /for \(const \[accept, label\][\s\S]*respondGroupInvite/u, "받은 초대 목록에 inline 수락·거절 버튼을 만들면 안 됩니다.");
assert.match(ui, /kind: "invite-response", operationId/u, "초대 응답은 operationId pending lock을 사용해야 합니다.");
assert.match(ui, /let manageRecords = new Map\(\)/u, "관리 목록 polling은 keyed DOM record를 재사용해야 합니다.");
assert.match(ui, /const inviteRows = model\.groupInvites\.map[\s\S]*placeRows\(elements\["group-list"\], \[\.\.\.inviteRows, \.\.\.groupRows\]\)/u, "받은 초대는 모임 목록 행에 합쳐야 합니다.");
assert.match(entry, /sentTo: `\$\{targetType\}:\$\{targetId\}`, \.\.\.operationMeta/u, "send 성공은 operationId를 palette에 되돌려줘야 합니다.");
assert.match(css, /@media\(prefers-color-scheme:dark\)\{\.composer-icon\.selected,\.thread-avatar\{background:#40354f;color:var\(--ink\)\}/u, "dark mode 아이콘은 4.5:1 이상 대비 색을 사용해야 합니다.");

await import(resolve(root, "dap_friend_messages/plugin.mjs"));
console.log(`DAP Friend Messages 검증 완료 (${required.length}개 배포 파일)`);
