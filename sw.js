"use strict";

// App-shell cache so this still works through a dead cellular patch (tunnel,
// parking garage) — bump CACHE_NAME on any deploy that changes these files.
const CACHE_NAME = "teslasound-v1";
const PRECACHE = [
  "./",
  "index.html",
  "app.js",
  "starter.js",
  "motion.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "src/character.js",
  "src/combustion-worklet.js",
  "src/engine-sim.js",
  "src/fx.js",
  "src/gate.js",
  "src/gearbox.js",
  "src/inputs.js",
  "src/layers.js",
  "src/physics.js",
  "src/presets.js",
  "src/profiles.js",
  "src/pulse.js",
  "src/resonators.js",
  "src/shift.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      // Cache-first for instant load; network still runs to refresh the cache.
      return cached || network;
    })
  );
});
