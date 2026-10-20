import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {};
    this.value = ""; this.textContent = ""; this.hidden = false; this.disabled = false;
    this.className = ""; this.checked = false; this.focused = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  setCustomValidity(message) { this.validationMessage = message; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  focus() { this.focused = true; }
}

const allText = (node) => [node.textContent, ...node.children.map(allText)].join(" ");
let harnessSequence = 0;

async function harness() {
  const views = ["home", "manage"];
  const ids = [
    "app", "connect-panel", "connect-google", "workspace", "refresh", "close", "status", "nav-unread",
    "invite-count", "anonymous-thread-section", "anonymous-thread-list", "friend-thread-list", "group-thread-list", "contact-empty", "view-detail", "detail-back",
    "detail-kind", "detail-name", "detail-unread", "message-stack", "inbox-empty", "message-form", "composer-hint",
    "sticker-grid", "message-body", "anonymous-toggle", "counter", "send", "my-code", "friend-add-toggle", "friend-form", "friend-code",
    "friend-alias", "friend-add-submit", "friend-add-cancel", "profile-edit-toggle", "profile-form", "profile-name", "profile-current-name", "profile-save", "profile-cancel", "friend-list", "friend-empty",
    "invite-section", "invite-list", "group-form", "group-name", "group-friend-options", "group-list", "group-empty",
    ...views.flatMap((name) => [`tab-${name}`, `view-${name}`]),
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  const sent = [];
  let onMessage;
  const session = (++harnessSequence).toString(16).padStart(12, "0");
  const crypto = { randomUUID() { return `${session.slice(0, 8)}-${session.slice(8)}-4000-8000-000000000000`; } };
  const window = { dapPalette: { postMessage(message) { sent.push(message); }, onMessage(handler) { onMessage = handler; }, close() {} } };
  const document = { getElementById(id) { return elements[id]; }, createElement(tag) { return new FakeElement(tag); } };
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
    { id: "m1", anonymous: false, senderId: "f1", senderName: "하늘", targetType: "friend", targetId: "f1", body: null, stickerId: null, createdAt: new Date().toISOString(), openedAt: null },
    { id: "m2", anonymous: false, senderId: "f2", senderName: "바다", targetType: "group", targetId: "g1", body: null, stickerId: "cheer", createdAt: new Date().toISOString(), openedAt: null },
  ],
});

test("Google 연결은 사용자가 버튼을 누를 때만 요청한다", async () => {
  const view = await harness();
  view.onMessage({ type: "state", state: { connection: "disconnected", busy: false, friends: [], groups: [], groupInvites: [], messages: [], maxMessageLength: 100 } });
  assert.equal(view.sent.some((item) => item.type === "connectGoogle"), false);
  view.elements["connect-google"].onclick();
  assert.equal(view.sent.at(-1).type, "connectGoogle");
});

test("기본 화면은 친구와 모임 연락처 목록이며 상세에서 받은 쪽지만 필터링한다", async () => {
  const view = await harness();
  view.onMessage({ type: "state", state: state() });
  assert.equal(view.elements["view-home"].hidden, false);
  assert.equal(view.elements["friend-thread-list"].children.length, 2);
  assert.equal(view.elements["group-thread-list"].children.length, 1);
  view.elements["friend-thread-list"].children[0].children[0].onclick();
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
  view.elements["friend-thread-list"].children[0].children[0].onclick();
  view.elements["sticker-grid"].children[6].onclick();
  view.elements["message-body"].value = "오늘도 파이팅";
  view.elements["anonymous-toggle"].checked = true;
  view.elements["message-form"].listeners.submit({ preventDefault() {} });
  assert.deepEqual(
    { type: view.sent.at(-1).type, targetType: view.sent.at(-1).targetType, targetId: view.sent.at(-1).targetId, stickerId: view.sent.at(-1).stickerId, anonymous: view.sent.at(-1).anonymous },
    { type: "sendMessage", targetType: "friend", targetId: "f1", stickerId: "celebrate", anonymous: true },
  );
  view.onMessage({ type: "state", state: next, sentTo: "friend:f1" });
  assert.equal(view.elements["anonymous-toggle"].checked, false);
  assert.equal(view.elements["message-body"].value, "");
});

