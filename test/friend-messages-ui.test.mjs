import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class FakeElement {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.value = ""; this.textContent = ""; this.hidden = false; this.disabled = false; this.className = ""; this.checked = false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  setCustomValidity(message) { this.validationMessage = message; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
}
const allText = (node) => [node.textContent, ...node.children.map(allText)].join(" ");

async function harness() {
  const views = ["inbox", "compose", "friends", "groups"];
  const ids = ["app", "connect-panel", "connect-google", "workspace", "refresh", "close", "status", "nav-unread", "invite-count", "message-stack", "inbox-empty", "message-form", "target-type", "target-select", "sticker-grid", "message-body", "anonymous-toggle", "counter", "send", "my-code", "friend-form", "friend-code", "friend-alias", "profile-form", "profile-name", "profile-current-name", "friend-list", "friend-empty", "invite-section", "invite-list", "group-form", "group-name", "group-friend-options", "group-list", "group-empty", ...views.flatMap((name) => [`tab-${name}`, `view-${name}`])];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  elements["target-type"].value = "friend";
  const sent = []; let onMessage;
  const window = { dapPalette: { postMessage(message) { sent.push(message); }, onMessage(handler) { onMessage = handler; }, close() {} } };
  const document = { getElementById(id) { return elements[id]; }, createElement(tag) { return new FakeElement(tag); } };
  const source = await readFile(new URL("../ui/friend-messages-ui.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { window, document, Intl, Date, Set });
  return { elements, sent, onMessage };
}

const state = () => ({
  connection: "connected", busy: false, me: { code: "A1B2C3", name: "구름", nameCustomized: true }, maxMessageLength: 100, unreadCount: 2, error: null,
  friends: [{ id: "f1", name: "하늘", alias: "", publicName: "하늘", hasAlias: false, code: "EF3456", blocked: false, unreadCount: 1 }, { id: "f2", name: "바다", alias: "", publicName: "바다", hasAlias: false, code: "AB4567", blocked: false, unreadCount: 0 }],
  groups: [{ id: "g1", name: "산책 모임", owner: true, unreadCount: 1, members: [{ id: "f1", name: "하늘" }, { id: "f2", name: "바다" }] }],
  groupInvites: [{ id: "i1", groupId: "g2", groupName: "점심 모임", inviterName: "구름" }],
  messages: [
    { id: "m1", senderId: "f1", senderName: "하늘", targetType: "friend", targetId: "f1", targetName: "", body: null, stickerId: null, createdAt: new Date().toISOString(), openedAt: null },
    { id: "m2", senderId: "f2", senderName: "바다", targetType: "group", targetId: "g1", targetName: "산책 모임", body: null, stickerId: "cheer", createdAt: new Date().toISOString(), openedAt: null },
  ],
});

test("Google 연결은 사용자가 버튼을 누를 때만 요청한다", async () => {
  const view = await harness();
  view.onMessage({ type: "state", state: { connection: "disconnected", busy: false, friends: [], groups: [], groupInvites: [], messages: [], maxMessageLength: 100 } });
  assert.equal(view.sent.some((item) => item.type === "connectGoogle"), false);
  view.elements["connect-google"].onclick();
  assert.equal(view.sent.at(-1).type, "connectGoogle");
});

test("친구와 공개 별명 입력에는 maxlength 대신 codepoint 검증을 사용한다", async () => {
  const html = await readFile(new URL("../palette/index.html", import.meta.url), "utf8");
  assert.match(html, /id="friend-alias"/u);
  assert.match(html, /id="profile-name"/u);
  assert.doesNotMatch(html, /id="(?:friend-alias|profile-name)"[^>]*maxlength/u);
  assert.match(html, /Google 이름은 공개하지 않으며 이 별명만 친구에게 보입니다/u);
});

test("받은 쪽지는 접힌 봉투로 보이고 클릭할 때만 open 요청을 보낸다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  assert.match(view.elements["message-stack"].children[0].className, /envelope/u);
  assert.match(allText(view.elements["message-stack"]), /산책 모임/u);
  view.elements["message-stack"].children[0].onclick();
  assert.equal(view.sent.at(-1).type, "openMessage"); assert.equal(view.sent.at(-1).messageId, "m1");
});

test("열린 쪽지는 종이와 내장 스티커로 표시한다", async () => {
  const view = await harness(); const next = state();
  next.messages = [{ ...next.messages[1], openedAt: new Date().toISOString(), body: "다 같이 힘내!", stickerId: "cheer" }];
  view.onMessage({ type: "state", state: next });
  assert.match(view.elements["message-stack"].children[0].className, /opened-note/u);
  assert.match(allText(view.elements["message-stack"]), /💪|다 같이 힘내/u);
  assert.match(allText(view.elements["message-stack"]), /잠시 뒤/u);
});

test("친구 또는 모임과 preset sticker ID를 선택해 쪽지를 보낸다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  view.elements["tab-compose"].onclick(); view.elements["target-type"].value = "group"; view.elements["target-type"].onchange();
  view.elements["target-select"].value = "g1"; view.elements["sticker-grid"].children[6].onclick();
  view.elements["message-body"].value = "오늘도 파이팅";
  view.elements["message-form"].listeners.submit({ preventDefault() {} });
  assert.deepEqual({ type: view.sent.at(-1).type, targetType: view.sent.at(-1).targetType, targetId: view.sent.at(-1).targetId, stickerId: view.sent.at(-1).stickerId }, { type: "sendMessage", targetType: "group", targetId: "g1", stickerId: "celebrate" });
  assert.equal(view.sent.at(-1).anonymous, false);
});

test("보낼 수 있는 친구가 한 명이면 자동 선택해 실제 payload를 보낸다", async () => {
  const view = await harness(); const next = state(); next.friends = [next.friends[0]];
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["target-select"].value, "f1");
  assert.equal(view.elements.send.disabled, false);
  assert.equal(view.elements.send.attributes["aria-disabled"], "false");
  view.elements["message-body"].value = "자동 선택 확인";
  view.elements["message-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.at(-1).type, "sendMessage");
  assert.equal(view.sent.at(-1).targetType, "friend");
  assert.equal(view.sent.at(-1).targetId, "f1");
});

test("친구가 여러 명인데 대상을 고르지 않으면 안내하고 전송하지 않는다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  assert.equal(view.elements["target-select"].value, "");
  assert.equal(view.elements.send.disabled, false);
  assert.equal(view.elements.send.attributes["aria-disabled"], "false");
  const initialCount = view.sent.length;
  view.elements["target-select"].listeners.invalid({ preventDefault() {} });
  assert.equal(view.elements.status.textContent, "받는 친구/모임을 선택해 주세요.");
  assert.equal(view.elements["target-select"].attributes["aria-invalid"], "true");
  view.elements["message-body"].value = "선택 전에는 안 가요";
  view.elements["message-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.length, initialCount);
  assert.equal(view.elements.status.textContent, "받는 친구/모임을 선택해 주세요.");
  view.elements["target-select"].value = "f2";
  view.elements["target-select"].onchange();
  assert.equal(view.elements["target-select"].attributes["aria-invalid"], "false");
  assert.equal(view.elements.send.attributes["aria-disabled"], "false");
});

test("익명 토글을 payload에 담고 전송 성공 뒤 해제한다", async () => {
  const view = await harness(); const next = state(); view.onMessage({ type: "state", state: next });
  view.elements["target-select"].value = "f1";
  view.elements["message-body"].value = "응원할게";
  view.elements["anonymous-toggle"].checked = true;
  view.elements["message-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.at(-1).anonymous, true);
  view.onMessage({ type: "state", state: next, sentTo: "friend:f1" });
  assert.equal(view.elements["anonymous-toggle"].checked, false);
});

test("받은 익명 쪽지는 발신자 이름을 노출하지 않고 자연스럽게 안내한다", async () => {
  const view = await harness(); const next = state();
  next.messages = [{ ...next.messages[0], anonymous: true, senderId: "", senderName: "익명의 친구" }];
  view.onMessage({ type: "state", state: next });
  const envelope = view.elements["message-stack"].children[0];
  assert.match(allText(envelope), /익명의 친구/u);
  assert.doesNotMatch(allText(envelope), /하늘/u);
  assert.equal(envelope.attributes["aria-label"], "익명의 친구가 보낸 쪽지 열기");
  assert.doesNotMatch(envelope.attributes["aria-label"], /익명의 친구 님/u);
  next.messages[0] = { ...next.messages[0], openedAt: new Date().toISOString(), body: "비밀 응원" };
  view.onMessage({ type: "state", state: next });
  const opened = view.elements["message-stack"].children[0];
  assert.equal(opened.attributes["aria-label"], "익명의 친구가 보낸 열린 쪽지");
  assert.doesNotMatch(allText(opened), /하늘|익명의 친구 님/u);
});

test("친구 등록 별칭은 20 codepoint를 허용하고 21자는 보존한 채 전송을 막는다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  view.elements["friend-code"].value = "ABC123";
  view.elements["friend-alias"].value = "😀".repeat(21);
  view.elements["friend-alias"].listeners.input();
  const count = view.sent.length;
  view.elements["friend-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.length, count);
  assert.equal(view.elements["friend-alias"].value, "😀".repeat(21));
  assert.equal(view.elements["friend-alias"].attributes["aria-invalid"], "true");
  view.elements["friend-alias"].value = "😀".repeat(20);
  view.elements["friend-alias"].listeners.input();
  view.elements["friend-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.at(-1).type, "addFriend");
  assert.equal(view.sent.at(-1).alias, "😀".repeat(20));
});

test("친구 별칭을 수정하거나 공개 별명으로 되돌릴 수 있다", async () => {
  const view = await harness(); const next = state();
  next.friends[0] = { ...next.friends[0], name: "산책친구", alias: "산책친구", publicName: "하늘", hasAlias: true };
  view.onMessage({ type: "state", state: next });
  const editor = view.elements["friend-list"].children[0].children[2];
  editor.children[0].value = "동네친구";
  editor.children[1].onclick();
  assert.deepEqual({ type: view.sent.at(-1).type, friendId: view.sent.at(-1).friendId, alias: view.sent.at(-1).alias }, { type: "updateFriendAlias", friendId: "f1", alias: "동네친구" });
  editor.children[2].onclick();
  assert.equal(view.sent.at(-1).type, "updateFriendAlias");
  assert.equal(view.sent.at(-1).alias, null);
  next.friends[0] = { ...next.friends[0], name: "하늘", alias: "", publicName: "하늘", hasAlias: false };
  view.onMessage({ type: "state", state: next });
  const restored = view.elements["friend-list"].children[0];
  assert.match(allText(restored.children[0]), /하늘/u);
  assert.equal(restored.children[2].children[0].value, "");
  assert.equal(restored.children[2].children[2].hidden, true);
});

test("친구 별칭과 공개 별명은 Cc/Cf 문자를 즉시 거부한다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  view.elements["friend-code"].value = "ABC123";
  view.elements["friend-alias"].value = "친구\u200B별칭";
  view.elements["friend-alias"].listeners.input();
  const count = view.sent.length;
  view.elements["friend-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.length, count);
  assert.equal(view.elements["friend-alias"].attributes["aria-invalid"], "true");
  assert.match(view.elements["friend-alias"].validationMessage, /제어 문자/u);
  view.elements["profile-name"].value = "공개\n별명";
  view.elements["profile-name"].listeners.input();
  view.elements["profile-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.length, count);
  assert.equal(view.elements["profile-name"].attributes["aria-invalid"], "true");
  assert.match(view.elements["profile-name"].validationMessage, /제어 문자/u);
});

test("내 공개 별명은 현재 값을 표시하고 20 codepoint까지만 전송한다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  assert.equal(view.elements["profile-current-name"].textContent, "구름");
  assert.equal(view.elements["profile-name"].value, "구름");
  view.elements["profile-name"].value = "🌿".repeat(21);
  view.elements["profile-name"].listeners.input();
  const count = view.sent.length;
  view.elements["profile-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.length, count);
  assert.equal(view.elements["profile-name"].value, "🌿".repeat(21));
  view.elements["profile-name"].value = "🌿".repeat(20);
  view.elements["profile-name"].listeners.input();
  view.elements["profile-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.at(-1).type, "updateProfileName");
  assert.equal(view.sent.at(-1).name, "🌿".repeat(20));
});

test("친구 삭제는 같은 친구에서 두 번째 클릭에만 전송한다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() }); view.elements["tab-friends"].onclick();
  const actions = view.elements["friend-list"].children[0].children[1]; const count = view.sent.length;
  actions.children[1].onclick(); assert.equal(view.sent.length, count); assert.equal(actions.children[1].textContent, "삭제");
  const rerendered = view.elements["friend-list"].children[0].children[1].children[1]; assert.equal(rerendered.textContent, "삭제 확정"); rerendered.onclick();
  assert.equal(view.sent.at(-1).type, "removeFriend");
});

test("모임 초대 수락/거절과 owner 전용 관리, 멤버 leave를 노출한다", async () => {
  const view = await harness(); const next = state(); next.groups.push({ id: "g2", name: "독서", owner: false, unreadCount: 0, members: [] }); view.onMessage({ type: "state", state: next });
  const inviteActions = view.elements["invite-list"].children[0].children[1]; inviteActions.children[0].onclick(); assert.equal(view.sent.at(-1).type, "respondGroupInvite"); assert.equal(view.sent.at(-1).accept, true);
  assert.match(allText(view.elements["group-list"].children[0]), /이름 저장|친구 초대|모임 삭제/u);
  const memberActions = view.elements["group-list"].children[1].children.at(-1); assert.match(allText(memberActions), /모임 나가기/u);
});

test("모임 나가기는 같은 모임에서 두 번째 클릭에만 전송한다", async () => {
  const view = await harness(); const next = state();
  next.groups.push({ id: "g2", name: "독서", owner: false, unreadCount: 0, members: [] });
  view.onMessage({ type: "state", state: next });
  const initialCount = view.sent.length;
  view.elements["group-list"].children[1].children[2].children[0].onclick();
  assert.equal(view.sent.length, initialCount);
  const confirm = view.elements["group-list"].children[1].children[2].children[0];
  assert.equal(confirm.textContent, "한 번 더 눌러 나가기");
  assert.equal(confirm.attributes["aria-label"], "독서 모임 나가기 확정");
  confirm.onclick();
  assert.equal(view.sent.at(-1).type, "leaveGroup");
  assert.equal(view.sent.at(-1).groupId, "g2");
  assert.equal(view.elements["group-list"].children[1].children[2].children[0].textContent, "모임 나가기");
});

test("다른 모임 나가기를 누르면 이전 모임의 확인 상태가 초기화된다", async () => {
  const view = await harness(); const next = state();
  next.groups.push(
    { id: "g2", name: "독서", owner: false, unreadCount: 0, members: [] },
    { id: "g3", name: "영화", owner: false, unreadCount: 0, members: [] },
  );
  view.onMessage({ type: "state", state: next });
  const initialCount = view.sent.length;
  view.elements["group-list"].children[1].children[2].children[0].onclick();
  view.elements["group-list"].children[2].children[2].children[0].onclick();
  assert.equal(view.sent.length, initialCount);
  assert.equal(view.elements["group-list"].children[1].children[2].children[0].textContent, "모임 나가기");
  assert.equal(view.elements["group-list"].children[2].children[2].children[0].textContent, "한 번 더 눌러 나가기");
});

test("새 state를 받으면 모임 나가기 확인이 초기화된다", async () => {
  const view = await harness(); const next = state();
  next.groups.push({ id: "g2", name: "독서", owner: false, unreadCount: 0, members: [] });
  view.onMessage({ type: "state", state: next });
  view.elements["group-list"].children[1].children[2].children[0].onclick();
  assert.equal(view.elements["group-list"].children[1].children[2].children[0].textContent, "한 번 더 눌러 나가기");
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["group-list"].children[1].children[2].children[0].textContent, "모임 나가기");
});

test("모임 삭제는 같은 그룹에서 두 번째 클릭에만 전송하고 다른 그룹을 누르면 초기화된다", async () => {
  const view = await harness();
  const next = state();
  next.groups.push({ id: "g2", name: "독서 모임", owner: true, unreadCount: 0, members: [] });
  view.onMessage({ type: "state", state: next });
  const initialCount = view.sent.length;
  view.elements["group-list"].children[0].children[2].children[4].onclick();
  assert.equal(view.sent.length, initialCount);
  assert.equal(view.elements["group-list"].children[0].children[2].children[4].textContent, "한 번 더 눌러 삭제");
  view.elements["group-list"].children[1].children[2].children[4].onclick();
  assert.equal(view.elements["group-list"].children[0].children[2].children[4].textContent, "모임 삭제");
  const g2Delete = view.elements["group-list"].children[1].children[2].children[4];
  assert.equal(g2Delete.attributes["aria-label"], "독서 모임 모임 삭제 확정");
  g2Delete.onclick();
  assert.equal(view.sent.at(-1).type, "deleteGroup");
  assert.equal(view.sent.at(-1).groupId, "g2");
});

test("새 state를 받으면 모임 삭제 확인이 초기화된다", async () => {
  const view = await harness(); const next = state();
  view.onMessage({ type: "state", state: next });
  view.elements["group-list"].children[0].children[2].children[4].onclick();
  assert.equal(view.elements["group-list"].children[0].children[2].children[4].textContent, "한 번 더 눌러 삭제");
  view.onMessage({ type: "state", state: next });
  assert.equal(view.elements["group-list"].children[0].children[2].children[4].textContent, "모임 삭제");
});

test("멤버 내보내기도 같은 멤버에서 두 번째 클릭에만 전송한다", async () => {
  const view = await harness(); const next = state(); next.me.id = "owner";
  view.onMessage({ type: "state", state: next });
  const count = view.sent.length;
  view.elements["group-list"].children[0].children[1].children[0].children[1].onclick();
  assert.equal(view.sent.length, count);
  const confirm = view.elements["group-list"].children[0].children[1].children[0].children[1];
  assert.equal(confirm.textContent, "내보내기 확정");
  confirm.onclick();
  assert.equal(view.sent.at(-1).type, "removeGroupMember");
  assert.equal(view.sent.at(-1).memberId, "f1");
});

test("이모지 쪽지는 codepoint 100자를 허용하고 101자는 자르지 않은 채 전송을 막는다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  view.elements["target-select"].value = "f1";
  view.elements["message-body"].value = "😀".repeat(101);
  view.elements["message-body"].listeners.input();
  const count = view.sent.length;
  view.elements["message-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.length, count);
  assert.equal(view.elements["message-body"].value, "😀".repeat(101));
  assert.equal(view.elements["message-body"].attributes["aria-invalid"], "true");
  assert.match(view.elements["message-body"].validationMessage, /100자/u);
  view.elements["message-body"].value = "😀".repeat(100);
  view.elements["message-body"].listeners.input();
  view.elements["message-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.at(-1).type, "sendMessage");
  assert.equal(view.sent.at(-1).body, "😀".repeat(100));
});

test("모임 생성과 이름 변경은 codepoint 30자 초과 시 입력을 보존하고 전송을 막는다", async () => {
  const view = await harness(); view.onMessage({ type: "state", state: state() });
  view.elements["group-name"].value = "🎈".repeat(31);
  view.elements["group-name"].listeners.input();
  const count = view.sent.length;
  view.elements["group-form"].listeners.submit({ preventDefault() {} });
  assert.equal(view.sent.length, count);
  assert.equal(view.elements["group-name"].value, "🎈".repeat(31));
  assert.equal(view.elements["group-name"].attributes["aria-invalid"], "true");
  const rename = view.elements["group-list"].children[0].children[2].children[0];
  const save = view.elements["group-list"].children[0].children[2].children[1];
  rename.value = "🎈".repeat(31); rename.listeners.input(); save.onclick();
  assert.equal(view.sent.length, count);
  assert.equal(rename.attributes["aria-invalid"], "true");
  rename.value = "🎈".repeat(30); rename.listeners.input(); save.onclick();
  assert.equal(view.sent.at(-1).type, "updateGroup");
  assert.equal(view.sent.at(-1).name, "🎈".repeat(30));
});
