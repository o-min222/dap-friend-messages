const EDGE_URL = "https://vowrjkctldqxizvleogd.supabase.co/functions/v1/friend-messages";
const PUBLISHABLE_KEY = "sb_publishable_Dgxv-IINi9MZLWRYnQAuug_MmvlpXsl";
const CONNECTION_ID = "google";
const OAUTH_SCOPES = Object.freeze(["openid"]);
const POLL_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 8_000;
const SEEN_MESSAGE_ID_FLOOR = 2_048;
const MESSAGE_MAX_LENGTH = 100;
const DISPLAY_NAME_MAX_LENGTH = 20;
const NAME_FORBIDDEN_PATTERN = /[\p{Cc}\p{Cf}]/u;
const GROUP_MAX_MEMBERS = 8;
const FRIEND_CODE_PATTERN = /^[A-F0-9]{6}$/u;
const STICKER_IDS = Object.freeze(["smile", "cheer", "love", "surprise", "sulk", "cry", "celebrate", "tired"]);
const NEW_MESSAGE_NOTICE = "새 쪽지가 도착했어요.";
// Edge 계약이 확정되면 값만 바꾸면 되도록 wire action을 한곳에 모은다.
const BACKEND_ACTIONS = Object.freeze({
  state: "state", connectFriend: "connect", updateFriendAlias: "updateFriendAlias",
  updateProfileName: "updateProfileName", openMessage: "open", removeFriend: "remove",
  blockFriend: "block", unblockFriend: "unblock", sendMessage: "sendMessage",
  createGroup: "createGroup", updateGroup: "updateGroup", inviteGroup: "inviteGroup",
  respondGroupInvite: "respondGroupInvite", removeGroupMember: "removeGroupMember",
  leaveGroup: "leaveGroup", deleteGroup: "deleteGroup",
});
const ALLOWED_ACTIONS = new Set(Object.values(BACKEND_ACTIONS));

function timeoutSignal(ms = REQUEST_TIMEOUT_MS) {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function apiError(status, payload) {
  const detail = payload && typeof payload === "object"
    ? payload.message || payload.error || payload.detail
    : payload;
  return detail ? String(detail).slice(0, 240) : `서버 요청에 실패했어요 (${status})`;
}

function expiryMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function validateSession(payload) {
  const source = payload?.session || payload;
  const token = typeof source?.session_token === "string" ? source.session_token : "";
  const expiresAt = expiryMillis(source?.expires_at);
  if (!token || expiresAt <= Date.now()) throw new Error("메시지 세션을 발급받지 못했어요.");
  return { token, expiresAt };
}

function validateFriendCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!FRIEND_CODE_PATTERN.test(code)) throw new Error("친구 코드는 A–F와 숫자로 된 6자리예요.");
  return code;
}

function validateFriendAlias(value) {
  const raw = String(value || "");
  if (NAME_FORBIDDEN_PATTERN.test(raw)) throw new Error("친구 별칭에는 제어 문자를 사용할 수 없어요.");
  const alias = raw.trim();
  if ([...alias].length > DISPLAY_NAME_MAX_LENGTH) throw new Error("친구 별칭은 20자까지 사용할 수 있어요.");
  return alias || null;
}

function validateProfileName(value) {
  const raw = String(value || "");
  if (NAME_FORBIDDEN_PATTERN.test(raw)) throw new Error("공개 별명에는 제어 문자를 사용할 수 없어요.");
  const name = raw.trim();
  if (!name) throw new Error("친구에게 보여 줄 공개 별명을 입력해 주세요.");
  if ([...name].length > DISPLAY_NAME_MAX_LENGTH) throw new Error("공개 별명은 20자까지 사용할 수 있어요.");
  return name;
}

function validateMessage(value) {
  const body = String(value || "").trim();
  if (!body) throw new Error("보낼 내용을 입력해 주세요.");
  if ([...body].length > MESSAGE_MAX_LENGTH) throw new Error("쪽지는 100자까지 보낼 수 있어요.");
  return body;
}

