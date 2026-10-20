(() => {
  "use strict";

  const bridge = window.dapPalette;
  const viewNames = ["home", "manage"];
  const ids = [
    "app", "connect-panel", "connect-google", "workspace", "refresh", "close", "status", "nav-unread",
    "invite-count", "anonymous-thread-section", "anonymous-thread-list", "friend-thread-list", "group-thread-list", "contact-empty", "view-detail", "detail-back",
    "detail-kind", "detail-name", "detail-unread", "message-stack", "inbox-empty", "message-form", "composer-hint",
    "sticker-grid", "message-body", "anonymous-toggle", "counter", "send", "my-code", "friend-form", "friend-code",
    "friend-alias", "profile-form", "profile-name", "profile-current-name", "friend-list", "friend-empty",
    "invite-section", "invite-list", "group-form", "group-name", "group-friend-options", "group-list", "group-empty",
    ...viewNames.flatMap((name) => [`tab-${name}`, `view-${name}`]),
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  const stickerPresets = [
    ["smile", "🙂", "미소"], ["cheer", "💪", "응원"], ["love", "💗", "사랑"], ["surprise", "😮", "놀람"],
    ["sulk", "😤", "삐짐"], ["cry", "😢", "눈물"], ["celebrate", "🎉", "축하"], ["tired", "😴", "피곤"],
  ];
  const stickerMap = Object.fromEntries(stickerPresets.map(([id, emoji, label]) => [id, { emoji, label }]));
  let model = { connection: "checking", busy: false, me: {}, friends: [], groups: [], groupInvites: [], messages: [], maxMessageLength: 100 };
  let activeView = "home";
  let selectedTarget = null;
  let selectedStickerId = null;
  let groupMemberIds = new Set();
  let removeArmedFriendId = null;
  let deleteArmedGroupId = null;
  let removeArmedMemberKey = null;
  let leaveArmedGroupId = null;
  let threadButtons = new Map();

  const send = (message) => bridge?.postMessage?.(message);
  const codepointLength = (value) => [...String(value || "")].length;
  const nameForbiddenPattern = /[\p{Cc}\p{Cf}]/u;
  const updateLengthValidity = (input, max, label) => {
    const valid = codepointLength(input.value) <= max;
    input.setCustomValidity?.(valid ? "" : `${label}은 ${max}자까지 입력할 수 있어요.`);
    input.setAttribute("aria-invalid", valid ? "false" : "true");
    return valid;
  };
  const updateNameValidity = (input, label, required = false) => {
    const value = String(input.value || "");
    const message = nameForbiddenPattern.test(value)
      ? `${label}에는 제어 문자를 사용할 수 없어요.`
      : codepointLength(value.trim()) > 20
        ? `${label}은 20자까지 입력할 수 있어요.`
        : required && !value.trim() ? `${label}을 입력해 주세요.` : "";
    input.setCustomValidity?.(message);
    input.setAttribute("aria-invalid", message ? "true" : "false");
    return !message;
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
  const senderLabel = (message) => message.anonymous ? "익명의 친구" : message.senderName;
  const senderSubject = (message) => message.anonymous ? "익명의 친구가" : `${message.senderName} 님이`;
  const stickerNode = (id) => stickerMap[id] ? el("span", "note-sticker", stickerMap[id].emoji) : null;
  const targetKey = (target) => target ? `${target.type}:${target.id}` : "";

  function messageBelongsTo(message, target) {
    if (!target) return false;
    if (target.type === "anonymous") return message.anonymous && message.targetType !== "group";
    if (target.type === "group") return message.targetType === "group" && message.targetId === target.id;
    return !message.anonymous && message.targetType !== "group" && (message.senderId === target.id || message.targetId === target.id);
  }

  function targetMessages(target = selectedTarget) {
    return model.messages.filter((message) => messageBelongsTo(message, target));
  }

  function unreadFor(target) {
    return targetMessages(target).filter((message) => !message.openedAt).length;
  }

  function showView(name, restoreFocus = false) {
    if (!viewNames.includes(name)) return;
    activeView = name;
    elements["view-detail"].hidden = true;
    for (const view of viewNames) {
      elements[`view-${view}`].hidden = view !== name;
      elements[`tab-${view}`].className = `tab${view === name ? " active" : ""}`;
      elements[`tab-${view}`].setAttribute("aria-current", view === name ? "page" : "false");
    }
    if (restoreFocus && selectedTarget) {
      const targetButton = threadButtons.get(targetKey(selectedTarget));
      (targetButton || elements["tab-home"]).focus?.();
    }
  }

  function openTarget(target) {
    selectedTarget = target;
    activeView = "detail";
    for (const view of viewNames) elements[`view-${view}`].hidden = true;
    elements["view-detail"].hidden = false;
    for (const view of viewNames) {
      const homeActive = view === "home";
      elements[`tab-${view}`].className = `tab${homeActive ? " active" : ""}`;
      elements[`tab-${view}`].setAttribute("aria-current", homeActive ? "page" : "false");
    }
    renderDetail();
    elements["detail-name"].focus?.();
  }

  function appendThread(list, target, meta, disabled = false) {
    const item = el("li", "");
    const button = el("button", "thread-row");
    button.type = "button";
    button.disabled = disabled;
    button.setAttribute("aria-label", disabled ? `${target.name}, 차단됨` : `${target.name} 쪽지 상세 열기`);
    const copy = el("span", "thread-copy");
    copy.append(el("strong", "", target.name), el("small", "", meta));
    const unread = unreadFor(target);
    button.append(el("span", "thread-avatar", target.type === "group" ? "👥" : target.type === "anonymous" ? "?" : "✉"), copy);
    if (unread) button.append(el("span", "badge", String(unread)));
    button.onclick = () => openTarget(target);
    item.append(button);
    list.append(item);
    threadButtons.set(targetKey(target), button);
  }

  function renderThreads() {
    elements["anonymous-thread-list"].replaceChildren();
    elements["friend-thread-list"].replaceChildren();
    elements["group-thread-list"].replaceChildren();
    threadButtons = new Map();
    const anonymousTarget = { type: "anonymous", id: "anonymous", name: "익명 쪽지" };
    const hasAnonymous = unreadFor(anonymousTarget) > 0;
    elements["anonymous-thread-section"].hidden = !hasAnonymous;
    if (hasAnonymous) appendThread(elements["anonymous-thread-list"], anonymousTarget, "발신자를 숨긴 받은 쪽지");
    for (const friend of model.friends) {
      appendThread(elements["friend-thread-list"], { type: "friend", id: friend.id, name: friend.name }, friend.blocked ? "차단됨 · 관리에서 해제할 수 있어요" : "1:1 종이 쪽지", friend.blocked);
    }
    for (const group of model.groups) {
      appendThread(elements["group-thread-list"], { type: "group", id: group.id, name: group.name }, `${group.members.length}명 모임`);
    }
    const hasContacts = model.friends.length + model.groups.length > 0 || unreadFor(anonymousTarget) > 0;
    elements["contact-empty"].hidden = hasContacts;
  }

  function renderMessages(messages) {
    elements["message-stack"].replaceChildren();
    for (const message of messages) {
      if (message.openedAt) {
        const paper = el("article", "opened-note");
        paper.setAttribute("aria-label", `${senderSubject(message)} 보낸 열린 쪽지`);
        const meta = el("div", "note-meta");
        meta.append(el("strong", "", senderLabel(message)), el("time", "", timeLabel(message.createdAt)));
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
        const copy = el("span", "envelope-copy");
        copy.append(el("strong", "", senderLabel(message)), el("span", "", timeLabel(message.createdAt)));
        envelope.append(el("span", "envelope-seal", "✦"), copy, el("span", "envelope-open", "펼쳐보기"));
        elements["message-stack"].append(envelope);
      }
    }
    elements["inbox-empty"].hidden = messages.length > 0;
  }

  function renderDetail() {
    if (!selectedTarget) return showView("home");
    const currentContact = selectedTarget.type === "friend"
      ? model.friends.find((friend) => friend.id === selectedTarget.id && !friend.blocked)
      : selectedTarget.type === "group" ? model.groups.find((group) => group.id === selectedTarget.id) : null;
    const exists = selectedTarget.type === "anonymous" ? targetMessages(selectedTarget).length > 0 : Boolean(currentContact);
    if (!exists) { selectedTarget = null; return showView("home"); }
    if (currentContact) selectedTarget = { ...selectedTarget, name: currentContact.name };
    const messages = targetMessages();
    const unread = unreadFor(selectedTarget);
    elements["detail-name"].textContent = selectedTarget.name;
    elements["detail-kind"].textContent = selectedTarget.type === "group" ? "GROUP NOTE" : selectedTarget.type === "anonymous" ? "ANONYMOUS NOTE" : "FRIEND NOTE";
    elements["detail-unread"].textContent = String(unread);
    elements["detail-unread"].hidden = !unread;
    elements["message-form"].hidden = selectedTarget.type === "anonymous";
    elements["composer-hint"].hidden = selectedTarget.type !== "group";
    elements.send.disabled = model.busy || selectedTarget.type === "anonymous";
    renderMessages(messages);
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

  function renderFriends() {
    elements["friend-list"].replaceChildren();
    for (const friend of model.friends) {
      const publicName = friend.publicName || friend.name || "친구";
      const item = el("li", "manage-item friend-item");
      const info = el("span", "manage-info");
      const detail = friend.hasAlias ? `공개 별명 ${publicName}` : "친구의 공개 별명";
      info.append(el("strong", "", friend.name), el("small", "", friend.blocked ? `${detail} · 차단됨` : detail));
      const actions = el("span", "row-actions");
      const block = el("button", "text-button", friend.blocked ? "차단 해제" : "차단"); block.type = "button"; block.onclick = () => send({ type: friend.blocked ? "unblockFriend" : "blockFriend", friendId: friend.id });
      const armed = removeArmedFriendId === friend.id;
      const remove = el("button", "text-button danger", armed ? "삭제 확정" : "삭제"); remove.type = "button"; remove.setAttribute("aria-label", armed ? `${friend.name} 삭제 확정` : `${friend.name} 삭제 확인`);
      remove.onclick = () => { if (!armed) { removeArmedFriendId = friend.id; renderFriends(); } else { removeArmedFriendId = null; send({ type: "removeFriend", friendId: friend.id }); renderFriends(); } };
      const aliasEditor = el("div", "friend-alias-editor");
      const aliasInput = el("input"); aliasInput.value = friend.hasAlias ? friend.alias || friend.name : ""; aliasInput.placeholder = publicName; aliasInput.setAttribute("aria-label", `${friend.name} 내가 부를 이름`);
      aliasInput.addEventListener("input", () => updateNameValidity(aliasInput, "친구 별칭"));
      const saveAlias = el("button", "text-button", "별칭 저장"); saveAlias.type = "button"; saveAlias.onclick = () => { if (updateNameValidity(aliasInput, "친구 별칭")) send({ type: "updateFriendAlias", friendId: friend.id, alias: aliasInput.value }); };
      const resetAlias = el("button", "text-button", "공개 별명 사용"); resetAlias.type = "button"; resetAlias.hidden = !friend.hasAlias; resetAlias.setAttribute("aria-label", `${friend.name} 별칭을 지우고 ${publicName} 사용`); resetAlias.onclick = () => send({ type: "updateFriendAlias", friendId: friend.id, alias: null });
      aliasEditor.append(aliasInput, saveAlias, resetAlias);
      actions.append(block, remove); item.append(info, actions, aliasEditor); elements["friend-list"].append(item);
    }
    elements["friend-empty"].hidden = model.friends.length > 0;
    elements["my-code"].textContent = model.me?.code || "------";
    elements["profile-current-name"].textContent = model.me?.name || "설정 전";
    elements["profile-name"].value = model.me?.nameCustomized ? model.me.name : "";
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
        const row = el("li", ""); row.append(el("span", "", member.name));
        if (group.owner && member.id !== model.me?.id) {
          const memberKey = `${group.id}:${member.id}`; const armed = removeArmedMemberKey === memberKey;
          const kick = el("button", "text-button danger", armed ? "내보내기 확정" : "내보내기"); kick.type = "button"; kick.setAttribute("aria-label", armed ? `${member.name} 내보내기 확정` : `${member.name} 내보내기 확인`);
          kick.onclick = () => { if (!armed) { removeArmedMemberKey = memberKey; deleteArmedGroupId = null; leaveArmedGroupId = null; renderGroups(); } else { removeArmedMemberKey = null; send({ type: "removeGroupMember", groupId: group.id, memberId: member.id }); renderGroups(); } };
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
        const del = el("button", "text-button danger", deleteArmed ? "한 번 더 눌러 삭제" : "모임 삭제"); del.type = "button"; del.setAttribute("aria-label", deleteArmed ? `${group.name} 모임 삭제 확정` : `${group.name} 모임 삭제 확인`);
        del.onclick = () => { if (!deleteArmed) { deleteArmedGroupId = group.id; removeArmedMemberKey = null; leaveArmedGroupId = null; renderGroups(); } else { deleteArmedGroupId = null; send({ type: "deleteGroup", groupId: group.id }); renderGroups(); } };
        actions.append(rename, save, inviteSelect, invite, del);
      } else {
        const leaveArmed = leaveArmedGroupId === group.id;
        const leave = el("button", "text-button danger", leaveArmed ? "한 번 더 눌러 나가기" : "모임 나가기"); leave.type = "button"; leave.setAttribute("aria-label", leaveArmed ? `${group.name} 모임 나가기 확정` : `${group.name} 모임 나가기 확인`);
        leave.onclick = () => { if (!leaveArmed) { leaveArmedGroupId = group.id; deleteArmedGroupId = null; removeArmedMemberKey = null; renderGroups(); } else { leaveArmedGroupId = null; send({ type: "leaveGroup", groupId: group.id }); renderGroups(); } };
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
    renderThreads(); renderFriends(); renderGroups();
    elements["nav-unread"].textContent = String(model.unreadCount || 0); elements["nav-unread"].hidden = !model.unreadCount;
    if (activeView === "detail") renderDetail(); else showView(activeView);
    elements.status.textContent = model.error ? `연결 오류: ${model.error}` : model.busy ? "새 쪽지를 확인하는 중…" : model.lastSyncedAt ? `${timeLabel(model.lastSyncedAt)}에 확인했어요.` : "쪽지함을 준비하고 있어요.";
  }

  for (const name of viewNames) elements[`tab-${name}`].onclick = () => showView(name);
  elements["detail-back"].onclick = () => showView("home", true);
  elements["message-body"].addEventListener("input", () => { const count = codepointLength(elements["message-body"].value); elements.counter.textContent = `${count} / ${model.maxMessageLength}`; updateLengthValidity(elements["message-body"], model.maxMessageLength, "쪽지"); });
  elements["group-name"].addEventListener("input", () => updateLengthValidity(elements["group-name"], 30, "모임 이름"));
  elements["friend-alias"].addEventListener("input", () => updateNameValidity(elements["friend-alias"], "친구 별칭"));
  elements["profile-name"].addEventListener("input", () => updateNameValidity(elements["profile-name"], "공개 별명", true));
  elements["friend-code"].addEventListener("input", () => { elements["friend-code"].value = elements["friend-code"].value.toUpperCase().replace(/[^A-F0-9]/gu, "").slice(0, 6); });
  elements["friend-form"].addEventListener("submit", (event) => { event.preventDefault(); if (!updateNameValidity(elements["friend-alias"], "친구 별칭")) return; send({ type: "addFriend", code: elements["friend-code"].value, alias: elements["friend-alias"].value }); });
  elements["profile-form"].addEventListener("submit", (event) => { event.preventDefault(); if (!updateNameValidity(elements["profile-name"], "공개 별명", true)) return; send({ type: "updateProfileName", name: elements["profile-name"].value }); });
  elements["message-form"].addEventListener("submit", (event) => { event.preventDefault(); if (!selectedTarget || selectedTarget.type === "anonymous") return; if (!updateLengthValidity(elements["message-body"], model.maxMessageLength, "쪽지")) return; send({ type: "sendMessage", targetType: selectedTarget.type, targetId: selectedTarget.id, body: elements["message-body"].value, stickerId: selectedStickerId, anonymous: elements["anonymous-toggle"].checked === true }); });
  elements["group-form"].addEventListener("submit", (event) => { event.preventDefault(); if (!updateLengthValidity(elements["group-name"], 30, "모임 이름")) return; send({ type: "createGroup", name: elements["group-name"].value, memberIds: [...groupMemberIds] }); });
  elements["connect-google"].onclick = () => send({ type: "connectGoogle" }); elements.refresh.onclick = () => send({ type: "refresh" }); elements.close.onclick = () => bridge?.close?.();
  bridge?.onMessage?.((message) => {
    if (message?.type === "state") {
      removeArmedFriendId = null; deleteArmedGroupId = null; removeArmedMemberKey = null; leaveArmedGroupId = null;
      model = { groups: [], groupInvites: [], ...message.state }; render();
      if (message.notice) elements.status.textContent = message.notice;
      if (message.sentTo) { elements["message-body"].value = ""; elements["anonymous-toggle"].checked = false; selectedStickerId = null; renderStickers(); elements.counter.textContent = `0 / ${model.maxMessageLength}`; }
    } else if (message?.type === "error") elements.status.textContent = message.message;
  });

  renderStickers(); render(); send({ type: "ready" });
})();
