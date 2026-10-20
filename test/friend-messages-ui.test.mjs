import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {};
    this.value = ""; this.textContent = ""; this.hidden = false; this.disabled = false;
    this.className = ""; this.checked = false; this.focused = false; this.styleWriteCount = 0; this.tabIndex = 0; this.parentNode = null;
    this.style = new Proxy({}, { set: (target, key, value) => { this.styleWriteCount += 1; target[key] = value; return true; } }); this.scrollHeight = 24;
  }
  contains(node) { return this === node || this.children.some((child) => child?.contains?.(node)); }
  append(...children) { for (const child of children) { child.parentNode?.removeChild(child, false); child.parentNode = this; this.children.push(child); } }
  insertBefore(child, reference) { child.parentNode?.removeChild(child, false); const index = reference ? this.children.indexOf(reference) : -1; child.parentNode = this; if (index < 0) this.children.push(child); else this.children.splice(index, 0, child); }
  removeChild(child, detachFocus = true) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; if (detachFocus && child.contains(this.ownerDocument?.activeElement)) { this.ownerDocument.activeElement.focused = false; this.ownerDocument.activeElement = null; } }
  replaceChildren(...children) { for (const child of [...this.children]) this.removeChild(child); for (const child of children) this.append(child); }
  remove() { this.parentNode?.removeChild(this); }
  select() { this.selected = true; this.focus(); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  setCustomValidity(message) { this.validationMessage = message; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  focus() { if (this.ownerDocument?.activeElement) this.ownerDocument.activeElement.focused = false; this.focused = true; if (this.ownerDocument) this.ownerDocument.activeElement = this; }
}

const allText = (node) => [node.textContent, ...node.children.map(allText)].join(" ");
const relativeLuminance = (hex) => {
  const channels = hex.match(/[0-9a-f]{2}/giu).map((part) => Number.parseInt(part, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const contrastRatio = (first, second) => { const values = [relativeLuminance(first), relativeLuminance(second)].sort((left, right) => right - left); return (values[0] + 0.05) / (values[1] + 0.05); };
let harnessSequence = 0;

async function harness(options = {}) {
  const views = ["home", "manage"];
  const ids = [
    "app", "connect-panel", "connect-google", "workspace", "refresh", "close", "status", "nav-unread", "home-title",
    "invite-count", "message-list", "inbox-empty", "message-form", "composer-hint", "compose-recipient", "compose-back",
    "sticker-tray", "sticker-toggle", "sticker-grid", "message-body", "anonymous-toggle", "counter", "send", "manage-title", "manage-menu-trigger", "profile-row", "profile-current-name", "profile-view", "profile-display-name", "profile-code-value", "profile-code-copy", "profile-copy-status", "profile-edit", "manage-tab-friends", "manage-tab-groups", "group-invite-count", "friends-panel", "groups-panel", "friend-form", "friend-code",
    "friend-alias", "friend-add-submit", "friend-add-cancel", "profile-form", "profile-name", "profile-save", "profile-cancel", "friend-list", "friend-empty",
    "group-form", "group-name", "group-friend-options", "group-create-submit", "group-create-cancel", "group-list", "group-empty",
    "manage-dialog-backdrop", "manage-dialog", "manage-dialog-title", "manage-dialog-back", "manage-dialog-close", "menu-panel", "menu-friend-add", "menu-group-add", "profile-panel", "friend-add-panel", "friend-panel", "group-create-panel", "group-panel", "compose-panel",
    "friend-detail-name", "friend-detail-status", "friend-message", "friend-alias-edit", "friend-alias-form", "friend-detail-alias", "friend-alias-save", "friend-alias-reset", "friend-alias-cancel", "friend-block", "friend-remove",
    "group-detail-name", "group-detail-status", "group-message", "group-rename-form", "group-rename-name", "group-rename-save", "group-invite-controls", "group-invite-select", "group-invite-button", "group-member-list", "group-leave", "group-delete",
    "invite-panel", "invite-detail-name", "invite-detail-status", "invite-accept", "invite-decline",
    ...views.flatMap((name) => [`tab-${name}`, `view-${name}`]),
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  const sent = [];
  const copied = [];
  let onMessage;
  const session = (++harnessSequence).toString(16).padStart(12, "0");
  const crypto = { randomUUID() { return `${session.slice(0, 8)}-${session.slice(8)}-4000-8000-000000000000`; } };
  const window = { dapPalette: { postMessage(message) { sent.push(message); }, onMessage(handler) { onMessage = handler; }, close() {} } };
  const body = new FakeElement("body");
  const document = { body, activeElement: null, getElementById(id) { return elements[id]; }, createElement(tag) { const node = new FakeElement(tag); node.ownerDocument = document; return node; }, execCommand(command) { if (command !== "copy" || options.fallbackFailure) return false; copied.push("fallback"); return true; } };
  for (const element of Object.values(elements)) element.ownerDocument = document;
  body.ownerDocument = document;
  const navigator = { clipboard: { async writeText(value) { if (options.clipboardFailure) throw new Error("clipboard failed"); copied.push(value); } } };
  const source = await readFile(new URL("../ui/friend-messages-ui.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { window, document, navigator, Intl, Date, Set, crypto });
  return { elements, sent, copied, onMessage, document };
}

const state = () => ({
  connection: "connected", busy: false,
  me: { id: "me", code: "A1B2C3", name: "구름", nameCustomized: true },
  maxMessageLength: 100, unreadCount: 3, error: null,
  friends: [
    { id: "f1", name: "하늘", alias: "", publicName: "하늘", hasAlias: false, blocked: false },
    { id: "f2", name: "바다", alias: "", publicName: "바다", hasAlias: false, blocked: false },
  ],
  groups: [{ id: "g1", name: "산책 모임", owner: true, members: [{ id: "f1", name: "하늘" }, { id: "f2", name: "바다" }] }],
  groupInvites: [{ id: "i1", groupId: "g2", groupName: "점심 모임", inviterName: "구름" }],
  messages: [
    { id: "m1", anonymous: false, senderId: "f1", senderName: "하늘", targetType: "friend", targetId: "f1", body: null, stickerId: null, createdAt: "2026-10-20T12:00:00Z", openedAt: null },
    { id: "m2", anonymous: false, senderId: "f2", senderName: "바다", targetType: "group", targetId: "g1", body: null, stickerId: "cheer", createdAt: "2026-10-20T11:00:00Z", openedAt: null },
    { id: "m3", anonymous: true, senderId: "", senderName: "익명의 친구", targetType: "friend", targetId: "", body: null, stickerId: null, createdAt: "2026-10-20T10:00:00Z", openedAt: null },
  ],
});

const openFriendCompose = (view, friendIndex = 0) => {
  view.elements["tab-manage"].onclick();
  view.elements["friend-list"].children[friendIndex].children[0].onclick();
  view.elements["friend-message"].onclick();
};

const openGroupCompose = (view, groupIndex = 0) => {
  view.elements["tab-manage"].onclick();
  view.elements["manage-tab-groups"].onclick();
  view.elements["group-list"].children[groupIndex + 1].children[0].onclick();
  view.elements["group-message"].onclick();
};

test("Google 연결은 사용자가 버튼을 누를 때만 요청한다", async () => {
  const view = await harness();
  view.onMessage({ type: "state", state: { connection: "disconnected", busy: false, friends: [], groups: [], groupInvites: [], messages: [], maxMessageLength: 100 } });
  assert.equal(view.sent.some((item) => item.type === "connectGoogle"), false);
  view.elements["connect-google"].onclick(); assert.equal(view.sent.at(-1).type, "connectGoogle");
});

test("쪽지 홈은 연락처가 아니라 받은 쪽지만 최신순으로 표시하고 본문을 숨긴다", async () => {
  const view = await harness(); const next = state(); next.messages[0].body = "열기 전 비밀 본문"; next.messages[1].createdAt = next.messages[0].createdAt;
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["message-list"].children.length, 3);
  assert.match(allText(view.elements["message-list"].children[0]), /하늘/u);
  assert.match(allText(view.elements["message-list"].children[1]), /바다 · 산책 모임/u);
  assert.match(allText(view.elements["message-list"].children[2]), /익명의 친구/u);
  assert.doesNotMatch(allText(view.elements["message-list"]), /열기 전 비밀 본문|친구의 공개 별명|모임장/u);
  assert.equal(view.elements["nav-unread"].textContent, "3");
});

test("연락처가 있어도 받은 쪽지가 없으면 정확한 empty를 표시한다", async () => {
  const view = await harness(); const next = state(); next.messages = []; next.unreadCount = 0;
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["message-list"].children.length, 0);
  assert.equal(view.elements["inbox-empty"].hidden, false);
});

test("동일 polling은 message DOM identity와 두 번째 봉투 focus를 보존하고 순서만 이동한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });
  const item = view.elements["message-list"].children[1]; const envelope = item.children[0]; envelope.focus();
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["message-list"].children[1], item); assert.equal(item.children[0], envelope); assert.equal(view.document.activeElement, envelope);
  next.messages[0].createdAt = "2026-10-20T09:00:00Z"; view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["message-list"].children[0], item); assert.equal(item.children[0], envelope); assert.equal(view.document.activeElement, envelope);
});

test("봉투를 열면 같은 위치의 종이 쪽지로 바뀌고 초점을 받은 뒤 만료 시 제거된다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });
  const item = view.elements["message-list"].children[0]; const envelope = item.children[0]; envelope.focus(); envelope.onclick();
  assert.equal(view.sent.at(-1).type, "openMessage"); assert.equal(view.sent.at(-1).messageId, "m1");
  next.messages[0] = { ...next.messages[0], openedAt: "2026-10-20T12:00:01Z", body: "응원할게", stickerId: "cheer" };
  view.onMessage({ type: "state", state: next, openedMessageId: "m1" });
  const paper = view.elements["message-list"].children[0].children[0];
  assert.equal(view.elements["message-list"].children[0], item); assert.notEqual(paper, envelope); assert.match(paper.className, /opened-note/u); assert.equal(paper.tabIndex, -1); assert.equal(paper.focused, true);
  assert.match(allText(paper), /응원할게/u);
  next.messages = next.messages.filter((message) => message.id !== "m1");
  view.onMessage({ type: "state", state: next, expiredMessageId: "m1" });
  assert.equal(view.elements["message-list"].children.length, 2);
});

test("focused message 만료는 같은 index 다음→이전→홈 제목 순으로 초점을 복원한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });
  view.elements["message-list"].children[1].children[0].focus();
  next.messages = next.messages.filter((message) => message.id !== "m2"); view.onMessage({ type: "state", state: next, expiredMessageId: "m2" });
  assert.equal(view.document.activeElement, view.elements["message-list"].children[1].children[0]); assert.match(allText(view.elements["message-list"].children[1]), /익명의 친구/u);
  view.elements["message-list"].children[1].children[0].focus();
  next.messages = next.messages.filter((message) => message.id !== "m3"); view.onMessage({ type: "state", state: next, expiredMessageId: "m3" });
  assert.equal(view.document.activeElement, view.elements["message-list"].children[0].children[0]); assert.match(allText(view.elements["message-list"].children[0]), /하늘/u);
  view.elements["message-list"].children[0].children[0].focus(); next.messages = []; view.onMessage({ type: "state", state: next, expiredMessageId: "m1" });
  assert.equal(view.document.activeElement, view.elements["home-title"]); assert.equal(view.elements["home-title"].focused, true);
});

