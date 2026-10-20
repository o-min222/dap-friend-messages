import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {};
    this.value = ""; this.textContent = ""; this.hidden = false; this.disabled = false;
    this.className = ""; this.checked = false; this.focused = false; this.styleWriteCount = 0;
    this.style = new Proxy({}, { set: (target, key, value) => { this.styleWriteCount += 1; target[key] = value; return true; } }); this.scrollHeight = 24;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  setCustomValidity(message) { this.validationMessage = message; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  focus() { this.focused = true; if (this.ownerDocument) this.ownerDocument.activeElement = this; }
}

const allText = (node) => [node.textContent, ...node.children.map(allText)].join(" ");
let harnessSequence = 0;

async function harness() {
  const views = ["home", "manage"];
  const ids = [
    "app", "connect-panel", "connect-google", "workspace", "refresh", "close", "status", "nav-unread",
    "invite-count", "thread-list", "contact-empty", "view-detail", "detail-back", "detail-avatar",
    "detail-kind", "detail-name", "detail-unread", "message-stack", "inbox-empty", "message-form", "composer-hint",
    "sticker-tray", "sticker-toggle", "sticker-grid", "message-body", "anonymous-toggle", "counter", "send", "my-code", "friend-add-trigger", "friend-form", "friend-code",
    "friend-alias", "friend-add-submit", "friend-add-cancel", "profile-row", "profile-form", "profile-name", "profile-current-name", "profile-save", "profile-cancel", "friend-list", "friend-empty",
    "invite-section", "invite-list", "group-add-trigger", "group-form", "group-name", "group-friend-options", "group-create-submit", "group-create-cancel", "group-list", "group-empty",
    "manage-dialog-backdrop", "manage-dialog", "manage-dialog-title", "manage-dialog-close", "profile-panel", "friend-add-panel", "friend-panel", "group-create-panel", "group-panel",
    "friend-detail-name", "friend-detail-status", "friend-message", "friend-alias-form", "friend-detail-alias", "friend-alias-save", "friend-alias-reset", "friend-block", "friend-remove",
    "group-detail-name", "group-detail-status", "group-rename-form", "group-rename-name", "group-rename-save", "group-invite-controls", "group-invite-select", "group-invite-button", "group-member-list", "group-leave", "group-delete",
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
  return { elements, sent, onMessage };
}

const state = () => ({
  connection: "connected", busy: false,
  me: { id: "me", code: "A1B2C3", name: "구름", nameCustomized: true },
  maxMessageLength: 100, unreadCount: 2, error: null,
  friends: [
    { id: "f1", name: "하늘", alias: "", publicName: "하늘", hasAlias: false, blocked: false },
    { id: "f2", name: "바다", alias: "", publicName: "바다", hasAlias: false, blocked: false },
  ],
  groups: [{ id: "g1", name: "산책 모임", owner: true, members: [{ id: "f1", name: "하늘" }, { id: "f2", name: "바다" }] }],
  groupInvites: [{ id: "i1", groupId: "g2", groupName: "점심 모임", inviterName: "구름" }],
  messages: [
    { id: "m1", anonymous: false, senderId: "f1", senderName: "하늘", targetType: "friend", targetId: "f1", body: null, stickerId: null, createdAt: "2026-10-20T12:00:00Z", openedAt: null },
    { id: "m2", anonymous: false, senderId: "f2", senderName: "바다", targetType: "group", targetId: "g1", body: null, stickerId: "cheer", createdAt: "2026-10-20T11:00:00Z", openedAt: null },
  ],
});

test("Google 연결은 사용자가 버튼을 누를 때만 요청한다", async () => {
  const view = await harness();
  view.onMessage({ type: "state", state: { connection: "disconnected", busy: false, friends: [], groups: [], groupInvites: [], messages: [], maxMessageLength: 100 } });
  assert.equal(view.sent.some((item) => item.type === "connectGoogle"), false);
  view.elements["connect-google"].onclick();
  assert.equal(view.sent.at(-1).type, "connectGoogle");
});

test("기본 화면은 친구·모임 통합 목록이며 상세에서 대상 쪽지만 필터링한다", async () => {
  const view = await harness();
  view.onMessage({ type: "state", state: state() });
  assert.equal(view.elements["view-home"].hidden, false);
  assert.equal(view.elements["thread-list"].children.length, 3);
  view.elements["thread-list"].children[0].children[0].onclick();
  assert.equal(view.elements["view-detail"].hidden, false);
  assert.equal(view.elements["detail-name"].textContent, "하늘");
  assert.equal(view.elements["detail-name"].focused, true);
  assert.equal(view.elements["message-stack"].children.length, 1);
  assert.match(allText(view.elements["message-stack"]), /하늘/u);
  assert.doesNotMatch(allText(view.elements["message-stack"]), /산책 모임/u);
});

test("친구 상세에서 종이 쪽지, 스티커, 익명 선택을 바로 전송하고 성공 뒤 초기화한다", async () => {
  const view = await harness(); const next = state();
  view.onMessage({ type: "state", state: next });
  view.elements["thread-list"].children[0].children[0].onclick();
  view.elements["sticker-grid"].children[6].onclick();
  view.elements["message-body"].value = "오늘도 파이팅";
  view.elements["anonymous-toggle"].onclick();
  view.elements["message-form"].listeners.submit({ preventDefault() {} });
  const operationId = view.sent.at(-1).operationId;
  const sentCount = view.sent.length;
  assert.match(operationId, /^palette-[A-Za-z0-9_-]+/u);
  assert.equal(view.elements.send.disabled, true);
  view.elements["message-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.length, sentCount);
  assert.deepEqual(
    { type: view.sent.at(-1).type, targetType: view.sent.at(-1).targetType, targetId: view.sent.at(-1).targetId, stickerId: view.sent.at(-1).stickerId, anonymous: view.sent.at(-1).anonymous },
    { type: "sendMessage", targetType: "friend", targetId: "f1", stickerId: "celebrate", anonymous: true },
  );
  view.onMessage({ type: "state", state: next, sentTo: "friend:f1", operationId });
  assert.equal(view.elements["anonymous-toggle"].attributes["aria-pressed"], "false");
  assert.equal(view.elements["message-body"].value, "");
});

test("모임 상세는 해당 모임 쪽지만 보여 주고 group payload를 보낸다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  view.elements["thread-list"].children[1].children[0].onclick();
  assert.equal(view.elements["detail-name"].textContent, "산책 모임");
  assert.equal(view.elements["message-stack"].children.length, 1);
  view.elements["message-body"].value = "모임 쪽지";
  view.elements["message-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.at(-1).targetType, "group");
  assert.equal(view.sent.at(-1).targetId, "g1");
});

test("목록으로 돌아가면 열었던 연락처 행에 초점을 복원한다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  const button = view.elements["thread-list"].children[2].children[0];
  button.onclick();
  view.elements["detail-back"].onclick();
  assert.equal(view.elements["view-home"].hidden, false);
  assert.equal(button.focused, true);
});

test("익명 1:1은 최상단 읽기 전용 pseudo-thread로만 노출하고 친구에게 귀속하지 않는다", async () => {
  const view = await harness(); const next = state();
  next.unreadCount = 3;
  next.messages.unshift({ id: "anon1", anonymous: true, senderId: "", senderName: "익명의 친구", targetType: "friend", targetId: "", body: null, stickerId: null, createdAt: new Date().toISOString(), openedAt: null });
  view.onMessage({ type: "state", state: next });
  assert.match(allText(view.elements["thread-list"].children[0]), /익명 쪽지/u);
  assert.doesNotMatch(allText(view.elements["thread-list"].children[0]), /하늘|바다|비밀 응원/u);
  view.elements["thread-list"].children[0].children[0].onclick();
  assert.equal(view.elements["detail-name"].textContent, "익명 쪽지");
  assert.equal(view.elements["message-form"].hidden, true);
  assert.equal(view.elements["message-stack"].children.length, 1);
  view.elements["message-stack"].children[0].onclick();
  assert.equal(view.sent.at(-1).type, "openMessage");
  assert.equal(view.sent.at(-1).messageId, "anon1");
});

test("익명 쪽지를 연 뒤 목록 행이 사라지면 홈 탭으로 초점을 복원한다", async () => {
  const view = await harness(); const next = state();
  next.messages = [{ id: "anon1", anonymous: true, senderId: "", senderName: "익명의 친구", targetType: "friend", targetId: "", body: null, stickerId: null, createdAt: new Date().toISOString(), openedAt: null }];
  next.unreadCount = 1;
  view.onMessage({ type: "state", state: next });
  view.elements["thread-list"].children[0].children[0].onclick();
  next.messages[0] = { ...next.messages[0], openedAt: new Date().toISOString(), body: "응원" };
  next.unreadCount = 0;
  view.onMessage({ type: "state", state: next });
  assert.doesNotMatch(allText(view.elements["thread-list"]), /익명 쪽지/u);
  view.elements["detail-back"].onclick();
  assert.equal(view.elements["tab-home"].focused, true);
});

test("익명 모임 쪽지는 groupId로 모임 상세에만 귀속한다", async () => {
  const view = await harness(); const next = state();
  next.messages = [{ id: "ag1", anonymous: true, senderId: "", senderName: "익명의 친구", targetType: "group", targetId: "g1", body: null, stickerId: null, createdAt: new Date().toISOString(), openedAt: null }];
  next.unreadCount = 1;
  view.onMessage({ type: "state", state: next });
  assert.doesNotMatch(allText(view.elements["thread-list"]), /익명 쪽지/u);
  assert.equal(view.elements["thread-list"].children.length, 3);
  view.elements["thread-list"].children[0].children[0].onclick();
  assert.equal(view.elements["message-stack"].children.length, 1);
  assert.match(allText(view.elements["message-stack"]), /익명의 친구/u);
});

test("열린 쪽지는 종이로 표시하고 익명 aria 문구에서 어색한 조사를 쓰지 않는다", async () => {
  const view = await harness(); const next = state();
  next.messages = [{ id: "anon1", anonymous: true, senderId: "", senderName: "익명의 친구", targetType: "friend", targetId: "", openedAt: new Date().toISOString(), body: "비밀 응원", stickerId: "cheer", createdAt: new Date().toISOString() }];
  next.unreadCount = 0;
  // 열린 익명 쪽지는 이미 pseudo-thread가 사라져야 하므로 일반 렌더에 재노출하지 않는다.
  view.onMessage({ type: "state", state: next });
  assert.doesNotMatch(allText(view.elements["thread-list"]), /익명 쪽지/u);
  assert.equal(view.elements["thread-list"].children.length, 3);

  next.messages[0].openedAt = null;
  next.unreadCount = 1;
  view.onMessage({ type: "state", state: next });
  view.elements["thread-list"].children[0].children[0].onclick();
  next.messages[0].openedAt = new Date().toISOString();
  view.onMessage({ type: "state", state: next });
  const opened = view.elements["message-stack"].children[0];
  assert.match(opened.className, /opened-note/u);
  assert.equal(opened.attributes["aria-label"], "익명의 친구가 보낸 열린 쪽지");
  assert.doesNotMatch(allText(opened), /익명의 친구 님/u);
});

test("이모지 쪽지는 100 codepoint를 허용하고 101자는 자르지 않은 채 막는다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  view.elements["thread-list"].children[0].children[0].onclick();
  view.elements["message-body"].value = "😀".repeat(101);
  view.elements["message-body"].listeners.input();
  const count = view.sent.length;
  view.elements["message-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.length, count);
  assert.equal(view.elements["message-body"].value, "😀".repeat(101));
  assert.equal(view.elements["message-body"].attributes["aria-invalid"], "true");
  view.elements["message-body"].value = "😀".repeat(100);
  view.elements["message-body"].listeners.input();
  view.elements["message-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.at(-1).type, "sendMessage");
});

test("통합 목록은 미열람과 최신 순으로 정렬하고 본문을 미리 노출하지 않는다", async () => {
  const view = await harness(); const next = state();
  next.messages = [
    { ...next.messages[0], id: "older", createdAt: "2026-10-20T10:00:00Z", body: "목록에 보이면 안 되는 비밀" },
    { ...next.messages[1], id: "newer", createdAt: "2026-10-20T13:00:00Z", body: "모임 본문도 금지" },
  ];
  view.onMessage({ type: "state", state: next });
  assert.match(allText(view.elements["thread-list"].children[0]), /산책 모임/u);
  assert.match(allText(view.elements["thread-list"].children[1]), /하늘/u);
  assert.match(allText(view.elements["thread-list"].children[2]), /바다/u);
  assert.doesNotMatch(allText(view.elements["thread-list"]), /목록에 보이면 안 되는 비밀|모임 본문도 금지/u);
  assert.doesNotMatch(allText(view.elements["thread-list"]), /친구 관리|모임 관리/u);
});

test("컴팩트 작성기는 스티커 tray Escape와 자동 높이, polling 중 draft 상태 보존을 지원한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });
  view.elements["thread-list"].children[0].children[0].onclick();
  assert.equal(view.elements["sticker-tray"].hidden, true);
  assert.equal(view.elements["sticker-toggle"].attributes["aria-expanded"], "false");
  view.elements["sticker-toggle"].onclick();
  assert.equal(view.elements["sticker-tray"].hidden, false);
  assert.equal(view.elements["sticker-grid"].children[0].focused, true);
  view.elements["message-form"].listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(view.elements["sticker-tray"].hidden, true);
  assert.equal(view.elements["sticker-toggle"].focused, true);

  view.elements["sticker-toggle"].onclick(); view.elements["sticker-grid"].children[2].onclick();
  view.elements["sticker-toggle"].onclick();
  view.elements["anonymous-toggle"].onclick();
  view.elements["message-body"].value = "폴링에도 남을 초안"; view.elements["message-body"].scrollHeight = 88; view.elements["message-body"].listeners.input();
  assert.equal(view.elements["message-body"].style.height, "88px");
  const writesBeforePolling = view.elements["message-body"].styleWriteCount;
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["message-body"].styleWriteCount, writesBeforePolling);
  assert.equal(view.elements["message-body"].value, "폴링에도 남을 초안");
  assert.equal(view.elements["sticker-tray"].hidden, false);
  assert.equal(view.elements["anonymous-toggle"].attributes["aria-pressed"], "true");
  assert.match(view.elements["sticker-grid"].children[2].className, /selected/u);

  view.elements["detail-back"].onclick(); view.elements["thread-list"].children[2].children[0].onclick();
  assert.equal(view.elements["message-body"].value, "");
  assert.equal(view.elements["anonymous-toggle"].attributes["aria-pressed"], "false");
  assert.equal(view.elements["sticker-tray"].hidden, true);
});

