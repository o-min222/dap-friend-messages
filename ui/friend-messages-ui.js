(() => {
  "use strict";

  const bridge = window.dapPalette;
  const viewNames = ["home", "manage"];
  const ids = [
    "app", "connect-panel", "connect-google", "workspace", "refresh", "close", "status", "nav-unread", "home-title",
    "invite-count", "message-list", "inbox-empty", "message-form", "composer-hint", "compose-recipient", "compose-back",
    "sticker-tray", "sticker-toggle", "sticker-grid", "message-body", "anonymous-toggle", "counter", "send", "manage-title", "manage-menu-trigger", "profile-row", "profile-current-name", "profile-view", "profile-display-name", "profile-code-value", "profile-code-copy", "profile-copy-status", "profile-edit", "manage-tab-friends", "manage-tab-groups", "group-invite-count", "friends-panel", "groups-panel", "friend-form", "friend-code",
    "friend-alias", "friend-add-submit", "friend-add-cancel", "profile-form", "profile-name", "profile-save", "profile-cancel", "friend-list", "friend-empty",
    "group-form", "group-name", "group-friend-options", "group-create-submit", "group-create-cancel", "group-list", "group-empty",
    "manage-dialog-backdrop", "manage-dialog", "manage-dialog-title", "manage-dialog-back", "manage-dialog-close", "menu-panel", "menu-friend-add", "menu-group-add", "profile-panel", "friend-add-panel", "friend-panel", "group-create-panel", "group-panel",
    "friend-detail-name", "friend-detail-status", "friend-message", "friend-alias-edit", "friend-alias-form", "friend-detail-alias", "friend-alias-save", "friend-alias-reset", "friend-alias-cancel", "friend-block", "friend-remove",
    "group-detail-name", "group-detail-status", "group-message", "group-rename-form", "group-rename-name", "group-rename-save", "group-invite-controls", "group-invite-select", "group-invite-button", "group-member-list", "group-leave", "group-delete",
    "invite-panel", "invite-detail-name", "invite-detail-status", "invite-accept", "invite-decline", "compose-panel",
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
  let activeManageSection = "friends";
  let selectedTarget = null;
  let selectedStickerId = null;
  let anonymousSelected = false;
  let stickerTrayOpen = false;
  let draftRevision = 0;
  let pendingSend = null;
  let groupMemberIds = new Set();
  let removeArmedFriendId = null;
  let deleteArmedGroupId = null;
  let removeArmedMemberKey = null;
  let leaveArmedGroupId = null;
  let messageRecords = new Map();
  let manageRecords = new Map();
  let dialogKind = null;
  let dialogEntityId = "";
  let dialogTriggerKey = "";
  let composeReturnKind = "";
  let dialogFocusables = [];
  let menuReturnFocusId = "";
  let pendingDialogOperation = null;
  let profileEditing = false;
  let friendAliasEditing = false;
  let groupFriendInputs = new Map();
  let groupMemberButtons = new Map();
  let operationSequence = 0;
  const operationSessionId = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 12)
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 18);

  const nextOperationId = () => `palette-${operationSessionId}-${++operationSequence}`;

  const send = (message) => bridge?.postMessage?.(message);
  const fallbackCopy = (value) => {
    const previousFocus = document.activeElement;
    const input = el("textarea"); input.value = value; input.setAttribute("aria-hidden", "true"); input.style.position = "fixed"; input.style.opacity = "0";
    document.body?.append?.(input); input.select?.();
    try { return document.execCommand?.("copy") === true; }
    finally { input.remove?.(); previousFocus?.focus?.(); }
  };
  const copyProfileCode = async () => {
    const code = String(model.me?.code || "");
    if (!code) { elements["profile-copy-status"].textContent = "복사할 친구 코드가 없어요."; return; }
    try {
      try {
        if (!globalThis.navigator?.clipboard?.writeText) throw new Error("clipboard unavailable");
        await globalThis.navigator.clipboard.writeText(code);
      } catch {
        if (!fallbackCopy(code)) throw new Error("copy failed");
      }
      elements["profile-copy-status"].textContent = "친구 코드를 복사했어요.";
    } catch {
      elements["profile-copy-status"].textContent = "복사하지 못했어요. 코드를 길게 눌러 직접 복사해 주세요.";
    }
  };
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

  function resizeComposer() {
    const input = elements["message-body"];
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight || 24, 96)}px`;
  }

  function renderAnonymousToggle() {
    elements["anonymous-toggle"].setAttribute("aria-pressed", anonymousSelected ? "true" : "false");
    elements["anonymous-toggle"].setAttribute("aria-label", `익명으로 보내기: ${anonymousSelected ? "켜짐" : "꺼짐"}`);
    elements["anonymous-toggle"].className = `composer-icon${anonymousSelected ? " selected" : ""}`;
  }

  function renderStickerTray() {
    elements["sticker-tray"].hidden = !stickerTrayOpen;
    elements["sticker-toggle"].setAttribute("aria-expanded", stickerTrayOpen ? "true" : "false");
    elements["sticker-toggle"].setAttribute("aria-label", stickerTrayOpen ? "스티커 선택 닫기" : "스티커 선택 열기");
  }

  function resetComposer() {
    draftRevision += 1;
    elements["message-body"].value = "";
    elements["message-body"].setCustomValidity?.("");
    elements["message-body"].setAttribute("aria-invalid", "false");
    elements.counter.textContent = `0 / ${model.maxMessageLength}`;
    selectedStickerId = null;
    anonymousSelected = false;
    stickerTrayOpen = false;
    resizeComposer(); renderStickers(); renderAnonymousToggle(); renderStickerTray();
  }

  const draftSnapshot = () => JSON.stringify({
    targetKey: targetKey(selectedTarget), body: elements["message-body"].value,
    stickerId: selectedStickerId, anonymous: anonymousSelected,
  });

  const pendingMatchesDraft = (pending) => Boolean(pending
    && pending.targetKey === targetKey(selectedTarget)
    && pending.draftRevision === draftRevision
    && pending.snapshot === draftSnapshot());

  function showView(name) {
    if (!viewNames.includes(name)) return;
    activeView = name;
    for (const view of viewNames) {
      elements[`view-${view}`].hidden = view !== name;
      elements[`tab-${view}`].className = `bottom-nav-item${view === name ? " active" : ""}`;
      elements[`tab-${view}`].setAttribute("aria-current", view === name ? "page" : "false");
    }
  }

  function showManageSection(name, focusTab = false) {
    if (!["friends", "groups"].includes(name)) return;
    activeManageSection = name;
    for (const section of ["friends", "groups"]) {
      const selected = section === name; const tab = elements[`manage-tab-${section}`];
      tab.setAttribute("aria-selected", selected ? "true" : "false"); tab.tabIndex = selected ? 0 : -1;
      elements[`${section}-panel`].hidden = !selected;
    }
    if (focusTab) elements[`manage-tab-${name}`].focus?.();
  }
  const messageLabel = (message) => {
    if (message.anonymous && message.targetType !== "group") return "익명의 친구";
    if (message.targetType === "group") {
      const groupName = model.groups.find((group) => group.id === message.targetId)?.name || "모임";
      return message.anonymous ? `익명의 친구 · ${groupName}` : `${message.senderName} · ${groupName}`;
    }
    return message.senderName || "친구";
  };

  function messageSignature(message) {
    return JSON.stringify({
      opened: Boolean(message.openedAt), label: messageLabel(message), createdAt: message.createdAt,
      anonymous: message.anonymous, senderName: message.senderName,
      body: message.openedAt ? message.body : null, stickerId: message.openedAt ? message.stickerId : null,
    });
  }

  function createMessageNode(message) {
    if (message.openedAt) {
      const paper = el("article", "opened-note");
      paper.tabIndex = -1;
      paper.setAttribute("aria-label", `${senderSubject(message)} 보낸 열린 쪽지`);
      const meta = el("div", "note-meta");
      meta.append(el("strong", "", messageLabel(message)), el("time", "", timeLabel(message.createdAt)));
      const sticker = stickerNode(message.stickerId);
      if (sticker) paper.append(sticker);
      if (message.body) paper.append(el("p", "note-body", message.body));
      paper.append(meta, el("small", "note-expiry", "잠시 뒤 사라져요"));
      return paper;
    }
    const envelope = el("button", "envelope");
    envelope.type = "button";
    envelope.setAttribute("aria-label", `${senderSubject(message)} 보낸 쪽지 열기`);
    envelope.onclick = () => send({ type: "openMessage", messageId: message.id });
    const copy = el("span", "envelope-copy");
    copy.append(el("strong", "", messageLabel(message)), el("span", "", timeLabel(message.createdAt)));
    envelope.append(el("span", "envelope-seal", "✦"), copy, el("span", "envelope-open", "열기"));
    return envelope;
  }

  function renderInbox(renderMeta = {}) {
    const oldOrder = [...elements["message-list"].children];
    const focusedRecord = [...messageRecords.entries()].find(([, record]) => record.node === document.activeElement);
    const focusedId = focusedRecord?.[0] || "";
    const focusedIndex = focusedRecord ? oldOrder.indexOf(focusedRecord[1].item) : -1;
    const messages = [...model.messages].sort((left, right) => (new Date(right.createdAt).getTime() || 0) - (new Date(left.createdAt).getTime() || 0) || left.id.localeCompare(right.id));
    const liveIds = new Set(messages.map((message) => message.id));
    for (const [id, record] of messageRecords) {
      if (!liveIds.has(id)) { record.item.remove?.(); messageRecords.delete(id); }
    }
    for (const message of messages) {
      const signature = messageSignature(message);
      let record = messageRecords.get(message.id);
      if (!record) {
        const item = el("li", "message-item"); const node = createMessageNode(message); item.append(node);
        record = { item, node, signature }; messageRecords.set(message.id, record);
      } else if (record.signature !== signature) {
        const node = createMessageNode(message); record.item.replaceChildren(node); record = { ...record, node, signature }; messageRecords.set(message.id, record);
      }
    }
    const orderedRecords = messages.map((message) => messageRecords.get(message.id));
    for (let index = 0; index < orderedRecords.length; index += 1) {
      const item = orderedRecords[index].item;
      if (elements["message-list"].children[index] !== item) elements["message-list"].insertBefore(item, elements["message-list"].children[index] || null);
    }
    elements["inbox-empty"].hidden = messages.length > 0;
    if (renderMeta.openedMessageId) return messageRecords.get(renderMeta.openedMessageId)?.node.focus?.();
    if (focusedId && messageRecords.has(focusedId)) return messageRecords.get(focusedId).node.focus?.();
    if (focusedId && !messageRecords.has(focusedId)) {
      const fallback = orderedRecords[focusedIndex] || orderedRecords[focusedIndex - 1];
      const fallbackNode = fallback?.node || elements["home-title"];
      fallbackNode?.focus?.();
    }
  }

  function renderStickers() {
    elements["sticker-grid"].replaceChildren();
    for (const [id, emoji, label] of stickerPresets) {
      const button = el("button", `sticker${selectedStickerId === id ? " selected" : ""}`, emoji);
      button.type = "button";
      button.setAttribute("aria-label", `${label} 스티커${selectedStickerId === id ? " 선택됨" : ""}`);
      button.setAttribute("aria-pressed", selectedStickerId === id ? "true" : "false");
      button.onclick = () => { selectedStickerId = selectedStickerId === id ? null : id; draftRevision += 1; renderStickers(); stickerTrayOpen = false; renderStickerTray(); elements["sticker-toggle"].focus?.(); };
      elements["sticker-grid"].append(button);
    }
  }

  const triggerFor = (key) => key === "manage-menu" ? elements["manage-menu-trigger"] : key === "profile" ? elements["profile-row"] : manageRecords.get(key)?.button;
  const fallbackForTrigger = (key) => key?.startsWith("friend:") ? elements["manage-tab-friends"]
    : key?.startsWith("group:") || key?.startsWith("invite:") ? elements["manage-tab-groups"]
      : elements["manage-menu-trigger"] || elements["manage-title"];

  function closeManageDialog(restoreFocus = true) {
    const triggerKey = dialogTriggerKey;
    dialogKind = null; dialogEntityId = ""; dialogTriggerKey = ""; dialogFocusables = []; menuReturnFocusId = ""; pendingDialogOperation = null;
    profileEditing = false; friendAliasEditing = false;
    removeArmedFriendId = null; deleteArmedGroupId = null; removeArmedMemberKey = null; leaveArmedGroupId = null;
    elements["manage-dialog-backdrop"].hidden = true;
    for (const id of ["menu-panel", "profile-panel", "friend-add-panel", "friend-panel", "group-create-panel", "group-panel", "invite-panel", "compose-panel"]) elements[id].hidden = true;
    if (restoreFocus) (triggerFor(triggerKey) || fallbackForTrigger(triggerKey)).focus?.();
  }

  function setDialogFocusables(items) {
    dialogFocusables = [elements["manage-dialog-back"], elements["manage-dialog-close"], ...items].filter((item) => item && !item.hidden && !item.disabled);
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
    for (const id of ["menu-panel", "profile-panel", "friend-add-panel", "friend-panel", "group-create-panel", "group-panel", "invite-panel", "compose-panel"]) elements[id].hidden = true;
    const menuChild = dialogTriggerKey === "manage-menu" && ["friend-add", "group-create"].includes(dialogKind);
    elements["manage-dialog-back"].hidden = !menuChild;
    let firstFocus = elements["manage-dialog-title"];
    if (dialogKind === "menu") {
      elements["menu-panel"].hidden = false; elements["manage-dialog-title"].textContent = "관리 메뉴";
      setDialogFocusables([elements["menu-friend-add"], elements["menu-group-add"]]);
      firstFocus = menuReturnFocusId ? elements[menuReturnFocusId] : elements["menu-friend-add"];
    } else if (dialogKind === "profile") {
      elements["profile-panel"].hidden = false; elements["manage-dialog-title"].textContent = "내 프로필";
      elements["profile-display-name"].textContent = model.me?.name || "설정 전"; elements["profile-code-value"].textContent = model.me?.code || "------";
      elements["profile-view"].hidden = profileEditing; elements["profile-form"].hidden = !profileEditing;
      if (profileEditing) {
        updateNameValidity(elements["profile-name"], "내 이름", true); elements["profile-save"].disabled = Boolean(pendingDialogOperation);
        setDialogFocusables([elements["profile-name"], elements["profile-save"], elements["profile-cancel"]]); firstFocus = elements["profile-name"];
      } else {
        setDialogFocusables([elements["profile-code-copy"], elements["profile-edit"]]); firstFocus = elements["profile-code-copy"];
      }
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
      const friendStatus = [friend.hasAlias && friend.name !== publicName ? `친구가 정한 이름 · ${publicName}` : "", friend.blocked ? "차단됨" : ""].filter(Boolean).join(" · ");
      elements["friend-detail-name"].textContent = friend.name; elements["friend-detail-status"].textContent = friendStatus;
      elements["friend-alias-form"].hidden = !friendAliasEditing;
      if (friendAliasEditing) updateNameValidity(elements["friend-detail-alias"], "친구 별칭");
      elements["friend-message"].disabled = friend.blocked; elements["friend-alias-edit"].hidden = friendAliasEditing; elements["friend-alias-edit"].disabled = Boolean(pendingDialogOperation); elements["friend-alias-save"].disabled = Boolean(pendingDialogOperation); elements["friend-alias-reset"].disabled = Boolean(pendingDialogOperation); elements["friend-alias-reset"].hidden = !friend.hasAlias;
      elements["friend-block"].textContent = friend.blocked ? "차단 해제" : "차단"; elements["friend-block"].disabled = Boolean(pendingDialogOperation);
      const armed = removeArmedFriendId === friend.id; elements["friend-remove"].textContent = armed ? "삭제 확정" : "친구 삭제"; elements["friend-remove"].setAttribute("aria-label", armed ? `${friend.name} 삭제 확정` : `${friend.name} 삭제 확인`);
      elements["friend-remove"].disabled = Boolean(pendingDialogOperation);
      setDialogFocusables([elements["friend-message"], elements["friend-alias-edit"], ...(friendAliasEditing ? [elements["friend-detail-alias"], elements["friend-alias-save"], elements["friend-alias-reset"], elements["friend-alias-cancel"]] : []), elements["friend-block"], elements["friend-remove"]]); firstFocus = elements["friend-message"];
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
      elements["group-message"].disabled = Boolean(pendingDialogOperation);
      setDialogFocusables([elements["group-message"], elements["group-rename-name"], elements["group-rename-save"], elements["group-invite-select"], elements["group-invite-button"], ...memberButtons, elements["group-leave"], elements["group-delete"]]);
    } else if (dialogKind === "invite") {
      const invite = model.groupInvites.find((item) => item.id === dialogEntityId);
      if (!invite) return closeManageDialog(true);
      elements["invite-panel"].hidden = false; elements["manage-dialog-title"].textContent = "받은 모임 초대";
      elements["invite-detail-name"].textContent = invite.groupName; elements["invite-detail-status"].textContent = `${invite.inviterName}님의 초대`;
      elements["invite-accept"].disabled = Boolean(pendingDialogOperation); elements["invite-decline"].disabled = Boolean(pendingDialogOperation);
      setDialogFocusables([elements["invite-accept"], elements["invite-decline"]]); firstFocus = elements["invite-accept"];
    } else if (dialogKind === "compose") {
      const contact = selectedTarget?.type === "friend"
        ? model.friends.find((friend) => friend.id === selectedTarget.id && !friend.blocked)
        : selectedTarget?.type === "group" ? model.groups.find((group) => group.id === selectedTarget.id) : null;
      if (!contact) return closeManageDialog(true);
      selectedTarget = { ...selectedTarget, name: contact.name };
      elements["compose-panel"].hidden = false; elements["manage-dialog-title"].textContent = "쪽지 보내기";
      elements["compose-recipient"].textContent = contact.name;
      elements["composer-hint"].textContent = selectedTarget.type === "group" ? `${contact.members.length}명 모임 전체에게 보내요` : "친구에게 보내요";
      elements.send.disabled = model.busy || Boolean(pendingSend);
      renderAnonymousToggle(); renderStickerTray();
      setDialogFocusables([elements["compose-back"], elements["sticker-toggle"], elements["message-body"], elements["anonymous-toggle"], elements.send]); firstFocus = elements["message-body"];
    }
    if (initial) firstFocus.focus?.();
  }

  function openManageDialog(kind, entityId, triggerKey) {
    dialogKind = kind; dialogEntityId = entityId || ""; dialogTriggerKey = triggerKey; menuReturnFocusId = ""; pendingDialogOperation = null;
    profileEditing = false; friendAliasEditing = false;
    removeArmedFriendId = null; deleteArmedGroupId = null; removeArmedMemberKey = null; leaveArmedGroupId = null;
    if (kind === "profile") elements["profile-copy-status"].textContent = "";
    renderManageDialog(true);
  }

  function openMenuChild(kind, returnFocusId) {
    dialogKind = kind; dialogEntityId = ""; menuReturnFocusId = returnFocusId; pendingDialogOperation = null;
    renderManageDialog(true);
  }

  function returnToManageMenu() {
    dialogKind = "menu"; dialogEntityId = ""; pendingDialogOperation = null;
    renderManageDialog(true);
  }

  function openComposer(target, returnKind) {
    if (targetKey(selectedTarget) !== targetKey(target)) resetComposer();
    selectedTarget = target; composeReturnKind = returnKind; dialogKind = "compose"; pendingDialogOperation = null;
    renderManageDialog(true);
  }

  function createManageRecord(descriptor) {
    const item = el("li", ""); const button = el("button", "manage-row"); button.type = "button"; button.setAttribute("aria-haspopup", "dialog"); button.setAttribute("aria-label", descriptor.label);
    const info = el("span", "manage-info"); info.append(el("strong", "", descriptor.name), el("small", "", descriptor.detail));
    button.append(el("span", "manage-avatar", descriptor.avatar), info);
    if (descriptor.badge) button.append(el("span", "badge", descriptor.badge));
    button.append(el("span", "chevron", "›")); button.onclick = descriptor.onOpen; item.append(button);
    return { item, button, signature: descriptor.signature };
  }

  function renderManagement() {
    const focusedEntry = [...manageRecords].find(([, record]) => record.button === document.activeElement);
    const focusedKey = focusedEntry?.[0] || ""; const focusedList = focusedEntry?.[1].item.parentNode;
    const focusedIndex = focusedList ? [...focusedList.children].indexOf(focusedEntry[1].item) : -1;
    elements["profile-current-name"].textContent = model.me?.name || "설정 전";
    const friendRows = model.friends.map((friend) => {
      const detail = friend.blocked ? "차단됨" : "";
      const key = `friend:${friend.id}`;
      return { key, name: friend.name, detail, avatar: "☺", label: `${friend.name} 친구 상세 열기`, signature: JSON.stringify([friend.name, detail]), onOpen: () => openManageDialog("friend", friend.id, key) };
    });
    const inviteRows = model.groupInvites.map((invite) => { const key = `invite:${invite.id}`; const detail = `초대 · ${invite.inviterName}님이 초대`; return { key, name: invite.groupName, detail, avatar: "✉", badge: "초대", label: `${invite.groupName} 모임 초대 상세 열기`, signature: JSON.stringify([invite.groupName, detail, "invite"]), onOpen: () => openManageDialog("invite", invite.id, key) }; });
    const groupRows = model.groups.map((group) => { const key = `group:${group.id}`; const detail = `${group.members.length}명 · ${group.owner ? "모임장" : "멤버"}`; return { key, name: group.name, detail, avatar: "👥", label: `${group.name} 모임 상세 열기`, signature: JSON.stringify([group.name, detail]), onOpen: () => openManageDialog("group", group.id, key) }; });
    const allRows = [...friendRows, ...inviteRows, ...groupRows]; const liveKeys = new Set(allRows.map((row) => row.key));
    for (const [key, record] of manageRecords) if (!liveKeys.has(key)) { record.item.remove?.(); manageRecords.delete(key); }
    for (const descriptor of allRows) {
      const current = manageRecords.get(descriptor.key);
      if (!current) manageRecords.set(descriptor.key, createManageRecord(descriptor));
      else if (current.signature !== descriptor.signature) { const next = createManageRecord(descriptor); current.item.replaceChildren(next.button); manageRecords.set(descriptor.key, { item: current.item, button: next.button, signature: next.signature }); }
    }
    const placeRows = (list, descriptors) => descriptors.forEach((descriptor, index) => { const item = manageRecords.get(descriptor.key).item; if (list.children[index] !== item) list.insertBefore(item, list.children[index] || null); });
    placeRows(elements["friend-list"], friendRows); placeRows(elements["group-list"], [...inviteRows, ...groupRows]);
    elements["friend-empty"].hidden = friendRows.length > 0; elements["group-empty"].hidden = inviteRows.length + groupRows.length > 0;
    elements["invite-count"].textContent = String(inviteRows.length); elements["invite-count"].hidden = inviteRows.length === 0;
    elements["group-invite-count"].textContent = inviteRows.length > 9 ? "9+" : String(inviteRows.length); elements["group-invite-count"].hidden = inviteRows.length === 0;
    if (dialogKind) renderManageDialog(false);
    else if (focusedKey && manageRecords.has(focusedKey) && document.activeElement !== manageRecords.get(focusedKey).button) manageRecords.get(focusedKey).button.focus?.();
    else if (focusedKey && !manageRecords.has(focusedKey)) {
      const rows = focusedList === elements["friend-list"] ? friendRows : [...inviteRows, ...groupRows];
      const fallback = rows[focusedIndex] || rows[focusedIndex - 1];
      (fallback ? manageRecords.get(fallback.key)?.button : focusedList === elements["friend-list"] ? elements["manage-tab-friends"] : elements["manage-tab-groups"])?.focus?.();
    }
  }

  function render(renderMeta = {}) {
    const connected = model.connection === "connected";
    elements.app.setAttribute("aria-busy", model.busy || model.connection === "checking" ? "true" : "false");
    elements["connect-panel"].hidden = connected; elements.workspace.hidden = !connected; elements.refresh.hidden = !connected;
    elements["connect-google"].disabled = model.busy || model.connection === "checking";
    if (!connected) { elements.status.textContent = model.error || (model.connection === "checking" ? "Google 연결 상태를 확인하고 있어요." : "Google 연결이 필요해요."); return; }
    renderInbox(renderMeta); renderManagement(); showManageSection(activeManageSection);
    elements["nav-unread"].textContent = String(model.unreadCount || 0); elements["nav-unread"].hidden = !model.unreadCount;
    showView(activeView);
    elements.status.textContent = model.error ? `연결 오류: ${model.error}` : model.busy ? "새 쪽지를 확인하는 중…" : model.lastSyncedAt ? `${timeLabel(model.lastSyncedAt)}에 확인했어요.` : "쪽지함을 준비하고 있어요.";
  }

  for (const name of viewNames) elements[`tab-${name}`].onclick = () => showView(name);
  for (const section of ["friends", "groups"]) elements[`manage-tab-${section}`].onclick = () => showManageSection(section, true);
  for (const section of ["friends", "groups"]) elements[`manage-tab-${section}`].addEventListener("keydown", (event) => {
    const sections = ["friends", "groups"]; const currentIndex = sections.indexOf(activeManageSection);
    const next = event.key === "Home" ? sections[0] : event.key === "End" ? sections.at(-1)
      : event.key === "ArrowLeft" ? sections[(currentIndex - 1 + sections.length) % sections.length]
        : event.key === "ArrowRight" ? sections[(currentIndex + 1) % sections.length] : "";
    if (next) { event.preventDefault?.(); showManageSection(next, true); }
  });
  elements["profile-row"].onclick = () => openManageDialog("profile", "", "profile");
  elements["manage-menu-trigger"].onclick = () => openManageDialog("menu", "", "manage-menu");
  elements["menu-friend-add"].onclick = () => openMenuChild("friend-add", "menu-friend-add");
  elements["menu-group-add"].onclick = () => openMenuChild("group-create", "menu-group-add");
  elements["manage-dialog-back"].onclick = returnToManageMenu;
  elements["manage-dialog-close"].onclick = () => closeManageDialog(true);
  elements["profile-code-copy"].onclick = copyProfileCode;
  elements["profile-edit"].onclick = () => { if (pendingDialogOperation) return; profileEditing = true; elements["profile-name"].value = model.me?.nameCustomized ? model.me.name : ""; renderManageDialog(false); elements["profile-name"].focus?.(); };
  elements["profile-cancel"].onclick = () => { if (pendingDialogOperation) return; profileEditing = false; elements["profile-name"].setCustomValidity?.(""); elements["profile-name"].setAttribute("aria-invalid", "false"); renderManageDialog(false); elements["profile-edit"].focus?.(); };
  elements["friend-add-cancel"].onclick = () => closeManageDialog(true);
  elements["group-create-cancel"].onclick = () => closeManageDialog(true);
  elements["manage-dialog"].addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialogKind === "compose" && stickerTrayOpen) { event.preventDefault?.(); stickerTrayOpen = false; renderStickerTray(); elements["sticker-toggle"].focus?.(); return; }
    if (event.key === "Escape") { event.preventDefault?.(); closeManageDialog(true); return; }
    if (event.key !== "Tab" || dialogFocusables.length === 0) return;
    const index = dialogFocusables.indexOf(document.activeElement); const backwards = event.shiftKey === true;
    if ((!backwards && index === dialogFocusables.length - 1) || (backwards && index <= 0)) { event.preventDefault?.(); dialogFocusables[backwards ? dialogFocusables.length - 1 : 0].focus?.(); }
  });
  elements["message-body"].addEventListener("input", () => { draftRevision += 1; const count = codepointLength(elements["message-body"].value); elements.counter.textContent = `${count} / ${model.maxMessageLength}`; updateLengthValidity(elements["message-body"], model.maxMessageLength, "쪽지"); resizeComposer(); });
  elements["sticker-toggle"].onclick = () => { stickerTrayOpen = !stickerTrayOpen; renderStickerTray(); if (stickerTrayOpen) elements["sticker-grid"].children[0]?.focus?.(); };
  elements["anonymous-toggle"].onclick = () => { anonymousSelected = !anonymousSelected; draftRevision += 1; renderAnonymousToggle(); };
  elements["message-form"].addEventListener("keydown", (event) => { if (event.key === "Escape" && stickerTrayOpen) { event.preventDefault?.(); event.stopPropagation?.(); stickerTrayOpen = false; renderStickerTray(); elements["sticker-toggle"].focus?.(); } });
  elements["group-name"].addEventListener("input", () => updateLengthValidity(elements["group-name"], 30, "모임 이름"));
  elements["group-rename-name"].addEventListener("input", () => updateLengthValidity(elements["group-rename-name"], 30, "모임 이름"));
  elements["friend-alias"].addEventListener("input", () => updateNameValidity(elements["friend-alias"], "친구 별칭"));
  elements["friend-detail-alias"].addEventListener("input", () => updateNameValidity(elements["friend-detail-alias"], "친구 별칭"));
  elements["profile-name"].addEventListener("input", () => updateNameValidity(elements["profile-name"], "내 이름", true));
  elements["friend-alias-edit"].onclick = () => { if (pendingDialogOperation) return; const friend = model.friends.find((item) => item.id === dialogEntityId); if (!friend) return; friendAliasEditing = true; elements["friend-detail-alias"].value = friend.hasAlias ? friend.alias || friend.name : ""; renderManageDialog(false); elements["friend-detail-alias"].focus?.(); };
  elements["friend-alias-cancel"].onclick = () => { if (pendingDialogOperation) return; friendAliasEditing = false; elements["friend-detail-alias"].setCustomValidity?.(""); elements["friend-detail-alias"].setAttribute("aria-invalid", "false"); renderManageDialog(false); elements["friend-alias-edit"].focus?.(); };
  elements["friend-code"].addEventListener("input", () => { elements["friend-code"].value = elements["friend-code"].value.toUpperCase().replace(/[^A-F0-9]/gu, "").slice(0, 6); });
  elements["friend-form"].addEventListener("submit", (event) => { event.preventDefault(); if (pendingDialogOperation || !updateNameValidity(elements["friend-alias"], "친구 별칭")) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "friend-add", operationId }; send({ type: "addFriend", code: elements["friend-code"].value, alias: elements["friend-alias"].value, operationId }); renderManageDialog(false); });
  elements["profile-form"].addEventListener("submit", (event) => { event.preventDefault(); if (pendingDialogOperation || !updateNameValidity(elements["profile-name"], "내 이름", true)) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "profile", operationId }; send({ type: "updateProfileName", name: elements["profile-name"].value, operationId }); renderManageDialog(false); });
  elements["friend-alias-form"].addEventListener("submit", (event) => { event.preventDefault(); if (pendingDialogOperation || !updateNameValidity(elements["friend-detail-alias"], "친구 별칭")) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "friend-alias", operationId }; send({ type: "updateFriendAlias", friendId: dialogEntityId, alias: elements["friend-detail-alias"].value, operationId }); renderManageDialog(false); });
  elements["friend-alias-reset"].onclick = () => { if (pendingDialogOperation) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "friend-alias", operationId }; send({ type: "updateFriendAlias", friendId: dialogEntityId, alias: null, operationId }); renderManageDialog(false); };
  elements["friend-message"].onclick = () => { const friend = model.friends.find((item) => item.id === dialogEntityId); if (!friend || friend.blocked) return; openComposer({ type: "friend", id: friend.id, name: friend.name }, "friend"); };
  elements["group-message"].onclick = () => { const group = model.groups.find((item) => item.id === dialogEntityId); if (!group) return; openComposer({ type: "group", id: group.id, name: group.name }, "group"); };
  elements["compose-back"].onclick = () => { if (!composeReturnKind) return closeManageDialog(true); dialogKind = composeReturnKind; renderManageDialog(false); elements[composeReturnKind === "friend" ? "friend-message" : "group-message"].focus?.(); };
  elements["friend-block"].onclick = () => { const friend = model.friends.find((item) => item.id === dialogEntityId); if (!friend || pendingDialogOperation) return; const operationId = nextOperationId(); pendingDialogOperation = { kind: "friend-block", operationId }; send({ type: friend.blocked ? "unblockFriend" : "blockFriend", friendId: friend.id, operationId }); renderManageDialog(false); };
  elements["friend-remove"].onclick = () => { const friend = model.friends.find((item) => item.id === dialogEntityId); if (!friend || pendingDialogOperation) return; if (removeArmedFriendId !== friend.id) { removeArmedFriendId = friend.id; renderManageDialog(false); } else { const operationId = nextOperationId(); removeArmedFriendId = null; pendingDialogOperation = { kind: "friend-remove", operationId }; send({ type: "removeFriend", friendId: friend.id, operationId }); renderManageDialog(false); } };
  elements["message-form"].addEventListener("submit", (event) => { event.preventDefault(); if (pendingSend || !selectedTarget) return; if (!updateLengthValidity(elements["message-body"], model.maxMessageLength, "쪽지")) return; const operationId = nextOperationId(); pendingSend = { targetKey: targetKey(selectedTarget), operationId, draftRevision, snapshot: draftSnapshot() }; send({ type: "sendMessage", targetType: selectedTarget.type, targetId: selectedTarget.id, body: elements["message-body"].value, stickerId: selectedStickerId, anonymous: anonymousSelected === true, operationId }); renderManageDialog(false); });
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
      const completedSend = pendingSend?.operationId === message.operationId ? pendingSend : null;
      const shouldResetSentDraft = completedSend && message.sentTo === completedSend.targetKey && pendingMatchesDraft(completedSend);
      const sentComposeStillOpen = dialogKind === "compose";
      if (completedSend) pendingSend = null;
      model = { groups: [], groupInvites: [], ...message.state }; render(message);
      if (message.notice) elements.status.textContent = message.notice;
      if (shouldResetSentDraft) { resetComposer(); if (sentComposeStillOpen) { dialogKind = composeReturnKind; renderManageDialog(false); elements[composeReturnKind === "friend" ? "friend-message" : "group-message"].focus?.(); } }
      if (completedDialogOperation) {
        pendingDialogOperation = null;
        if (completedDialogOperation.kind === "profile" && dialogKind === "profile") { profileEditing = false; renderManageDialog(false); elements["profile-edit"].focus?.(); }
        else if (completedDialogOperation.kind === "friend-alias" && dialogKind === "friend") { friendAliasEditing = false; renderManageDialog(false); elements["friend-alias-edit"].focus?.(); }
        else if (["friend-add", "group-create", "friend-remove", "group-delete", "group-leave", "invite-response"].includes(completedDialogOperation.kind)) { if (dialogKind) closeManageDialog(true); }
        else { if (completedDialogOperation.kind === "group-invite") elements["group-invite-select"].value = ""; renderManageDialog(false); }
      }
    } else if (message?.type === "error") {
      if (pendingSend?.operationId === message.operationId) { pendingSend = null; if (dialogKind === "compose") renderManageDialog(false); }
      if (pendingDialogOperation?.operationId === message.operationId) pendingDialogOperation = null;
      elements.status.textContent = message.message;
      renderManageDialog(false);
      if (dialogKind === "profile" && profileEditing) elements["profile-name"].focus?.();
      else if (dialogKind === "profile") elements["profile-edit"].focus?.();
      else if (dialogKind === "friend-add") elements["friend-code"].focus?.();
      else if (dialogKind === "friend" && friendAliasEditing) elements["friend-detail-alias"].focus?.();
      else if (dialogKind === "friend") elements["friend-message"].focus?.();
      else if (dialogKind === "group-create") elements["group-name"].focus?.();
      else if (dialogKind === "group") elements["group-rename-name"].focus?.();
      else if (dialogKind === "invite") elements["invite-accept"].focus?.();
      else if (dialogKind === "compose") elements["message-body"].focus?.();
    }
  });

  renderStickers(); renderAnonymousToggle(); renderStickerTray(); resizeComposer(); render(); send({ type: "ready" });
})();
