(() => {
  "use strict";

  const bridge = window.dapPalette;
  const ids = [
    "app", "connect-panel", "connect-google", "workspace", "my-code", "friend-form", "friend-code",
    "message-form", "friend-select", "message-body", "counter", "send", "message-list", "inbox-empty",
    "unread", "friend-list", "friend-empty", "friend-count", "status", "refresh", "close",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  let model = {
    connection: "checking", busy: false, me: {}, friends: [], messages: [], maxMessageLength: 100,
  };

  const send = (message) => bridge?.postMessage?.(message);
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const timeLabel = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "방금" : new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit", minute: "2-digit",
    }).format(date);
  };

  function renderFriends() {
    const selected = elements["friend-select"].value;
    elements["friend-select"].replaceChildren();
    elements["friend-list"].replaceChildren();
    const available = model.friends.filter((friend) => !friend.blocked);
    const placeholder = element("option", "", available.length ? "친구를 선택하세요" : "쪽지를 보낼 친구가 없어요");
    placeholder.value = "";
    elements["friend-select"].append(placeholder);
    for (const friend of model.friends) {
      if (!friend.blocked) {
        const option = element("option", "", friend.name);
        option.value = friend.id;
        elements["friend-select"].append(option);
      }
      const item = element("li", `friend-item${friend.blocked ? " blocked" : ""}`);
      const avatar = element("span", "avatar", friend.name.slice(0, 1) || "친");
      avatar.setAttribute("aria-hidden", "true");
      const info = element("span", "friend-info");
      info.append(element("strong", "", `${friend.name}${friend.blocked ? " · 차단됨" : ""}`));
      if (friend.code) info.append(element("span", "friend-code-small", friend.code));
      const actions = element("span", "friend-actions");
      const block = element("button", "text-button", friend.blocked ? "차단 해제" : "차단");
      block.type = "button";
      block.onclick = () => send({ type: friend.blocked ? "unblockFriend" : "blockFriend", friendId: friend.id });
      const remove = element("button", "text-button danger", "삭제");
      remove.type = "button";
      remove.onclick = () => send({ type: "removeFriend", friendId: friend.id });
      actions.append(block, remove);
      item.append(avatar, info, actions);
      if (friend.unreadCount) item.append(element("span", "badge", String(friend.unreadCount)));
      elements["friend-list"].append(item);
    }
    if (available.some((friend) => friend.id === selected)) elements["friend-select"].value = selected;
    elements["friend-empty"].hidden = model.friends.length > 0;
    elements["friend-count"].textContent = `${model.friends.length}명`;
    elements.send.disabled = available.length === 0 || model.busy;
  }

  function renderMessages() {
    elements["message-list"].replaceChildren();
    for (const message of model.messages) {
      const item = element("li", `message-item${message.openedAt ? " opened" : ""}`);
      const button = element("button", "message-button");
      button.type = "button";
      button.disabled = Boolean(message.openedAt);
      button.setAttribute("aria-expanded", message.openedAt ? "true" : "false");
      const top = element("span", "message-meta");
      top.append(element("strong", "", message.senderName), element("time", "", timeLabel(message.createdAt)));
      button.append(top);
      if (message.openedAt) {
        button.append(element("span", "message-body", message.body));
        button.append(element("span", "countdown", "잠시 뒤 사라져요"));
      } else {
        button.append(element("span", "message-preview", "새 쪽지가 도착했어요 · 눌러서 열기"));
      }
      button.onclick = () => send({ type: "openMessage", messageId: message.id });
      item.append(button);
      elements["message-list"].append(item);
    }
    elements["inbox-empty"].hidden = model.messages.length > 0;
    elements.unread.textContent = String(model.unreadCount || 0);
    elements.unread.setAttribute("aria-label", `열지 않은 쪽지 ${model.unreadCount || 0}개`);
  }

  function render() {
    const connected = model.connection === "connected";
    elements.app.setAttribute("aria-busy", model.busy || model.connection === "checking" ? "true" : "false");
    elements["connect-panel"].hidden = connected;
    elements.workspace.hidden = !connected;
    elements.refresh.hidden = !connected;
    elements["connect-google"].disabled = model.busy || model.connection === "checking";
    elements["connect-google"].textContent = model.connection === "checking" ? "연결 확인 중…" : "Google로 연결";
    if (!connected) {
      elements.status.textContent = model.error || (model.connection === "checking" ? "Google 연결 상태를 확인하고 있어요." : "Google 연결이 필요해요.");
      return;
    }
    elements["my-code"].textContent = model.me?.code || "------";
    renderFriends();
    renderMessages();
    if (model.error) elements.status.textContent = `연결 오류: ${model.error}`;
    else if (model.busy) elements.status.textContent = "친구와 쪽지를 불러오는 중…";
    else if (model.lastSyncedAt) elements.status.textContent = `${timeLabel(model.lastSyncedAt)}에 확인했어요.`;
    else elements.status.textContent = "쪽지함을 준비하고 있어요.";
  }

  elements["friend-code"].addEventListener("input", () => {
    elements["friend-code"].value = elements["friend-code"].value.toUpperCase().replace(/[^A-F0-9]/gu, "").slice(0, 6);
  });
  elements["message-body"].addEventListener("input", () => {
    elements.counter.textContent = `${[...elements["message-body"].value].length} / ${model.maxMessageLength}`;
  });
  elements["friend-form"].addEventListener("submit", (event) => {
    event.preventDefault();
    send({ type: "addFriend", code: elements["friend-code"].value });
  });
  elements["message-form"].addEventListener("submit", (event) => {
    event.preventDefault();
    send({ type: "sendMessage", friendId: elements["friend-select"].value, body: elements["message-body"].value });
  });
  elements["connect-google"].onclick = () => send({ type: "connectGoogle" });
  elements.refresh.onclick = () => send({ type: "refresh" });
  elements.close.onclick = () => bridge?.close?.();

  bridge?.onMessage?.((message) => {
    if (message?.type === "state") {
      model = message.state;
      render();
      if (message.notice) elements.status.textContent = message.notice;
      if (message.sentTo) {
        elements["message-body"].value = "";
        elements.counter.textContent = `0 / ${model.maxMessageLength}`;
      }
    } else if (message?.type === "error") {
      elements.status.textContent = message.message;
    }
  });

  render();
  send({ type: "ready" });
})();