test("늦은 send 성공·오류는 다른 대상의 새 초안이나 현재 pending을 바꾸지 않는다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });
  view.elements["thread-list"].children[0].children[0].onclick();
  view.elements["message-body"].value = "A 이전 초안"; view.elements["message-body"].listeners.input();
  view.elements["message-form"].listeners.submit({ preventDefault() {} }); const oldId = view.sent.at(-1).operationId;
  view.elements["detail-back"].onclick(); view.elements["thread-list"].children[2].children[0].onclick();
  view.elements["message-body"].value = "B 초안"; view.elements["message-body"].listeners.input();
  view.elements["detail-back"].onclick(); view.elements["thread-list"].children[0].children[0].onclick();
  view.elements["message-body"].value = "A 새 초안"; view.elements["message-body"].listeners.input();
  view.onMessage({ type: "state", state: next, sentTo: "friend:f1", operationId: oldId });
  assert.equal(view.elements["message-body"].value, "A 새 초안");
  assert.equal(view.elements.send.disabled, false);

  view.elements["message-form"].listeners.submit({ preventDefault() {} }); const currentId = view.sent.at(-1).operationId;
  assert.notEqual(currentId, oldId); assert.equal(view.elements.send.disabled, true);
  view.onMessage({ type: "error", message: "늦은 이전 오류", operationId: oldId });
  assert.equal(view.elements["message-body"].value, "A 새 초안"); assert.equal(view.elements.send.disabled, true);
  view.onMessage({ type: "error", message: "현재 전송 실패", operationId: currentId });
  assert.equal(view.elements["message-body"].value, "A 새 초안"); assert.equal(view.elements.send.disabled, false);
});

