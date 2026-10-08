/* Come back: optional cloud backup. Sign in with Google and everything saved in localStorage
   (sessions, reminders, sounds, presets, remote buttons, theme...) is mirrored to one Firestore document per user.
   The app keeps working from localStorage, so it is still fast and offline-friendly; this file only syncs it.
   Fill in firebase-config.js (see README) to turn it on. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteField, collection, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { FIREBASE_CONFIG } from "./firebase-config.js";

var PREFIX = "come-back:", SESSIONS = "come-back:sessions", TOTAL = "come-back:total";
var K_UID = "come-back:cloud-uid", K_DIRTY = "come-back:cloud-dirty", K_SESS = "come-back:cloud-sess";   // K_SESS: starts of the sessions already in the cloud
var el = function (id) { return document.getElementById(id); };
var ui = { box: el("cloudBox"), status: el("cloudStatus"), signIn: el("cloudSignIn"), signOut: el("cloudSignOut"), sum: el("sumCloud") };

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
function syncKey(k) { return k.indexOf(PREFIX) === 0 && k !== K_UID && k !== K_DIRTY && k !== K_SESS; }
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
  function syncedStarts() { var a = parse(lsGet(K_SESS), null); return a ? new Set(a) : null; }
  function sessDoc(start) { return doc(db, "users", user.uid, "sessions", String(start)); }
  function chunked(ops) {            // Firestore batches hold at most 500 writes
    var p = Promise.resolve();
    for (var i = 0; i < ops.length; i += 400) (function (part) {
      p = p.then(function () { var b = writeBatch(db); part.forEach(function (f) { f(b); }); return b.commit(); });
    })(ops.slice(i, i + 400));
    return p;
  }
  // one document per sit: upload sits the cloud hasn't seen, delete ones removed on this device
  function pushSessions() {
    var local = parse(lsGet(SESSIONS), []), synced = syncedStarts() || new Set(), now = new Set(), ops = [];
    local.forEach(function (r) {
      now.add(r.start);
      if (!synced.has(r.start)) ops.push(function (b) { b.set(sessDoc(r.start), { rec: JSON.stringify(r) }); });
    });
    synced.forEach(function (st) { if (!now.has(st)) ops.push(function (b) { b.delete(sessDoc(st)); }); });
    return chunked(ops).then(function () {
      lsSet(K_SESS, JSON.stringify(Array.from(now)));
      return updateDoc(ref(), { "data.sessions": deleteField() }).catch(function () {});   // clear the old single-document copy
    });
  }
  function pushNow() {
    pushTimer = 0;
    if (!user) return Promise.resolve();
    var d = dirtySet(), data = {};
    d.delete(SESSIONS);
    d.forEach(function (k) { var v = lsGet(k); data[esc(k)] = v == null ? "" : v; });
    var main = d.size ? setDoc(ref(), { data: data, updated: Date.now() }, { merge: true }) : Promise.resolve();
    return main.then(pushSessions)
      .then(function () { var cur = dirtySet(); d.forEach(function (k) { if (lsGet(k) === (data[esc(k)] === "" ? null : data[esc(k)])) cur.delete(k); }); cur.delete(SESSIONS); dirtySave(cur); say("Backed up to " + user.email, true); })
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

  function pull() {
    if (!user || pulling) return Promise.resolve();
    pulling = true;
    say("Syncing…", true);
    return Promise.all([getDoc(ref()), getDocs(collection(db, "users", user.uid, "sessions"))]).then(function (res) {
      var snap = res[0], remote = {};
      if (snap.exists()) { var m = snap.data().data || {}; Object.keys(m).forEach(function (k) { remote[PREFIX + k] = m[k]; }); }
      var local = localData(), dirty = dirtySet(), firstLink = lsGet(K_UID) !== user.uid, changed = false;

      // sessions: the cloud copy is the subcollection (plus the old single-document list, which gets migrated)
      var R = {}, order = [];
      parse(remote[SESSIONS], []).forEach(function (r) { if (r) R[r.start] = r; });
      res[1].forEach(function (d) { var r = parse(d.data().rec, null); if (r) R[r.start] = r; });
      var synced = firstLink ? new Set() : (syncedStarts() || new Set());
      var L = parse(local[SESSIONS], []), seen = {}, out = [];
      L.forEach(function (r) {
        if (!r) return;
        if (R[r.start] || !synced.has(r.start)) { out.push(r); seen[r.start] = 1; }   // else it was deleted from the cloud elsewhere
      });
      Object.keys(R).forEach(function (st) {
        var r = R[st];
        if (!seen[r.start] && !synced.has(r.start)) out.push(r);                        // new from another device (or never seen here)
      });
      out.sort(function (x, y) { return x.start - y.start; });
      var str = JSON.stringify(out);
      if (str !== (local[SESSIONS] || "[]")) { lsSet(SESSIONS, str); changed = true; }
      if (firstLink) lsDel(K_SESS);
      dirty.delete(SESSIONS);

      var keys = {}; Object.keys(remote).concat(Object.keys(local)).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        var r = remote[k], l = local[k];
        if (k === TOTAL || k === SESSIONS) return;   // total is worked out below
        if (dirty.has(k) || r == null) {
          if (l != null) dirty.add(k);               // local-only or edited offline: send it up
        } else if (r !== l) {
          lsSet(k, r); changed = true; dirty.delete(k);
        }
      });
      // returns counted across all sittings: remote total plus returns from sessions only this device had
      var rt = parseInt(remote[TOTAL] || "0", 10) || 0, lt = parseInt(local[TOTAL] || "0", 10) || 0, total;
      if (firstLink) {
        var extra = 0; L.forEach(function (r) { if (r && !R[r.start]) extra += r.returns || 0; });
        total = snap.exists() && remote[TOTAL] != null ? rt + extra : lt;
      } else total = dirty.has(TOTAL) ? lt : (remote[TOTAL] == null ? lt : rt);
      if (String(total) !== local[TOTAL]) { lsSet(TOTAL, String(total)); changed = true; }
      if (String(total) !== remote[TOTAL]) dirty.add(TOTAL); else dirty.delete(TOTAL);
      lsSet(K_UID, user.uid);
      dirtySave(dirty);
      pulling = false;
      return pushNow().then(function () {
        if (changed) {
          // the app reads storage once at start-up; reload so everything shows the synced data (not mid-sit)
          if (window.CB_APP && window.CB_APP.busy && window.CB_APP.busy()) window.CB_PENDING_RELOAD = true;
          else location.reload();
        }
      });
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
