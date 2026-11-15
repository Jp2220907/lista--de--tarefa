"use strict";
// Somente o shell público. Nenhuma resposta Auth/REST/API nem dado pessoal é cacheado.
const CACHE = "minha-lista-shell-v1";
const ASSETS = ["/", "/index.html", "/styles.css", "/app.js", "/connection.js", "/account-ui.js", "/cloud-config.json", "/vendor/supabase.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
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
