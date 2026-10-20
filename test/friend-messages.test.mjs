import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { activate, __test } from "../dap_friend_messages/plugin.mjs";

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test("polling interval은 한 곳에서만 만들고 재시작 전에 기존 timer를 정리한다", async () => {
  const source = await readFile(new URL("../dap_friend_messages/plugin.mjs", import.meta.url), "utf8");
  assert.equal(source.match(/\bsetInterval\s*\(/gu)?.length, 1);
  assert.match(source, /const startPolling = \(\) => \{\s*stopPolling\(\);[\s\S]*pollTimer = setInterval/u);
  assert.match(source, /while \(seenMessageIds\.size > limit\)/u, "알림 ID 집합은 capped recent-ID cache여야 한다");
});

test("최종 Edge endpoint와 공개 키, action allowlist를 고정한다", () => {
  assert.equal(__test.EDGE_URL, "https://vowrjkctldqxizvleogd.supabase.co/functions/v1/friend-messages");
  assert.equal(__test.PUBLISHABLE_KEY, "sb_publishable_Dgxv-IINi9MZLWRYnQAuug_MmvlpXsl");
  assert.deepEqual([...__test.ALLOWED_ACTIONS], ["state", "connect", "updateFriendAlias", "updateProfileName", "open", "remove", "block", "unblock", "sendMessage", "createGroup", "updateGroup", "inviteGroup", "respondGroupInvite", "removeGroupMember", "leaveGroup", "deleteGroup"]);
  assert.deepEqual([...__test.STICKER_IDS], ["smile", "cheer", "love", "surprise", "sulk", "cry", "celebrate", "tired"]);
  assert.deepEqual([...__test.OAUTH_SCOPES], ["openid"]);
  assert.ok(__test.POLL_INTERVAL_MS >= 5_000 && __test.POLL_INTERVAL_MS <= 15_000);
  assert.equal(__test.SEEN_MESSAGE_ID_FLOOR, 2_048);
});

test("친구 코드는 A-F/숫자 6자리, 쪽지는 100자로 제한한다", () => {
  assert.equal(__test.validateFriendCode(" a1b2c3 "), "A1B2C3");
  assert.throws(() => __test.validateFriendCode("XY12ZZ"), /A–F/u);
  assert.throws(() => __test.validateFriendCode("ABC"), /6자리/u);
  assert.equal(__test.validateMessage(" 안녕! "), "안녕!");
  assert.throws(() => __test.validateMessage(""), /입력/u);
  assert.throws(() => __test.validateMessage("가".repeat(101)), /100자/u);
  assert.deepEqual(__test.validateOutgoing("", "love"), { body: "", stickerId: "love" });
  assert.throws(() => __test.validateOutgoing("", ""), /내용이나 스티커/u);
  assert.equal(__test.validateFriendAlias(` ${"😀".repeat(20)} `), "😀".repeat(20));
  assert.equal(__test.validateFriendAlias("  "), null);
  assert.throws(() => __test.validateFriendAlias("😀".repeat(21)), /20자/u);
  assert.throws(() => __test.validateFriendAlias("친구\u200B별칭"), /제어 문자/u);
  assert.throws(() => __test.validateFriendAlias("친구\n별칭"), /제어 문자/u);
  assert.equal(__test.validateProfileName("🌿".repeat(20)), "🌿".repeat(20));
  assert.throws(() => __test.validateProfileName("🌿".repeat(21)), /20자/u);
  assert.throws(() => __test.validateProfileName("공개\u2060별명"), /제어 문자/u);
  assert.throws(() => __test.validateProfileName("공개\t별명"), /제어 문자/u);
  assert.throws(() => __test.validateProfileName(""), /입력/u);
  assert.equal(__test.DISPLAY_NAME_MAX_LENGTH, 20);
});

test("친구의 내 별칭과 공개 별명, 내 공개 별명을 유연하게 정규화한다", () => {
  const result = __test.normalizeState({
    profile: { user_id: "me", display_name: "푸른 구름", name_customized: true, friend_code: "ABC123" },
    friends: [
      { friend_id: "f1", display_name: "산책친구", public_name: "하늘", has_alias: true, alias: "산책친구" },
      { friend_id: "f2", display_name: "바다", public_name: "바다", has_alias: false, alias: null },
      { friend_id: "f3", alias: "책친구", public_name: "나무" },
    ],
  });
  assert.deepEqual(result.me, { id: "me", name: "푸른 구름", nameCustomized: true, code: "ABC123" });
  assert.deepEqual({ name: result.friends[0].name, alias: result.friends[0].alias, publicName: result.friends[0].publicName, hasAlias: result.friends[0].hasAlias }, { name: "산책친구", alias: "산책친구", publicName: "하늘", hasAlias: true });
  assert.deepEqual({ name: result.friends[1].name, alias: result.friends[1].alias, publicName: result.friends[1].publicName, hasAlias: result.friends[1].hasAlias }, { name: "바다", alias: "", publicName: "바다", hasAlias: false });
  assert.deepEqual({ name: result.friends[2].name, alias: result.friends[2].alias, publicName: result.friends[2].publicName, hasAlias: result.friends[2].hasAlias }, { name: "책친구", alias: "책친구", publicName: "나무", hasAlias: true });
});

test("state의 열지 않은 쪽지는 메타데이터만 정규화하고 본문은 버린다", () => {
  const result = __test.normalizeState({
    profile: { display_name: "영민", friend_code: "AB12CD" },
    friends: [{ friend_id: "f1", display_name: "하늘", friend_code: "EF3456", unread_count: 1 }],
    unopened_messages: [{ message_id: "m1", sender_id: "f1", sender_name: "하늘", body: "노출되면 안 됨", created_at: "2026-10-20T10:00:00Z" }],
  });
  assert.equal(result.me.code, "AB12CD");
  assert.equal(result.friends[0].id, "f1");
  assert.deepEqual(result.messages[0], {
    id: "m1", anonymous: false, senderId: "f1", senderName: "하늘", createdAt: "2026-10-20T10:00:00Z",
    targetType: "friend", targetId: "f1", targetName: "", stickerId: null,
    openedAt: null, expiresAt: null, body: null,
  });
});

test("익명 쪽지는 backend 발신자 필드가 있어도 main 정규화에서 마스킹한다", () => {
  const result = __test.normalizeState({
    profile: { friend_code: "ABC123" },
    unopened_messages: [{
      message_id: "m-anon", anonymous: true, sender_id: "secret-user-id",
      sender_name: "실명", display_name: "노출 금지", target_id: "friend-must-not-leak",
      created_at: "2026-10-20T10:00:00Z",
    }],
  });
  assert.equal(result.messages[0].anonymous, true);
  assert.equal(result.messages[0].senderId, "");
  assert.equal(result.messages[0].senderName, "익명의 친구");
  assert.equal(result.messages[0].targetId, "");
  assert.doesNotMatch(JSON.stringify(result.messages[0]), /secret-user-id|실명|노출 금지|friend-must-not-leak/u);
  const opened = __test.normalizeOpenedMessage({
    anonymous: true, sender_id: "open-secret-id", sender_name: "열 때 노출 금지",
    body: "안녕", expires_at: Date.now() + 5_000,
  }, { id: "m-anon", anonymous: false, senderId: "fallback-id", senderName: "기존 이름" });
  assert.equal(opened.anonymous, true);
  assert.equal(opened.senderId, "");
  assert.equal(opened.senderName, "익명의 친구");
  assert.doesNotMatch(JSON.stringify(opened), /open-secret-id|열 때 노출 금지|fallback-id|기존 이름/u);
});

test("익명 모임 쪽지는 발신자는 마스킹하되 groupId만 보존한다", () => {
  const message = __test.normalizeMetadata({
    message_id: "m-group-anon", anonymous: true, sender_id: "secret-user",
    target_type: "group", target_id: "g-fallback", group_id: "g1", group_name: "산책",
  });
  assert.equal(message.senderId, "");
  assert.equal(message.senderName, "익명의 친구");
  assert.equal(message.targetType, "group");
  assert.equal(message.targetId, "g1");
});

test("모임과 pending 초대를 최대 8명 계약으로 정규화한다", () => {
  const result = __test.normalizeState({
    profile: { friend_code: "ABC123" },
    groups: [{ group_id: "g1", group_name: "산책", is_owner: true, members: Array.from({ length: 10 }, (_, index) => ({ user_id: `u${index}`, display_name: `멤버${index}` })) }],
    group_invites: [
      { invite_id: "i1", group_id: "g2", group_name: "점심", invited_by_name: "하늘", direction: "incoming" },
      { invite_id: "i2", group_id: "g3", group_name: "발신 초대", invited_by_name: "나", direction: "outgoing" },
    ],
  });
  assert.equal(result.groups[0].owner, true);
  assert.equal(result.groups[0].members.length, 8);
  assert.equal(result.groupInvites.length, 1);
  assert.equal(result.groupInvites[0].groupName, "점심");
  assert.equal(result.groupInvites[0].inviterName, "하늘");
  assert.equal(result.groupInvites[0].direction, "incoming");
  assert.equal(__test.GROUP_MAX_MEMBERS, 8);
});

test("opaque 세션과 열린 쪽지의 서버 만료 시각을 검증한다", () => {
  const expiresAt = Date.now() + 30_000;
  assert.deepEqual(__test.validateSession({ session_token: "opaque", expires_at: expiresAt }), {
    token: "opaque", expiresAt,
  });
  assert.throws(() => __test.validateSession({ session_token: "opaque", expires_at: Date.now() - 1 }), /발급/u);
  const opened = __test.normalizeOpenedMessage({ body: "밥 먹었어?", expires_at: expiresAt }, {
    id: "m1", senderName: "하늘",
  });
  assert.equal(opened.body, "밥 먹었어?");
  assert.equal(opened.expiresAt, expiresAt);
});

test("정기 새로고침이 겹쳐도 열린 쪽지는 서버 만료 시각까지 유지한다", () => {
  const now = Date.now();
  const current = [{
    id: "m1", senderId: "f1", senderName: "하늘", body: "비밀 쪽지",
    createdAt: new Date(now - 1_000).toISOString(), openedAt: new Date(now).toISOString(),
    expiresAt: now + 5_000,
  }];
  const state = __test.mergeServerState(current, {
    profile: { friend_code: "ABC123" },
    unopened_messages: [],
  }, now + 1_000);
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].body, "비밀 쪽지");

  const expired = __test.mergeServerState(current, {
    profile: { friend_code: "ABC123" },
    unopened_messages: [],
  }, now + 5_001);
  assert.equal(expired.messages.length, 0);
});

