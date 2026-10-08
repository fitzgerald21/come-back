/* Come back: optional cloud backup. Sign in with Google and everything saved in localStorage
   (sessions, reminders, sounds, presets, remote buttons, theme...) is mirrored to one Firestore document per user.
   The app keeps working from localStorage, so it is still fast and offline-friendly; this file only syncs it.
   Fill in firebase-config.js (see README) to turn it on. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { FIREBASE_CONFIG } from "./firebase-config.js";

var PREFIX = "come-back:", SESSIONS = "come-back:sessions", TOTAL = "come-back:total";
var K_UID = "come-back:cloud-uid", K_DIRTY = "come-back:cloud-dirty";
var el = function (id) { return document.getElementById(id); };
var ui = { box: el("cloudBox"), status: el("cloudStatus"), signIn: el("cloudSignIn"), signOut: el("cloudSignOut"), sum: el("sumCloud") };

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
function syncKey(k) { return k.indexOf(PREFIX) === 0 && k !== K_UID && k !== K_DIRTY; }
function say(msg, signedIn) {
  if (ui.status) ui.status.textContent = msg;
  if (ui.sum) ui.sum.textContent = signedIn ? "On" : "";
  if (ui.signIn) ui.signIn.hidden = !!signedIn;
  if (ui.signOut) ui.signOut.hidden = !signedIn;
}
function dirtySet() { try { return new Set(JSON.parse(lsGet(K_DIRTY) || "[]")); } catch (e) { return new Set(); } }
function dirtySave(s) { if (s.size) lsSet(K_DIRTY, JSON.stringify(Array.from(s))); else lsDel(K_DIRTY); }
function parse(s, d) { try { var v = JSON.parse(s); return v == null ? d : v; } catch (e) { return d; } }
function esc(k) { return k.slice(PREFIX.length); }   // Firestore map keys can't contain every character; drop the shared prefix

if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey || /YOUR_/.test(FIREBASE_CONFIG.apiKey)) {
  if (ui.box) ui.box.hidden = true;                  // not configured: the app stays local-only
} else {
  var app = initializeApp(FIREBASE_CONFIG), auth = getAuth(app), db = getFirestore(app);
  var user = null, pushTimer = 0, pulling = false;
  var ref = function () { return doc(db, "users", user.uid); };

  function localData() {
    var out = {};
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (syncKey(k)) out[k] = localStorage.getItem(k); } } catch (e) {}
    return out;
  }
  function pushNow() {
    pushTimer = 0;
    if (!user) return;
    var d = dirtySet(), data = {};
    d.forEach(function (k) { var v = lsGet(k); data[esc(k)] = v == null ? "" : v; });
    if (!d.size) return;
    setDoc(ref(), { data: data, updated: Date.now() }, { merge: true })
      .then(function () { var cur = dirtySet(); d.forEach(function (k) { if (lsGet(k) === (data[esc(k)] === "" ? null : data[esc(k)])) cur.delete(k); }); dirtySave(cur); say("Backed up to " + user.email, true); })
      .catch(function () { say("Couldn't reach the cloud. Changes are kept on this device and will upload later.", true); });
  }

  // called by the app after every localStorage write
  window.CB_CLOUD = {
    changed: function (k) {
      if (!syncKey(k)) return;
      var d = dirtySet(); d.add(k); dirtySave(d);
      if (user) { clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 1500); }
    }
  };

  function mergeSessions(a, b) {
    var seen = {}, out = [];
    a.concat(b).forEach(function (r) { if (r && !seen[r.start]) { seen[r.start] = 1; out.push(r); } });
    return out.sort(function (x, y) { return x.start - y.start; });
  }

  function pull() {
    if (!user || pulling) return Promise.resolve();
    pulling = true;
    say("Syncing…", true);
    return getDoc(ref()).then(function (snap) {
      var remote = {};
      if (snap.exists()) { var m = snap.data().data || {}; Object.keys(m).forEach(function (k) { remote[PREFIX + k] = m[k]; }); }
      var local = localData(), dirty = dirtySet(), firstLink = lsGet(K_UID) !== user.uid, changed = false;
      var keys = {}; Object.keys(remote).concat(Object.keys(local)).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        var r = remote[k], l = local[k];
        if (k === TOTAL) return;                     // worked out after the sessions
        if (k === SESSIONS) {
          var rs = parse(r, []), ls = parse(l, []), merged;
          if (firstLink || dirty.has(k) && r == null) merged = mergeSessions(rs, ls);
          else if (dirty.has(k)) merged = ls;       // this device deleted or added since the last sync
          else merged = rs;
          var str = JSON.stringify(merged);
          if (str !== l) { lsSet(k, str); changed = true; }
          if (str !== r) dirty.add(k); else dirty.delete(k);
        } else if (dirty.has(k) || r == null) {
          if (l != null) dirty.add(k);               // local-only or edited offline: send it up
        } else if (r !== l) {
          lsSet(k, r); changed = true; dirty.delete(k);
        }
      });
      // returns counted across all sittings: remote total plus returns from sessions only this device had
      var rt = parseInt(remote[TOTAL] || "0", 10) || 0, lt = parseInt(local[TOTAL] || "0", 10) || 0, total;
      if (firstLink) {
        var remoteStarts = {}; parse(remote[SESSIONS], []).forEach(function (r) { remoteStarts[r.start] = 1; });
        var extra = 0; parse(local[SESSIONS], []).forEach(function (r) { if (!remoteStarts[r.start]) extra += r.returns || 0; });
        total = snap.exists() ? rt + extra : lt;
      } else total = dirty.has(TOTAL) ? lt : (remote[TOTAL] == null ? lt : rt);
      if (String(total) !== local[TOTAL]) { lsSet(TOTAL, String(total)); changed = true; }
      if (String(total) !== remote[TOTAL]) dirty.add(TOTAL); else dirty.delete(TOTAL);
      lsSet(K_UID, user.uid);
      dirtySave(dirty);
      pulling = false;
      if (dirty.size) pushNow(); else say("Backed up to " + user.email, true);
      if (changed) {
        // the app reads storage once at start-up; reload so everything shows the synced data (not mid-sit)
        if (window.CB_APP && window.CB_APP.busy && window.CB_APP.busy()) window.CB_PENDING_RELOAD = true;
        else location.reload();
      }
    }).catch(function () { pulling = false; say("Couldn't reach the cloud. Your data is safe on this device.", true); });
  }

  onAuthStateChanged(auth, function (u) {
    user = u;
    if (u) pull(); else say("Sign in with Google to keep your sits safe and use them on any device.", false);
  });
  getRedirectResult(auth).catch(function () {});
  document.addEventListener("visibilitychange", function () { if (!document.hidden && user) pull(); });
  window.addEventListener("online", function () { if (user) pull(); });

  if (ui.signIn) ui.signIn.addEventListener("click", function () {
    var p = new GoogleAuthProvider();
    signInWithPopup(auth, p).catch(function (e) {
      if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) signInWithRedirect(auth, p);
      else if (!e || e.code !== "auth/popup-closed-by-user") say("Sign-in didn't work. Try again.", false);
    });
  });
  if (ui.signOut) ui.signOut.addEventListener("click", function () {
    signOut(auth).then(function () { lsDel(K_UID); say("Signed out. Your data stays on this device.", false); });
  });
}