test("익명 direct는 추론 없이 generic label, 익명 group은 모임 이름만 허용한다", async () => {
  const view = await harness(); const next = state();
  next.messages = [
    { ...next.messages[2], id: "a1", createdAt: "2026-10-20T14:00:00Z", senderId: "secret", targetId: "f1" },
    { ...next.messages[2], id: "a2", targetType: "group", targetId: "g1", createdAt: "2026-10-20T13:00:00Z" },
  ];
  view.onMessage({ type: "state", state: next });
  assert.match(allText(view.elements["message-list"].children[0]), /익명의 친구/u);
  assert.doesNotMatch(allText(view.elements["message-list"].children[0]), /하늘|secret|산책/u);
  assert.match(allText(view.elements["message-list"].children[1]), /익명의 친구 · 산책 모임/u);
});

test("친구 상세 작성기는 payload·중복 잠금·성공 복귀와 focus를 처리한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next }); openFriendCompose(view);
  assert.equal(view.elements["compose-panel"].hidden, false); assert.equal(view.elements["compose-recipient"].textContent, "하늘");
  view.elements["sticker-grid"].children[6].onclick(); view.elements["message-body"].value = "파이팅"; view.elements["message-body"].listeners.input(); view.elements["anonymous-toggle"].onclick();
  view.elements["message-form"].listeners.submit({ preventDefault() {} }); const sent = view.sent.at(-1); const count = view.sent.length;
  assert.deepEqual({ type: sent.type, targetType: sent.targetType, targetId: sent.targetId, stickerId: sent.stickerId, anonymous: sent.anonymous }, { type: "sendMessage", targetType: "friend", targetId: "f1", stickerId: "celebrate", anonymous: true });
  assert.equal(view.elements.send.disabled, true); view.elements["message-form"].listeners.submit({ preventDefault() {} }); assert.equal(view.sent.length, count);
  view.onMessage({ type: "state", state: next, sentTo: "friend:f1", operationId: sent.operationId });
  assert.equal(view.elements["friend-panel"].hidden, false); assert.equal(view.elements["message-body"].value, ""); assert.equal(view.elements["friend-message"].focused, true);
});