test("관리 목록은 보기 전용 요약 행이고 프로필·친구·모임 상세를 dialog로 연다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  assert.equal(view.elements["friend-list"].children.length, 2);
  assert.equal(view.elements["group-list"].children.length, 1);
  assert.match(allText(view.elements["friend-list"].children[0]), /하늘/u);
  assert.doesNotMatch(allText(view.elements["friend-list"]), /저장|삭제|차단/u);
  assert.equal(view.elements["invite-list"].children[0].children.length, 1);
  assert.equal(view.elements["invite-list"].children[0].children[0].tagName, "button");
  assert.doesNotMatch(allText(view.elements["invite-list"]), /수락|거절/u);
  view.elements["profile-row"].onclick();
  assert.equal(view.elements["manage-dialog-backdrop"].hidden, false);
  assert.equal(view.elements["profile-panel"].hidden, false);
  assert.equal(view.elements["profile-name"].focused, true);
  view.elements["manage-dialog-close"].onclick();
  assert.equal(view.elements["manage-dialog-backdrop"].hidden, true);
  assert.equal(view.elements["profile-row"].focused, true);
  view.elements["friend-list"].children[0].children[0].onclick();
  assert.equal(view.elements["friend-panel"].hidden, false);
  assert.equal(view.elements["friend-detail-name"].textContent, "하늘");
  view.elements["manage-dialog-close"].onclick();
  view.elements["group-list"].children[0].children[0].onclick();
  assert.equal(view.elements["group-panel"].hidden, false);
  assert.equal(view.elements["group-detail-name"].textContent, "산책 모임");
  view.elements["manage-dialog-close"].onclick(); view.onMessage({ type: "state", state: state() });
  assert.equal(view.elements["group-list"].children[0].children[0].focused, true);
});

