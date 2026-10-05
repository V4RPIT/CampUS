/* Campus Chat – frontend logic (no framework, no build step).
   Sections: helpers · auth · boot · communities/channels · DMs · messages · profile */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); // always escape user text (XSS)
let token = localStorage.token, me, socket, comms = [], cur = {};   // cur = {type:'ch'|'dm', id, name}
let activeComm = null;
const attachments = new Map();
const messagesById = new Map();
const typingUsers = new Map();
let typingTimer, typingHeartbeat, typingTarget = null, typingActive = false, sending = false;
let uploadedFile = null, uploadedAttachment = null;
let replyingTo = null, notificationItems = [];
let dialogResolve = null;

// ───── helpers ─────
async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
const av = u => u.avatar ? `<img class="av" src="${esc(u.avatar)}">` : `<span class="av">${esc(u.username[0].toUpperCase())}</span>`;
function toast(message, type = 'info') {
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  item.textContent = message;
  $('#toastRegion').append(item);
  requestAnimationFrame(() => item.classList.add('visible'));
  setTimeout(() => {
    item.classList.remove('visible');
    setTimeout(() => item.remove(), 220);
  }, 4200);
}
function showDialog({ title, message = '', input = false, value = '', placeholder = '', confirmLabel = 'Continue', danger = false }) {
  const dialog = $('#actionDialog');
  $('#actionDialogTitle').textContent = title;
  $('#actionDialogMessage').textContent = message;
  $('#actionDialogInput').hidden = !input;
  $('#actionDialogInput').value = value;
  $('#actionDialogInput').placeholder = placeholder;
  $('#actionDialogConfirm').textContent = confirmLabel;
  $('#actionDialogConfirm').classList.toggle('danger-button', danger);
  dialog.showModal();
  if (input) $('#actionDialogInput').focus();
  else $('#actionDialogConfirm').focus();
  return new Promise(resolve => { dialogResolve = resolve; });
}
function finishDialog(value) {
  if (!dialogResolve) return;
  const resolve = dialogResolve;
  dialogResolve = null;
  $('#actionDialog').close();
  resolve(value);
}
$('#actionDialogForm').onsubmit = event => {
  event.preventDefault();
  finishDialog($('#actionDialogInput').hidden ? true : $('#actionDialogInput').value);
};
$('#actionDialogCancel').onclick = () => finishDialog(null);
$('#actionDialog').addEventListener('cancel', event => {
  event.preventDefault();
  finishDialog(null);
});
$('#actionDialog').addEventListener('close', () => {
  if (dialogResolve) finishDialog(null);
});
function shrink(file, max, q) {          // resize an uploaded image in the browser so it stays small
  return new Promise(res => { const r = new FileReader(); r.onload = () => { const i = new Image(); i.onload = () => {
    const k = Math.min(1, max / Math.max(i.width, i.height)), c = document.createElement('canvas');
    c.width = i.width * k; c.height = i.height * k; c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', q)); };
    i.src = r.result; }; r.readAsDataURL(file); });
}

// ───── auth (login / signup / recover share one form) ─────
let mode = 'login';
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  mode = b.dataset.m;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $('#x').hidden = mode !== 'recover'; $('#inv').hidden = mode !== 'signup'; $('#err').textContent = '';
  $('#p').placeholder = mode === 'recover' ? 'New password (8+ characters)' : 'Password (8+ characters)';
});
$('#authForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const d = await api('/' + mode, 'POST', { username: $('#u').value.trim(), password: $('#p').value, code: $('#x').value, invite: $('#inv').value, website: $('#hp').value });
    token = localStorage.token = d.token;
    if (d.recoveryCode) await showDialog({
      title: 'Save your recovery code',
      message: `${d.recoveryCode}\n\nThis code is shown only once. Store it somewhere safe to recover your account.`,
      confirmLabel: 'I saved it'
    });
    boot();
  } catch (err) { $('#err').textContent = err.message; }
};