function pluginHarness({ connected = false, fetchImpl, statusImpl }) {
  const actions = [];
  const radial = [];
  const posted = [];
  const trayItems = [];
  const trayUpdates = [];
  const bubbleMessages = [];
  const oauthCalls = { connect: [], accessToken: 0, status: 0 };
  let paletteHandler;
  let closed = false;
  const registration = () => ({ dispose() {} });
  const ctx = {
    actions: { registerAction(spec) { actions.push(spec); return registration(); } },
    radialMenu: { addItem(spec) { radial.push(spec); return registration(); } },
    trayMenu: {
      addItem(spec) {
        trayItems.push(spec);
        return { update(patch) { trayUpdates.push(patch); }, dispose() {} };
      },
    },
    host: {
      bubble: { speak(message) { bubbleMessages.push(message); } },
      oauth: {
        async status(id) {
          oauthCalls.status += 1;
          assert.equal(id, "google");
          return statusImpl ? statusImpl() : { connected };
        },
        async connect(spec) { oauthCalls.connect.push(spec); connected = true; return { connected: true }; },
        async accessToken(id) { oauthCalls.accessToken += 1; assert.equal(id, "google"); return `google-${oauthCalls.accessToken}`; },
      },
      windows: {
        openPalette() {
          return {
            isDestroyed() { return false; },
            onMessage(fn) { paletteHandler = fn; return () => {}; },
            postMessage(message) { posted.push(message); },
            show() {}, focus() {}, close() { closed = true; },
          };
        },
      },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const cleanupPlugin = activate(ctx);
  return {
    actions, radial, posted, oauthCalls, trayItems, trayUpdates, bubbleMessages,
    get handler() { return paletteHandler; },
    dispose() { cleanupPlugin(); },
    async cleanup() { cleanupPlugin(); globalThis.fetch = originalFetch; await wait(); },
    get closed() { return closed; },
  };
}

test("동의 화면은 사용자 connect 요청 전에는 열지 않는다", async () => {
  const harness = pluginHarness({ connected: false, fetchImpl: async () => { throw new Error("network not expected"); } });
  try {
    await wait();
    assert.equal(harness.oauthCalls.connect.length, 0);
    await harness.actions.find((action) => action.id === "openPalette").callback();
    await harness.handler({ type: "ready" });
    assert.equal(harness.posted.at(-1).state.connection, "disconnected");
    assert.equal(harness.oauthCalls.connect.length, 0);
    assert.equal(harness.radial[0].actionId, "openPalette");
  } finally {
    await harness.cleanup();
  }
});

test("종료 뒤 늦게 끝난 OAuth 상태 확인은 네트워크나 폴링을 시작하지 않는다", async () => {
  let resolveStatus;
  let fetchCalls = 0;
  const status = new Promise((resolve) => { resolveStatus = resolve; });
  const harness = pluginHarness({
    connected: true,
    statusImpl: () => status,
    fetchImpl: async () => { fetchCalls += 1; throw new Error("network not expected"); },
  });
  try {
    harness.dispose();
    resolveStatus({ connected: true });
    await wait(10);
    assert.equal(fetchCalls, 0);
  } finally {
    await harness.cleanup();
  }
});

test("첫 state는 알림 기준선으로 삼고 이후 새 ID만 내용 없이 bubble/tray에 알린다", async () => {
  let stateCall = 0;
  const statePayloads = [
    [{ message_id: "old", sender_id: "f1", sender_name: "과거 이름" }],
    [],
    [{ message_id: "old", sender_id: "f1", sender_name: "과거 이름" }],
    [
      { message_id: "old", sender_id: "f1", sender_name: "과거 이름" },
      { message_id: "new", anonymous: true, sender_id: "secret", sender_name: "숨길 이름", target_id: "f1" },
    ],
    [
      { message_id: "old", sender_id: "f1" },
      { message_id: "new", anonymous: true, sender_id: "secret", target_id: "f1" },
    ],
    [
      { message_id: "old", sender_id: "f1" },
      { message_id: "new", anonymous: true, sender_id: "secret", target_id: "f1" },
      { message_id: "while-open", sender_id: "f2", sender_name: "열린 창" },
    ],
  ];
  const harness = pluginHarness({
    connected: true,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.action === "session") return { ok: true, status: 200, async text() { return JSON.stringify({ session_token: "opaque", expires_at: Date.now() + 60_000 }); } };
      if (body.action === "state") {
        const unopened_messages = statePayloads[Math.min(stateCall, statePayloads.length - 1)];
        stateCall += 1;
        return { ok: true, status: 200, async text() { return JSON.stringify({ profile: { friend_code: "ABC123" }, unopened_messages }); } };
      }
      throw new Error(`unexpected ${body.action}`);
    },
  });
  try {
    await wait(20);
    assert.equal(harness.bubbleMessages.length, 0, "기존 쪽지 baseline은 알리지 않는다");
    assert.equal(harness.trayUpdates.at(-1).submenu[0].label, "● 새 쪽지 1개");

    await harness.actions.find((action) => action.id === "refreshInbox").callback();
    assert.equal(harness.bubbleMessages.length, 0);
    assert.equal(harness.trayUpdates.at(-1).submenu[0].label, "새 쪽지 없음");

    await harness.actions.find((action) => action.id === "refreshInbox").callback();
    assert.equal(harness.bubbleMessages.length, 0, "응답에서 빠졌다 돌아온 같은 ID는 다시 알리지 않는다");
    assert.equal(harness.trayUpdates.at(-1).submenu[0].label, "● 새 쪽지 1개");

    await harness.actions.find((action) => action.id === "refreshInbox").callback();
    assert.deepEqual(harness.bubbleMessages, [__test.NEW_MESSAGE_NOTICE]);
    assert.equal(harness.bubbleMessages[0], "새 쪽지가 도착했어요.");
    assert.doesNotMatch(harness.bubbleMessages[0], /과거 이름|숨길 이름|secret|2/u);
    assert.equal(harness.trayUpdates.at(-1).submenu[0].label, "● 새 쪽지 2개");

    await harness.actions.find((action) => action.id === "refreshInbox").callback();
    assert.equal(harness.bubbleMessages.length, 1, "같은 ID를 중복 알리지 않는다");

    harness.actions.find((action) => action.id === "openPalette").callback();
    await harness.actions.find((action) => action.id === "refreshInbox").callback();
    assert.equal(harness.bubbleMessages.length, 1, "palette가 열려 있으면 bubble을 겹쳐 띄우지 않는다");
    assert.equal(harness.trayUpdates.at(-1).submenu[0].label, "● 새 쪽지 3개");
  } finally {
    await harness.cleanup();
  }
});