test("모임 작성기는 owner·member 모두 열리고 오류와 polling에서 draft를 보존한다", async () => {
  const view = await harness(); const next = state(); next.groups.push({ id: "g2", name: "독서", owner: false, members: [] }); view.onMessage({ type: "state", state: next });
  openGroupCompose(view, 1); assert.equal(view.elements["compose-recipient"].textContent, "독서");
  view.elements["sticker-toggle"].onclick(); view.elements["anonymous-toggle"].onclick(); view.elements["message-body"].value = "모임 초안"; view.elements["message-body"].listeners.input();
  const styleWrites = view.elements["message-body"].styleWriteCount; view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["message-body"].value, "모임 초안"); assert.equal(view.elements["sticker-tray"].hidden, false); assert.equal(view.elements["anonymous-toggle"].attributes["aria-pressed"], "true"); assert.equal(view.elements["message-body"].styleWriteCount, styleWrites);
  view.elements["message-form"].listeners.submit({ preventDefault() {} }); const sent = view.sent.at(-1); assert.equal(sent.targetType, "group"); assert.equal(sent.targetId, "g2");
  view.onMessage({ type: "error", message: "전송 실패", operationId: sent.operationId });
  assert.equal(view.elements["compose-panel"].hidden, false); assert.equal(view.elements["message-body"].value, "모임 초안"); assert.equal(view.elements.send.disabled, false);
});

