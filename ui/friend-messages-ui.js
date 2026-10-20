(() => {
  "use strict";

  const bridge = window.dapPalette;
  const viewNames = ["inbox", "compose", "friends", "groups"];
  const ids = [
    "app", "connect-panel", "connect-google", "workspace", "refresh", "close", "status", "nav-unread",
    "invite-count", "message-stack", "inbox-empty", "message-form", "target-type", "target-select",
    "sticker-grid", "message-body", "anonymous-toggle", "counter", "send", "my-code", "friend-form", "friend-code",
    "friend-list", "friend-empty", "invite-section", "invite-list", "group-form", "group-name",
    "group-friend-options", "group-list", "group-empty",
    ...viewNames.flatMap((name) => [`tab-${name}`, `view-${name}`]),
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  const stickerPresets = [
    ["smile", "🙂", "미소"], ["cheer", "💪", "응원"], ["love", "💗", "사랑"], ["surprise", "😮", "놀람"],
    ["sulk", "😤", "삐짐"], ["cry", "😢", "눈물"], ["celebrate", "🎉", "축하"], ["tired", "😴", "피곤"],
  ];
  const stickerMap = Object.fromEntries(stickerPresets.map(([id, emoji, label]) => [id, { emoji, label }]));
  let model = { connection: "checking", busy: false, me: {}, friends: [], groups: [], groupInvites: [], messages: [], maxMessageLength: 100 };
  let activeView = "inbox";
  let selectedStickerId = null;
  let groupMemberIds = new Set();
  let removeArmedFriendId = null;
  let deleteArmedGroupId = null;
  let removeArmedMemberKey = null;
  let leaveArmedGroupId = null;

  const send = (message) => bridge?.postMessage?.(message);
  const codepointLength = (value) => [...String(value || "")].length;
  const updateLengthValidity = (input, max, label) => {
    const valid = codepointLength(input.value) <= max;
    input.setCustomValidity?.(valid ? "" : `${label}은 ${max}자까지 입력할 수 있어요.`);
    input.setAttribute("aria-invalid", valid ? "false" : "true");
    return valid;
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const timeLabel = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "방금" : new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(date);
  };
  const stickerNode = (id) => {
    const preset = stickerMap[id];
    return preset ? el("span", "note-sticker", preset.emoji) : null;
  };
  const senderLabel = (message) => message.anonymous ? "익명의 친구" : message.senderName;
  const senderSubject = (message) => message.anonymous ? "익명의 친구가" : `${message.senderName} 님이`;

  function showView(name) {
    if (!viewNames.includes(name)) return;
    activeView = name;
    for (const view of viewNames) {
      elements[`view-${view}`].hidden = view !== name;
      elements[`tab-${view}`].className = `tab${view === name ? " active" : ""}`;
      elements[`tab-${view}`].setAttribute("aria-current", view === name ? "page" : "false");
    }
    if (name === "compose") renderTargets();
  }

  function renderMessages() {
    elements["message-stack"].replaceChildren();
    for (const message of model.messages) {
      if (message.openedAt) {
        const paper = el("article", "opened-note");
        paper.setAttribute("aria-label", `${senderSubject(message)} 보낸 열린 쪽지`);
        const meta = el("div", "note-meta");
        meta.append(el("strong", "", message.targetType === "group" ? `${message.targetName || "모임"} · ${senderLabel(message)}` : senderLabel(message)), el("time", "", timeLabel(message.createdAt)));
        const sticker = stickerNode(message.stickerId);
        if (sticker) paper.append(sticker);
        if (message.body) paper.append(el("p", "note-body", message.body));
        paper.append(meta, el("small", "note-expiry", "잠시 뒤 사라져요"));
        elements["message-stack"].append(paper);
      } else {
        const envelope = el("button", "envelope");
        envelope.type = "button";
        envelope.setAttribute("aria-label", `${senderSubject(message)} 보낸 쪽지 열기`);
        envelope.onclick = () => send({ type: "openMessage", messageId: message.id });
        const seal = el("span", "envelope-seal", "✦");
        const copy = el("span", "envelope-copy");
        copy.append(el("strong", "", message.targetType === "group" ? message.targetName || "모임 쪽지" : senderLabel(message)), el("span", "", `${senderLabel(message)} · ${timeLabel(message.createdAt)}`));
        envelope.append(seal, copy, el("span", "envelope-open", "펼쳐보기"));
        elements["message-stack"].append(envelope);
      }
    }
    elements["inbox-empty"].hidden = model.messages.length > 0;
    elements["nav-unread"].textContent = String(model.unreadCount || 0);
    elements["nav-unread"].hidden = !model.unreadCount;
  }

  function renderStickers() {
    elements["sticker-grid"].replaceChildren();
    for (const [id, emoji, label] of stickerPresets) {
      const button = el("button", `sticker${selectedStickerId === id ? " selected" : ""}`, emoji);
      button.type = "button";
      button.setAttribute("aria-label", `${label} 스티커${selectedStickerId === id ? " 선택됨" : ""}`);
      button.setAttribute("aria-pressed", selectedStickerId === id ? "true" : "false");
      button.onclick = () => { selectedStickerId = selectedStickerId === id ? null : id; renderStickers(); };
      elements["sticker-grid"].append(button);
    }
  }

  function renderTargets() {
    const type = elements["target-type"].value === "group" ? "group" : "friend";
    const items = type === "group" ? model.groups : model.friends.filter((friend) => !friend.blocked);
    const previous = elements["target-select"].value;
    elements["target-select"].replaceChildren();
    const placeholder = el("option", "", items.length ? "선택해 주세요" : type === "group" ? "참여 중인 모임 없음" : "보낼 수 있는 친구 없음");
    placeholder.value = "";
    elements["target-select"].append(placeholder);
    for (const item of items) { const option = el("option", "", type === "group" ? `${item.name} · ${item.members.length}명` : item.name); option.value = item.id; elements["target-select"].append(option); }
    if (items.some((item) => item.id === previous)) elements["target-select"].value = previous;
    elements.send.disabled = !items.length || model.busy;
  }

  function renderFriends() {
    elements["friend-list"].replaceChildren();
    for (const friend of model.friends) {
      const item = el("li", "manage-item");
      const info = el("span", "manage-info"); info.append(el("strong", "", friend.name), el("small", "", friend.blocked ? "차단됨" : friend.code || "친구"));
      const actions = el("span", "row-actions");
      const block = el("button", "text-button", friend.blocked ? "차단 해제" : "차단"); block.type = "button"; block.onclick = () => send({ type: friend.blocked ? "unblockFriend" : "blockFriend", friendId: friend.id });
      const armed = removeArmedFriendId === friend.id;
      const remove = el("button", "text-button danger", armed ? "삭제 확정" : "삭제"); remove.type = "button"; remove.setAttribute("aria-label", armed ? `${friend.name} 삭제 확정` : `${friend.name} 삭제 확인`);
      remove.onclick = () => { if (!armed) { removeArmedFriendId = friend.id; renderFriends(); } else { removeArmedFriendId = null; send({ type: "removeFriend", friendId: friend.id }); renderFriends(); } };
      actions.append(block, remove); item.append(info, actions); elements["friend-list"].append(item);
    }
    elements["friend-empty"].hidden = model.friends.length > 0;
    elements["my-code"].textContent = model.me?.code || "------";
  }

  function renderGroupFriendOptions() {
    elements["group-friend-options"].replaceChildren();
    for (const friend of model.friends.filter((item) => !item.blocked)) {
      const label = el("label", "check-option"); const input = el("input"); input.type = "checkbox"; input.checked = groupMemberIds.has(friend.id);
      input.onchange = () => { if (input.checked && groupMemberIds.size < 7) groupMemberIds.add(friend.id); else { groupMemberIds.delete(friend.id); input.checked = false; } };
      label.append(input, el("span", "", friend.name)); elements["group-friend-options"].append(label);
    }
  }

  function renderGroups() {
    elements["invite-list"].replaceChildren();
    for (const invite of model.groupInvites) {
      const item = el("li", "manage-item"); const info = el("span", "manage-info"); info.append(el("strong", "", invite.groupName), el("small", "", `${invite.inviterName}님의 초대`));
      const actions = el("span", "row-actions");
      for (const [accept, label] of [[true, "수락"], [false, "거절"]]) { const button = el("button", "text-button", label); button.type = "button"; button.onclick = () => send({ type: "respondGroupInvite", inviteId: invite.id, accept }); actions.append(button); }
      item.append(info, actions); elements["invite-list"].append(item);
    }
    elements["invite-section"].hidden = model.groupInvites.length === 0;
    elements["invite-count"].textContent = String(model.groupInvites.length);
    elements["invite-count"].hidden = model.groupInvites.length === 0;
    elements["group-list"].replaceChildren();
    for (const group of model.groups) {
      const item = el("li", "group-card");
      const head = el("div", "group-head"); head.append(el("strong", "", group.name), el("span", "group-role", group.owner ? "모임장" : "멤버"));
      const members = el("ul", "member-list");
      for (const member of group.members) {
        const row = el("li", "");
        row.append(el("span", "", member.name));
        if (group.owner && member.id !== model.me?.id) {
          const memberKey = `${group.id}:${member.id}`;
          const armed = removeArmedMemberKey === memberKey;
          const kick = el("button", "text-button danger", armed ? "내보내기 확정" : "내보내기");
          kick.type = "button";
          kick.setAttribute("aria-label", armed ? `${member.name} 내보내기 확정` : `${member.name} 내보내기 확인`);
          kick.onclick = () => {
            if (!armed) {
              removeArmedMemberKey = memberKey;
              deleteArmedGroupId = null;
              leaveArmedGroupId = null;
              renderGroups();
            } else {
              removeArmedMemberKey = null;
              send({ type: "removeGroupMember", groupId: group.id, memberId: member.id });
              renderGroups();
            }
          };
          row.append(kick);
        }
        members.append(row);
      }
      item.append(head, members);
      const actions = el("div", "group-actions");
      if (group.owner) {
        const rename = el("input"); rename.value = group.name; rename.setAttribute("aria-label", `${group.name} 새 이름`); rename.addEventListener("input", () => updateLengthValidity(rename, 30, "모임 이름"));
        const save = el("button", "text-button", "이름 저장"); save.type = "button"; save.onclick = () => { if (updateLengthValidity(rename, 30, "모임 이름")) send({ type: "updateGroup", groupId: group.id, name: rename.value }); };
        const inviteSelect = el("select"); inviteSelect.setAttribute("aria-label", `${group.name}에 초대할 친구`); const empty = el("option", "", "친구 초대"); empty.value = ""; inviteSelect.append(empty);
        const memberSet = new Set(group.members.map((member) => member.id));
        for (const friend of model.friends.filter((friend) => !friend.blocked && !memberSet.has(friend.id))) { const option = el("option", "", friend.name); option.value = friend.id; inviteSelect.append(option); }
        const invite = el("button", "text-button", "초대"); invite.type = "button"; invite.disabled = group.members.length >= 8; invite.onclick = () => { if (inviteSelect.value) send({ type: "inviteGroup", groupId: group.id, memberIds: [inviteSelect.value] }); };
        const deleteArmed = deleteArmedGroupId === group.id;
        const del = el("button", "text-button danger", deleteArmed ? "한 번 더 눌러 삭제" : "모임 삭제");
        del.type = "button";
        del.setAttribute("aria-label", deleteArmed ? `${group.name} 모임 삭제 확정` : `${group.name} 모임 삭제 확인`);
        del.onclick = () => {
          if (!deleteArmed) {
            deleteArmedGroupId = group.id;
            removeArmedMemberKey = null;
            leaveArmedGroupId = null;
            renderGroups();
          } else {
            deleteArmedGroupId = null;
            send({ type: "deleteGroup", groupId: group.id });
            renderGroups();
          }
        };
        actions.append(rename, save, inviteSelect, invite, del);
      } else {
        const leaveArmed = leaveArmedGroupId === group.id;
        const leave = el("button", "text-button danger", leaveArmed ? "한 번 더 눌러 나가기" : "모임 나가기");
        leave.type = "button";
        leave.setAttribute("aria-label", leaveArmed ? `${group.name} 모임 나가기 확정` : `${group.name} 모임 나가기 확인`);
        leave.onclick = () => {
          if (!leaveArmed) {
            leaveArmedGroupId = group.id;
            deleteArmedGroupId = null;
            removeArmedMemberKey = null;
            renderGroups();
          } else {
            leaveArmedGroupId = null;
            send({ type: "leaveGroup", groupId: group.id });
            renderGroups();
          }
        };
        actions.append(leave);
      }
      item.append(actions); elements["group-list"].append(item);
    }
    elements["group-empty"].hidden = model.groups.length > 0;
    renderGroupFriendOptions();
  }

  function render() {
    const connected = model.connection === "connected";
    elements.app.setAttribute("aria-busy", model.busy || model.connection === "checking" ? "true" : "false");
    elements["connect-panel"].hidden = connected; elements.workspace.hidden = !connected; elements.refresh.hidden = !connected;
    elements["connect-google"].disabled = model.busy || model.connection === "checking";
    if (!connected) { elements.status.textContent = model.error || (model.connection === "checking" ? "Google 연결 상태를 확인하고 있어요." : "Google 연결이 필요해요."); return; }
    renderMessages(); renderTargets(); renderFriends(); renderGroups(); showView(activeView);
    elements.status.textContent = model.error ? `연결 오류: ${model.error}` : model.busy ? "새 쪽지를 확인하는 중…" : model.lastSyncedAt ? `${timeLabel(model.lastSyncedAt)}에 확인했어요.` : "쪽지함을 준비하고 있어요.";
  }

  for (const name of viewNames) elements[`tab-${name}`].onclick = () => showView(name);
  elements["target-type"].onchange = renderTargets;
  elements["message-body"].addEventListener("input", () => { const count = codepointLength(elements["message-body"].value); elements.counter.textContent = `${count} / ${model.maxMessageLength}`; updateLengthValidity(elements["message-body"], model.maxMessageLength, "쪽지"); });
  elements["group-name"].addEventListener("input", () => updateLengthValidity(elements["group-name"], 30, "모임 이름"));
  elements["friend-code"].addEventListener("input", () => { elements["friend-code"].value = elements["friend-code"].value.toUpperCase().replace(/[^A-F0-9]/gu, "").slice(0, 6); });
  elements["friend-form"].addEventListener("submit", (event) => { event.preventDefault(); send({ type: "addFriend", code: elements["friend-code"].value }); });
  elements["message-form"].addEventListener("submit", (event) => { event.preventDefault(); if (!updateLengthValidity(elements["message-body"], model.maxMessageLength, "쪽지")) return; const targetType = elements["target-type"].value === "group" ? "group" : "friend"; send({ type: "sendMessage", targetType, targetId: elements["target-select"].value, body: elements["message-body"].value, stickerId: selectedStickerId, anonymous: elements["anonymous-toggle"].checked === true }); });
  elements["group-form"].addEventListener("submit", (event) => { event.preventDefault(); if (!updateLengthValidity(elements["group-name"], 30, "모임 이름")) return; send({ type: "createGroup", name: elements["group-name"].value, memberIds: [...groupMemberIds] }); });
  elements["connect-google"].onclick = () => send({ type: "connectGoogle" }); elements.refresh.onclick = () => send({ type: "refresh" }); elements.close.onclick = () => bridge?.close?.();
  bridge?.onMessage?.((message) => { if (message?.type === "state") { removeArmedFriendId = null; deleteArmedGroupId = null; removeArmedMemberKey = null; leaveArmedGroupId = null; model = { groups: [], groupInvites: [], ...message.state }; render(); if (message.notice) elements.status.textContent = message.notice; if (message.sentTo) { elements["message-body"].value = ""; elements["anonymous-toggle"].checked = false; selectedStickerId = null; renderStickers(); elements.counter.textContent = `0 / ${model.maxMessageLength}`; } } else if (message?.type === "error") elements.status.textContent = message.message; });

  renderStickers(); render(); send({ type: "ready" });
})();