test("명시적 Google 연결 뒤 session 교환과 state 호출에 opaque Bearer를 쓴다", async () => {
  const requests = [];
  const harness = pluginHarness({
    connected: false,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, options, body });
      if (body.action === "session") return { ok: true, status: 200, async text() { return JSON.stringify({ session_token: "opaque-1", expires_at: Date.now() + 60_000 }); } };
      if (body.action === "state") return { ok: true, status: 200, async text() { return JSON.stringify({ profile: { friend_code: "AB12CD" }, friends: [], unopened_messages: [] }); } };
      throw new Error("unexpected action");
    },
  });
  try {
    await wait();
    await harness.actions.find((action) => action.id === "openPalette").callback();
    await harness.handler({ type: "connectGoogle" });
    await wait();
    assert.deepEqual(harness.oauthCalls.connect[0], {
      provider: "google", connectionId: "google", scopes: ["openid"],
    });
    assert.equal(requests[0].url, __test.EDGE_URL);
    assert.equal(requests[0].options.headers.Authorization, "Bearer google-1");
    assert.equal(requests[0].body.action, "session");
    assert.equal(requests[1].options.headers.Authorization, "Bearer opaque-1");
    assert.equal(requests[1].body.action, "state");
    assert.equal(harness.posted.at(-1).state.me.code, "AB12CD");
  } finally {
    await harness.cleanup();
  }
});

