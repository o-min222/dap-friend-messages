(() => {
  "use strict";

  const bridge = window.dapPalette;
  const viewNames = ["home", "manage"];
  const ids = [
    "app", "connect-panel", "connect-google", "workspace", "refresh", "close", "status", "nav-unread",
    "invite-count", "anonymous-thread-section", "anonymous-thread-list", "friend-thread-list", "group-thread-list", "contact-empty", "view-detail", "detail-back",
    "detail-kind", "detail-name", "detail-unread", "message-stack", "inbox-empty", "message-form", "composer-hint",
    "sticker-grid", "message-body", "anonymous-toggle", "counter", "send", "my-code", "friend-add-trigger", "friend-form", "friend-code",
    "friend-alias", "friend-add-submit", "friend-add-cancel", "profile-row", "profile-form", "profile-name", "profile-current-name", "profile-save", "profile-cancel", "friend-list", "friend-empty",
    "invite-section", "invite-list", "group-add-trigger", "group-form", "group-name", "group-friend-options", "group-create-submit", "group-create-cancel", "group-list", "group-empty",
    "manage-dialog-backdrop", "manage-dialog", "manage-dialog-title", "manage-dialog-close", "profile-panel", "friend-add-panel", "friend-panel", "group-create-panel", "group-panel",
    "friend-detail-name", "friend-detail-status", "friend-message", "friend-alias-form", "friend-detail-alias", "friend-alias-save", "friend-alias-reset", "friend-block", "friend-remove",
    "group-detail-name", "group-detail-status", "group-rename-form", "group-rename-name", "group-rename-save", "group-invite-controls", "group-invite-select", "group-invite-button", "group-member-list", "group-leave", "group-delete",
    "invite-panel", "invite-detail-name", "invite-detail-status", "invite-accept", "invite-decline",
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
  let manageButtons = new Map();
  let dialogKind = null;
  let dialogEntityId = "";
  let dialogTriggerKey = "";
  let dialogFocusables = [];
  let pendingDialogOperation = null;
  let groupFriendInputs = new Map();
  let groupMemberButtons = new Map();
  let operationSequence = 0;
  const operationSessionId = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 12)
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 18);

  const nextOperationId = () => `palette-${operationSessionId}-${++operationSequence}`;

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

  const triggerFor = (key) => key === "profile" ? elements["profile-row"]
    : key === "friend-add" ? elements["friend-add-trigger"]
      : key === "group-add" ? elements["group-add-trigger"] : manageButtons.get(key);

  function closeManageDialog(restoreFocus = true) {
    const triggerKey = dialogTriggerKey;
    dialogKind = null; dialogEntityId = ""; dialogTriggerKey = ""; dialogFocusables = []; pendingDialogOperation = null;
    removeArmedFriendId = null; deleteArmedGroupId = null; removeArmedMemberKey = null; leaveArmedGroupId = null;
    elements["manage-dialog-backdrop"].hidden = true;
    for (const id of ["profile-panel", "friend-add-panel", "friend-panel", "group-create-panel", "group-panel", "invite-panel"]) elements[id].hidden = true;
    if (restoreFocus) (triggerFor(triggerKey) || elements["tab-manage"]).focus?.();
  }

  function setDialogFocusables(items) {
    dialogFocusables = [elements["manage-dialog-close"], ...items.filter((item) => item && !item.hidden && !item.disabled)];
  }

  function renderGroupFriendOptions() {
    const focusedFriendId = [...groupFriendInputs].find(([, input]) => input === document.activeElement)?.[0];
    elements["group-friend-options"].replaceChildren();
    groupFriendInputs = new Map();
    const inputs = [];
    for (const friend of model.friends.filter((item) => !item.blocked)) {
      const label = el("label", "check-option"); const input = el("input"); input.type = "checkbox"; input.checked = groupMemberIds.has(friend.id);
      input.onchange = () => { if (input.checked && groupMemberIds.size < 7) groupMemberIds.add(friend.id); else { groupMemberIds.delete(friend.id); input.checked = false; } };
      label.append(input, el("span", "", friend.name)); elements["group-friend-options"].append(label); inputs.push(input); groupFriendInputs.set(friend.id, input);
    }
    if (focusedFriendId) groupFriendInputs.get(focusedFriendId)?.focus?.();
    return inputs;
  }

  function renderManageDialog(initial = false) {
    if (!dialogKind) return;
    elements["manage-dialog-backdrop"].hidden = false;
    for (const id of ["profile-panel", "friend-add-panel", "friend-panel", "group-create-panel", "group-panel", "invite-panel"]) elements[id].hidden = true;
    let firstFocus = elements["manage-dialog-title"];
    if (dialogKind === "profile") {
      elements["profile-panel"].hidden = false; elements["manage-dialog-title"].textContent = "내 프로필";
      if (initial) elements["profile-name"].value = model.me?.nameCustomized ? model.me.name : "";
      updateNameValidity(elements["profile-name"], "공개 별명", true);
      elements["profile-save"].disabled = Boolean(pendingDialogOperation);
      setDialogFocusables([elements["profile-name"], elements["profile-save"], elements["profile-cancel"]]); firstFocus = elements["profile-name"];
    } else if (dialogKind === "friend-add") {
      elements["friend-add-panel"].hidden = false; elements["manage-dialog-title"].textContent = "친구 추가";
      if (initial) { elements["friend-code"].value = ""; elements["friend-alias"].value = ""; }
      updateNameValidity(elements["friend-alias"], "친구 별칭"); elements["friend-add-submit"].disabled = Boolean(pendingDialogOperation);
      setDialogFocusables([elements["friend-code"], elements["friend-alias"], elements["friend-add-submit"], elements["friend-add-cancel"]]); firstFocus = elements["friend-code"];
    } else if (dialogKind === "friend") {
      const friend = model.friends.find((item) => item.id === dialogEntityId);
      if (!friend) return closeManageDialog(true);
      const publicName = friend.publicName || friend.name || "친구";
      elements["friend-panel"].hidden = false; elements["manage-dialog-title"].textContent = "친구 상세";
      elements["friend-detail-name"].textContent = friend.name; elements["friend-detail-status"].textContent = `${friend.hasAlias ? `공개 별명 ${publicName}` : "친구의 공개 별명"}${friend.blocked ? " · 차단됨" : ""}`;
      if (initial) elements["friend-detail-alias"].value = friend.hasAlias ? friend.alias || friend.name : "";
      updateNameValidity(elements["friend-detail-alias"], "친구 별칭");
      elements["friend-message"].disabled = friend.blocked; elements["friend-alias-save"].disabled = Boolean(pendingDialogOperation); elements["friend-alias-reset"].disabled = Boolean(pendingDialogOperation); elements["friend-alias-reset"].hidden = !friend.hasAlias;
      elements["friend-block"].textContent = friend.blocked ? "차단 해제" : "차단"; elements["friend-block"].disabled = Boolean(pendingDialogOperation);
      const armed = removeArmedFriendId === friend.id; elements["friend-remove"].textContent = armed ? "삭제 확정" : "친구 삭제"; elements["friend-remove"].setAttribute("aria-label", armed ? `${friend.name} 삭제 확정` : `${friend.name} 삭제 확인`);
      elements["friend-remove"].disabled = Boolean(pendingDialogOperation);
      setDialogFocusables([elements["friend-message"], elements["friend-detail-alias"], elements["friend-alias-save"], elements["friend-alias-reset"], elements["friend-block"], elements["friend-remove"]]);
    } else if (dialogKind === "group-create") {
      elements["group-create-panel"].hidden = false; elements["manage-dialog-title"].textContent = "새 모임 만들기";
      if (initial) { elements["group-name"].value = ""; groupMemberIds = new Set(); }
      updateLengthValidity(elements["group-name"], 30, "모임 이름"); const memberInputs = renderGroupFriendOptions(); elements["group-create-submit"].disabled = Boolean(pendingDialogOperation);
      setDialogFocusables([elements["group-name"], ...memberInputs, elements["group-create-submit"], elements["group-create-cancel"]]); firstFocus = elements["group-name"];
    } else if (dialogKind === "group") {
      const group = model.groups.find((item) => item.id === dialogEntityId);
      if (!group) return closeManageDialog(true);
      elements["group-panel"].hidden = false; elements["manage-dialog-title"].textContent = "모임 상세";
      elements["group-detail-name"].textContent = group.name; elements["group-detail-status"].textContent = `${group.members.length}명 · ${group.owner ? "모임장" : "멤버"}`;
      elements["group-rename-form"].hidden = !group.owner; elements["group-invite-controls"].hidden = !group.owner; elements["group-delete"].hidden = !group.owner; elements["group-leave"].hidden = group.owner;
      if (initial) elements["group-rename-name"].value = group.name;
      elements["group-rename-save"].disabled = Boolean(pendingDialogOperation); elements["group-invite-button"].disabled = Boolean(pendingDialogOperation) || group.members.length >= 8;
      elements["group-invite-select"].replaceChildren(); const empty = el("option", "", "친구 선택"); empty.value = ""; elements["group-invite-select"].append(empty);
      const memberSet = new Set(group.members.map((member) => member.id));
      for (const friend of model.friends.filter((item) => !item.blocked && !memberSet.has(item.id))) { const option = el("option", "", friend.name); option.value = friend.id; elements["group-invite-select"].append(option); }
      const focusedMemberId = [...groupMemberButtons].find(([, button]) => button === document.activeElement)?.[0];
      elements["group-member-list"].replaceChildren(); groupMemberButtons = new Map(); const memberButtons = [];
      for (const member of group.members) {
        const row = el("li", ""); row.append(el("span", "", member.name));
        if (group.owner && member.id !== model.me?.id) {
          const memberKey = `${group.id}:${member.id}`; const armed = removeArmedMemberKey === memberKey; const kick = el("button", "text-button danger", armed ? "내보내기 확정" : "내보내기"); kick.type = "button"; kick.setAttribute("aria-label", armed ? `${member.name} 내보내기 확정` : `${member.name} 내보내기 확인`);
          kick.disabled = Boolean(pendingDialogOperation); kick.onclick = () => { if (pendingDialogOperation) return; if (!armed) { removeArmedMemberKey = memberKey; deleteArmedGroupId = null; renderManageDialog(false); groupMemberButtons.get(member.id)?.focus?.(); } else { const operationId = nextOperationId(); removeArmedMemberKey = null; pendingDialogOperation = { kind: "member-remove", operationId }; send({ type: "removeGroupMember", groupId: group.id, memberId: member.id, operationId }); renderManageDialog(false); } }; row.append(kick); memberButtons.push(kick); groupMemberButtons.set(member.id, kick);
        }
        elements["group-member-list"].append(row);
      }
      if (focusedMemberId) groupMemberButtons.get(focusedMemberId)?.focus?.();
      const deleteArmed = deleteArmedGroupId === group.id; elements["group-delete"].textContent = deleteArmed ? "한 번 더 눌러 삭제" : "모임 삭제"; elements["group-delete"].setAttribute("aria-label", deleteArmed ? `${group.name} 모임 삭제 확정` : `${group.name} 모임 삭제 확인`);
      const leaveArmed = leaveArmedGroupId === group.id; elements["group-leave"].textContent = leaveArmed ? "한 번 더 눌러 나가기" : "모임 나가기"; elements["group-leave"].setAttribute("aria-label", leaveArmed ? `${group.name} 모임 나가기 확정` : `${group.name} 모임 나가기 확인`);
      elements["group-delete"].disabled = Boolean(pendingDialogOperation); elements["group-leave"].disabled = Boolean(pendingDialogOperation);
      setDialogFocusables([elements["group-rename-name"], elements["group-rename-save"], elements["group-invite-select"], elements["group-invite-button"], ...memberButtons, elements["group-leave"], elements["group-delete"]]);
    } else if (dialogKind === "invite") {
      const invite = model.groupInvites.find((item) => item.id === dialogEntityId);
      if (!invite) return closeManageDialog(true);
      elements["invite-panel"].hidden = false; elements["manage-dialog-title"].textContent = "받은 모임 초대";
      elements["invite-detail-name"].textContent = invite.groupName; elements["invite-detail-status"].textContent = `${invite.inviterName}님의 초대`;
      elements["invite-accept"].disabled = Boolean(pendingDialogOperation); elements["invite-decline"].disabled = Boolean(pendingDialogOperation);
      setDialogFocusables([elements["invite-accept"], elements["invite-decline"]]); firstFocus = elements["invite-accept"];
    }
    if (initial) firstFocus.focus?.();
  }

  function openManageDialog(kind, entityId, triggerKey) {
    dialogKind = kind; dialogEntityId = entityId || ""; dialogTriggerKey = triggerKey; pendingDialogOperation = null;
    removeArmedFriendId = null; deleteArmedGroupId = null; removeArmedMemberKey = null; leaveArmedGroupId = null;
    renderManageDialog(true);
  }

  function appendManageRow(list, key, name, detail, avatar, onOpen) {
    const item = el("li", ""); const button = el("button", "manage-row"); button.type = "button"; button.setAttribute("aria-haspopup", "dialog"); button.setAttribute("aria-label", `${name} 상세 열기`);
    const info = el("span", "manage-info"); info.append(el("strong", "", name), el("small", "", detail)); button.append(el("span", "manage-avatar", avatar), info, el("span", "chevron", "›")); button.onclick = onOpen; item.append(button); list.append(item); manageButtons.set(key, button);
  }

  function renderManagement() {
    const focusedManageKey = [...manageButtons].find(([, button]) => button === document.activeElement)?.[0];
    manageButtons = new Map(); elements["friend-list"].replaceChildren(); elements["group-list"].replaceChildren();
    elements["my-code"].textContent = model.me?.code || "------"; elements["profile-current-name"].textContent = model.me?.name || "설정 전";
    for (const friend of model.friends) {
      const publicName = friend.publicName || friend.name || "친구"; const detail = `${friend.hasAlias ? `공개 별명 ${publicName}` : "친구의 공개 별명"}${friend.blocked ? " · 차단됨" : ""}`;
      appendManageRow(elements["friend-list"], `friend:${friend.id}`, friend.name, detail, "☺", () => openManageDialog("friend", friend.id, `friend:${friend.id}`));
    }
    for (const group of model.groups) appendManageRow(elements["group-list"], `group:${group.id}`, group.name, `${group.members.length}명 · ${group.owner ? "모임장" : "멤버"}`, "👥", () => openManageDialog("group", group.id, `group:${group.id}`));
    elements["friend-empty"].hidden = model.friends.length > 0; elements["group-empty"].hidden = model.groups.length > 0;
    elements["invite-list"].replaceChildren();
    for (const invite of model.groupInvites) appendManageRow(elements["invite-list"], `invite:${invite.id}`, invite.groupName, `${invite.inviterName}님의 초대`, "✉", () => openManageDialog("invite", invite.id, `invite:${invite.id}`));
    elements["invite-section"].hidden = model.groupInvites.length === 0; elements["invite-count"].textContent = String(model.groupInvites.length); elements["invite-count"].hidden = model.groupInvites.length === 0;
    if (dialogKind) renderManageDialog(false);
    else if (focusedManageKey) (manageButtons.get(focusedManageKey) || elements["tab-manage"]).focus?.();
  }

  function render() {
    const connected = model.connection === "connected";
    elements.app.setAttribute("aria-busy", model.busy || model.connection === "checking" ? "true" : "false");
    elements["connect-panel"].hidden = connected; elements.workspace.hidden = !connected; elements.refresh.hidden = !connected;
    elements["connect-google"].disabled = model.busy || model.connection === "checking";
    if (!connected) { elements.status.textContent = model.error || (model.connection === "checking" ? "Google 연결 상태를 확인하고 있어요." : "Google 연결이 필요해요."); return; }
    renderThreads(); renderManagement();
    elements["nav-unread"].textContent = String(model.unreadCount || 0); elements["nav-unread"].hidden = !model.unreadCount;
    if (activeView === "detail") renderDetail(); else showView(activeView);
    elements.status.textContent = model.error ? `연결 오류: ${model.error}` : model.busy ? "새 쪽지를 확인하는 중…" : model.lastSyncedAt ? `${timeLabel(model.lastSyncedAt)}에 확인했어요.` : "쪽지함을 준비하고 있어요.";
  }

  for (const name of viewNames) elements[`tab-${name}`].onclick = () => showView(name);
  elements["detail-back"].onclick = () => showView("home", true);
  elements["profile-row"].onclick = () => openManageDialog("profile", "", "profile");
  elements["friend-add-trigger"].onclick = () => openManageDialog("friend-add", "", "friend-add");
  elements["group-add-trigger"].onclick = () => openManageDialog("group-create", "", "group-add");
  elements["manage-dialog-close"].onclick = () => closeManageDialog(true);
  elements["profile-cancel"].onclick = () => closeManageDialog(true);
  elements["friend-add-cancel"].onclick = () => closeManageDialog(true);
  elements["group-create-cancel"].onclick = () => closeManageDialog(true);
  elements["manage-dialog"].addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault?.(); closeManageDialog(true); return; }
    if (event.key !== "Tab" || dialogFocusables.length === 0) return;
    const index = dialogFocusables.indexOf(document.activeElement); const backwards = event.shiftKey === true;
    if ((!backwards && index === dialogFocusables.length - 1) || (backwards && index <= 0)) { event.preventDefault?.(); dialogFocusables[backwards ? dialogFocusables.length - 1 : 0].focus?.(); }
  });
  elements["message-body"].addEventListener("input", () => { const count = codepointLength(elements["message-body"].value); elements.counter.textContent = `${count} / ${model.maxMessageLength}`; updateLengthValidity(elements["message-body"], model.maxMessageLength, "쪽지"); });
  elements["group-name"].addEventListener("input", () => updateLengthValidity(elements["group-name"], 30, "모임 이름"));
  elements["group-rename-name"].addEventListener("input", () => updateLengthValidity(elements["group-rename-name"], 30, "모임 이름"));
  elements["friend-alias"].addEventListener("input", () => updateNameValidity(elements["friend-alias"], "친구 별칭"));
  elements["friend-detail-alias"].addEventListener("input", () => updateNameValidity(elements["friend-detail-alias"], "친구 별칭"));
  elements["profile-name"].addEventListener("input", () => updateNameValidity(elements["profile-name"], "공개 별명", true));
  elements["friend-code"].addEventListener("input", () => { elements["friend-code"].value = elements["friend-code"].value.toUpperCase().replace(/[^A-F0-9]/gu, "").slice(0, 6); });
  elements["friend-form"].addEventListener("submit", (event) => { event.preventDefault(); if (pendingDialogOperation || !updateNameValidity(elements["friend-alias"], "친구 별칭")) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "friend-add", operationId }; send({ type: "addFriend", code: elements["friend-code"].value, alias: elements["friend-alias"].value, operationId }); renderManageDialog(false); });
  elements["profile-form"].addEventListener("submit", (event) => { event.preventDefault(); if (pendingDialogOperation || !updateNameValidity(elements["profile-name"], "공개 별명", true)) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "profile", operationId }; send({ type: "updateProfileName", name: elements["profile-name"].value, operationId }); renderManageDialog(false); });
  elements["friend-alias-form"].addEventListener("submit", (event) => { event.preventDefault(); if (pendingDialogOperation || !updateNameValidity(elements["friend-detail-alias"], "친구 별칭")) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "friend-alias", operationId }; send({ type: "updateFriendAlias", friendId: dialogEntityId, alias: elements["friend-detail-alias"].value, operationId }); renderManageDialog(false); });
  elements["friend-alias-reset"].onclick = () => { if (pendingDialogOperation) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "friend-alias", operationId }; send({ type: "updateFriendAlias", friendId: dialogEntityId, alias: null, operationId }); renderManageDialog(false); };
  elements["friend-message"].onclick = () => { const friend = model.friends.find((item) => item.id === dialogEntityId); if (!friend || friend.blocked) return; closeManageDialog(false); openTarget({ type: "friend", id: friend.id, name: friend.name }); };
  elements["friend-block"].onclick = () => { const friend = model.friends.find((item) => item.id === dialogEntityId); if (!friend || pendingDialogOperation) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "friend-block", operationId }; send({ type: friend.blocked ? "unblockFriend" : "blockFriend", friendId: friend.id, operationId }); renderManageDialog(false); };
  elements["friend-remove"].onclick = () => { const friend = model.friends.find((item) => item.id === dialogEntityId); if (!friend || pendingDialogOperation) return; if (removeArmedFriendId !== friend.id) { removeArmedFriendId = friend.id; renderManageDialog(false); } else { const operationId = nextOperationId(); removeArmedFriendId = null; pendingDialogOperation = { kind: "friend-remove", operationId }; send({ type: "removeFriend", friendId: friend.id, operationId }); renderManageDialog(false); } };
  elements["message-form"].addEventListener("submit", (event) => { event.preventDefault(); if (!selectedTarget || selectedTarget.type === "anonymous") return; if (!updateLengthValidity(elements["message-body"], model.maxMessageLength, "쪽지")) return; send({ type: "sendMessage", targetType: selectedTarget.type, targetId: selectedTarget.id, body: elements["message-body"].value, stickerId: selectedStickerId, anonymous: elements["anonymous-toggle"].checked === true }); });
  elements["group-form"].addEventListener("submit", (event) => { event.preventDefault(); if (pendingDialogOperation || !updateLengthValidity(elements["group-name"], 30, "모임 이름")) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "group-create", operationId }; send({ type: "createGroup", name: elements["group-name"].value, memberIds: [...groupMemberIds], operationId }); renderManageDialog(false); });
  elements["group-rename-form"].addEventListener("submit", (event) => { event.preventDefault(); if (pendingDialogOperation || !updateLengthValidity(elements["group-rename-name"], 30, "모임 이름")) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "group-rename", operationId }; send({ type: "updateGroup", groupId: dialogEntityId, name: elements["group-rename-name"].value, operationId }); renderManageDialog(false); });
  elements["group-invite-button"].onclick = () => { if (pendingDialogOperation || !elements["group-invite-select"].value) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "group-invite", operationId }; send({ type: "inviteGroup", groupId: dialogEntityId, memberIds: [elements["group-invite-select"].value], operationId }); renderManageDialog(false); };
  const respondToInvite = (accept) => { if (dialogKind !== "invite" || pendingDialogOperation) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "invite-response", operationId }; send({ type: "respondGroupInvite", inviteId: dialogEntityId, accept, operationId }); renderManageDialog(false); };
  elements["invite-accept"].onclick = () => respondToInvite(true); elements["invite-decline"].onclick = () => respondToInvite(false);
  elements["group-delete"].onclick = () => { const group = model.groups.find((item) => item.id === dialogEntityId); if (!group?.owner || pendingDialogOperation) return; if (deleteArmedGroupId !== group.id) { deleteArmedGroupId = group.id; removeArmedMemberKey = null; renderManageDialog(false); } else { const operationId = nextOperationId(); deleteArmedGroupId = null; pendingDialogOperation = { kind: "group-delete", operationId }; send({ type: "deleteGroup", groupId: group.id, operationId }); renderManageDialog(false); } };
  elements["group-leave"].onclick = () => { const group = model.groups.find((item) => item.id === dialogEntityId); if (!group || group.owner || pendingDialogOperation) return; if (leaveArmedGroupId !== group.id) { leaveArmedGroupId = group.id; renderManageDialog(false); } else { const operationId = nextOperationId(); leaveArmedGroupId = null; pendingDialogOperation = { kind: "group-leave", operationId }; send({ type: "leaveGroup", groupId: group.id, operationId }); renderManageDialog(false); } };
  elements["connect-google"].onclick = () => send({ type: "connectGoogle" }); elements.refresh.onclick = () => send({ type: "refresh" }); elements.close.onclick = () => bridge?.close?.();
  bridge?.onMessage?.((message) => {
    if (message?.type === "state") {
      removeArmedFriendId = null; deleteArmedGroupId = null; removeArmedMemberKey = null; leaveArmedGroupId = null;
      const completedDialogOperation = pendingDialogOperation?.operationId === message.operationId ? pendingDialogOperation : null;
      model = { groups: [], groupInvites: [], ...message.state }; render();
      if (message.notice) elements.status.textContent = message.notice;
      if (message.sentTo) { elements["message-body"].value = ""; elements["anonymous-toggle"].checked = false; selectedStickerId = null; renderStickers(); elements.counter.textContent = `0 / ${model.maxMessageLength}`; }
      if (completedDialogOperation) {
        pendingDialogOperation = null;
        if (["profile", "friend-add", "friend-alias", "group-create", "friend-remove", "group-delete", "group-leave", "invite-response"].includes(completedDialogOperation.kind)) closeManageDialog(true);
        else { if (completedDialogOperation.kind === "group-invite") elements["group-invite-select"].value = ""; renderManageDialog(false); }
      }
    } else if (message?.type === "error") {
      if (pendingDialogOperation?.operationId === message.operationId) pendingDialogOperation = null;
      elements.status.textContent = message.message;
      renderManageDialog(false);
      if (dialogKind === "profile") elements["profile-name"].focus?.();
      else if (dialogKind === "friend-add") elements["friend-code"].focus?.();
      else if (dialogKind === "friend") elements["friend-detail-alias"].focus?.();
      else if (dialogKind === "group-create") elements["group-name"].focus?.();
      else if (dialogKind === "group") elements["group-rename-name"].focus?.();
      else if (dialogKind === "invite") elements["invite-accept"].focus?.();
    }
  });

  renderStickers(); render(); send({ type: "ready" });
})();