test("A→B→A 새 초안은 늦은 성공에서 보존되고 stale 오류는 현재 pending을 풀지 않는다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next }); openFriendCompose(view, 0);
  view.elements["message-body"].value = "A 이전"; view.elements["message-body"].listeners.input(); view.elements["message-form"].listeners.submit({ preventDefault() {} }); const oldId = view.sent.at(-1).operationId;
  view.elements["manage-dialog-close"].onclick(); view.elements["friend-list"].children[1].children[0].onclick(); view.elements["friend-message"].onclick();
  view.elements["message-body"].value = "B"; view.elements["message-body"].listeners.input(); view.elements["manage-dialog-close"].onclick(); view.elements["friend-list"].children[0].children[0].onclick(); view.elements["friend-message"].onclick();
  view.elements["message-body"].value = "A 새 초안"; view.elements["message-body"].listeners.input(); view.onMessage({ type: "state", state: next, sentTo: "friend:f1", operationId: oldId });
  assert.equal(view.elements["message-body"].value, "A 새 초안"); assert.equal(view.elements["compose-panel"].hidden, false);
  view.elements["message-form"].listeners.submit({ preventDefault() {} }); const currentId = view.sent.at(-1).operationId; assert.notEqual(currentId, oldId);
  view.onMessage({ type: "error", message: "늦은 오류", operationId: oldId }); assert.equal(view.elements.send.disabled, true); assert.equal(view.elements["message-body"].value, "A 새 초안");
  view.onMessage({ type: "error", message: "현재 오류", operationId: currentId }); assert.equal(view.elements.send.disabled, false);
});

test("작성 dialog는 sticker Escape를 먼저 처리하고 다음 Escape에 닫혀 trigger focus를 복원한다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() }); openFriendCompose(view);
  view.elements["sticker-toggle"].onclick(); let stopped = false;
  view.elements["message-form"].listeners.keydown({ key: "Escape", preventDefault() {}, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true); assert.equal(view.elements["sticker-tray"].hidden, true); assert.equal(view.elements["manage-dialog-backdrop"].hidden, false); assert.equal(view.elements["sticker-toggle"].focused, true);
  view.elements["manage-dialog"].listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(view.elements["manage-dialog-backdrop"].hidden, true); assert.equal(view.elements["friend-list"].children[0].children[0].focused, true);
});

test("차단 친구 보내기는 비활성이고 관리 파괴 동작은 2단 확인을 유지한다", async () => {
  const view = await harness(); const next = state(); next.friends[0].blocked = true; view.onMessage({ type: "state", state: next });
  view.elements["tab-manage"].onclick(); view.elements["friend-list"].children[0].children[0].onclick(); assert.equal(view.elements["friend-message"].disabled, true);
  const before = view.sent.length; view.elements["friend-message"].onclick(); assert.equal(view.sent.length, before); assert.equal(view.elements["friend-panel"].hidden, false);
  view.elements["friend-remove"].onclick(); assert.equal(view.sent.length, before); view.elements["friend-remove"].onclick(); assert.equal(view.sent.at(-1).type, "removeFriend");
});