// ───── boot ─────
async function boot() {
  try { me = await api('/me'); } catch { return; }
  $('#auth').hidden = true; $('#app').hidden = false;
  $('#meName').textContent = me.username; $('#meAv').innerHTML = av(me);
  socket?.disconnect();
  socket = io({ auth: { token } });
  socket.on('msg', onMsg);
  socket.on('typing', onTyping);
  socket.on('warn', t => toast(t, 'error'));
  socket.on('notifications-updated', data => {
    updateNotificationBadge(data);
    if (!$('#notificationsPanel').hidden) loadNotifications();
  });
  socket.on('message-deleted', onMessageDeleted);
  socket.on('channel-deleted', onChannelDeleted);
  socket.on('connect', () => { if ($('#text').value.trim()) startTyping(); });
  await loadComms(); showDMs(); loadNotifications();
  if (!cur.type && comms.length) openComm(comms[0].id);
}

// ───── communities & channels ─────
async function loadComms() {
  comms = await api('/communities');
  $('#rail').innerHTML = `<button id="dmBtn" title="Direct messages">💬</button>` +
    comms.map(c => `<button data-id="${c.id}" title="${esc(c.name)}" aria-label="${esc(c.name)}">${c.avatar ? `<img class="community-icon-rail" src="${esc(c.avatar)}" alt="">` : esc(c.name.slice(0, 2).toUpperCase())}</button>`).join('') +
    `<button id="addBtn" title="Create or join">＋</button>`;
  $('#dmBtn').onclick = showDMs;
  $('#addBtn').onclick = async () => {
    try {
      const choice = await showDialog({ title: 'Join or create a community', message: 'Enter an invite code to join, or leave this blank to create a new community.', input: true, placeholder: 'Invite code' });
      if (choice === null) return;
      let c;
      if (choice.trim()) c = await api('/communities/join', 'POST', { code: choice });
      else {
        const name = await showDialog({ title: 'Create a community', input: true, placeholder: 'Community name' });
        if (name === null) return;
        c = await api('/communities', 'POST', { name });
      }
      await loadComms(); openComm(c.id);
    } catch (err) { toast(err.message, 'error'); }
  };
  document.querySelectorAll('#rail [data-id]').forEach(b => b.onclick = () => openComm(+b.dataset.id));
}
function markRail(id) { document.querySelectorAll('#rail button').forEach(b => b.classList.toggle('on', b.dataset.id == id || (id === 'dm' && b.id === 'dmBtn'))); }
function closeMobileNav() {
  document.body.classList.remove('mobile-nav-open');
  $('#mobileNavBackdrop').hidden = true;
}
$('#mobileMenuBtn').onclick = () => {
  const open = document.body.classList.toggle('mobile-nav-open');
  $('#mobileNavBackdrop').hidden = !open;
};
$('#mobileNavBackdrop').onclick = closeMobileNav;