test("모임 상세는 해당 모임 쪽지만 보여 주고 group payload를 보낸다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  view.elements["group-thread-list"].children[0].children[0].onclick();
  assert.equal(view.elements["detail-name"].textContent, "산책 모임");
  assert.equal(view.elements["message-stack"].children.length, 1);
  view.elements["message-body"].value = "모임 쪽지";
  view.elements["message-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.at(-1).targetType, "group");
  assert.equal(view.sent.at(-1).targetId, "g1");
});

test("목록으로 돌아가면 열었던 연락처 행에 초점을 복원한다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  const button = view.elements["friend-thread-list"].children[1].children[0];
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
  assert.equal(view.elements["anonymous-thread-section"].hidden, false);
  assert.match(allText(view.elements["anonymous-thread-list"].children[0]), /익명 쪽지/u);
  assert.equal(allText(view.elements["friend-thread-list"].children[0]).includes("2"), false);
  view.elements["anonymous-thread-list"].children[0].children[0].onclick();
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
  view.elements["anonymous-thread-list"].children[0].children[0].onclick();
  next.messages[0] = { ...next.messages[0], openedAt: new Date().toISOString(), body: "응원" };
  next.unreadCount = 0;
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["anonymous-thread-section"].hidden, true);
  view.elements["detail-back"].onclick();
  assert.equal(view.elements["tab-home"].focused, true);
});

test("익명 모임 쪽지는 groupId로 모임 상세에만 귀속한다", async () => {
  const view = await harness(); const next = state();
  next.messages = [{ id: "ag1", anonymous: true, senderId: "", senderName: "익명의 친구", targetType: "group", targetId: "g1", body: null, stickerId: null, createdAt: new Date().toISOString(), openedAt: null }];
  next.unreadCount = 1;
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["anonymous-thread-section"].hidden, true);
  assert.equal(view.elements["friend-thread-list"].children.length, 2);
  view.elements["group-thread-list"].children[0].children[0].onclick();
  assert.equal(view.elements["message-stack"].children.length, 1);
  assert.match(allText(view.elements["message-stack"]), /익명의 친구/u);
});

test("열린 쪽지는 종이로 표시하고 익명 aria 문구에서 어색한 조사를 쓰지 않는다", async () => {
  const view = await harness(); const next = state();
  next.messages = [{ id: "anon1", anonymous: true, senderId: "", senderName: "익명의 친구", targetType: "friend", targetId: "", openedAt: new Date().toISOString(), body: "비밀 응원", stickerId: "cheer", createdAt: new Date().toISOString() }];
  next.unreadCount = 0;
  // 열린 익명 쪽지는 이미 pseudo-thread가 사라져야 하므로 일반 렌더에 재노출하지 않는다.
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["anonymous-thread-section"].hidden, true);
  assert.equal(view.elements["friend-thread-list"].children.length, 2);

  next.messages[0].openedAt = null;
  next.unreadCount = 1;
  view.onMessage({ type: "state", state: next });
  view.elements["anonymous-thread-list"].children[0].children[0].onclick();
  next.messages[0].openedAt = new Date().toISOString();
  view.onMessage({ type: "state", state: next });
  const opened = view.elements["message-stack"].children[0];
  assert.match(opened.className, /opened-note/u);
  assert.equal(opened.attributes["aria-label"], "익명의 친구가 보낸 열린 쪽지");
  assert.doesNotMatch(allText(opened), /익명의 친구 님/u);
});