test("HTML은 하단 내비게이션·프로필 우선 친구 화면과 380px 안전 규칙을 유지한다", async () => {
  const html = await readFile(new URL("../palette/index.html", import.meta.url), "utf8"); const css = await readFile(new URL("../ui/friend-messages.css", import.meta.url), "utf8");
  assert.match(html, /id="home-title" tabindex="-1"/u); assert.match(html, /id="message-list"[^>]*aria-live="polite"[^>]*aria-relevant="additions removals"[^>]*aria-atomic="false"/u); assert.doesNotMatch(html, /id="view-detail"|id="thread-list"|id="detail-back"/u);
  assert.match(html, /id="compose-panel"[^>]*hidden/u); assert.match(html, /id="group-message"[^>]*>모임 전체에 쪽지 보내기/u);
  const home = html.slice(html.indexOf('<section id="view-home"'), html.indexOf('<section id="view-manage"'));
  assert.doesNotMatch(home, /friend-list|group-list|message-form|textarea/u);
  const manageStart = html.indexOf('<section id="view-manage"'); const navStart = html.indexOf('<nav class="bottom-nav"'); const dialogStart = html.indexOf('<div id="manage-dialog-backdrop"'); const manage = html.slice(manageStart, navStart); const bottomNav = html.slice(navStart, dialogStart);
  assert.ok(manageStart < navStart); assert.doesNotMatch(html, /<nav class="tabs"/u); assert.match(bottomNav, /id="tab-home"[^>]*aria-label="쪽지"[^>]*title="쪽지"[\s\S]*bottom-nav-icon" aria-hidden="true"[\s\S]*<svg[^>]*focusable="false"[\s\S]*id="tab-manage"[^>]*aria-label="친구"[^>]*title="친구"[\s\S]*bottom-nav-icon" aria-hidden="true"[\s\S]*<svg[^>]*focusable="false"/u);
  assert.doesNotMatch(bottomNav, /bottom-nav-label|>\s*(?:쪽지|친구)\s*</u, "아이콘 전용 nav에는 보이는 label text가 없어야 한다"); assert.match(bottomNav, /id="nav-unread" class="badge"[\s\S]*id="invite-count" class="badge"/u);
  assert.match(manage, /id="manage-title"[^>]*>친구<\/h2>[\s\S]*id="manage-menu-trigger"[^>]*aria-label="관리 메뉴"/u);
  assert.ok(manage.indexOf('id="profile-row"') < manage.indexOf('role="tablist"')); assert.match(manage, /id="profile-row"(?![^>]*aria-label)[\s\S]*class="sr-only">내 프로필<[\s\S]*id="profile-current-name"/u); assert.doesNotMatch(manage, /눌러서 수정|내 코드/u);
  assert.match(manage, /role="tablist"[^>]*aria-label="친구와 모임"[\s\S]*id="manage-tab-friends"[^>]*role="tab"[^>]*aria-selected="true"[\s\S]*id="manage-tab-groups"[^>]*role="tab"[^>]*aria-selected="false"/u);
  assert.equal(manage.match(/class="manage-segment-icon" aria-hidden="true"><svg[^>]*focusable="false"/gu)?.length, 2); assert.match(manage, /id="manage-tab-friends"[\s\S]*<span>친구<\/span>[\s\S]*id="manage-tab-groups"[\s\S]*<span>모임<\/span>[\s\S]*id="group-invite-count" class="badge"/u);
  assert.match(manage, /id="friends-panel"[^>]*role="tabpanel"[\s\S]*id="groups-panel"[^>]*role="tabpanel"[^>]*hidden/u); assert.doesNotMatch(manage, /friend-add-trigger|group-add-trigger|invite-section|invite-list|<(?:input|select|textarea|form)\b/u);
  assert.match(html, /id="menu-panel" hidden[\s\S]*id="menu-friend-add"[\s\S]*id="menu-group-add"/u); assert.doesNotMatch(html, /id="menu-profile"/u);
  assert.match(html, /id="profile-view"[\s\S]*id="profile-code-value"[^>]*translate="no"[\s\S]*id="profile-code-copy"[\s\S]*id="profile-copy-status"[^>]*aria-live="polite"[\s\S]*id="profile-edit"[^>]*>이름 수정<[\s\S]*id="profile-form"[^>]*hidden[\s\S]*<label>내 이름/u); assert.match(html, /id="friend-alias-edit"[\s\S]*id="friend-alias-form"[^>]*hidden[\s\S]*id="friend-alias-reset"[^>]*>친구가 정한 이름 사용<[\s\S]*id="friend-alias-cancel"/u);
  assert.doesNotMatch(html, /<small>공개 별명<|Google 이름은 공개하지 않으며|비워서 저장하거나|공개 이름 사용/u);
  assert.match(css, /\.bottom-nav-item\{[^}]*min-height:52px/su); assert.match(css, /env\(safe-area-inset-bottom\)/u); assert.match(css, /\.bottom-nav-icon\{[^}]*width:44px[^}]*height:36px[^}]*border-radius:18px/su); assert.match(css, /\.bottom-nav-item\.active::before\{background:#7357a5\}/u); assert.match(css, /\.bottom-nav-item\.active \.bottom-nav-icon\{background:#eee6f7;color:#563d82\}/u); assert.match(css, /\.bottom-nav-item:focus-visible\{outline:3px solid #b8514e/u); assert.match(css, /\.bottom-nav-item>\.badge\{[^}]*left:calc\(50% \+ 13px\)/su); assert.match(css, /\.composer-bar\{[^}]*grid-template-columns:44px minmax\(0,1fr\) 44px 44px/su); assert.match(css, /@media\(max-width:395px\)/u); assert.doesNotMatch(css, /transition:\s*all/u);
  for (const [foreground, background] of [["#7d746a", "#fffdf8"], ["#7357a5", "#f4edfa"], ["#563d82", "#eee6f7"], ["#563d82", "#e1d3ef"], ["#7357a5", "#fffdf8"], ["#aaa095", "#292724"], ["#ddcef5", "#40354f"], ["#ddcef5", "#4b3e5e"], ["#a68bd3", "#292724"], ["#b8514e", "#fffdf8"], ["#e17a76", "#292724"]]) assert.ok(contrastRatio(foreground, background) >= 3);
  assert.match(css, /\.manage-segments\{[^}]*display:inline-flex[^}]*width:max-content[^}]*max-width:100%[^}]*gap:2px[^}]*margin-bottom:7px/su); assert.match(css, /\.manage-segments button\{[^}]*flex:0 0 70px[^}]*width:70px[^}]*min-height:44px[^}]*gap:4px[^}]*color:#62594f/su); assert.match(css, /\.manage-segments button:last-child\{flex-basis:78px;width:78px/su); assert.match(css, /\.manage-segments \.badge\{position:absolute;top:3px;right:3px/su);
  assert.match(css, /\.manage-segment-icon svg\{[^}]*width:16px[^}]*stroke-width:1\.8/su); assert.match(css, /button\[aria-selected="true"\] \.manage-segment-icon svg\{stroke-width:2\.4\}/u); assert.match(css, /button\[aria-selected="true"\]\{background:#fffdf8;color:#342f2a;font-weight:800/su);
  for (const [foreground, background] of [["#62594f", "#e9e0d3"], ["#7357a5", "#f4edfa"], ["#342f2a", "#fffdf8"], ["#aaa095", "#201e1c"], ["#ddcef5", "#362f40"], ["#f5f0e8", "#40354f"], ["#b8514e", "#fffdf8"], ["#e17a76", "#292724"]]) assert.ok(contrastRatio(foreground, background) >= 3);
});