function validateGroupName(value) {
  const name = String(value || "").trim();
  if (!name) throw new Error("모임 이름을 입력해 주세요.");
  if ([...name].length > 30) throw new Error("모임 이름은 30자까지 사용할 수 있어요.");
  return name;
}

function validateSticker(value) {
  const id = String(value || "");
  if (id && !STICKER_IDS.includes(id)) throw new Error("지원하지 않는 스티커예요.");
  return id || null;
}

function validateOutgoing(bodyValue, stickerValue) {
  const body = String(bodyValue || "").trim();
  const stickerId = validateSticker(stickerValue);
  if (!body && !stickerId) throw new Error("쪽지 내용이나 스티커를 선택해 주세요.");
  if ([...body].length > MESSAGE_MAX_LENGTH) throw new Error("쪽지는 100자까지 보낼 수 있어요.");
  return { body, stickerId };
}

function normalizeFriend(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.friend_id || raw.id || "");
  if (!id) return null;
  const code = String(raw.friend_code || raw.code || "").toUpperCase();
  const explicitAlias = String(raw.alias || raw.friend_alias || raw.local_alias || "").trim();
  const hasAlias = raw.has_alias === true || Boolean(explicitAlias);
  const publicName = [...String(raw.public_name || raw.profile_name || (!hasAlias ? raw.display_name : "") || raw.name || "친구")]
    .slice(0, DISPLAY_NAME_MAX_LENGTH).join("");
  const name = [...String(explicitAlias || raw.display_name || publicName || "친구")]
    .slice(0, DISPLAY_NAME_MAX_LENGTH).join("");
  return {
    id,
    name,
    alias: hasAlias ? name : "",
    publicName,
    hasAlias,
    code: FRIEND_CODE_PATTERN.test(code) ? code : "",
    blocked: raw.blocked === true || raw.status === "blocked",
    unreadCount: Math.max(0, Number(raw.unread_count || 0)),
  };
}

function normalizeMetadata(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.message_id || raw.id || "");
  if (!id) return null;
  const anonymous = raw.anonymous === true || raw.is_anonymous === true;
  const targetType = raw.target_type === "group" || raw.group_id ? "group" : "friend";
  return {
    id,
    anonymous,
    senderId: anonymous ? "" : String(raw.sender_id || ""),
    senderName: anonymous ? "익명의 친구" : String(raw.sender_name || raw.display_name || "친구").slice(0, 40),
    targetType,
    targetId: anonymous
      ? targetType === "group" ? String(raw.group_id || raw.target_id || "") : ""
      : String(raw.target_id || raw.group_id || raw.sender_id || ""),
    targetName: String(raw.target_name || raw.group_name || "").slice(0, 40),
    stickerId: STICKER_IDS.includes(raw.sticker_id) ? raw.sticker_id : null,
    createdAt: String(raw.created_at || new Date().toISOString()),
    openedAt: null,
    expiresAt: null,
    body: null,
  };
}

function normalizeMember(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.user_id || raw.friend_id || raw.id || "");
  return id ? { id, name: String(raw.display_name || raw.name || "멤버").slice(0, 40) } : null;
}

function normalizeGroup(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.group_id || raw.id || "");
  if (!id) return null;
  return {
    id,
    name: String(raw.name || raw.group_name || "모임").slice(0, 30),
    members: (Array.isArray(raw.members) ? raw.members : []).map(normalizeMember).filter(Boolean).slice(0, GROUP_MAX_MEMBERS),
    owner: raw.owner === true || raw.is_owner === true,
    unreadCount: Math.max(0, Number(raw.unread_count || 0)),
  };
}

function normalizeInvite(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.invite_id || raw.id || "");
  if (!id) return null;
  return {
    id,
    groupId: String(raw.group_id || ""),
    groupName: String(raw.group_name || raw.name || "모임").slice(0, 30),
    inviterName: String(raw.invited_by_name || raw.inviter_name || "친구").slice(0, 40),
    direction: raw.direction === "outgoing" ? "outgoing" : "incoming",
  };
}