test("이모지 쪽지는 100 codepoint를 허용하고 101자는 자르지 않은 채 막는다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  view.elements["friend-thread-list"].children[0].children[0].onclick();
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

test("친구 별칭과 공개 별명은 codepoint 20자와 Cc/Cf 규칙을 지킨다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  view.elements["friend-add-toggle"].onclick();
  view.elements["friend-code"].value = "ABC123";
  view.elements["friend-alias"].value = "😀".repeat(21);
  view.elements["friend-alias"].listeners.input();
  const count = view.sent.length;
  view.elements["friend-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.length, count);
  assert.equal(view.elements["friend-alias"].value, "😀".repeat(21));
  view.elements["friend-alias"].value = "친구\u200B별칭";
  view.elements["friend-alias"].listeners.input();
  assert.match(view.elements["friend-alias"].validationMessage, /제어 문자/u);
  view.elements["profile-edit-toggle"].onclick();
  view.elements["profile-name"].value = "🌿".repeat(20);
  view.elements["profile-name"].listeners.input();
  view.elements["profile-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.at(-1).type, "updateProfileName");
});

test("친구 별칭을 수정하거나 공개 별명으로 되돌릴 수 있다", async () => {
  const view = await harness(); const next = state();
  next.friends[0] = { ...next.friends[0], name: "산책친구", alias: "산책친구", publicName: "하늘", hasAlias: true };
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["friend-list"].children[0].children.length, 2);
  assert.equal(view.elements["friend-list"].children[0].children[1].children[2].attributes["aria-expanded"], "false");
  view.elements["friend-list"].children[0].children[1].children[2].onclick();
  const editor = view.elements["friend-list"].children[0].children[2];
  assert.equal(view.elements["friend-list"].children[0].children[1].children[2].attributes["aria-expanded"], "true");
  assert.equal(editor.children[0].focused, true);
  editor.children[0].value = "동네친구"; editor.children[0].listeners.input(); editor.children[1].onclick();
  assert.equal(view.sent.at(-1).alias, "동네친구");
  const saveOperationId = view.sent.at(-1).operationId;
  next.friends[0] = { ...next.friends[0], name: "동네친구", alias: "동네친구" };
  view.onMessage({ type: "state", state: next, notice: "친구 별칭을 바꿨어요.", operationId: saveOperationId });
  assert.equal(view.elements["friend-list"].children[0].children.length, 2);
  assert.equal(view.elements["friend-list"].children[0].children[1].children[2].focused, true);
  view.elements["friend-list"].children[0].children[1].children[2].onclick();
  view.elements["friend-list"].children[0].children[2].children[2].onclick();
  assert.equal(view.sent.at(-1).alias, null);
  const resetOperationId = view.sent.at(-1).operationId;
  next.friends[0] = { ...next.friends[0], name: "하늘", alias: "", publicName: "하늘", hasAlias: false };
  view.onMessage({ type: "state", state: next, notice: "공개 별명으로 되돌렸어요.", operationId: resetOperationId });
  assert.equal(view.elements["friend-list"].children[0].children.length, 2);
  view.elements["friend-list"].children[0].children[1].children[2].onclick();
  view.elements["friend-list"].children[0].children[2].children[3].onclick();
  assert.equal(view.elements["friend-list"].children[0].children.length, 2);
  assert.equal(view.elements["friend-list"].children[0].children[1].children[2].focused, true);
});

test("프로필은 기본 카드에서 수정할 때만 편집하고 성공·취소 뒤 수정 버튼으로 초점을 복원한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["profile-form"].hidden, true);
  assert.equal(view.elements["profile-edit-toggle"].attributes["aria-expanded"], "false");
  view.elements["profile-edit-toggle"].onclick();
  assert.equal(view.elements["profile-form"].hidden, false);
  assert.equal(view.elements["profile-name"].focused, true);
  view.elements["profile-name"].value = "새구름"; view.elements["profile-name"].listeners.input();
  view.elements["profile-form"].listeners.submit({ preventDefault() {} });
  assert.deepEqual({ type: view.sent.at(-1).type, name: view.sent.at(-1).name }, { type: "updateProfileName", name: "새구름" });
  let operationId = view.sent.at(-1).operationId;
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["profile-form"].hidden, false);
  assert.equal(view.elements["profile-name"].value, "새구름");
  view.onMessage({ type: "error", message: "공개 별명을 저장하지 못했어요.", operationId });
  assert.equal(view.elements["profile-form"].hidden, false);
  assert.equal(view.elements["profile-name"].value, "새구름");
  assert.match(view.elements.status.textContent, /저장하지 못했어요/u);
  view.elements["profile-form"].listeners.submit({ preventDefault() {} });
  operationId = view.sent.at(-1).operationId;
  next.me.name = "새구름";
  view.onMessage({ type: "state", state: next, notice: "공개 별명을 바꿨어요.", operationId });
  assert.equal(view.elements["profile-form"].hidden, true);
  assert.equal(view.elements["profile-edit-toggle"].focused, true);

  view.elements["profile-edit-toggle"].onclick();
  view.elements["profile-name"].value = "🌿".repeat(21); view.elements["profile-name"].listeners.input();
  assert.match(view.elements["profile-name"].validationMessage, /20자/u);
  view.elements["profile-cancel"].onclick();
  assert.equal(view.elements["profile-form"].hidden, true);
  assert.equal(view.elements["profile-edit-toggle"].focused, true);
  view.elements["profile-edit-toggle"].onclick();
  assert.equal(view.elements["profile-name"].validationMessage, "");
  assert.equal(view.elements["profile-name"].attributes["aria-invalid"], "false");
});