test("초대가 두 자리를 넘어도 모임 탭 badge와 capsule 폭 계약을 유지한다", async () => {
  const view = await harness(); const next = state(); const invite = next.groupInvites[0];
  next.groupInvites = Array.from({ length: 123 }, (_, index) => ({ ...invite, id: `invite-${index}` }));
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["group-invite-count"].textContent, "9+"); assert.equal(view.elements["invite-count"].textContent, "123");
});

test("dark primary button은 기본·disabled 상태 모두 읽기 쉬운 대비를 유지한다", async () => {
  const css = await readFile(new URL("../ui/friend-messages.css", import.meta.url), "utf8");
  assert.match(css, /@media\(prefers-color-scheme:dark\)\{[^}]*--accent:#a68bd3[^}]*\}\.primary-button\{color:#191817\}\.primary-button:disabled\{opacity:1;background:#6f657b;color:#f5f0e8\}/u);
  assert.ok(contrastRatio("#a68bd3", "#191817") >= 4.5); assert.ok(contrastRatio("#6f657b", "#f5f0e8") >= 4.5);
});

test("친구 화면은 친구 panel을 기본으로 열고 모임 tab에 초대 행과 badge를 표시한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next }); view.elements["tab-manage"].onclick();
  assert.equal(view.elements["tab-home"].className, "bottom-nav-item"); assert.equal(view.elements["tab-home"].attributes["aria-current"], "false"); assert.equal(view.elements["tab-manage"].className, "bottom-nav-item active"); assert.equal(view.elements["tab-manage"].attributes["aria-current"], "page");
  assert.equal(view.elements["friends-panel"].hidden, false); assert.equal(view.elements["groups-panel"].hidden, true); assert.equal(view.elements["manage-tab-friends"].attributes["aria-selected"], "true");
  assert.equal(view.elements["profile-current-name"].textContent, "구름"); assert.equal(view.elements["invite-count"].textContent, "1"); assert.equal(view.elements["group-invite-count"].textContent, "1");
  let prevented = 0;
  view.elements["manage-tab-friends"].listeners.keydown({ key: "ArrowLeft", preventDefault() { prevented += 1; } }); assert.equal(view.elements["groups-panel"].hidden, false); assert.equal(view.document.activeElement, view.elements["manage-tab-groups"]);
  view.elements["manage-tab-groups"].listeners.keydown({ key: "ArrowRight", preventDefault() { prevented += 1; } }); assert.equal(view.elements["friends-panel"].hidden, false); assert.equal(view.document.activeElement, view.elements["manage-tab-friends"]);
  view.elements["manage-tab-friends"].listeners.keydown({ key: "End", preventDefault() { prevented += 1; } }); assert.equal(view.elements["groups-panel"].hidden, false); assert.equal(view.document.activeElement, view.elements["manage-tab-groups"]);
  view.elements["manage-tab-groups"].listeners.keydown({ key: "Home", preventDefault() { prevented += 1; } }); assert.equal(view.elements["friends-panel"].hidden, false); assert.equal(view.document.activeElement, view.elements["manage-tab-friends"]); assert.equal(prevented, 4);
  view.elements["manage-tab-groups"].onclick(); assert.equal(view.elements["friends-panel"].hidden, true); assert.equal(view.elements["groups-panel"].hidden, false); assert.equal(view.document.activeElement, view.elements["manage-tab-groups"]);
  assert.equal(view.elements["friend-list"].children.length, 2); assert.equal(view.elements["group-list"].children.length, 2);
  assert.match(allText(view.elements["group-list"].children[0]), /점심 모임.*초대 · 구름님이 초대.*초대/u);
  view.elements["group-list"].children[0].children[0].onclick(); assert.equal(view.elements["invite-panel"].hidden, false); assert.equal(view.elements["invite-accept"].focused, true);
  view.elements["invite-accept"].onclick(); const id = view.sent.at(-1).operationId; const count = view.sent.length; view.elements["invite-accept"].onclick(); assert.equal(view.sent.length, count);
  view.onMessage({ type: "error", message: "실패", operationId: id }); assert.equal(view.elements["invite-panel"].hidden, false); assert.equal(view.elements["invite-accept"].disabled, false);
});

