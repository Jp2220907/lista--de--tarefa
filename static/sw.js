"use strict";
importScripts("/push-state.js");
// Somente o shell público. Nenhuma resposta Auth/REST/API nem dado pessoal é cacheado.
const CACHE = "minha-lista-shell-v9";
const ASSETS = ["/", "/index.html", "/styles.css", "/app.js", "/assistant.js", "/connection.js", "/account-ui.js", "/calendar.js", "/notifications.js", "/push-state.js", "/recuperar-senha.html", "/recovery.js", "/cloud-config.json", "/vendor/supabase.js", "/manifest.webmanifest", "/icons/assistant-robot-green.png", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))); });
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name.startsWith("minha-lista-shell-") && name !== CACHE).map((name) => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.search || !ASSETS.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(url.pathname, copy)));
    }
    return response;
  }).catch(() => caches.match(url.pathname).then((cached) => cached || Response.error())));
});


self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_PUSH_UPDATE') self.skipWaiting();
  if (event.data?.type === 'CHECK_PUSH_READY') event.ports[0]?.postMessage({ pushReady: true });
});
const taskIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data.json(); } catch { return; }
    if (!taskIdPattern.test(payload?.task_id || '') || !['before', 'due'].includes(payload.kind)) return;
    let owner;
    try { owner = await MinhaListaPushState.read(); } catch { return; }
    if (!owner.enabled || owner.user_id !== payload.user_id || owner.subscription_id !== payload.subscription_id) return;
    await self.registration.showNotification('Minha lista', {
      body: payload.kind === 'before' ? 'Lembrete: uma tarefa está próxima do horário.' : 'Chegou o horário de uma tarefa.',
      icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: payload.tag,
      data: { task_id: payload.task_id, user_id: payload.user_id, subscription_id: payload.subscription_id },
    });
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data || {};
    let owner;
    try { owner = await MinhaListaPushState.read(); } catch { owner = {}; }
    const allowed = owner.enabled && owner.user_id === data.user_id && owner.subscription_id === data.subscription_id && taskIdPattern.test(data.task_id || '');
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === '/');
    if (existing) {
      if (allowed) existing.postMessage({ type: 'OPEN_TASK', taskId: data.task_id });
      return existing.focus();
    }
    const url = new URL('/', self.location.origin);
    if (allowed) url.searchParams.set('task', data.task_id);
    return self.clients.openWindow(url.href);
  })());
});