test("401이면 Google 토큰으로 opaque 세션을 한 번만 다시 교환한다", async () => {
  let sessions = 0;
  let states = 0;
  const harness = pluginHarness({
    connected: true,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.action === "session") {
        sessions += 1;
        return { ok: true, status: 200, async text() { return JSON.stringify({ session_token: `opaque-${sessions}`, expires_at: Date.now() + 60_000 }); } };
      }
      states += 1;
      if (states === 1) return { ok: false, status: 401, async text() { return JSON.stringify({ message: "expired" }); } };
      assert.equal(options.headers.Authorization, "Bearer opaque-2");
      return { ok: true, status: 200, async text() { return JSON.stringify({ profile: { friend_code: "ABC123" }, unopened_messages: [] }); } };
    },
  });
  try {
    await wait(20);
    assert.equal(sessions, 2);
    assert.equal(states, 2);
    assert.equal(harness.oauthCalls.accessToken, 2);
  } finally {
    await harness.cleanup();
  }
});

test("친구 등록·별칭 수정·공개 별명 변경 payload를 Edge 계약으로 전달한다", async () => {
  const requests = [];
  const harness = pluginHarness({
    connected: true,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (body.action === "session") return { ok: true, status: 200, async text() { return JSON.stringify({ session_token: "opaque", expires_at: Date.now() + 60_000 }); } };
      if (body.action === "state") return { ok: true, status: 200, async text() { return JSON.stringify({ profile: { user_id: "me", display_name: "구름", name_customized: true, friend_code: "ABC123" }, friends: [{ friend_id: "f1", display_name: "하늘", public_name: "하늘", has_alias: false }], unopened_messages: [] }); } };
      if (["connect", "updateFriendAlias", "updateProfileName"].includes(body.action)) return { ok: true, status: 200, async text() { return "{}"; } };
      throw new Error(`unexpected ${body.action}`);
    },
  });
  try {
    await wait(10);
    await harness.actions.find((action) => action.id === "openPalette").callback();
    await harness.handler({ type: "addFriend", code: "DEF456", alias: " 새 친구 " });
    await harness.handler({ type: "updateFriendAlias", friendId: "f1", alias: " 산책친구 " });
    await harness.handler({ type: "updateFriendAlias", friendId: "f1", alias: "" });
    await harness.handler({ type: "updateProfileName", name: " 푸른 구름 " });
    const connect = requests.find((body) => body.action === "connect");
    assert.deepEqual({ friendCode: connect.friendCode, alias: connect.alias }, { friendCode: "DEF456", alias: "새 친구" });
    const aliases = requests.filter((body) => body.action === "updateFriendAlias");
    assert.deepEqual(aliases.map(({ friendId, alias }) => ({ friendId, alias })), [{ friendId: "f1", alias: "산책친구" }, { friendId: "f1", alias: null }]);
    const profile = requests.find((body) => body.action === "updateProfileName");
    assert.equal(profile.displayName, "푸른 구름");
  } finally {
    await harness.cleanup();
  }
});