test("친구 추가는 요청 성공 때만 닫고 초기화하며 실패 시 입력을 보존한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["friend-form"].hidden, true);
  view.elements["friend-add-toggle"].onclick();
  assert.equal(view.elements["friend-add-toggle"].attributes["aria-expanded"], "true");
  assert.equal(view.elements["friend-code"].focused, true);
  view.elements["friend-code"].value = "ABC123"; view.elements["friend-code"].listeners.input();
  view.elements["friend-alias"].value = "새친구"; view.elements["friend-alias"].listeners.input();
  view.elements["friend-form"].listeners.submit({ preventDefault() {} });
  let operationId = view.sent.at(-1).operationId;
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["friend-form"].hidden, false);
  assert.equal(view.elements["friend-code"].value, "ABC123");
  assert.equal(view.elements["friend-alias"].value, "새친구");
  view.onMessage({ type: "error", message: "이미 연결된 친구예요.", operationId });
  assert.equal(view.elements["friend-form"].hidden, false);
  assert.equal(view.elements["friend-code"].value, "ABC123");
  assert.equal(view.elements["friend-alias"].value, "새친구");
  assert.match(view.elements.status.textContent, /이미 연결/u);
  view.elements["friend-form"].listeners.submit({ preventDefault() {} });
  operationId = view.sent.at(-1).operationId;
  view.onMessage({ type: "state", state: next, notice: "친구를 연결했어요.", operationId });
  assert.equal(view.elements["friend-form"].hidden, true);
  assert.equal(view.elements["friend-code"].value, "");
  assert.equal(view.elements["friend-add-toggle"].focused, true);
  view.elements["friend-add-toggle"].onclick();
  view.elements["friend-alias"].value = "😀".repeat(21); view.elements["friend-alias"].listeners.input();
  assert.match(view.elements["friend-alias"].validationMessage, /20자/u);
  view.elements["friend-add-cancel"].onclick();
  assert.equal(view.elements["friend-form"].hidden, true);
  assert.equal(view.elements["friend-add-toggle"].focused, true);
  view.elements["friend-add-toggle"].onclick();
  assert.equal(view.elements["friend-alias"].validationMessage, "");
  assert.equal(view.elements["friend-alias"].attributes["aria-invalid"], "false");
});

test("다른 친구의 별칭 수정을 열면 이전 편집을 닫고 오류 시 현재 초안을 보존한다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  view.elements["friend-list"].children[0].children[1].children[2].onclick();
  view.elements["friend-list"].children[0].children[2].children[0].value = "첫 초안";
  view.elements["friend-list"].children[0].children[2].children[0].listeners.input();
  view.elements["friend-list"].children[1].children[1].children[2].onclick();
  assert.equal(view.elements["friend-list"].children[0].children.length, 2);
  const secondEditor = view.elements["friend-list"].children[1].children[2];
  secondEditor.children[0].value = "둘째 초안"; secondEditor.children[0].listeners.input(); secondEditor.children[1].onclick();
  const operationId = view.sent.at(-1).operationId;
  view.onMessage({ type: "state", state: state() });
  assert.equal(view.elements["friend-list"].children[1].children[2].children[0].value, "둘째 초안");
  view.onMessage({ type: "error", message: "별칭을 저장하지 못했어요.", operationId });
  assert.equal(view.elements["friend-list"].children[1].children[2].children[0].value, "둘째 초안");
  assert.match(view.elements.status.textContent, /저장하지 못했어요/u);
});

