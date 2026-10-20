import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.value = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.className = "";
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
}

function allText(node) {
  return [node.textContent, ...node.children.map(allText)].join(" ");
}

async function harness() {
  const ids = [
    "app", "connect-panel", "connect-google", "workspace", "my-code", "friend-form", "friend-code",
    "message-form", "friend-select", "message-body", "counter", "send", "message-list", "inbox-empty",
    "unread", "friend-list", "friend-empty", "friend-count", "status", "refresh", "close",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement()]));
  const sent = [];
  let onMessage;
  const window = {
    dapPalette: {
      postMessage(message) { sent.push(message); },
      onMessage(handler) { onMessage = handler; },
      close() {},
    },
  };
  const document = {
    getElementById(id) { return elements[id]; },
    createElement(tag) { return new FakeElement(tag); },
  };
  const source = await readFile(new URL("../ui/friend-messages-ui.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { window, document, Intl, Date });
  return { elements, sent, onMessage };
}

test("연결 전 Google 버튼을 명시적으로 누를 때만 connect 요청을 보낸다", async () => {
  const view = await harness();
  view.onMessage({ type: "state", state: { connection: "disconnected", busy: false, me: {}, friends: [], messages: [], maxMessageLength: 100 } });
  assert.equal(view.elements["connect-panel"].hidden, false);
  assert.equal(view.elements.workspace.hidden, true);
  assert.equal(view.sent.some((message) => message.type === "connectGoogle"), false);
  view.elements["connect-google"].onclick();
  assert.equal(view.sent.at(-1).type, "connectGoogle");
});

test("닫힌 쪽지는 본문 없이 메타데이터만 렌더링하고 open 요청을 보낸다", async () => {
  const view = await harness();
  view.onMessage({ type: "state", state: {
    connection: "connected", busy: false, me: { code: "A1B2C3" }, maxMessageLength: 100,
    unreadCount: 1, lastSyncedAt: Date.now(), error: null,
    friends: [{ id: "f1", name: "<친구>", code: "EF3456", unreadCount: 1, blocked: false }],
    messages: [{ id: "m1", senderName: "<친구>", body: null, createdAt: new Date().toISOString(), openedAt: null }],
  } });
  assert.equal(view.elements["my-code"].textContent, "A1B2C3");
  assert.match(allText(view.elements["friend-list"]), /<친구>/u);
  assert.doesNotMatch(allText(view.elements["message-list"]), /비밀|본문/u);
  view.elements["message-list"].children[0].children[0].onclick();
  assert.equal(view.sent.at(-1).type, "openMessage");
  assert.equal(view.sent.at(-1).messageId, "m1");
});

test("열린 쪽지는 서버가 돌려준 본문과 만료 안내를 표시한다", async () => {
  const view = await harness();
  view.onMessage({ type: "state", state: {
    connection: "connected", busy: false, me: { code: "A1B2C3" }, maxMessageLength: 100,
    unreadCount: 0, friends: [], error: null,
    messages: [{ id: "m1", senderName: "하늘", body: "오늘 산책할래?", createdAt: new Date().toISOString(), openedAt: new Date().toISOString() }],
  } });
  assert.match(allText(view.elements["message-list"]), /오늘 산책할래\?/u);
  assert.match(allText(view.elements["message-list"]), /잠시 뒤/u);
});

test("친구 차단·해제·삭제 요청을 UI에서 보낼 수 있다", async () => {
  const view = await harness();
  view.onMessage({ type: "state", state: {
    connection: "connected", busy: false, me: { code: "A1B2C3" }, maxMessageLength: 100,
    unreadCount: 0, messages: [], error: null,
    friends: [{ id: "f1", name: "하늘", code: "EF3456", unreadCount: 0, blocked: true }],
  } });
  const actions = view.elements["friend-list"].children[0].children[2];
  actions.children[0].onclick();
  assert.equal(view.sent.at(-1).type, "unblockFriend");
  actions.children[1].onclick();
  assert.equal(view.sent.at(-1).type, "removeFriend");
});