test("모임 쪽지는 targetType/targetId/stickerId/anonymous adapter 계약으로 전송한다", async () => {
  const requests = [];
  const harness = pluginHarness({
    connected: true,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (body.action === "session") return { ok: true, status: 200, async text() { return JSON.stringify({ session_token: "opaque", expires_at: Date.now() + 60_000 }); } };
      if (body.action === "state") return { ok: true, status: 200, async text() { return JSON.stringify({ profile: { friend_code: "ABC123" }, groups: [{ group_id: "g1", group_name: "산책", is_owner: true, members: [] }], unopened_messages: [] }); } };
      if (body.action === "sendMessage") return { ok: true, status: 200, async text() { return "{}"; } };
      throw new Error(`unexpected ${body.action}`);
    },
  });
  try {
    await wait(10);
    await harness.actions.find((action) => action.id === "openPalette").callback();
    harness.handler({ type: "sendMessage", targetType: "group", targetId: "g1", body: "", stickerId: "celebrate", anonymous: true });
    await wait(10);
    const sent = requests.find((body) => body.action === "sendMessage");
    assert.equal(sent.targetType, "group");
    assert.equal(sent.targetId, "g1");
    assert.equal(sent.body, "");
    assert.equal(sent.stickerId, "celebrate");
    assert.equal(sent.anonymous, true);
    assert.equal(typeof sent.clientNonce, "string");
  } finally {
    await harness.cleanup();
  }
});

test("open 응답 본문은 서버 expires_at까지만 메모리와 UI에 남는다", async () => {
  const harness = pluginHarness({
    connected: true,
    fetchImpl: async (_url, options) => {
      const { action } = JSON.parse(options.body);
      if (action === "session") return { ok: true, status: 200, async text() { return JSON.stringify({ session_token: "opaque", expires_at: Date.now() + 60_000 }); } };
      if (action === "state") return { ok: true, status: 200, async text() { return JSON.stringify({ profile: { friend_code: "ABC123" }, unopened_messages: [{ message_id: "m1", sender_name: "하늘" }] }); } };
      if (action === "open") return { ok: true, status: 200, async text() { return JSON.stringify({ body: "비밀 쪽지", expires_at: Date.now() + 100 }); } };
      throw new Error("unexpected action");
    },
  });
  try {
    await wait(10);
    await harness.actions.find((action) => action.id === "openPalette").callback();
    await harness.handler({ type: "openMessage", messageId: "m1" });
    await wait(10);
    assert.equal(harness.posted.at(-1).state.messages[0].body, "비밀 쪽지");
    await wait(110);
    assert.equal(harness.posted.at(-1).state.messages.length, 0);
  } finally {
    await harness.cleanup();
  }
});