test("프로필·친구 추가·친구 별칭 중 하나만 열고 이전 요청의 늦은 성공 응답을 무시한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });

  view.elements["profile-edit-toggle"].onclick();
  view.elements["profile-name"].value = "프로필 초안"; view.elements["profile-name"].listeners.input();
  view.elements["profile-form"].listeners.submit({ preventDefault() {} });
  const abandonedProfileOperationId = view.sent.at(-1).operationId;
  view.elements["friend-add-toggle"].onclick();
  assert.equal(view.elements["profile-form"].hidden, true);
  assert.equal(view.elements["profile-edit-toggle"].attributes["aria-expanded"], "false");
  assert.equal(view.elements["friend-form"].hidden, false);
  view.onMessage({ type: "state", state: next, notice: "공개 별명을 바꿨어요.", operationId: abandonedProfileOperationId });
  assert.equal(view.elements["friend-form"].hidden, false);

  view.elements["friend-code"].value = "ABC123"; view.elements["friend-code"].listeners.input();
  view.elements["friend-alias"].value = "추가 초안"; view.elements["friend-alias"].listeners.input();
  view.elements["friend-form"].listeners.submit({ preventDefault() {} });
  const abandonedAddOperationId = view.sent.at(-1).operationId;
  view.elements["friend-list"].children[0].children[1].children[2].onclick();
  assert.equal(view.elements["friend-form"].hidden, true);
  assert.equal(view.elements["friend-add-toggle"].attributes["aria-expanded"], "false");
  assert.equal(view.elements["friend-list"].children[0].children.length, 3);
  view.onMessage({ type: "state", state: next, notice: "친구를 연결했어요.", operationId: abandonedAddOperationId });
  assert.equal(view.elements["friend-list"].children[0].children.length, 3);

  const aliasEditor = view.elements["friend-list"].children[0].children[2];
  aliasEditor.children[0].value = "별칭 초안"; aliasEditor.children[0].listeners.input(); aliasEditor.children[1].onclick();
  const abandonedAliasOperationId = view.sent.at(-1).operationId;
  view.elements["profile-edit-toggle"].onclick();
  assert.equal(view.elements["friend-list"].children[0].children.length, 2);
  assert.equal(view.elements["profile-form"].hidden, false);
  assert.equal(view.elements["profile-name"].focused, true);
  view.onMessage({ type: "state", state: next, notice: "친구 별칭을 바꿨어요.", operationId: abandonedAliasOperationId });
  assert.equal(view.elements["profile-form"].hidden, false);
});

test("같은 편집기를 다시 연 뒤 이전 성공·오류가 새 요청 상태를 바꾸지 않는다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });

  view.elements["profile-edit-toggle"].onclick();
  view.elements["profile-name"].value = "이전 요청"; view.elements["profile-name"].listeners.input();
  view.elements["profile-form"].listeners.submit({ preventDefault() {} });
  const oldOperationId = view.sent.at(-1).operationId;
  view.elements["friend-add-toggle"].onclick();
  view.elements["profile-edit-toggle"].onclick();
  view.elements["profile-name"].value = "현재 요청"; view.elements["profile-name"].listeners.input();
  view.elements["profile-form"].listeners.submit({ preventDefault() {} });
  const currentOperationId = view.sent.at(-1).operationId;

  view.onMessage({ type: "state", state: next, notice: "공개 별명을 바꿨어요.", operationId: oldOperationId });
  assert.equal(view.elements["profile-form"].hidden, false);
  assert.equal(view.elements["profile-name"].value, "현재 요청");
  assert.equal(view.elements["profile-save"].disabled, true);
  view.onMessage({ type: "error", message: "이전 요청 오류", operationId: oldOperationId });
  assert.equal(view.elements["profile-save"].disabled, true);
  assert.equal(view.elements["profile-name"].value, "현재 요청");
  view.onMessage({ type: "state", state: next, notice: "공개 별명을 바꿨어요.", operationId: currentOperationId });
  assert.equal(view.elements["profile-form"].hidden, true);
});

test("팔레트를 다시 열어도 편집 요청 ID가 이전 문서와 충돌하지 않는다", async () => {
  const first = await harness(); const second = await harness();
  for (const view of [first, second]) {
    view.onMessage({ type: "state", state: state() });
    view.elements["profile-edit-toggle"].onclick();
    view.elements["profile-name"].value = "구름";
    view.elements["profile-name"].listeners.input();
    view.elements["profile-form"].listeners.submit({ preventDefault() {} });
  }
  const firstId = first.sent.at(-1).operationId;
  const secondId = second.sent.at(-1).operationId;
  assert.match(firstId, /^[A-Za-z0-9_-]{1,64}$/u);
  assert.match(secondId, /^[A-Za-z0-9_-]{1,64}$/u);
  assert.notEqual(firstId, secondId);
});