test("프로필 행은 조회를 먼저 열고 복사·편집 성공·focus 복원을 처리한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next }); view.elements["tab-manage"].onclick();
  view.elements["profile-row"].onclick(); assert.equal(view.elements["profile-panel"].hidden, false); assert.equal(view.elements["profile-view"].hidden, false); assert.equal(view.elements["profile-form"].hidden, true); assert.equal(view.elements["profile-display-name"].textContent, "구름"); assert.equal(view.elements["profile-code-value"].textContent, "A1B2C3"); assert.equal(view.document.activeElement, view.elements["profile-code-copy"]);
  await view.elements["profile-code-copy"].onclick(); assert.deepEqual(view.copied, ["A1B2C3"]); assert.equal(view.elements["profile-copy-status"].textContent, "친구 코드를 복사했어요.");
  view.elements["profile-edit"].onclick(); assert.equal(view.elements["profile-view"].hidden, true); assert.equal(view.elements["profile-form"].hidden, false); assert.equal(view.document.activeElement, view.elements["profile-name"]);
  view.elements["profile-name"].value = "취소할 별명"; view.elements["profile-cancel"].onclick(); assert.equal(view.elements["profile-form"].hidden, true); assert.equal(view.document.activeElement, view.elements["profile-edit"]);
  view.elements["profile-edit"].onclick(); assert.equal(view.elements["profile-name"].value, "구름");
  view.elements["profile-name"].value = "새 구름"; view.onMessage({ type: "state", state: next }); assert.equal(view.elements["profile-name"].value, "새 구름"); assert.equal(view.elements["profile-form"].hidden, false);
  view.elements["profile-form"].listeners.submit({ preventDefault() {} }); const operationId = view.sent.at(-1).operationId; next.me = { ...next.me, name: "새 구름" }; view.onMessage({ type: "state", state: next, operationId, notice: "내 이름을 바꿨어요." });
  assert.equal(view.elements["profile-form"].hidden, true); assert.equal(view.elements["profile-view"].hidden, false); assert.equal(view.elements["profile-display-name"].textContent, "새 구름"); assert.equal(view.document.activeElement, view.elements["profile-edit"]);
  view.elements["manage-dialog-close"].onclick(); assert.equal(view.document.activeElement, view.elements["profile-row"]);
});

test("코드 복사는 Clipboard 실패 시 fallback을 쓰고 모두 실패하면 직접 복사를 안내한다", async () => {
  const fallback = await harness({ clipboardFailure: true }); fallback.onMessage({ type: "state", state: state() }); fallback.elements["tab-manage"].onclick(); fallback.elements["profile-row"].onclick(); await fallback.elements["profile-code-copy"].onclick(); assert.deepEqual(fallback.copied, ["fallback"]); assert.equal(fallback.elements["profile-copy-status"].textContent, "친구 코드를 복사했어요."); assert.equal(fallback.document.body.children.length, 0); assert.equal(fallback.document.activeElement, fallback.elements["profile-code-copy"]);
  const failed = await harness({ clipboardFailure: true, fallbackFailure: true }); failed.onMessage({ type: "state", state: state() }); failed.elements["tab-manage"].onclick(); failed.elements["profile-row"].onclick(); await failed.elements["profile-code-copy"].onclick(); assert.match(failed.elements["profile-copy-status"].textContent, /복사하지 못했어요.*직접 복사/u); assert.equal(failed.document.body.children.length, 0); assert.equal(failed.document.activeElement, failed.elements["profile-code-copy"]);
});