test("받은 초대는 상세 dialog에서만 응답하고 중복·늦은 응답을 operationId로 격리한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });
  view.elements["invite-list"].children[0].children[0].onclick();
  assert.equal(view.elements["invite-panel"].hidden, false); assert.equal(view.elements["invite-accept"].focused, true);
  view.elements["invite-accept"].onclick(); const oldId = view.sent.at(-1).operationId; const firstCount = view.sent.length;
  assert.deepEqual({ type: view.sent.at(-1).type, accept: view.sent.at(-1).accept }, { type: "respondGroupInvite", accept: true });
  view.elements["invite-accept"].onclick(); assert.equal(view.sent.length, firstCount);
  view.elements["manage-dialog-close"].onclick(); view.elements["invite-list"].children[0].children[0].onclick();
  view.elements["invite-decline"].onclick(); const currentId = view.sent.at(-1).operationId; assert.notEqual(oldId, currentId);
  view.onMessage({ type: "state", state: next, notice: "모임 초대를 수락했어요.", operationId: oldId });
  assert.equal(view.elements["manage-dialog-backdrop"].hidden, false); assert.equal(view.elements["invite-decline"].disabled, true);
  view.onMessage({ type: "error", message: "이전 요청 오류", operationId: oldId }); assert.equal(view.elements["invite-decline"].disabled, true);
  view.onMessage({ type: "error", message: "초대 응답 실패", operationId: currentId });
  assert.equal(view.elements["manage-dialog-backdrop"].hidden, false); assert.equal(view.elements["invite-decline"].disabled, false); assert.equal(view.elements["invite-accept"].focused, true);
  view.elements["invite-decline"].onclick(); const retryId = view.sent.at(-1).operationId;
  view.onMessage({ type: "state", state: next, notice: "모임 초대를 거절했어요.", operationId: retryId });
  assert.equal(view.elements["manage-dialog-backdrop"].hidden, true); assert.equal(view.elements["invite-list"].children[0].children[0].focused, true);
});