async function openComm(id, preferredChannelId) {
  closeMobileNav();
  const c = activeComm = await api('/communities/' + id);
  markRail(id);
  $('#sideTop').innerHTML = `<div class="community-identity">${c.avatar ? `<img class="community-icon" src="${esc(c.avatar)}" alt="">` : `<span class="community-icon community-icon-fallback">${esc(c.name.slice(0, 2).toUpperCase())}</span>`}<span>${esc(c.name)}</span></div>` +
    (c.owner === me.id ? '<details class="context-menu community-menu"><summary aria-label="Community options" title="Community options">⋮</summary><div class="context-menu-list"><button type="button" data-community-action="add-channel">Add subgroup</button><button type="button" data-community-action="edit-avatar">Change picture</button></div></details>' : '');
  $('#sideList').innerHTML = `<div class="item invite-code">Invite code: <b>${esc(c.code)}</b></div>` +
    c.channels.map(ch => `<div class="channel-row"><div class="item" data-ch="${ch.id}"># ${esc(ch.name)}</div>` +
      (c.owner === me.id ? `<details class="context-menu channel-menu"><summary aria-label="Options for #${esc(ch.name)}" title="Subgroup options">⋮</summary><div class="context-menu-list"><button type="button" data-rename="${ch.id}">Rename subgroup</button><button type="button" class="delete-channel" data-delete-channel="${ch.id}">Delete subgroup</button></div></details>` : '') +
      '</div>').join('');
  document.querySelectorAll('[data-ch]').forEach(el => el.onclick = () => openChannel(c.channels.find(x => x.id == el.dataset.ch)));
  $('#sideTop [data-community-action="add-channel"]')?.addEventListener('click', async event => {
    event.currentTarget.closest('details').open = false;
    const name = await showDialog({ title: 'Create a subgroup', input: true, placeholder: 'Subgroup name' });
    if (!name) return;
    try { await api(`/communities/${id}/channels`, 'POST', { name }); await openComm(id); }
    catch (error) { toast(error.message, 'error'); }
  });
  $('#sideTop [data-community-action="edit-avatar"]')?.addEventListener('click', event => {
    event.currentTarget.closest('details').open = false;
    $('#communityAvatarFile').click();
  });
  document.querySelectorAll('[data-rename]').forEach(el => el.onclick = async () => {
    el.closest('details').open = false;
    const channel = c.channels.find(x => x.id == el.dataset.rename);
    const name = await showDialog({ title: 'Rename subgroup', message: `Choose a new name for #${channel.name}.`, input: true, value: channel.name, placeholder: 'Subgroup name', confirmLabel: 'Save' });
    if (name === null) return;
    try {
      await api(`/communities/${id}/channels/${channel.id}`, 'PUT', { name });
      await openComm(id, channel.id);
    } catch (err) { toast(err.message, 'error'); }
  });
  document.querySelectorAll('[data-delete-channel]').forEach(button => button.onclick = async () => {
    button.closest('details').open = false;
    const channel = c.channels.find(item => item.id === Number(button.dataset.deleteChannel));
    if (!await showDialog({
      title: 'Delete subgroup?',
      message: `#${channel.name}, its messages, replies, and attached files will be permanently deleted for everyone.`,
      confirmLabel: 'Delete subgroup',
      danger: true
    })) return;
    try {
      await api(`/communities/${id}/channels/${channel.id}`, 'DELETE');
      const remaining = c.channels.find(item => item.id !== channel.id);
      if (cur.type === 'ch' && cur.id === channel.id) {
        if (remaining) await openComm(id, remaining.id);
        else {
          cur = {};
          $('#titleText').textContent = 'No subgroups yet';
          $('#msgs').replaceChildren();
        }
      }
      toast(`Deleted #${channel.name}`, 'success');
    } catch (error) { toast(error.message, 'error'); }
  });
  $('#members').hidden = false;
  $('#members').innerHTML = `<h4>Members — ${c.members.length}</h4>` + c.members.map(m =>
    `<div class="item" data-u="${esc(m.username)}" title="${esc(m.bio || '')}">${av(m)}<span>${esc(m.username)}${m.flair ? `<br><small>${esc(m.flair)}</small>` : ''}</span></div>`).join('');
  document.querySelectorAll('[data-u]').forEach(el => el.onclick = () => el.dataset.u !== me.username && openDM(el.dataset.u)); // click member → private chat
  const selectedChannel = c.channels.find(channel => channel.id === preferredChannelId) || c.channels[0];
  if (selectedChannel) openChannel(selectedChannel);
  else {
  cur = {};
  $('#titleText').textContent = 'No subgroups yet';
  $('#msgs').replaceChildren();
  }
}
async function openChannel(ch) {
  closeMobileNav();
  stopTyping();
  clearTypingIndicators();
  cur = { type: 'ch', id: ch.id };
  document.querySelectorAll('[data-ch]').forEach(el => el.classList.toggle('on', el.dataset.ch == ch.id));
  $('#titleText').textContent = '# ' + ch.name;
  render(await api('/messages?channel=' + ch.id));
  markConversationRead({ channel: ch.id });
}