function normalizeState(payload) {
  const source = payload?.state || payload || {};
  const profile = source.profile || source.me || source;
  const ownCode = String(profile.friend_code || profile.code || "").toUpperCase();
  const friends = Array.isArray(source.friends) ? source.friends : [];
  const messages = Array.isArray(source.unopened_messages)
    ? source.unopened_messages
    : Array.isArray(source.messages) ? source.messages : [];
  return {
    me: {
      id: String(profile.user_id || profile.id || ""),
      name: [...String(profile.display_name || profile.name || "나")].slice(0, DISPLAY_NAME_MAX_LENGTH).join(""),
      nameCustomized: profile.name_customized === true,
      code: FRIEND_CODE_PATTERN.test(ownCode) ? ownCode : "",
    },
    friends: friends.map(normalizeFriend).filter(Boolean),
    groups: (Array.isArray(source.groups) ? source.groups : []).map(normalizeGroup).filter(Boolean),
    groupInvites: (Array.isArray(source.group_invites) ? source.group_invites : [])
      .map(normalizeInvite)
      .filter((invite) => invite?.direction === "incoming"),
    messages: messages.map(normalizeMetadata).filter(Boolean),
  };
}

function normalizeOpenedMessage(payload, fallback) {
  const source = payload?.message || payload || {};
  const anonymous = source.anonymous === true || source.is_anonymous === true || fallback?.anonymous === true;
  const body = String(source.body || source.message || "").slice(0, MESSAGE_MAX_LENGTH);
  const stickerId = STICKER_IDS.includes(source.sticker_id || source.stickerId)
    ? source.sticker_id || source.stickerId
    : fallback?.stickerId || null;
  if (!body && !stickerId) throw new Error("쪽지 내용을 불러오지 못했어요.");
  const expiresAt = expiryMillis(source.expires_at) || Date.now() + 5_000;
  return {
    ...fallback,
    anonymous,
    senderId: anonymous ? "" : String(fallback?.senderId || ""),
    senderName: anonymous ? "익명의 친구" : String(fallback?.senderName || "친구").slice(0, 40),
    body,
    stickerId,
    openedAt: String(source.opened_at || new Date().toISOString()),
    expiresAt,
  };
}

function mergeServerState(currentMessages, payload, now = Date.now()) {
  const next = normalizeState(payload);
  const opened = currentMessages.filter((message) => (
    message.openedAt && message.expiresAt > now
  ));
  const openedIds = new Set(opened.map((message) => message.id));
  return {
    ...next,
    messages: [
      ...opened,
      ...next.messages.filter((message) => !openedIds.has(message.id)),
    ],
  };
}