test("친구 추가 dialog는 Unicode 별칭 검증, 중복 제출 방지, 오류 draft 보존과 성공 focus 복원을 제공한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });
  view.elements["friend-add-trigger"].onclick();
  assert.equal(view.elements["friend-code"].focused, true);
  view.elements["friend-code"].value = "abc123"; view.elements["friend-code"].listeners.input();
  assert.equal(view.elements["friend-code"].value, "ABC123");
  view.elements["friend-alias"].value = "😀".repeat(21); view.elements["friend-alias"].listeners.input();
  const before = view.sent.length; view.elements["friend-form"].listeners.submit({ preventDefault() {} }); assert.equal(view.sent.length, before);
  view.elements["friend-alias"].value = "새친구"; view.elements["friend-alias"].listeners.input(); view.elements["friend-form"].listeners.submit({ preventDefault() {} });
  const operationId = view.sent.at(-1).operationId; const pendingCount = view.sent.length;
  view.elements["friend-form"].listeners.submit({ preventDefault() {} }); assert.equal(view.sent.length, pendingCount);
  view.onMessage({ type: "state", state: next }); assert.equal(view.elements["friend-alias"].value, "새친구");
  view.onMessage({ type: "error", message: "이미 연결된 친구예요.", operationId });
  assert.equal(view.elements["friend-alias"].value, "새친구"); assert.match(view.elements.status.textContent, /이미 연결/u);
  view.elements["friend-form"].listeners.submit({ preventDefault() {} }); const retryId = view.sent.at(-1).operationId;
  view.onMessage({ type: "state", state: next, notice: "친구를 연결했어요.", operationId: retryId });
  assert.equal(view.elements["manage-dialog-backdrop"].hidden, true); assert.equal(view.elements["friend-add-trigger"].focused, true);
});