// ───── direct messages ─────
async function showDMs() {
  closeMobileNav();
  stopTyping();
  clearTypingIndicators();
  markRail('dm'); activeComm = null; $('#members').hidden = true;
  $('#sideTop').innerHTML = `<span>Direct messages</span><button id="newDm" title="New DM">＋</button>`;
  $('#newDm').onclick = async () => { const username = await showDialog({ title: 'New direct message', input: true, placeholder: 'Username' }); if (username?.trim()) openDM(username.trim()); };
  const list = await api('/dms');
  $('#sideList').innerHTML = list.map(u => `<div class="item dm-item" data-peer="${esc(u.username)}">${av(u)}<span>${esc(u.username)}</span></div>`).join('') || '<div class="item empty-dms">No chats yet</div>';
  document.querySelectorAll('[data-peer]').forEach(el => el.onclick = () => openDM(el.dataset.peer));
}
async function openDM(username) {
  closeMobileNav();
  stopTyping();
  clearTypingIndicators();
  try { render(await api('/messages?dm=' + encodeURIComponent(username))); } catch (e) { return toast(e.message, 'error'); }
  cur = { type: 'dm', id: username }; $('#titleText').textContent = '@ ' + username;
  markConversationRead({ dm: username });
}

// ───── messages ─────
function currentTypingTarget() {
  return cur.type === 'ch' ? { channel: cur.id } : cur.type === 'dm' ? { dm: cur.id } : null;
}
function emitTyping(target, typing) {
  if (target && socket?.connected) socket.emit('typing', { ...target, typing });
}
function stopTyping() {
  clearTimeout(typingTimer);
  clearInterval(typingHeartbeat);
  if (typingActive) emitTyping(typingTarget, false);
  typingTarget = null;
  typingActive = false;
}
function startTyping() {
  const target = currentTypingTarget();
  if (!target || !socket?.connected) return;
  const key = JSON.stringify(target);
  if (typingTarget && JSON.stringify(typingTarget) !== key) stopTyping();
  if (!typingActive) {
    typingTarget = target;
    typingActive = true;
    emitTyping(typingTarget, true);
    typingHeartbeat = setInterval(() => emitTyping(typingTarget, true), 2000);
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 4000);
}
function clearTypingIndicators() {
  typingUsers.forEach(user => clearTimeout(user.timer));
  typingUsers.clear();
  $('#typingStatus').hidden = true;
  $('#typingStatus').textContent = '';
}
function onTyping(event) {
  if (event.user_id === me.id) return;
  const matches = cur.type === 'ch'
    ? event.channel_id === cur.id
    : cur.type === 'dm' && event.peer === cur.id;
  if (!matches) return;
  const key = event.user_id;
  clearTimeout(typingUsers.get(key)?.timer);
  if (event.typing) {
    const entry = { username: event.username };
    entry.timer = setTimeout(() => { typingUsers.delete(key); renderTypingStatus(); }, 5500);
    typingUsers.set(key, entry);
  } else typingUsers.delete(key);
  renderTypingStatus();
}
function renderTypingStatus() {
  const names = [...typingUsers.values()].map(user => user.username);
  const status = $('#typingStatus');
  status.hidden = !names.length;
  status.textContent = names.length > 1
    ? `${names.slice(0, 2).join(' and ')}${names.length > 2 ? ` and ${names.length - 2} others` : ''} are typing…`
    : names.length ? `${names[0]} is typing…` : '';
}
const msgHTML = m => {
  messagesById.set(m.id, m);
  if (m.attachment) attachments.set(m.id, m.attachment);
  const isImg = /^https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(m.body || '');
  const file = m.attachment ? `<button class="attachment" type="button" data-file="${m.id}">📎 ${esc(m.attachment.name)}</button>` : '';
  const quote = m.reply ? `<button class="reply-quote" type="button" data-jump="${m.reply.id}"><b>${esc(m.reply.username)}</b><span>${m.reply.deleted ? 'Original message deleted' : esc(m.reply.body || (m.reply.attachment_name ? '📎 ' + m.reply.attachment_name : 'Message'))}</span></button>` : '';
  const canDelete = m.user_id === me.id || (m.channel_id && activeComm?.owner === me.id);
  const menu = `<details class="message-menu"><summary aria-label="Message actions" title="Message actions">⋮</summary><div class="message-menu-list"><button type="button" data-reply="${m.id}">Reply</button>${canDelete ? `<button type="button" class="delete-action" data-delete="${m.id}">Delete</button>` : ''}</div></details>`;
  return `<article class="msg" data-message="${m.id}">${av(m)}<div class="msg-content">${quote}<b>${esc(m.username)}</b>${m.flair ? `<span class="flair">${esc(m.flair)}</span>` : ''}` +
    `<time>${new Date(m.ts).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</time>` +
    `${m.body ? `<div class="body">${isImg ? `<img src="${esc(m.body)}" loading="lazy">` : esc(m.body)}</div>` : ''}${file}</div>${menu}</article>`;
};
function render(list) {
  attachments.clear();
  messagesById.clear();
  $('#msgs').innerHTML = list.map(msgHTML).join('');
  $('#msgs').scrollTop = 1e9;
}
function onMsg(m) {
  if (cur.type === 'ch' && m.channel_id === cur.id || cur.type === 'dm' && m.peer === cur.id) {
    $('#msgs').insertAdjacentHTML('beforeend', msgHTML(m)); $('#msgs').scrollTop = 1e9;
    if (m.user_id !== me.id) markConversationRead(currentTypingTarget());
  } else if (m.peer && !activeComm) showDMs();                // new DM from someone → refresh list
}
function setReply(message) {
  replyingTo = message;
  $('#replyPreview').innerHTML = `<div><b>Replying to ${esc(message.username)}</b><span>${esc(message.body || (message.attachment?.name ? '📎 ' + message.attachment.name : 'Message'))}</span></div><button type="button" id="cancelReply" aria-label="Cancel reply">×</button>`;
  $('#replyPreview').hidden = false;
  $('#text').focus();
}
function onMessageDeleted(event) {
  const matches = cur.type === 'ch'
    ? event.channel_id === cur.id
    : cur.type === 'dm' && event.peer === cur.id;
  if (matches) {
    $(`[data-message="${event.id}"]`)?.remove();
    messagesById.delete(event.id);
    attachments.delete(event.id);
    if (replyingTo?.id === event.id) cancelReply();
  }
  loadNotifications();
}
function onChannelDeleted(event) {
  if (cur.type !== 'ch' || cur.id !== event.channel_id) return;
  cur = {};
  $('#titleText').textContent = 'This subgroup was deleted';
  $('#msgs').replaceChildren();
  if (activeComm?.id === event.community_id) openComm(event.community_id);
}
function updateNotificationBadge(data = {}) {
  const badge = $('#notificationBadge');
  const unread = Number(data.unread) || 0;
  badge.hidden = unread < 1;
  badge.textContent = unread > 99 ? '99+' : String(unread);
  $('#notificationBtn').setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
}
async function loadNotifications() {
  try {
    const result = await api('/notifications');
    notificationItems = result.items;
    updateNotificationBadge({ unread: result.unread });
    $('#notificationList').innerHTML = notificationItems.length
      ? notificationItems.map(item => {
        const target = item.channel_id ? `# ${esc(item.channel_name)}` : `@ ${esc(item.dm_peer)}`;
        const preview = item.body || (item.attachment?.name ? `📎 ${item.attachment.name}` : 'Message');
        return `<button class="notification-item${item.is_read ? '' : ' unread'}" type="button" data-notification="${item.notification_id}"><b>${esc(item.username)} · ${target}</b><span>${esc(preview)}</span><time>${new Date(item.ts).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</time></button>`;
      }).join('')
      : '<p class="empty-notifications">No notifications yet</p>';
  } catch (error) {
    $('#notificationList').innerHTML = '<p class="empty-notifications">Could not load notifications</p>';
    console.error('Could not load notifications:', error);
  }
}
async function markConversationRead(target) {
  if (!target) return;
  try {
    const result = await api('/notifications/read', 'POST', target);
    updateNotificationBadge(result);
  } catch (error) { console.error('Could not mark notifications as read:', error); }
}
$('#notificationBtn').onclick = () => {
  const panel = $('#notificationsPanel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) loadNotifications();
};
$('#notificationList').onclick = async event => {
  const item = event.target.closest('[data-notification]');
  if (!item) return;
  const notification = notificationItems.find(entry => entry.notification_id === Number(item.dataset.notification));
  if (!notification) return;
  $('#notificationsPanel').hidden = true;
  try {
    await api('/notifications/read', 'POST', { notificationId: notification.notification_id });
    await loadNotifications();
    if (notification.channel_id) await openComm(notification.community_id, notification.channel_id);
    else {
      await showDMs();
      await openDM(notification.dm_peer);
    }
    requestAnimationFrame(() => $(`[data-message="${notification.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  } catch (error) { toast(error.message, 'error'); }
};
$('#markAllRead').onclick = async () => {
  try {
    const result = await api('/notifications/read', 'POST', { all: true });
    updateNotificationBadge(result);
    await loadNotifications();
  } catch (error) { toast(error.message, 'error'); }
};
function cancelReply() {
  replyingTo = null;
  $('#replyPreview').hidden = true;
  $('#replyPreview').replaceChildren();
}
$('#msgs').onclick = async event => {
  const replyButton = event.target.closest('[data-reply]');
  if (replyButton) {
    const message = messagesById.get(Number(replyButton.dataset.reply));
    if (message) setReply(message);
    replyButton.closest('details').open = false;
    return;
  }
  const deleteButton = event.target.closest('[data-delete]');
  if (deleteButton) {
    if (!await showDialog({ title: 'Delete message?', message: 'This message will be deleted for everyone in this conversation.', confirmLabel: 'Delete message', danger: true })) return;
    try {
      await api(`/messages/${deleteButton.dataset.delete}`, 'DELETE');
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  const jump = event.target.closest('[data-jump]');
  if (jump) {
    document.querySelector(`[data-message="${jump.dataset.jump}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const fileButton = event.target.closest('[data-file]');
  if (!fileButton) return;
  const attachment = attachments.get(Number(fileButton.dataset.file));
  if (!attachment) return;
  try {
    let blob;
    if (attachment.id) {
      const response = await fetch(`/api/attachments/${attachment.id}`, { headers: { Authorization: 'Bearer ' + token } });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Could not download that file');
      }
      blob = await response.blob();
    } else {
      const raw = atob(attachment.data.split(',')[1]);
      const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
      blob = new Blob([bytes], { type: attachment.type || 'application/octet-stream' });
    }
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = attachment.name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { toast(error.message || 'Could not download that file', 'error'); }
};
let swipeStart = null;
$('#msgs').addEventListener('pointerdown', event => {
  const message = event.target.closest('.msg');
  if (!message || event.target.closest('button, summary')) return;
  swipeStart = { id: Number(message.dataset.message), x: event.clientX, y: event.clientY };
});
$('#msgs').addEventListener('pointerup', event => {
  if (!swipeStart) return;
  const start = swipeStart;
  swipeStart = null;
  const dx = event.clientX - start.x, dy = event.clientY - start.y;
  if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.4 || getSelection()?.toString()) return;
  const messageElement = event.target.closest('.msg');
  const message = messagesById.get(start.id);
  if (messageElement?.dataset.message == start.id && message) setReply(message);
});
$('#msgs').addEventListener('pointercancel', () => { swipeStart = null; });
$('#replyPreview').onclick = event => {
  if (event.target.closest('#cancelReply')) cancelReply();
};
$('#attachBtn').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = () => {
  const file = $('#fileInput').files[0];
  uploadedFile = null;
  uploadedAttachment = null;
  if (file && file.size > 50 * 1024 * 1024) {
    toast('Files must be no larger than 50 MB', 'error');
    $('#fileInput').value = '';
    $('#filePreview').hidden = true;
    return;
  }
  $('#filePreview').hidden = !file;
  $('#filePreview').textContent = file ? file.name : '';
};
function uploadAttachment(file) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', new URL('/api/attachments', location.origin));
    request.setRequestHeader('Authorization', 'Bearer ' + token);
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    request.setRequestHeader('X-File-Type', file.type || 'application/octet-stream');
    request.upload.onprogress = event => {
      if (!event.lengthComputable) return;
      $('#filePreview').textContent = `Uploading ${Math.round(event.loaded / event.total * 100)}% · ${file.name}`;
    };
    request.onload = () => {
      let result;
      try { result = JSON.parse(request.responseText); }
      catch {
        const message = request.status === 404
          ? 'The server does not have the upload endpoint yet. Restart the latest server.js or redeploy the latest version, then reload the app.'
          : `Upload failed (HTTP ${request.status}): ${request.responseText.slice(0, 160) || 'No response from server'}`;
        return reject(new Error(message));
      }
      if (request.status < 200 || request.status >= 300) {
        const message = request.status === 404
          ? 'Upload endpoint not found. Restart the latest server.js or redeploy the latest version, then reload the app.'
          : result.error || `Upload failed (HTTP ${request.status})`;
        return reject(new Error(message));
      }
      resolve(result);
    };
    request.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    request.onabort = () => reject(new Error('Upload was cancelled.'));
    request.send(file);
  });
}
$('#text').oninput = () => {
  if (!$('#text').value.trim()) return stopTyping();
  startTyping();
};
$('#text').onblur = stopTyping;
$('#composer').onsubmit = e => {
  e.preventDefault();
  stopTyping();
  const body = $('#text').value.trim();
  const file = $('#fileInput').files[0];
  if ((!body && !file) || !cur.type) return;
  if (sending) return;
  if (file && file.size > 50 * 1024 * 1024) {
    toast('Files must be no larger than 50 MB', 'error');
    return;
  }
  if (!socket?.connected) {
    toast('You are offline. Reconnect before sending your message.', 'error');
    return;
  }
  const target = currentTypingTarget();
  const sendButton = $('#composer button[type="submit"]');
  sending = true;
  sendButton.disabled = true;
  const send = attachmentId => {
    sendButton.textContent = 'Sending…';
    socket.timeout(30000).emit('send', { ...target, body, attachmentId, replyToId: replyingTo?.id ?? null }, (timeout, result) => {
      sending = false;
      sendButton.disabled = false;
      sendButton.textContent = 'Send';
      if (timeout || !result?.ok) {
        toast(timeout ? 'Message could not be sent. Please try again.' : result?.error || 'Message could not be sent.', 'error');
        return;
      }
      $('#text').value = '';
      $('#fileInput').value = '';
      $('#filePreview').hidden = true;
      $('#filePreview').textContent = '';
      uploadedFile = null;
      uploadedAttachment = null;
      cancelReply();
    });
  };
  if (file) {
    if (uploadedFile === file && uploadedAttachment) {
      send(uploadedAttachment.id);
    } else {
      sendButton.textContent = 'Uploading…';
      uploadAttachment(file).then(result => {
        uploadedFile = file;
        uploadedAttachment = result;
        $('#filePreview').textContent = `Uploaded · ${file.name}`;
        send(result.id);
      }).catch(err => {
        sending = false;
        sendButton.disabled = false;
        sendButton.textContent = 'Send';
        toast(err.message, 'error');
      });
    }
  } else send(null);
};
// ───── profile settings ─────
$('#setBtn').onclick = () => {
  $('#flair').value = me.flair; $('#bio').value = me.bio; $('#dlg').showModal();
};
$('#closeDlg').onclick = () => $('#dlg').close();
$('#logout').onclick = () => { localStorage.removeItem('token'); location.reload(); };
$('#setForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const f = $('#avFile').files[0];
    me = await api('/me', 'PUT', { avatar: f ? await shrink(f, 128, .8) : me.avatar, bio: $('#bio').value, flair: $('#flair').value }); // avatar saved to server
    $('#meAv').innerHTML = av(me); $('#dlg').close(); toast('Profile saved', 'success');
  } catch (err) { toast(err.message, 'error'); }
};

$('#communityAvatarFile').onchange = async () => {
  const file = $('#communityAvatarFile').files[0], community = activeComm;
  if (!file || !community) return;
  try {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file');
    const avatar = await shrink(file, 160, .82);
    await api(`/communities/${community.id}`, 'PUT', { avatar });
    await loadComms();
    await openComm(community.id, cur.type === 'ch' ? cur.id : undefined);
  } catch (error) { toast(error.message || 'Could not update community picture', 'error'); }
  finally { $('#communityAvatarFile').value = ''; }
};

if (token) boot();