test("친구 상세는 조회 우선이며 이름 편집 draft·오류·성공을 보존한다", async () => {
  const view = await harness(); const next = state(); next.friends[0] = { ...next.friends[0], name: "하늘 별칭", alias: "하늘 별칭", hasAlias: true }; view.onMessage({ type: "state", state: next }); view.elements["tab-manage"].onclick();
  assert.doesNotMatch(allText(view.elements["friend-list"]), /친구의 공개 별명|공개 이름 사용/u); view.elements["friend-list"].children[0].children[0].onclick(); assert.equal(view.elements["friend-alias-form"].hidden, true); assert.equal(view.elements["friend-detail-name"].textContent, "하늘 별칭"); assert.equal(view.elements["friend-detail-status"].textContent, "친구가 정한 이름 · 하늘"); assert.equal(view.document.activeElement, view.elements["friend-message"]);
  view.elements["friend-alias-edit"].onclick(); assert.equal(view.elements["friend-alias-form"].hidden, false); assert.equal(view.document.activeElement, view.elements["friend-detail-alias"]); view.elements["friend-detail-alias"].value = "취소할 별칭"; view.elements["friend-alias-cancel"].onclick(); assert.equal(view.elements["friend-alias-form"].hidden, true); assert.equal(view.document.activeElement, view.elements["friend-alias-edit"]);
  view.elements["friend-alias-edit"].onclick(); assert.equal(view.elements["friend-detail-alias"].value, "하늘 별칭"); view.elements["friend-detail-alias"].value = "새 별칭"; view.onMessage({ type: "state", state: next }); assert.equal(view.elements["friend-detail-alias"].value, "새 별칭");
  view.elements["friend-alias-form"].listeners.submit({ preventDefault() {} }); const failedId = view.sent.at(-1).operationId; view.onMessage({ type: "error", message: "바꾸지 못했어요.", operationId: failedId }); assert.equal(view.elements["friend-alias-form"].hidden, false); assert.equal(view.elements["friend-detail-alias"].value, "새 별칭"); assert.equal(view.document.activeElement, view.elements["friend-detail-alias"]);
  view.elements["friend-alias-form"].listeners.submit({ preventDefault() {} }); const successId = view.sent.at(-1).operationId; next.friends[0] = { ...next.friends[0], name: "새 별칭", alias: "새 별칭" }; view.onMessage({ type: "state", state: next, operationId: successId, notice: "별칭을 바꿨어요." }); assert.equal(view.elements["friend-alias-form"].hidden, true); assert.equal(view.elements["friend-detail-name"].textContent, "새 별칭"); assert.equal(view.document.activeElement, view.elements["friend-alias-edit"]);
  view.elements["friend-alias-edit"].onclick(); view.elements["friend-alias-reset"].onclick(); const reset = view.sent.at(-1); assert.equal(reset.type, "updateFriendAlias"); assert.equal(reset.friendId, "f1"); assert.equal(reset.alias, null);
  next.friends[0] = { ...next.friends[0], name: "하늘", alias: "", hasAlias: false }; view.onMessage({ type: "state", state: next, operationId: reset.operationId, notice: "친구가 정한 이름을 사용해요." }); assert.equal(view.elements["friend-alias-form"].hidden, true); assert.equal(view.elements["friend-detail-name"].textContent, "하늘"); assert.equal(view.elements["friend-detail-status"].textContent, ""); assert.equal(view.document.activeElement, view.elements["friend-alias-edit"]);
});

test("관리 메뉴는 친구 추가·모임 생성만 전환한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next }); view.elements["tab-manage"].onclick();
  view.elements["manage-menu-trigger"].onclick();
  assert.equal(view.elements["menu-panel"].hidden, false); assert.equal(view.document.activeElement, view.elements["menu-friend-add"]);
  view.elements["menu-friend-add"].onclick(); assert.equal(view.elements["friend-add-panel"].hidden, false); assert.equal(view.elements["manage-dialog-back"].hidden, false); assert.equal(view.document.activeElement, view.elements["friend-code"]);
  view.elements["friend-alias"].value = "작성 중"; view.onMessage({ type: "state", state: next }); assert.equal(view.elements["friend-alias"].value, "작성 중");
  view.elements["manage-dialog-back"].onclick(); assert.equal(view.elements["menu-panel"].hidden, false); assert.equal(view.document.activeElement, view.elements["menu-friend-add"]);
  let trapped = false; view.elements["menu-group-add"].focus(); view.elements["manage-dialog"].listeners.keydown({ key: "Tab", shiftKey: false, preventDefault() { trapped = true; } });
  assert.equal(trapped, true); assert.equal(view.document.activeElement, view.elements["manage-dialog-close"]);
  view.elements["manage-dialog"].listeners.keydown({ key: "Escape", preventDefault() {} }); assert.equal(view.elements["manage-dialog-backdrop"].hidden, true); assert.equal(view.document.activeElement, view.elements["manage-menu-trigger"]);
});

test("친구·모임 panel polling은 행 identity와 focus를 유지하고 사라진 초대는 모임 tab으로 복원한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next }); view.elements["tab-manage"].onclick();
  const friendItem = view.elements["friend-list"].children[1]; const friendButton = friendItem.children[0]; friendButton.focus();
  view.onMessage({ type: "state", state: next }); assert.equal(view.elements["friend-list"].children[1], friendItem); assert.equal(friendItem.children[0], friendButton); assert.equal(view.document.activeElement, friendButton);
  next.friends[1] = { ...next.friends[1], name: "아주 길게 바뀐 친구 이름" }; view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["friend-list"].children[1], friendItem); assert.notEqual(friendItem.children[0], friendButton); assert.equal(view.document.activeElement, friendItem.children[0]);
  view.elements["manage-tab-groups"].onclick(); view.elements["group-list"].children[0].children[0].onclick(); view.elements["invite-accept"].onclick(); const operationId = view.sent.at(-1).operationId;
  next.groupInvites = []; view.onMessage({ type: "state", state: next, operationId, notice: "초대를 수락했어요." });
  assert.equal(view.elements["group-list"].children.length, 1); assert.equal(view.document.activeElement, view.elements["manage-tab-groups"]);
});