test("프로필 dialog는 Escape와 Tab trap을 지원하고 실패 초안을 보존한 뒤 성공 때 닫힌다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });
  view.elements["profile-row"].onclick(); view.elements["profile-name"].value = "새구름"; view.elements["profile-name"].listeners.input();
  view.elements["profile-form"].listeners.submit({ preventDefault() {} }); const operationId = view.sent.at(-1).operationId;
  view.onMessage({ type: "error", message: "저장 실패", operationId });
  assert.equal(view.elements["profile-name"].value, "새구름"); assert.equal(view.elements["profile-name"].focused, true);
  view.elements["profile-form"].listeners.submit({ preventDefault() {} }); const retryId = view.sent.at(-1).operationId;
  view.onMessage({ type: "state", state: next, notice: "공개 별명을 바꿨어요.", operationId: retryId });
  assert.equal(view.elements["manage-dialog-backdrop"].hidden, true); assert.equal(view.elements["profile-row"].focused, true);
  view.elements["profile-row"].onclick();
  let prevented = false; view.elements["manage-dialog-close"].focus();
  view.elements["manage-dialog"].listeners.keydown({ key: "Tab", shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(view.elements["profile-cancel"].focused, true);
  view.elements["manage-dialog"].listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(view.elements["manage-dialog-backdrop"].hidden, true); assert.equal(view.elements["profile-row"].focused, true);
});

test("친구 상세에서 별칭·쪽지·차단·2단 삭제를 처리한다", async () => {
  const view = await harness(); const next = state(); next.friends[0] = { ...next.friends[0], alias: "산책친구", name: "산책친구", publicName: "하늘", hasAlias: true }; view.onMessage({ type: "state", state: next });
  view.elements["friend-list"].children[0].children[0].onclick();
  view.elements["friend-detail-alias"].value = "동네친구"; view.elements["friend-detail-alias"].listeners.input(); view.elements["friend-alias-form"].listeners.submit({ preventDefault() {} });
  assert.deepEqual({ type: view.sent.at(-1).type, alias: view.sent.at(-1).alias }, { type: "updateFriendAlias", alias: "동네친구" });
  const aliasId = view.sent.at(-1).operationId; view.onMessage({ type: "error", message: "별칭 실패", operationId: aliasId }); assert.equal(view.elements["friend-detail-alias"].value, "동네친구");
  view.elements["friend-alias-reset"].onclick(); assert.equal(view.sent.at(-1).alias, null);
  view.onMessage({ type: "error", message: "복원 실패", operationId: view.sent.at(-1).operationId });
  view.elements["friend-block"].onclick(); assert.equal(view.sent.at(-1).type, "blockFriend"); const blockId = view.sent.at(-1).operationId; const blockedCount = view.sent.length; view.elements["friend-block"].onclick(); assert.equal(view.sent.length, blockedCount);
  view.onMessage({ type: "state", state: next, notice: "친구를 차단했어요.", operationId: blockId });
  let count = view.sent.length; view.elements["friend-remove"].onclick(); assert.equal(view.sent.length, count); view.elements["friend-remove"].onclick(); assert.equal(view.sent.at(-1).type, "removeFriend");
  count = view.sent.length; view.elements["friend-remove"].onclick(); view.elements["friend-remove"].onclick(); assert.equal(view.sent.length, count);
  view.elements["friend-message"].onclick(); assert.equal(view.elements["view-detail"].hidden, false); assert.equal(view.elements["detail-name"].textContent, "산책친구");
});

test("모임 생성·상세의 입력과 관리 액션은 dialog 안에서만 동작한다", async () => {
  const view = await harness(); const next = state(); next.groups.push({ id: "g2", name: "독서", owner: false, members: [] }); view.onMessage({ type: "state", state: next });
  view.elements["group-add-trigger"].onclick(); assert.equal(view.elements["group-create-panel"].hidden, false); assert.equal(view.elements["group-name"].focused, true);
  view.elements["group-friend-options"].children[0].children[0].focus(); view.onMessage({ type: "state", state: next }); assert.equal(view.elements["group-friend-options"].children[0].children[0].focused, true);
  view.elements["group-name"].value = "새 모임"; view.elements["group-form"].listeners.submit({ preventDefault() {} }); assert.equal(view.sent.at(-1).type, "createGroup");
  const createId = view.sent.at(-1).operationId; view.onMessage({ type: "state", state: next, notice: "모임을 만들었어요.", operationId: createId }); assert.equal(view.elements["group-add-trigger"].focused, true);
  view.elements["group-list"].children[0].children[0].onclick();
  view.elements["group-rename-name"].value = "🎈".repeat(31); view.elements["group-rename-name"].listeners.input(); const before = view.sent.length; view.elements["group-rename-form"].listeners.submit({ preventDefault() {} }); assert.equal(view.sent.length, before);
  view.elements["group-rename-name"].value = "산책단"; view.elements["group-rename-name"].listeners.input(); view.elements["group-rename-form"].listeners.submit({ preventDefault() {} }); assert.equal(view.sent.at(-1).type, "updateGroup");
  view.onMessage({ type: "error", message: "변경 실패", operationId: view.sent.at(-1).operationId }); assert.equal(view.elements["group-rename-name"].value, "산책단");
  let count = view.sent.length; let kick = view.elements["group-member-list"].children[0].children[1]; kick.focus(); kick.onclick(); assert.equal(view.sent.length, count); kick = view.elements["group-member-list"].children[0].children[1]; assert.equal(kick.focused, true); assert.equal(kick.textContent, "내보내기 확정"); kick.onclick(); assert.equal(view.sent.at(-1).type, "removeGroupMember"); const kickId = view.sent.at(-1).operationId; count = view.sent.length; view.elements["group-member-list"].children[0].children[1].onclick(); assert.equal(view.sent.length, count);
  view.onMessage({ type: "error", message: "내보내기 실패", operationId: kickId });
  count = view.sent.length; view.elements["group-delete"].onclick(); assert.equal(view.sent.length, count); view.elements["group-delete"].onclick(); assert.equal(view.sent.at(-1).type, "deleteGroup"); count = view.sent.length; view.elements["group-delete"].onclick(); assert.equal(view.sent.length, count);
  view.elements["manage-dialog-close"].onclick(); view.elements["group-list"].children[1].children[0].onclick(); count = view.sent.length; view.elements["group-leave"].onclick(); assert.equal(view.sent.length, count); view.elements["group-leave"].onclick(); assert.equal(view.sent.at(-1).type, "leaveGroup"); count = view.sent.length; view.elements["group-leave"].onclick(); assert.equal(view.sent.length, count);
});

test("이전 operation 응답은 새 dialog의 pending과 draft를 바꾸지 않는다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });
  view.elements["profile-row"].onclick(); view.elements["profile-name"].value = "이전"; view.elements["profile-form"].listeners.submit({ preventDefault() {} }); const oldId = view.sent.at(-1).operationId;
  view.elements["manage-dialog-close"].onclick(); view.elements["profile-row"].onclick(); view.elements["profile-name"].value = "현재"; view.elements["profile-form"].listeners.submit({ preventDefault() {} }); const currentId = view.sent.at(-1).operationId;
  view.onMessage({ type: "state", state: next, notice: "공개 별명을 바꿨어요.", operationId: oldId }); assert.equal(view.elements["manage-dialog-backdrop"].hidden, false); assert.equal(view.elements["profile-name"].value, "현재"); assert.equal(view.elements["profile-save"].disabled, true);
  view.onMessage({ type: "error", message: "old", operationId: oldId }); assert.equal(view.elements["profile-save"].disabled, true);
  view.onMessage({ type: "state", state: next, notice: "공개 별명을 바꿨어요.", operationId: currentId }); assert.equal(view.elements["manage-dialog-backdrop"].hidden, true);
});

