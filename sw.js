/* Come back: offline support.
   Pages load network-first so a new version shows up on the next open; sounds and fonts are cached after first use. */
var CACHE = "come-back-v7";
var CORE = ["./", "index.html", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"]
  .concat(["dark", "circle", "flame", "daytree", "tree", "rain", "ocean", "stars"].map(function (n) { return "previews/" + n + ".jpg"; }));
var SOUNDS = ["daytree", "tree", "rain", "ocean", "stars"].map(function (n) { return "sounds/" + n + ".mp3"; });

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // the recordings are large, so fetch them in the background without holding up the install
    SOUNDS.forEach(function (u) { c.add(u).catch(function () {}); });
    return c.addAll(CORE);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function put(req, res) {
  if (res && (res.status === 200 || res.type === "opaque")) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
  return res;
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  var font = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !font) return;

  if (req.mode === "navigate" || (sameOrigin && /\/(index\.html)?$/.test(url.pathname))) {
    // network first, so updates arrive; the cached copy is the offline fallback
    e.respondWith(fetch(req).then(function (r) { return put(req, r); }).catch(function () {
      return caches.match(req).then(function (m) { return m || caches.match("index.html"); });
    }));
    return;
  }
  if (sameOrigin && url.pathname.indexOf("/sounds/") >= 0 && /\.(mp3|ogg)$/.test(url.pathname)) {
    // recordings never change underneath us: cache first
    e.respondWith(caches.match(req).then(function (m) { return m || fetch(req).then(function (r) { return put(req, r); }); }));
    return;
  }
  // everything else: show what we have, refresh it in the background
  e.respondWith(caches.match(req).then(function (m) {
    var net = fetch(req).then(function (r) { return put(req, r); }).catch(function () { return m; });
    return m || net;
  }));
});