test("친구 삭제와 모임 삭제/나가기/내보내기는 두 번째 확인에서만 전송한다", async () => {
  const view = await harness(); const next = state();
  next.groups.push({ id: "g2", name: "독서", owner: false, members: [] });
  view.onMessage({ type: "state", state: next });
  let count = view.sent.length;
  view.elements["friend-list"].children[0].children[1].children[1].onclick();
  assert.equal(view.sent.length, count);
  view.elements["friend-list"].children[0].children[1].children[1].onclick();
  assert.equal(view.sent.at(-1).type, "removeFriend");

  count = view.sent.length;
  view.elements["group-list"].children[0].children[2].children[4].onclick();
  assert.equal(view.sent.length, count);
  view.elements["group-list"].children[0].children[2].children[4].onclick();
  assert.equal(view.sent.at(-1).type, "deleteGroup");

  count = view.sent.length;
  view.elements["group-list"].children[1].children[2].children[0].onclick();
  assert.equal(view.sent.length, count);
  view.elements["group-list"].children[1].children[2].children[0].onclick();
  assert.equal(view.sent.at(-1).type, "leaveGroup");

  count = view.sent.length;
  view.elements["group-list"].children[0].children[1].children[0].children[1].onclick();
  assert.equal(view.sent.length, count);
  view.elements["group-list"].children[0].children[1].children[0].children[1].onclick();
  assert.equal(view.sent.at(-1).type, "removeGroupMember");
  assert.equal(view.sent.at(-1).memberId, "f1");
});

test("새 state는 파괴 작업 확인을 초기화하고 모임 이름 30 codepoint를 검증한다", async () => {
  const view = await harness(); const next = state();
  view.onMessage({ type: "state", state: next });
  view.elements["group-list"].children[0].children[2].children[4].onclick();
  assert.match(view.elements["group-list"].children[0].children[2].children[4].textContent, /한 번 더/u);
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["group-list"].children[0].children[2].children[4].textContent, "모임 삭제");
  const rename = view.elements["group-list"].children[0].children[2].children[0];
  const save = view.elements["group-list"].children[0].children[2].children[1];
  rename.value = "🎈".repeat(31); rename.listeners.input();
  const count = view.sent.length; save.onclick();
  assert.equal(view.sent.length, count);
  rename.value = "🎈".repeat(30); rename.listeners.input(); save.onclick();
  assert.equal(view.sent.at(-1).type, "updateGroup");
});

test("HTML은 쪽지와 통합 관리 2탭, semantic 관리 섹션, maxlength 없는 Unicode 입력을 제공한다", async () => {
  const html = await readFile(new URL("../palette/index.html", import.meta.url), "utf8");
  assert.match(html, /id="friend-thread-list"/u);
  assert.match(html, /id="group-thread-list"/u);
  assert.match(html, /id="view-detail"/u);
  assert.match(html, /친구 관리/u);
  assert.match(html, /모임 관리/u);
  assert.match(html, /id="tab-manage"[^>]*aria-controls="view-manage"/u);
  assert.match(html, /id="view-manage"[^>]*aria-labelledby="manage-title"/u);
  assert.match(html, /<section class="management-section" aria-labelledby="friends-title">/u);
  assert.match(html, /<section class="management-section" aria-labelledby="groups-title">/u);
  assert.match(html, /id="profile-edit-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="profile-form"/u);
  assert.match(html, /id="friend-add-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="friend-form"/u);
  assert.doesNotMatch(html, /id="tab-(?:friends|groups)"|id="view-(?:friends|groups)"/u);
  assert.match(html, /익명으로 보내기/u);
  assert.doesNotMatch(html, /id="(?:message-body|friend-alias|profile-name|group-name)"[^>]*maxlength/u);
});

test("관리 탭 하나에서 친구와 모임 기능을 같은 스크롤 화면에 함께 노출한다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  view.elements["tab-manage"].onclick();
  assert.equal(view.elements["view-home"].hidden, true);
  assert.equal(view.elements["view-manage"].hidden, false);
  assert.equal(view.elements["tab-manage"].attributes["aria-current"], "page");
  assert.equal(view.elements["friend-list"].children.length, 2);
  assert.equal(view.elements["group-list"].children.length, 1);
  assert.equal(view.elements["invite-list"].children.length, 1);
});