test("HTML 관리 목록 밖에는 입력이 없고 modal·헤더 아이콘·380px overflow 규칙이 있다", async () => {
  const html = await readFile(new URL("../palette/index.html", import.meta.url), "utf8"); const css = await readFile(new URL("../ui/friend-messages.css", import.meta.url), "utf8");
  assert.match(html, /id="manage-dialog"[^>]*role="dialog"[^>]*aria-modal="true"/u);
  assert.match(html, /id="friend-add-trigger"[^>]*aria-label="친구 추가"[^>]*title="친구 추가"/u);
  assert.match(html, /id="group-add-trigger"[^>]*aria-label="새 모임 만들기"[^>]*title="새 모임 만들기"/u);
  const listMarkup = html.slice(html.indexOf('<section id="view-manage"'), html.indexOf('<div id="manage-dialog-backdrop"'));
  assert.doesNotMatch(listMarkup, /<(?:input|select|textarea)\b/u);
  assert.doesNotMatch(listMarkup, /친구 추가<\/button>|새 모임 만들기<\/summary>/u);
  assert.match(css, /\.management-icon-action\{[^}]*width:44px;[^}]*height:44px/su);
  assert.match(css, /@media\(max-width:395px\)[\s\S]*\.manage-dialog\{width:100%/u);
  assert.match(css, /\.view\{overflow-x:hidden\}/u);
  assert.match(html, /<textarea id="message-body" rows="1" aria-label="쪽지 내용" name="body" autocomplete="off" placeholder="쪽지 쓰기…"/u);
  assert.match(html, /id="anonymous-toggle"[^>]*aria-label="익명으로 보내기: 꺼짐"[^>]*aria-pressed="false"/u);
  assert.match(html, /id="sticker-tray"[^>]*hidden/u);
  assert.doesNotMatch(html, /새 종이 쪽지|<fieldset class="stickers"/u);
  assert.match(css, /\.composer-bar\{[^}]*grid-template-columns:44px minmax\(0,1fr\) 44px 44px/su);
  assert.match(css, /\.detail-view\{[^}]*min-width:0;[^}]*overflow:hidden/su);
  assert.doesNotMatch(css, /transition:\s*all/u);
  assert.match(css, /@media\(prefers-color-scheme:dark\)\{\.management-icon-action:hover\{background:#40354f;color:var\(--ink\)\}\.manage-avatar\{background:#40354f;color:var\(--ink\)\}\}/u);
  const luminance = (hex) => {
    const values = hex.match(/[0-9a-f]{2}/giu).map((part) => Number.parseInt(part, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const light = luminance("f5f0e8"); const dark = luminance("40354f");
  assert.ok((light + 0.05) / (dark + 0.05) >= 4.5);
  assert.match(css, /@media\(prefers-color-scheme:dark\)\{\.composer-icon\.selected,\.thread-avatar\{background:#40354f;color:var\(--ink\)\}/u);
});

test("관리 탭은 친구와 모임 목록을 같은 스크롤 흐름에 노출한다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() }); view.elements["tab-manage"].onclick();
  assert.equal(view.elements["view-manage"].hidden, false); assert.equal(view.elements["tab-manage"].attributes["aria-current"], "page");
  assert.equal(view.elements["friend-list"].children.length, 2); assert.equal(view.elements["group-list"].children.length, 1); assert.equal(view.elements["invite-list"].children.length, 1);
});
