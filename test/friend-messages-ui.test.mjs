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
  setAttribute(name, value) { this.attributes[name] = String(value); }
  setCustomValidity(message) { this.validationMessage = message; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  focus() { if (this.ownerDocument?.activeElement) this.ownerDocument.activeElement.focused = false; this.focused = true; if (this.ownerDocument) this.ownerDocument.activeElement = this; }
}

const allText = (node) => [node.textContent, ...node.children.map(allText)].join(" ");
let harnessSequence = 0;

async function harness() {
  const views = ["home", "manage"];
  const ids = [
    "app", "connect-panel", "connect-google", "workspace", "refresh", "close", "status", "nav-unread", "home-title",
    "invite-count", "message-list", "inbox-empty", "message-form", "composer-hint", "compose-recipient", "compose-back",
    "sticker-tray", "sticker-toggle", "sticker-grid", "message-body", "anonymous-toggle", "counter", "send", "my-code", "friend-add-trigger", "friend-form", "friend-code",
    "friend-alias", "friend-add-submit", "friend-add-cancel", "profile-row", "profile-form", "profile-name", "profile-current-name", "profile-save", "profile-cancel", "friend-list", "friend-empty",
    "invite-section", "invite-list", "group-add-trigger", "group-form", "group-name", "group-friend-options", "group-create-submit", "group-create-cancel", "group-list", "group-empty",
    "manage-dialog-backdrop", "manage-dialog", "manage-dialog-title", "manage-dialog-close", "profile-panel", "friend-add-panel", "friend-panel", "group-create-panel", "group-panel", "compose-panel",
    "friend-detail-name", "friend-detail-status", "friend-message", "friend-alias-form", "friend-detail-alias", "friend-alias-save", "friend-alias-reset", "friend-block", "friend-remove",
    "group-detail-name", "group-detail-status", "group-message", "group-rename-form", "group-rename-name", "group-rename-save", "group-invite-controls", "group-invite-select", "group-invite-button", "group-member-list", "group-leave", "group-delete",
    "invite-panel", "invite-detail-name", "invite-detail-status", "invite-accept", "invite-decline",
    ...views.flatMap((name) => [`tab-${name}`, `view-${name}`]),
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  const sent = [];
  let onMessage;
  const session = (++harnessSequence).toString(16).padStart(12, "0");
  const crypto = { randomUUID() { return `${session.slice(0, 8)}-${session.slice(8)}-4000-8000-000000000000`; } };
  const window = { dapPalette: { postMessage(message) { sent.push(message); }, onMessage(handler) { onMessage = handler; }, close() {} } };
  const document = { activeElement: null, getElementById(id) { return elements[id]; }, createElement(tag) { const node = new FakeElement(tag); node.ownerDocument = document; return node; } };
  for (const element of Object.values(elements)) element.ownerDocument = document;
  const source = await readFile(new URL("../ui/friend-messages-ui.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { window, document, Intl, Date, Set, crypto });
  return { elements, sent, onMessage, document };
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
  view.elements["group-list"].children[groupIndex].children[0].onclick();
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

test("HTML은 상세 depth 없이 받은 목록과 dialog 작성기만 가지며 380px 안전 규칙을 유지한다", async () => {
  const html = await readFile(new URL("../palette/index.html", import.meta.url), "utf8"); const css = await readFile(new URL("../ui/friend-messages.css", import.meta.url), "utf8");
  assert.match(html, /id="home-title" tabindex="-1"/u); assert.match(html, /id="message-list"[^>]*aria-live="polite"[^>]*aria-relevant="additions removals"[^>]*aria-atomic="false"/u); assert.doesNotMatch(html, /id="view-detail"|id="thread-list"|id="detail-back"/u);
  assert.match(html, /id="compose-panel"[^>]*hidden/u); assert.match(html, /id="group-message"[^>]*>모임 전체에 쪽지 보내기/u);
  const home = html.slice(html.indexOf('<section id="view-home"'), html.indexOf('<section id="view-manage"'));
  assert.doesNotMatch(home, /friend-list|group-list|message-form|textarea/u);
  assert.match(css, /\.composer-bar\{[^}]*grid-template-columns:44px minmax\(0,1fr\) 44px 44px/su); assert.match(css, /@media\(max-width:395px\)/u); assert.doesNotMatch(css, /transition:\s*all/u);
});

test("관리 목록과 초대 dialog의 기존 접근성 흐름을 유지한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next }); view.elements["tab-manage"].onclick();
  assert.equal(view.elements["friend-list"].children.length, 2); assert.equal(view.elements["group-list"].children.length, 1); assert.equal(view.elements["invite-list"].children.length, 1);
  view.elements["invite-list"].children[0].children[0].onclick(); assert.equal(view.elements["invite-panel"].hidden, false); assert.equal(view.elements["invite-accept"].focused, true);
  view.elements["invite-accept"].onclick(); const id = view.sent.at(-1).operationId; const count = view.sent.length; view.elements["invite-accept"].onclick(); assert.equal(view.sent.length, count);
  view.onMessage({ type: "error", message: "실패", operationId: id }); assert.equal(view.elements["invite-panel"].hidden, false); assert.equal(view.elements["invite-accept"].disabled, false);
});