function clientNonce() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function activate(ctx) {
  let palette = null;
  let paletteOff = null;
  let disposed = false;
  let pollTimer = null;
  let syncPromise = null;
  let opaqueSession = null;
  let trayHandle = null;
  let seenMessageIds = null;
  const expiryTimers = new Map();
  const registrations = [];
  const state = {
    connection: "checking",
    busy: false,
    me: { id: "", name: "나", code: "" },
    friends: [],
    groups: [],
    groupInvites: [],
    messages: [],
    lastSyncedAt: null,
    error: null,
  };

  const post = (message) => {
    if (palette && (typeof palette.isDestroyed !== "function" || !palette.isDestroyed())) {
      palette.postMessage(message);
    }
  };
  const publicState = () => ({
    ...state,
    unreadCount: state.messages.filter((message) => !message.openedAt).length,
    maxMessageLength: MESSAGE_MAX_LENGTH,
  });
  const pushState = (extra = {}) => post({ type: "state", state: publicState(), ...extra });
  const unreadCount = () => state.messages.filter((message) => !message.openedAt).length;
  const paletteIsOpen = () => Boolean(palette && (typeof palette.isDestroyed !== "function" || !palette.isDestroyed()));
  const trayPatch = () => {
    const count = unreadCount();
    return {
      submenu: [
        { itemId: "unread", label: count ? `● 새 쪽지 ${count}개` : "새 쪽지 없음", enabled: false },
        { itemId: "separator", type: "separator" },
        { itemId: "open", label: "친구 쪽지 열기…", actionId: "openPalette", enabled: true },
      ],
    };
  };
  const updateTray = () => trayHandle?.update?.(trayPatch());
  const announceNewMessages = (count) => {
    if (!count || paletteIsOpen() || typeof ctx.host.bubble?.speak !== "function") return;
    try {
      const result = ctx.host.bubble.speak(NEW_MESSAGE_NOTICE);
      result?.catch?.(() => {});
    } catch {
      // Host 알림 실패가 polling을 막지 않게 한다.
    }
  };

  const edgeFetch = async (authorization, body) => {
    const response = await fetch(EDGE_URL, {
      method: "POST",
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${authorization}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: timeoutSignal(),
    });
    return { response, payload: parseBody(await response.text()) };
  };

  const exchangeSession = async () => {
    const googleToken = await ctx.host.oauth.accessToken(CONNECTION_ID);
    const { response, payload } = await edgeFetch(googleToken, { action: "session" });
    if (!response.ok) throw new Error(apiError(response.status, payload));
    opaqueSession = validateSession(payload);
    return opaqueSession;
  };

  const ensureSession = async () => {
    if (opaqueSession && opaqueSession.expiresAt > Date.now() + 15_000) return opaqueSession;
    return exchangeSession();
  };

  const request = async (action, payload = {}, retry = true) => {
    if (!ALLOWED_ACTIONS.has(action)) throw new Error("허용되지 않은 요청이에요.");
    const session = await ensureSession();
    const result = await edgeFetch(session.token, { action, ...payload });
    if (result.response.status === 401 && retry) {
      opaqueSession = null;
      await exchangeSession();
      return request(action, payload, false);
    }
    if (!result.response.ok) throw new Error(apiError(result.response.status, result.payload));
    return result.payload;
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };
  const startPolling = () => {
    stopPolling();
    if (disposed) return;
    pollTimer = setInterval(() => void syncState(), POLL_INTERVAL_MS);
    pollTimer.unref?.();
  };

  const applyServerState = (payload) => {
    const next = mergeServerState(state.messages, payload);
    const incomingIds = next.messages.filter((message) => !message.openedAt).map((message) => message.id);
    let newCount = 0;
    if (seenMessageIds === null) {
      seenMessageIds = new Set(incomingIds);
    } else {
      for (const id of incomingIds) {
        if (!seenMessageIds.has(id)) newCount += 1;
        // Set의 삽입 순서를 최근 확인 순서로 사용한다.
        seenMessageIds.delete(id);
        seenMessageIds.add(id);
      }
      // 일시적으로 응답에서 빠진 ID도 기억해 재알림을 막되, 세션 메모리는 bounded한다.
      const limit = Math.max(SEEN_MESSAGE_ID_FLOOR, incomingIds.length);
      while (seenMessageIds.size > limit) seenMessageIds.delete(seenMessageIds.values().next().value);
    }
    state.me = next.me;
    state.friends = next.friends;
    state.groups = next.groups;
    state.groupInvites = next.groupInvites;
    state.messages = next.messages;
    updateTray();
    announceNewMessages(newCount);
  };

  const syncState = ({ announce = false } = {}) => {
    if (syncPromise || disposed || state.connection !== "connected") return syncPromise;
    state.busy = true;
    if (announce) state.error = null;
    pushState();
    syncPromise = (async () => {
      try {
        applyServerState(await request(BACKEND_ACTIONS.state));
        state.lastSyncedAt = Date.now();
        state.error = null;
        if (announce) pushState({ notice: "새 쪽지를 확인했어요." });
      } catch (error) {
        state.error = error instanceof Error ? error.message : "쪽지를 불러오지 못했어요.";
      } finally {
        state.busy = false;
        syncPromise = null;
        pushState();
      }
    })();
    return syncPromise;
  };

  const checkConnection = async () => {
    state.connection = "checking";
    pushState();
    const status = await ctx.host.oauth.status(CONNECTION_ID);
    if (disposed) return false;
    if (!status.connected) {
      state.connection = "disconnected";
      opaqueSession = null;
      stopPolling();
      pushState();
      return false;
    }
    state.connection = "connected";
    state.error = null;
    pushState();
    startPolling();
    await syncState();
    return true;
  };

  const connectGoogle = async () => {
    state.busy = true;
    state.error = null;
    pushState();
    try {
      const status = await ctx.host.oauth.connect({
        provider: "google",
        connectionId: CONNECTION_ID,
        scopes: [...OAUTH_SCOPES],
      });
      if (disposed) return;
      if (!status.connected) throw new Error(status.reason || "Google 계정을 연결하지 못했어요.");
      state.connection = "connected";
      opaqueSession = null;
      seenMessageIds = null;
      startPolling();
      await syncState();
      pushState({ notice: "Google 계정을 연결했어요." });
    } catch (error) {
      state.connection = "disconnected";
      state.error = error instanceof Error ? error.message : "Google 연결에 실패했어요.";
      stopPolling();
    } finally {
      state.busy = false;
      pushState();
    }
  };

  const expireMessageAt = (messageId, expiresAt) => {
    if (disposed) return;
    if (expiryTimers.has(messageId)) clearTimeout(expiryTimers.get(messageId));
    const delay = Math.max(0, expiresAt - Date.now());
    const timer = setTimeout(() => {
      expiryTimers.delete(messageId);
      state.messages = state.messages.filter((message) => message.id !== messageId);
      updateTray();
      pushState({ expiredMessageId: messageId });
    }, delay);
    timer.unref?.();
    expiryTimers.set(messageId, timer);
  };

  const mutateFriend = async (action, friendId, operationMeta = {}) => {
    const id = String(friendId || "");
    if (!state.friends.some((friend) => friend.id === id)) throw new Error("친구를 다시 선택해 주세요.");
    await request(BACKEND_ACTIONS[action], { friendId: id });
    await syncState();
    pushState({ notice: action === "removeFriend" ? "친구를 삭제했어요." : action === "blockFriend" ? "친구를 차단했어요." : "차단을 해제했어요.", ...operationMeta });
  };

  const onPaletteMessage = async (message) => {
    if (!message || typeof message !== "object" || disposed) return;
    const operationId = typeof message.operationId === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(message.operationId) ? message.operationId : undefined;
    const operationMeta = operationId ? { operationId } : {};
    if (message.type === "ready") return pushState();
    if (message.type === "connectGoogle") return connectGoogle();
    if (message.type === "refresh") return syncState({ announce: true });
    if (state.connection !== "connected") return post({ type: "error", message: "먼저 Google 계정을 연결해 주세요.", ...operationMeta });
    try {
      if (message.type === "addFriend") {
        await request(BACKEND_ACTIONS.connectFriend, {
          friendCode: validateFriendCode(message.code),
          alias: validateFriendAlias(message.alias),
        });
        await syncState();
        pushState({ notice: "친구를 연결했어요.", ...operationMeta });
      } else if (message.type === "updateFriendAlias") {
        const friendId = String(message.friendId || "");
        if (!state.friends.some((friend) => friend.id === friendId)) throw new Error("친구를 다시 선택해 주세요.");
        const alias = validateFriendAlias(message.alias);
        await request(BACKEND_ACTIONS.updateFriendAlias, { friendId, alias });
        await syncState();
        pushState({ notice: alias ? "친구 별칭을 바꿨어요." : "공개 별명으로 되돌렸어요.", ...operationMeta });
      } else if (message.type === "updateProfileName") {
        await request(BACKEND_ACTIONS.updateProfileName, { displayName: validateProfileName(message.name) });
        await syncState();
        pushState({ notice: "공개 별명을 바꿨어요.", ...operationMeta });
      } else if (message.type === "sendMessage") {
        const targetType = message.targetType === "group" ? "group" : "friend";
        const targetId = String(message.targetId || "");
        if (targetType === "friend") {
          const friend = state.friends.find((item) => item.id === targetId);
          if (!friend || friend.blocked) throw new Error("쪽지를 보낼 친구를 다시 선택해 주세요.");
        } else if (!state.groups.some((group) => group.id === targetId)) {
          throw new Error("쪽지를 보낼 모임을 다시 선택해 주세요.");
        }
        const outgoing = validateOutgoing(message.body, message.stickerId);
        await request(BACKEND_ACTIONS.sendMessage, {
          targetType,
          targetId,
          body: outgoing.body,
          stickerId: outgoing.stickerId,
          anonymous: message.anonymous === true,
          clientNonce: clientNonce(),
        });
        pushState({ notice: "쪽지를 보냈어요.", sentTo: `${targetType}:${targetId}` });
      } else if (message.type === "openMessage") {
        const messageId = String(message.messageId || "");
        const index = state.messages.findIndex((item) => item.id === messageId);
        if (index < 0 || state.messages[index].openedAt) return;
        const opened = normalizeOpenedMessage(await request(BACKEND_ACTIONS.openMessage, { messageId }), state.messages[index]);
        state.messages[index] = opened;
        updateTray();
        pushState({ openedMessageId: messageId });
        expireMessageAt(messageId, opened.expiresAt);
      } else if (["removeFriend", "blockFriend", "unblockFriend"].includes(message.type)) {
        const action = { removeFriend: "removeFriend", blockFriend: "blockFriend", unblockFriend: "unblockFriend" }[message.type];
        await mutateFriend(action, message.friendId, operationMeta);
      } else if (message.type === "createGroup") {
        const memberIds = [...new Set(Array.isArray(message.memberIds) ? message.memberIds.map(String) : [])];
        if (memberIds.length > GROUP_MAX_MEMBERS - 1 || memberIds.some((id) => !state.friends.some((friend) => friend.id === id && !friend.blocked))) throw new Error("모임원은 친구 중 최대 7명까지 선택할 수 있어요.");
        await request(BACKEND_ACTIONS.createGroup, { name: validateGroupName(message.name), memberIds });
        await syncState();
        pushState({ notice: "모임을 만들었어요.", ...operationMeta });
      } else if (message.type === "updateGroup") {
        const group = state.groups.find((item) => item.id === String(message.groupId || ""));
        if (!group?.owner) throw new Error("모임 이름은 모임장만 바꿀 수 있어요.");
        await request(BACKEND_ACTIONS.updateGroup, { groupId: group.id, name: validateGroupName(message.name) });
        await syncState();
        pushState({ notice: "모임 이름을 바꿨어요.", ...operationMeta });
      } else if (message.type === "inviteGroup") {
        const group = state.groups.find((item) => item.id === String(message.groupId || ""));
        const memberIds = [...new Set(Array.isArray(message.memberIds) ? message.memberIds.map(String) : [])];
        if (!group?.owner) throw new Error("친구 초대는 모임장만 할 수 있어요.");
        if (memberIds.length === 0 || group.members.length + memberIds.length > GROUP_MAX_MEMBERS) throw new Error("모임은 최대 8명까지 참여할 수 있어요.");
        await request(BACKEND_ACTIONS.inviteGroup, { groupId: group.id, memberIds });
        await syncState();
        pushState({ notice: "모임에 초대했어요.", ...operationMeta });
      } else if (message.type === "respondGroupInvite") {
        await request(BACKEND_ACTIONS.respondGroupInvite, { inviteId: String(message.inviteId || ""), accept: message.accept === true });
        await syncState();
        pushState({ notice: message.accept === true ? "모임 초대를 수락했어요." : "모임 초대를 거절했어요.", ...operationMeta });
      } else if (message.type === "removeGroupMember") {
        const group = state.groups.find((item) => item.id === String(message.groupId || ""));
        if (!group?.owner) throw new Error("모임원 내보내기는 모임장만 할 수 있어요.");
        await request(BACKEND_ACTIONS.removeGroupMember, { groupId: group.id, memberId: String(message.memberId || "") });
        await syncState();
        pushState({ notice: "모임원을 내보냈어요.", ...operationMeta });
      } else if (message.type === "leaveGroup") {
        const group = state.groups.find((item) => item.id === String(message.groupId || ""));
        if (!group || group.owner) throw new Error("모임장은 모임을 나갈 수 없어요. 모임을 삭제해 주세요.");
        await request(BACKEND_ACTIONS.leaveGroup, { groupId: group.id });
        await syncState();
        pushState({ notice: "모임에서 나왔어요.", ...operationMeta });
      } else if (message.type === "deleteGroup") {
        const group = state.groups.find((item) => item.id === String(message.groupId || ""));
        if (!group?.owner) throw new Error("모임 삭제는 모임장만 할 수 있어요.");
        await request(BACKEND_ACTIONS.deleteGroup, { groupId: group.id });
        await syncState();
        pushState({ notice: "모임을 삭제했어요.", ...operationMeta });
      }
    } catch (error) {
      post({ type: "error", message: error instanceof Error ? error.message : "요청을 처리하지 못했어요.", ...operationMeta });
    }
  };

  const openPalette = () => {
    if (!palette || palette.isDestroyed()) {
      palette = ctx.host.windows.openPalette({
        page: "palette/index.html",
        width: 410,
        height: 620,
        frame: false,
        resizable: true,
        minWidth: 380,
        minHeight: 520,
        alwaysOnTop: true,
        visibleOnAllWorkspaces: true,
        level: "pop-up-menu",
      });
      paletteOff?.();
      paletteOff = palette.onMessage((message) => void onPaletteMessage(message));
    }
    palette.show();
    palette.focus?.();
    pushState();
  };

  registrations.push(ctx.actions.registerAction({ id: "openPalette", callback: openPalette }));
  registrations.push(ctx.actions.registerAction({ id: "refreshInbox", callback: () => syncState({ announce: true }) }));
  registrations.push(ctx.radialMenu.addItem({
    itemId: "friend-messages",
    label: "친구 쪽지",
    actionId: "openPalette",
    priority: 44,
    icon: "assets/friend-messages.svg",
  }));
  trayHandle = ctx.trayMenu?.addItem?.({
    itemId: "friend-messages",
    label: "친구 쪽지",
    actionId: "openPalette",
    showInContextMenu: true,
    priority: 44,
    submenu: trayPatch().submenu,
  }) || null;
  if (trayHandle) registrations.push(trayHandle);
  updateTray();

  void checkConnection().catch((error) => {
    state.connection = "disconnected";
    state.error = error instanceof Error ? error.message : "Google 연결 상태를 확인하지 못했어요.";
    pushState();
  });

  return () => {
    disposed = true;
    stopPolling();
    opaqueSession = null;
    seenMessageIds = null;
    for (const timer of expiryTimers.values()) clearTimeout(timer);
    expiryTimers.clear();
    paletteOff?.();
    palette?.close();
    trayHandle = null;
    for (const registration of registrations) registration?.dispose?.();
  };
}

export const __test = {
  ALLOWED_ACTIONS,
  BACKEND_ACTIONS,
  EDGE_URL,
  FRIEND_CODE_PATTERN,
  DISPLAY_NAME_MAX_LENGTH,
  NAME_FORBIDDEN_PATTERN,
  MESSAGE_MAX_LENGTH,
  GROUP_MAX_MEMBERS,
  OAUTH_SCOPES,
  POLL_INTERVAL_MS,
  SEEN_MESSAGE_ID_FLOOR,
  PUBLISHABLE_KEY,
  STICKER_IDS,
  NEW_MESSAGE_NOTICE,
  expiryMillis,
  normalizeFriend,
  normalizeGroup,
  normalizeMetadata,
  normalizeOpenedMessage,
  normalizeState,
  mergeServerState,
  validateFriendCode,
  validateFriendAlias,
  validateGroupName,
  validateMessage,
  validateOutgoing,
  validateProfileName,
  validateSession,
};
