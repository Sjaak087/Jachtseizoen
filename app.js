// FIREBASE COMPAT CONFIGURATIE (WERKT 100% OP GITHUB PAGES, ANDROID EN LOKAAL)
const firebaseConfig = {
  apiKey: "AIzaSyBd-H-AcpJccJf0Ai3ctZZqyq0Ih-z95UI",
  authDomain: "jachtseizoen-d03d9.firebaseapp.com",
  databaseURL: "https://jachtseizoen-d03d9-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "jachtseizoen-d03d9",
  storageBucket: "jachtseizoen-d03d9.firebasestorage.app",
  messagingSenderId: "556835426876",
  appId: "1:556835426876:web:3ec343e598ce6f58bf2939",
  measurementId: "G-33BJVSWEXP"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();
const $ = id => document.getElementById(id);

// Peel en Maas / Panningen Coördinaten (Limburg)
const PEEL_EN_MAAS = [51.3250, 5.9800];
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

const state = {
  uid: localStorage.getItem("js_uid") || (crypto && crypto.randomUUID ? crypto.randomUUID() : 'u_' + Math.random().toString(36).substr(2, 9)),
  pos: null, watch: null, gameId: null, game: null, member: null,
  owner: false, map: null, markers: {}, unsubs: [], tick: null,
  lastSent: 0, lastAttempt: 0, publishing: false, geoError: null,
  lastGeoAt: 0, resumeBusy: false, mapFitGameId: null,
  routeLine: null, routeLineUid: null, routeStats: {}, routeRequestKeys: {},
  routeCache: {}, routePending: {}, routeQueue: [], routeWorkerRunning: false,
  lastRouteRequestAt: 0, lastTrackPositions: {}, movementLines: {},

  // VOICE CALLING STATE
  peerConnection: null, localStream: null, activeCallId: null,
  incomingCallId: null, callTimerInterval: null, callStartTime: 0
};

const HISTORY_KEY = "js_game_history";
localStorage.setItem("js_uid", state.uid);

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const code = () => Math.random().toString(36).slice(2, 8).toUpperCase();

function show(id) {
  ["locationGate", "home", "lobby"].forEach(x => {
    if ($(x)) $(x).hidden = x !== id;
  });
}

function message(text) { alert(text); }

function cleanListeners() {
  state.unsubs.forEach(fn => fn());
  state.unsubs = [];
  if (state.tick) clearInterval(state.tick);
  state.tick = null;
}

function listen(path, cb) {
  const ref = db.ref(path);
  const handler = ref.on("value", snapshot => cb(snapshot.val()));
  state.unsubs.push(() => ref.off("value", handler));
}

function hasLocation() { return !!state.pos; }

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geen GPS ondersteuning."));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  });
}

// LOCATIE TOESTAAN KNOP
if ($("enableLocation")) {
  $("enableLocation").onclick = async () => {
    try {
      state.pos = await getPosition();
      if ($("locationError")) $("locationError").hidden = true;
      show("home");
      startWatch();
      renderSavedGames();
      refreshSavedGames();
      loadUpdateLog();
    } catch (e) {
      state.geoError = "permission";
      if ($("locationError")) $("locationError").hidden = false;
    }
  };
}

// ==========================================
// REQUIREMENT 1: UPDATE LOG & ADMIN AUTH
// ==========================================
async function loadUpdateLog() {
  const container = $("updateLogList");
  if (!container) return;
  try {
    const snap = await db.ref("updates").get();
    if (!snap.exists()) {
      container.innerHTML = '<p class="saved-games-empty">Nog geen updates gepubliceerd.</p>';
      return;
    }
    const updatesObj = snap.val() || {};
    // FILTER: ALLEEN 'android' EN 'both' TARGETS TONEN IN DE ANDROID APP
    const updates = Object.values(updatesObj)
      .filter(item => item && (item.target === "android" || item.target === "both"))
      .sort((a, b) => (b.at || 0) - (a.at || 0));

    if (!updates.length) {
      container.innerHTML = '<p class="saved-games-empty">Geen updates voor de Android app beschikbaar.</p>';
      return;
    }

    container.innerHTML = updates.map(u => {
      const dateStr = u.at ? new Date(u.at).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "";
      const targetText = u.target === "both" ? "Android &amp; GitHub" : "Android App";
      return `<article class="update-log-card"><div class="update-log-card-head"><strong>${esc(u.title)}</strong><small>${dateStr}</small></div><p>${esc(u.content)}</p><span class="platform-badge">${targetText}</span></article>`;
    }).join("");
  } catch (e) {
    console.warn("Update log kon niet worden geladen:", e);
    container.innerHTML = '<p class="saved-games-empty">Update log laden mislukt.</p>';
  }
}

async function handleAddUpdateClick() {
  try {
    const snap = await db.ref("admin/password").get();
    const storedPw = snap.exists() ? snap.val() : null;

    if (!storedPw) {
      const newPw = prompt("🔒 STEL ADMIN WACHTWOORD IN\nEr is nog geen wachtwoord voor de Update Log ingesteld.\nVoer een nieuw wachtwoord in:");
      if (!newPw || !newPw.trim()) return message("Wachtwoord instellen geannuleerd.");
      await db.ref("admin/password").set(newPw.trim());
      message("✅ Admin wachtwoord opgeslagen!\nJe kunt nu updates publiceren.");
      if ($("updateFormPanel")) $("updateFormPanel").hidden = false;
    } else {
      const inputPw = prompt("🔒 ADMIN AUTHENTICATIE\nVoer het Admin wachtwoord in om de Update Log te bewerken:");
      if (inputPw === null) return;
      if (inputPw.trim() === storedPw) {
        if ($("updateFormPanel")) $("updateFormPanel").hidden = false;
      } else {
        message("❌ Onjuist wachtwoord! Toegang geweigerd.");
      }
    }
  } catch (e) {
    message("Fout bij authenticatie: " + e.message);
  }
}

async function publishUpdate() {
  const titleInput = $("updateTitle");
  const contentInput = $("updateContent");
  const targetInput = $("updateTarget");

  if (!titleInput || !contentInput) return;
  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  const target = targetInput ? targetInput.value : "both";

  if (!title || !content) return message("Vul zowel een titel als informatie in.");

  try {
    await db.ref("updates").push({ title, content, target, at: Date.now(), author: "Admin" });
    titleInput.value = "";
    contentInput.value = "";
    if ($("updateFormPanel")) $("updateFormPanel").hidden = true;
    message("Update succesvol gepubliceerd!");
    loadUpdateLog();
  } catch (e) { message("Publiceren mislukt: " + e.message); }
}

// ==========================================
// REQUIREMENT 2: LIVE VOICE CALLS (WEBRTC)
// ==========================================
async function getMicrophoneStream() {
  if (state.localStream) return state.localStream;
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return state.localStream;
  } catch (e) {
    message("Microfoontoegang is vereist om te kunnen bellen.\nGeef toestemming voor de microfoon.");
    throw e;
  }
}

function renderCallTargets() {
  const container = $("callTargetsList");
  if (!container || !state.game) return;
  const members = state.game.members || {};
  const teams = state.game.teams || {};

  const others = Object.entries(members).filter(([uid]) => uid !== state.uid);

  if (!others.length) {
    container.innerHTML = '<p class="saved-games-empty">Nog geen andere spelers in de lobby om te bellen.</p>';
    return;
  }

  container.innerHTML = others.map(([uid, m]) => {
    const t = teams[m.teamId];
    const roleText = t?.role === "police" ? "POLITIE" : t?.role === "robber" ? "BOEVEN" : "GEEN TEAM";
    const color = t?.role === "police" ? "var(--blue)" : "var(--red)";
    return `<div class="call-target-card"><div class="call-target-info"><strong>${esc(m.name)}</strong><small style="color:${color}">${esc(t?.name || "Geen team")} (${roleText})</small></div><button class="btn primary" data-call-uid="${uid}">BELLEN 📞</button></div>`;
  }).join("");

  document.querySelectorAll("[data-call-uid]").forEach(btn => {
    btn.onclick = () => initiateCall(btn.dataset.callUid);
  });
}

async function initiateCall(targetUid) {
  if (state.activeCallId) return message("Je bent al in gesprek!");
  const targetMember = state.game?.members?.[targetUid];
  if (!targetMember) return message("Speler niet gevonden.");

  try {
    const stream = await getMicrophoneStream();
    const callRef = db.ref(`games/${state.gameId}/calls`).push();
    const callId = callRef.key;
    state.activeCallId = callId;

    state.peerConnection = new RTCPeerConnection(rtcConfig);
    stream.getTracks().forEach(track => state.peerConnection.addTrack(track, stream));

    state.peerConnection.ontrack = event => {
      if ($("remoteAudio")) $("remoteAudio").srcObject = event.streams[0];
    };

    state.peerConnection.onicecandidate = event => {
      if (event.candidate) {
        db.ref(`games/${state.gameId}/calls/${callId}/callerCandidates`).push(event.candidate.toJSON());
      }
    };

    const offer = await state.peerConnection.createOffer();
    await state.peerConnection.setLocalDescription(offer);

    const me = state.game.members?.[state.uid];
    const myTeam = state.game.teams?.[me?.teamId];

    await callRef.set({
      callerUid: state.uid,
      callerName: me?.name || "Speler",
      callerTeamName: myTeam?.name || "Geen team",
      callerRole: myTeam?.role || "police",
      targetUid,
      offer: { type: offer.type, sdp: offer.sdp },
      status: "ringing",
      createdAt: Date.now()
    });

    showActiveCallBar(`BELLEN NAAR ${targetMember.name.toUpperCase()}...`);

    // Luisteren naar antwoord
    listen(`games/${state.gameId}/calls/${callId}`, async callData => {
      if (!callData) return;
      if (callData.status === "rejected") {
        message(`${targetMember.name} heeft het gesprek geweigerd.`);
        endCall();
      } else if (callData.status === "connected" && callData.answer && !state.peerConnection.currentRemoteDescription) {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(callData.answer));
        showActiveCallBar(`IN GESPREK MET ${targetMember.name.toUpperCase()}`);
        startCallTimer();
      } else if (callData.status === "ended") {
        endCall();
      }
    });

    // Luisteren naar ICE candidates
    listen(`games/${state.gameId}/calls/${callId}/targetCandidates`, candidateData => {
      if (!candidateData || !state.peerConnection) return;
      Object.values(candidateData).forEach(cand => {
        try { state.peerConnection.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {}
      });
    });

  } catch (e) {
    message("Bellen mislukt: " + e.message);
    endCall();
  }
}

// FIX INCOMING CALLS: ALLEEN VERSE OPROEPEN ONTVANGEN (< 45 SEC OUD)
function listenIncomingCalls() {
  if (!state.gameId) return;
  listen(`games/${state.gameId}/calls`, callsObj => {
    if (!callsObj) return;
    const now = Date.now();
    Object.entries(callsObj).forEach(([callId, callData]) => {
      const ageMs = now - Number(callData.createdAt || 0);

      // Oude verlopen oproepen automatisch opgeschoond
      if (callData.status === "ringing" && ageMs > 45000) {
        db.ref(`games/${state.gameId}/calls/${callId}`).update({ status: "ended" });
        return;
      }

      // Alleen reageren als oproep VERS is (< 45 sec), voor JOU bestemd, en je nog niet belt
      if (callData.targetUid === state.uid && callData.status === "ringing" && ageMs <= 45000 && !state.activeCallId && callData.callerUid !== state.uid) {
        state.incomingCallId = callId;
        if ($("callerName")) $("callerName").textContent = callData.callerName || "Speler";
        if ($("callerTeam")) $("callerTeam").textContent = `${callData.callerTeamName || "Team"} (${callData.callerRole === "police" ? "Politie" : "Boeven"})`;
        if ($("incomingCallOverlay")) $("incomingCallOverlay").hidden = false;
      }
    });
  });
}

function showActiveCallBar(title) {
  if ($("activeCallBar")) $("activeCallBar").hidden = false;
  if ($("activeCallTitle")) $("activeCallTitle").textContent = title;
}

function startCallTimer() {
  state.callStartTime = Date.now();
  if (state.callTimerInterval) clearInterval(state.callTimerInterval);
  state.callTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.callStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const secs = String(elapsed % 60).padStart(2, "0");
    if ($("activeCallTimer")) $("activeCallTimer").textContent = `${mins}:${secs}`;
  }, 1000);
}

function endCall() {
  if (state.activeCallId && state.gameId) {
    db.ref(`games/${state.gameId}/calls/${state.activeCallId}`).update({ status: "ended" });
  }
  if (state.peerConnection) {
    try { state.peerConnection.close(); } catch (e) {}
    state.peerConnection = null;
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach(track => track.stop());
    state.localStream = null;
  }
  if (state.callTimerInterval) clearInterval(state.callTimerInterval);
  state.callTimerInterval = null;
  state.activeCallId = null;
  state.incomingCallId = null;

  if ($("activeCallBar")) $("activeCallBar").hidden = true;
  if ($("incomingCallOverlay")) $("incomingCallOverlay").hidden = true;
  if ($("remoteAudio")) $("remoteAudio").srcObject = null;
}

function getMyInterval() {
  const g = state.game; if (!g) return 30;
  const teams = g.teams || {}, members = g.members || {}, me = members[state.uid], myRole = teams[me?.teamId]?.role;
  return myRole === "robber" ? Math.max(5, Number(g.settings?.robberInterval) || 60) : Math.max(5, Number(g.settings?.policeInterval) || 30);
}

function getOpponentInterval() {
  const g = state.game; if (!g) return 30;
  const teams = g.teams || {}, members = g.members || {}, me = members[state.uid], myRole = teams[me?.teamId]?.role;
  return myRole === "robber" ? Math.max(5, Number(g.settings?.policeInterval) || 30) : Math.max(5, Number(g.settings?.robberInterval) || 60);
}

function updateLocationNotice() {
  const el = $("locationNotice"); if (!el) return;
  const game = state.game, me = game?.members?.[state.uid];
  if (!state.gameId || !game || game.status !== "running") { el.hidden = true; return; }
  const teams = game.teams || {}, members = game.members || {}, myRole = teams[me?.teamId]?.role;
  if (!myRole) { el.hidden = true; return; }
  const interval = getOpponentInterval() * 1000;
  const staleAfter = Math.max(45000, interval * 2);
  const now = Date.now();
  const opponents = Object.entries(members).filter(([uid, m]) => uid !== state.uid && teams[m.teamId]?.role && teams[m.teamId].role !== myRole);
  if (!opponents.length) { el.hidden = true; return; }
  const delayed = opponents.filter(([, m]) => {
    const last = Number(m.location?.updatedAt || m.lastSeen || 0);
    return Number(m.offlineUntil || 0) > now || !m.location || !last || now - last > staleAfter;
  });
  if (!delayed.length) { el.hidden = true; el.classList.remove("ok"); el.textContent = ""; return; }
  const names = delayed.slice(0, 3).map(([, m]) => m.name || "Tegenstander");
  const extra = delayed.length > 3 ? ` en ${delayed.length - 3} andere speler(s)` : "";
  const temporarilyHidden = delayed.every(([, m]) => Number(m.offlineUntil || 0) > now);
  el.hidden = false; el.classList.remove("ok");
  el.textContent = temporarilyHidden
    ? `Locatie van ${names.join(", ")}${extra} is tijdelijk verborgen.`
    : `Locatie van ${names.join(", ")}${extra} komt niet binnen of is niet recent bijgewerkt.`;
}

function updateLocationSendCountdown() {
  const bar = $("locationCountdownBar"); if (!bar) return;
  const game = state.game;
  if (!state.gameId || !game || (game.status !== "running" && game.status !== "paused")) { bar.hidden = true; return; }
  bar.hidden = false;

  if (game.status === "paused") {
    if ($("locationSendCountdown")) $("locationSendCountdown").textContent = "PAUZE";
    if ($("locationReceiveCountdown")) $("locationReceiveCountdown").textContent = "PAUZE";
    if ($("locationCountdownHint")) $("locationCountdownHint").textContent = "Spel staat op pauze. Locaties worden tijdelijk niet verstuurd.";
    return;
  }

  const me = game.members?.[state.uid];
  const now = Date.now();
  const offlineUntil = Number(me?.offlineUntil || 0);
  const myInterval = getMyInterval() * 1000;
  const nextDue = Math.max(state.lastSent ? state.lastSent + myInterval : now, offlineUntil > now ? offlineUntil : 0);
  const secondsMySend = Math.max(0, Math.ceil((nextDue - now) / 1000));
  if ($("locationSendCountdown")) $("locationSendCountdown").textContent = String(secondsMySend);

  const teams = game.teams || {}, members = game.members || {};
  const myRole = teams[me?.teamId]?.role;
  const oppInterval = getOpponentInterval() * 1000;
  const opponents = Object.entries(members).filter(([uid, m]) => uid !== state.uid && teams[m.teamId]?.role && teams[m.teamId].role !== myRole);

  let newestOpponentTime = 0;
  opponents.forEach(([, m]) => {
    const t = Number(m.location?.updatedAt || 0);
    if (t > newestOpponentTime) newestOpponentTime = t;
  });

  const nextOpponentDue = newestOpponentTime ? newestOpponentTime + oppInterval : now + oppInterval;
  const secondsOppReceive = Math.max(0, Math.ceil((nextOpponentDue - now) / 1000));
  if ($("locationReceiveCountdown")) $("locationReceiveCountdown").textContent = String(secondsOppReceive);

  const hint = $("locationCountdownHint");
  if (!hint) return;
  if (!navigator.onLine) hint.textContent = "Geen internetverbinding — locatie wordt hersteld zodra je weer online bent.";
  else if (state.geoError) hint.textContent = "Locatie-update wacht op een werkende GPS-verbinding.";
  else if (offlineUntil > now) hint.textContent = "Je locatie staat tijdelijk uit; daarna wordt delen hervat.";
  else hint.textContent = `Jij verstuurt elke ${Math.round(myInterval / 1000)}s • Tegenstander ververst elke ${Math.round(oppInterval / 1000)}s.`;
}

function positionSuccess(p) {
  state.pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
  state.lastGeoAt = Date.now(); state.geoError = null;
  maybePublish(false); updateLocationNotice(); updateLocationSendCountdown();
}

function positionError(err) {
  state.geoError = err?.code === 1 ? "permission" : "unavailable";
  updateLocationNotice(); updateLocationSendCountdown();
}

async function refreshPositionAndPublish() {
  if (state.resumeBusy || !navigator.geolocation) return;
  state.resumeBusy = true;
  try {
    const p = await getPosition();
    positionSuccess({ coords: { latitude: p.lat, longitude: p.lng, accuracy: p.accuracy } });
  } catch (e) { positionError(e); }
  finally { state.resumeBusy = false; }
}

async function startWatch() {
  if (state.watch !== null) navigator.geolocation.clearWatch(state.watch);
  if (navigator.geolocation) {
    state.watch = navigator.geolocation.watchPosition(positionSuccess, positionError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
}

window.addEventListener("online", () => { state.geoError = null; refreshPositionAndPublish(); });
window.addEventListener("pageshow", () => { if (!document.hidden) refreshPositionAndPublish(); });
window.addEventListener("focus", () => refreshPositionAndPublish());
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshPositionAndPublish(); else updateLocationNotice(); });

// PEEL EN MAAS INITIALISATIE KAART
function initMap() {
  if (state.map) return;
  state.map = L.map("map").setView(PEEL_EN_MAAS, 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(state.map);
}

function teamColor(role) { return role === "police" ? "#5cb5ff" : "#ff615a"; }
function validPoint(p) { return !!p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && Math.abs(Number(p.lat)) <= 90 && Math.abs(Number(p.lng)) <= 180; }
function routeKey(from, to) { return [Number(from.lat).toFixed(4), Number(from.lng).toFixed(4), Number(to.lat).toFixed(4), Number(to.lng).toFixed(4)].join(","); }

function formatDistance(m) { if (!Number.isFinite(m)) return "—"; return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`; }
function formatEstimate(distance, speedKmh) {
  if (!Number.isFinite(distance)) return "—";
  const minutes = distance / (speedKmh * 1000 / 60);
  if (minutes < 1) return "minder dan 1 min";
  if (minutes < 60) return `± ${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60), rest = Math.round(minutes % 60);
  return `± ${hours} u ${String(rest).padStart(2, "0")} min`;
}

function cacheRoute(key, result) { state.routeCache[key] = result; const keys = Object.keys(state.routeCache); if (keys.length > 120) delete state.routeCache[keys[0]]; }

function requestFootRoute(from, to, callback, priority = 0) {
  if (!validPoint(from) || !validPoint(to)) { callback(null); return; }
  const key = routeKey(from, to);
  if (Object.prototype.hasOwnProperty.call(state.routeCache, key)) { callback(state.routeCache[key]); return; }
  if (state.routePending[key]) { state.routePending[key].push(callback); return; }
  state.routePending[key] = [callback];
  state.routeQueue.push({ key, from: { lat: Number(from.lat), lng: Number(from.lng) }, to: { lat: Number(to.lat), lng: Number(to.lng) }, priority });
  processRouteQueue();
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function processRouteQueue() {
  if (state.routeWorkerRunning) return;
  state.routeWorkerRunning = true;
  try {
    while (state.routeQueue.length) {
      state.routeQueue.sort((a, b) => a.priority - b.priority);
      const job = state.routeQueue.shift();
      const wait = Math.max(0, 1100 - (Date.now() - state.lastRouteRequestAt));
      if (wait) await pause(wait);
      state.lastRouteRequestAt = Date.now();
      let result = null;
      try {
        const coords = `${job.from.lng},${job.from.lat};${job.to.lng},${job.to.lat}`;
        const url = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&alternatives=true`;
        const response = await fetch(url, { mode: "cors", cache: "no-store" });
        if (!response.ok) throw new Error(`Route-server antwoordde ${response.status}`);
        const data = await response.json();
        if (data.code !== "Ok" || !Array.isArray(data.routes) || !data.routes.length) throw new Error("Geen wandelroute gevonden");
        const chosen = data.routes.reduce((best, r) => !best || Number(r.duration) < Number(best.duration) ? r : best, null);
        const coordsOut = chosen.geometry?.coordinates;
        if (!Array.isArray(coordsOut) || coordsOut.length < 2) throw new Error("Route heeft geen kaartlijn");
        result = { coords: coordsOut.map(c => [Number(c[1]), Number(c[0])]), distance: Number(chosen.distance), duration: Number(chosen.duration) };
        cacheRoute(job.key, result);
      } catch (error) { console.warn("Wandelroute kon niet worden berekend:", error.message); }
      const callbacks = state.routePending[job.key] || [];
      delete state.routePending[job.key];
      callbacks.forEach(cb => { try { cb(result); } catch (e) {} });
    }
  } finally {
    state.routeWorkerRunning = false;
    if (state.routeQueue.length) processRouteQueue();
  }
}

function clearRouteAndTracks() {
  if (state.routeLine && state.map) state.map.removeLayer(state.routeLine);
  state.routeLine = null; state.routeLineUid = null;
  Object.values(state.movementLines).flat().forEach(line => { if (state.map) state.map.removeLayer(line); });
  state.movementLines = {}; state.lastTrackPositions = {}; state.routeStats = {}; state.routeRequestKeys = {};
  state.routeQueue = []; state.routePending = {};
}

function setFastestRoute(opponents, origin, myRole) {
  if (!state.map || (state.game?.status !== "running" && state.game?.status !== "paused")) return;
  const ready = opponents.map(([uid, m]) => ({ uid, m, route: state.routeStats[uid], key: state.routeRequestKeys[uid] }))
    .filter(x => x.route && !x.route.loading && !x.route.error && x.route.key === x.key && Number.isFinite(x.route.duration));
  ready.sort((a, b) => a.route.duration - b.route.duration);
  const fastest = ready[0];
  if (!fastest) { if (state.routeLine) { state.map.removeLayer(state.routeLine); state.routeLine = null; state.routeLineUid = null; } return; }
  const color = teamColor(myRole), latlngs = fastest.route.coords;
  if (state.routeLine) { state.routeLine.setLatLngs(latlngs).setStyle({ color, weight: 5, opacity: .95, dashArray: null }); state.routeLineUid = fastest.uid; }
  else { state.routeLine = L.polyline(latlngs, { color, weight: 5, opacity: .95, lineCap: "round", lineJoin: "round" }).addTo(state.map); state.routeLineUid = fastest.uid; }
  state.routeLine.bindTooltip(`Snelste wandelroute naar ${esc(fastest.m.name || "Tegenstander")}`);
  state.routeLine.bringToFront();
}

function renderRoutePanel(opponents, myRole) {
  const panel = $("routePanel"); if (!panel) return;
  if (!state.game || (state.game.status !== "running" && state.game.status !== "paused")) { panel.hidden = true; return; }
  panel.hidden = false;
  const status = $("routeStatus"), summary = $("routeSummary"), list = $("routeTargets");
  if (!myRole) { status.textContent = "Kies eerst een team"; summary.innerHTML = "<p class=\"route-empty\">Je moet aan een Politie- of Boeven-team zijn toegewezen om routes te berekenen.</p>"; list.innerHTML = ""; return; }
  const active = opponents.filter(([, m]) => validPoint(m.location));
  if (!active.length) { status.textContent = "Wachten op GPS"; summary.innerHTML = "<p class=\"route-empty\">Nog geen bruikbare locatie van het andere team ontvangen.</p>"; list.innerHTML = ""; return; }
  const ready = active.map(([uid, m]) => ({ uid, m, route: state.routeStats[uid], key: state.routeRequestKeys[uid] }))
    .filter(x => x.route && !x.route.loading && !x.route.error && x.route.key === x.key && Number.isFinite(x.route.distance));
  ready.sort((a, b) => a.route.duration - b.route.duration);
  const fastest = ready[0];
  status.textContent = fastest ? `${ready.length}/${active.length} ROUTES KLAAR` : "Routes berekenen…";
  if (fastest) {
    const distance = fastest.route.distance;
    summary.innerHTML = `<div class="route-summary-main"><div><small>SNELSTE WANDELROUTE</small><strong>${esc(fastest.m.name || "Tegenstander")}</strong></div><b>${formatDistance(distance)}</b></div><div class="route-estimates"><div><small>TE VOET</small><strong>${formatEstimate(distance, 4.8)}</strong><span>ca. 4,8 km/u</span></div><div><small>RENNEN</small><strong>${formatEstimate(distance, 10)}</strong><span>ca. 10 km/u</span></div></div>`;
  } else {
    summary.innerHTML = `<p class="route-empty">De wegafstand wordt berekend via het wandelnetwerk in Peel en Maas…</p>`;
  }
  list.innerHTML = active.map(([uid, m]) => {
    const route = state.routeStats[uid], key = state.routeRequestKeys[uid], ok = route && !route.loading && !route.error && route.key === key && Number.isFinite(route.distance);
    return `<div class="route-target-row"><div class="route-target-name"><i style="background:${teamColor(state.game.teams?.[m.teamId]?.role)}"></i><span>${esc(m.name || "Tegenstander")}</span></div>${ok ? `<div class="route-target-meta"><b>${formatDistance(route.distance)}</b><span>lopen ${formatEstimate(route.distance, 4.8)} · rennen ${formatEstimate(route.distance, 10)}</span></div>` : `<div class="route-target-meta"><b>Berekenen…</b><span>via wandelwegen</span></div>`}</div>`;
  }).join("");
}

function renderMap() {
  if (!state.map || !state.game) return;
  const members = state.game.members || {}, teams = state.game.teams || {}, myRole = teams[members[state.uid]?.teamId]?.role;
  const me = members[state.uid], origin = validPoint(me?.location) ? { lat: Number(me.location.lat), lng: Number(me.location.lng) } : state.pos;
  const oppInterval = getOpponentInterval() * 1000;
  const now = Date.now(), opponents = [], fitPoints = [];

  Object.entries(members).forEach(([uid, m]) => {
    const loc = m.location, team = teams[m.teamId];
    if (!validPoint(loc) || !m.teamId || !team) {
      if (state.markers[uid]) { state.map.removeLayer(state.markers[uid]); delete state.markers[uid]; }
      return;
    }
    const isOpponent = !!myRole && team.role !== myRole;
    const offline = !!(isOpponent && Number(m.offlineUntil || 0) > now);
    const last = Number(loc.updatedAt || m.lastSeen || 0);
    const stale = isOpponent && (!last || now - last > Math.max(45000, oppInterval * 2));
    const label = offline ? "OFFLINE" : stale ? "LOCATIE NIET BINNEN" : team.role === "police" ? "POLITIE" : "BOEVEN";
    const color = offline ? "#a1a8a1" : teamColor(team.role);
    const icon = L.divIcon({ className: "", html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 5px ${color}44;opacity:${offline ? 0.65 : 1}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
    const popup = `<b>${esc(m.name)}</b><br>${label}${offline ? " • locatie tijdelijk verborgen" : stale ? " • apparaat mogelijk offline of in standby" : ""}`;

    if (state.markers[uid]) state.markers[uid].setLatLng([loc.lat, loc.lng]).setIcon(icon).setPopupContent(popup);
    else state.markers[uid] = L.marker([loc.lat, loc.lng], { icon }).addTo(state.map).bindPopup(popup);

    fitPoints.push([Number(loc.lat), Number(loc.lng)]);
    if (isOpponent && (state.game.status === "running" || state.game.status === "paused")) {
      if (!offline && !stale && validPoint(origin)) {
        opponents.push([uid, m]);
        const key = routeKey(origin, loc);
        if (state.routeRequestKeys[uid] !== key) {
          state.routeRequestKeys[uid] = key;
          state.routeStats[uid] = { key, loading: true };
          const gameId = state.gameId;
          requestFootRoute(origin, loc, route => {
            if (state.gameId !== gameId || state.routeRequestKeys[uid] !== key) return;
            state.routeStats[uid] = route ? { ...route, key } : { key, error: true };
            renderMap();
          }, 0);
        }
      }
    }
  });

  Object.keys(state.markers).forEach(uid => { if (!members[uid] || !validPoint(members[uid].location) || !members[uid].teamId || !teams[members[uid].teamId]) { state.map.removeLayer(state.markers[uid]); delete state.markers[uid]; } });

  if (state.mapFitGameId !== state.gameId && fitPoints.length) {
    state.mapFitGameId = state.gameId;
    if (fitPoints.length > 1) state.map.fitBounds(L.latLngBounds(fitPoints), { padding: [30, 30], maxZoom: 14 });
    else state.map.setView(fitPoints[0], 13);
  }

  if (state.game.status !== "running" && state.game.status !== "paused") {
    if (state.routeLine) { state.map.removeLayer(state.routeLine); state.routeLine = null; state.routeLineUid = null; }
    renderRoutePanel([], myRole);
  } else {
    setFastestRoute(opponents, origin, myRole);
    renderRoutePanel(opponents, myRole);
  }
}

async function maybePublish(force = false) {
  if (!state.gameId || !state.member || !state.pos || !state.game || state.game.status !== "running" || state.publishing) return;
  const now = Date.now(), myInterval = getMyInterval() * 1000;
  if (!force && state.lastSent && now - state.lastSent < myInterval) return;
  if (!force && state.lastAttempt && now - state.lastAttempt < 5000) return;
  const me = state.game.members?.[state.uid]; if (me?.offlineUntil > now) { updateLocationSendCountdown(); return; }
  state.publishing = true; state.lastAttempt = now; updateLocationSendCountdown();
  try {
    await db.ref(`games/${state.gameId}/members/${state.uid}`).update({ location: { ...state.pos, updatedAt: now }, lastSeen: now });
    state.lastSent = now; state.geoError = null; updateLocationNotice();
  } catch (e) { state.geoError = "network"; console.warn(e); updateLocationNotice(); }
  finally { state.publishing = false; updateLocationSendCountdown(); }
}

function updateCountdown() {
  if (!state.game) return;
  const g = state.game;
  const running = g.status === "running";
  const paused = g.status === "paused";

  if ($("gameControls")) $("gameControls").hidden = !(running || paused);
  if ($("gameOver")) $("gameOver").hidden = g.status !== "over";

  const statusEl = $("gameStatus");
  if (statusEl) {
    statusEl.textContent = running ? "LIVE IN SPEL" : paused ? "GEPAUZEERD" : g.status === "over" ? "GAME OVER" : "LOBBY";
    if (paused) statusEl.classList.add("status-paused");
    else statusEl.classList.remove("status-paused");
  }

  if ($("refreshLabel")) $("refreshLabel").textContent = running ? `GPS-update: elke ${getMyInterval()}s` : paused ? "Spel gepauzeerd" : "Locatie wacht op start";

  if (g.status === "over") {
    if ($("winnerText")) $("winnerText").textContent = g.winner ? `${g.winner} hebben gewonnen.` : "Het spel is afgelopen.";
    updateLocationSendCountdown();
    return;
  }

  if (paused) {
    const leftMs = Number(g.pausedRemaining || 0);
    if ($("countdown")) $("countdown").textContent = `${String(Math.floor(leftMs / 60000)).padStart(2, "0")}:${String(Math.floor(leftMs / 1000) % 60).padStart(2, "0")}`;
    updateLocationSendCountdown();
    return;
  }

  if (!running) { updateLocationSendCountdown(); return; }

  const left = Math.max(0, (g.endsAt || Date.now()) - Date.now());
  if ($("countdown")) $("countdown").textContent = `${String(Math.floor(left / 60000)).padStart(2, "0")}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}`;
  updateLocationSendCountdown();

  if (left <= 0 && state.owner) {
    db.ref(`games/${state.gameId}`).update({ status: "over", winner: "Boeven", endedAt: Date.now() });
  }
}

function renderTeams() {
  if (!state.game) return;
  const teams = state.game.teams || {}, members = state.game.members || {};

  if ($("teamList")) {
    $("teamList").innerHTML = Object.entries(teams).map(([id, t]) =>
      `<div class="team-card"><div class="team-card-head"><span class="${t.role === "police" ? "role-police" : "role-robber"}">${esc(t.name)} · ${t.role === "police" ? "POLITIE" : "BOEVEN"}</span>${state.owner ? `<button class="copy" data-rename-team="${id}">HERNOEM</button>` : ""}</div>${Object.entries(members).filter(([uid, m]) => m.teamId === id).map(([uid, m]) => `<div class="member-row"><span>${esc(m.name)}${uid === state.uid ? " (jij)" : ""}</span>${state.owner ? `<button class="copy" data-remove="${uid}">VERWIJDER</button>` : ""}</div>`).join("") || '<div class="hint">Nog geen spelers toegewezen.</div>'}</div>`
    ).join("") || '<p class="hint">Nog geen teams. Maak eerst een Politie- en Boeven-team aan.</p>';
  }

  if ($("memberList")) {
    $("memberList").innerHTML = Object.entries(members).map(([uid, m]) =>
      `<div class="member-row"><span>${esc(m.name)}${uid === state.uid ? " (jij)" : ""}</span>${state.owner ? `<select data-assign="${uid}"><option value="">Niet toegewezen</option>${Object.entries(teams).map(([id, t]) => `<option value="${id}" ${m.teamId === id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>` : `<small>${esc(teams[m.teamId]?.name || "Niet toegewezen")}</small>`}</div>`
    ).join("");
  }

  document.querySelectorAll("[data-assign]").forEach(el => el.onchange = () => db.ref(`games/${state.gameId}/members/${el.dataset.assign}`).update({ teamId: el.value || null }));
  document.querySelectorAll("[data-remove]").forEach(el => el.onclick = async () => {
    if (el.dataset.remove === state.uid) { message("Je kunt jezelf niet als host verwijderen."); return; }
    await db.ref(`games/${state.gameId}/members/${el.dataset.remove}`).remove();
  });
  document.querySelectorAll("[data-rename-team]").forEach(el => el.onclick = async () => {
    const t = teams[el.dataset.renameTeam], name = prompt("Nieuwe teamnaam:", t.name);
    if (name?.trim()) await db.ref(`games/${state.gameId}/teams/${el.dataset.renameTeam}`).update({ name: name.trim().slice(0, 30) });
  });

  renderCallTargets();
}

function renderChat(chat) {
  const container = $("chatMessages");
  if (!container) return;
  const msgs = Object.values(chat || {}).sort((a, b) => a.at - b.at).slice(-100);
  container.innerHTML = msgs.map(m => {
    const isMe = m.uid === state.uid;
    const timeStr = new Date(m.at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
    return `<div class="chat-message ${isMe ? "me" : "other"}"><small>${esc(m.name)}${isMe ? " (jij)" : ""} · ${timeStr}</small>${esc(m.text)}</div>`;
  }).join("");
  container.scrollTop = container.scrollHeight;
}

function readGameHistory() { try { const items = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); return Array.isArray(items) ? items.filter(x => x && x.id) : []; } catch { return []; } }
function writeGameHistory(items) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 30))); } catch (e) { console.warn("Potjesgeschiedenis kon niet worden opgeslagen", e); } }

function rememberGame(id, game, owner) {
  const items = readGameHistory(), old = items.find(x => x.id === id);
  const entry = { id, code: game.code || id, name: game.name || "Jachtseizoen", owner: !!owner, status: game.status || old?.status || "lobby", joinedAt: old?.joinedAt || Date.now(), updatedAt: Date.now(), available: true };
  writeGameHistory([entry, ...items.filter(x => x.id !== id)]);
  renderSavedGames();
}

function statusLabel(status) { return status === "running" ? "ACTIEF" : status === "paused" ? "GEPAUZEERD" : status === "over" ? "AFGEROND" : status === "missing" ? "NIET BESCHIKBAAR" : "LOBBY"; }

function renderSavedGames() {
  const host = $("savedGamesList"); if (!host) return;
  const items = readGameHistory();
  if (!items.length) { host.innerHTML = '<p class="saved-games-empty">Je hebt nog geen potjes gemaakt of gejoint. Je potjes verschijnen hier automatisch.</p>'; return; }
  host.innerHTML = items.map(item =>
    `<article class="saved-game-card"><div class="saved-game-main"><div class="saved-game-title">${esc(item.name || "Jachtseizoen")}</div><div class="saved-game-meta">Code: <b>${esc(item.code || item.id)}</b> · ${item.owner ? "Door jou gemaakt" : "Gejoint"}</div></div><span class="saved-game-status status-${esc(item.status || "lobby")}">${statusLabel(item.status)}</span><button class="btn secondary saved-game-open" data-open-saved="${esc(item.id)}">OPEN POTJE <span>→</span></button></article>`
  ).join("");
}

async function refreshSavedGames() {
  const button = $("refreshSavedGames"); if (button) button.disabled = true;
  try {
    const items = readGameHistory();
    await Promise.all(items.map(async item => {
      try {
        const snap = await db.ref(`games/${item.id}`).get();
        if (snap.exists()) {
          const game = snap.val();
          item.name = game.name || item.name; item.code = game.code || item.code;
          item.status = game.status || "lobby"; item.owner = game.owner === state.uid; item.available = true;
        } else { item.status = "missing"; item.available = false; }
      } catch (e) { console.warn("Potje kon niet worden ververst", item.id, e); }
    }));
    writeGameHistory(items); renderSavedGames();
  } finally { if (button) button.disabled = false; }
}

async function openSavedGame(id) {
  try {
    const snap = await db.ref(`games/${id}`).get();
    if (!snap.exists()) return message("Dit potje bestaat niet meer of is niet bereikbaar.");
    const game = snap.val(), member = game.members?.[state.uid];
    if (!member) return message("Je bent geen deelnemer meer van dit potje.");
    rememberGame(id, game, game.owner === state.uid);
    await enterGame(id, member, game.owner === state.uid);
  } catch (e) { message("Potje openen mislukt. Controleer je verbinding.\n" + e.message); }
}

function applyGame(g) {
  if (!g) return;
  state.game = g;
  state.member = g.members?.[state.uid] || state.member;
  state.owner = g.owner === state.uid;
  const locationUpdatedAt = Number(g.members?.[state.uid]?.location?.updatedAt || 0);
  if (locationUpdatedAt > state.lastSent) state.lastSent = locationUpdatedAt;

  if ($("lobbyTitle")) $("lobbyTitle").textContent = g.name || "Jachtseizoen";
  if ($("displayCode")) $("displayCode").textContent = g.code || "------";
  if ($("ownerBadge")) $("ownerBadge").textContent = state.owner ? "ALLEEN HOST" : "ALLEEN LEZEN";

  if ($("duration")) { $("duration").value = g.settings?.duration || 60; $("duration").disabled = !state.owner; }
  if ($("policeInterval")) { $("policeInterval").value = g.settings?.policeInterval || 30; $("policeInterval").disabled = !state.owner; }
  if ($("robberInterval")) { $("robberInterval").value = g.settings?.robberInterval || 60; $("robberInterval").disabled = !state.owner; }
  if ($("offlineUses")) { $("offlineUses").value = g.settings?.offlineUses ?? 2; $("offlineUses").disabled = !state.owner; }
  if ($("offlineDuration")) { $("offlineDuration").value = g.settings?.offlineDuration || 60; $("offlineDuration").disabled = !state.owner; }

  if ($("saveSettings")) $("saveSettings").hidden = !state.owner;
  if ($("startGame")) $("startGame").hidden = !state.owner || g.status !== "lobby";

  if ($("pauseGame")) $("pauseGame").hidden = !state.owner || g.status !== "running";
  if ($("resumeGame")) $("resumeGame").hidden = !state.owner || g.status !== "paused";

  if ($("addTeam")) $("addTeam").disabled = !state.owner;
  if ($("newTeamName")) $("newTeamName").disabled = !state.owner;
  if ($("newTeamRole")) $("newTeamRole").disabled = !state.owner;

  renderTeams();
  renderMap();
  updateCountdown();
  maybePublish();
  updateLocationNotice();
  updateLocationSendCountdown();

  if ((g.status === "running" || g.status === "paused") && !state.tick) {
    state.tick = setInterval(() => {
      updateCountdown();
      maybePublish();
      updateLocationNotice();
      updateLocationSendCountdown();
      renderMap();
    }, 1000);
  } else if (g.status !== "running" && g.status !== "paused" && state.tick) {
    clearInterval(state.tick);
    state.tick = null;
  }
}

async function enterGame(id, member, owner = false) {
  cleanListeners(); clearRouteAndTracks();
  state.gameId = id; state.game = null; state.mapFitGameId = null;
  state.member = member; state.owner = owner;
  state.lastSent = Number(member?.location?.updatedAt || 0);
  state.lastAttempt = 0; state.publishing = false;
  show("lobby"); initMap();
  setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 100);
  listen(`games/${id}`, applyGame);
  listen(`games/${id}/chat`, renderChat);
  listenIncomingCalls();
}

// DELEGATED EVENT LISTENERS (ALTIJD WERKING GEGARANDEERD)
document.addEventListener("click", async e => {
  const target = e.target;
  if (!target) return;

  // Update Log: Toevoegen Knop
  if (target.id === "addUpdateBtn" || target.closest("#addUpdateBtn")) {
    e.preventDefault();
    handleAddUpdateClick();
  }

  // Update Log: Annuleren
  if (target.id === "cancelUpdateBtn" || target.closest("#cancelUpdateBtn")) {
    e.preventDefault();
    if ($("updateFormPanel")) $("updateFormPanel").hidden = true;
  }

  // Update Log: Publiceren
  if (target.id === "publishUpdateBtn" || target.closest("#publishUpdateBtn")) {
    e.preventDefault();
    publishUpdate();
  }

  // Potje Aanmaken
  if (target.id === "createGame" || target.closest("#createGame")) {
    e.preventDefault();
    if (!hasLocation()) return message("Locatie is vereist.");
    const name = $("gameName") ? $("gameName").value.trim() : "";
    if (!name) return message("Vul een naam in.");
    const id = code(), now = Date.now();
    const game = {
      name: name.slice(0, 40), code: id, owner: state.uid, status: "lobby", createdAt: now,
      settings: { duration: 60, policeInterval: 30, robberInterval: 60, offlineUses: 2, offlineDuration: 60 },
      teams: {},
      members: { [state.uid]: { name: "Host", teamId: null, location: { ...state.pos, updatedAt: now }, lastSeen: now, offlineUses: 0 } }
    };
    try {
      await db.ref(`games/${id}`).set(game);
      await db.ref(`codes/${id}`).set(id);
      rememberGame(id, game, true);
      await enterGame(id, game.members[state.uid], true);
    } catch (err) { message("Potje maken mislukt: " + err.message); }
  }

  // Join Potje
  if (target.id === "joinGame" || target.closest("#joinGame")) {
    e.preventDefault();
    if (!hasLocation()) return message("Locatie is vereist.");
    const c = $("joinCode") ? $("joinCode").value.trim().toUpperCase() : "";
    const name = $("joinName") ? $("joinName").value.trim() : "";
    if (!c || !name) return message("Vul zowel de code als je naam in.");
    try {
      const snap = await db.ref(`games/${c}`).get();
      if (!snap.exists()) return message("Deze code bestaat niet (meer).");
      const g = snap.val();
      if (g.status === "over") return message("Dit potje is afgelopen.");
      const now = Date.now(), member = { name: name.slice(0, 24), teamId: null, location: { ...state.pos, updatedAt: now }, lastSeen: now, offlineUses: 0 };
      await db.ref(`games/${c}/members/${state.uid}`).set(member);
      rememberGame(c, g, g.owner === state.uid);
      await enterGame(c, member, g.owner === state.uid);
    } catch (err) { message("Joinen mislukt: " + err.message); }
  }

  // Kopieer Code
  if (target.id === "copyCode" || target.closest("#copyCode")) {
    e.preventDefault();
    try { await navigator.clipboard.writeText($("displayCode").textContent); $("copyCode").textContent = "GEKOPIEERD"; }
    catch { message("Code: " + $("displayCode").textContent); }
  }

  // Instellingen Opslaan
  if (target.id === "saveSettings" || target.closest("#saveSettings")) {
    e.preventDefault();
    const settings = {
      duration: Math.max(1, Math.min(240, Number($("duration")?.value) || 60)),
      policeInterval: Math.max(5, Math.min(600, Number($("policeInterval")?.value) || 30)),
      robberInterval: Math.max(5, Math.min(600, Number($("robberInterval")?.value) || 60)),
      offlineUses: Math.max(0, Math.min(20, Number($("offlineUses")?.value) || 0)),
      offlineDuration: Math.max(5, Math.min(600, Number($("offlineDuration")?.value) || 60))
    };
    await db.ref(`games/${state.gameId}/settings`).update(settings);
    message("Instellingen opgeslagen.");
  }

  // Team Toevoegen
  if (target.id === "addTeam" || target.closest("#addTeam")) {
    e.preventDefault();
    if (!state.owner) return;
    const name = $("newTeamName") ? $("newTeamName").value.trim() : "";
    if (!name) return message("Vul een teamnaam in.");
    const newRef = db.ref(`games/${state.gameId}/teams`).push();
    await newRef.set({ name: name.slice(0, 30), role: $("newTeamRole").value });
    if ($("newTeamName")) $("newTeamName").value = "";
  }

  // Spel Starten
  if (target.id === "startGame" || target.closest("#startGame")) {
    e.preventDefault();
    if (!state.owner) return;
    const snap = await db.ref(`games/${state.gameId}`).get();
    const g = snap.val();
    const teams = Object.values(g.teams || {}), members = Object.values(g.members || {});
    if (!teams.some(t => t.role === "police") || !teams.some(t => t.role === "robber")) return message("Maak minimaal één Politie-team en één Boeven-team.");
    if (members.some(m => !m.teamId)) return message("Wijs iedere speler toe aan een team voordat je start.");
    if (!confirm("Het spel starten? De timer begint direct.")) return;
    await db.ref(`games/${state.gameId}`).update({ status: "running", startedAt: Date.now(), endsAt: Date.now() + (g.settings?.duration || 60) * 60000 });
    await maybePublish(true);
  }

  // Spel Pauzeren
  if (target.id === "pauseGame" || target.closest("#pauseGame")) {
    e.preventDefault();
    if (!state.owner || state.game?.status !== "running") return;
    const remaining = Math.max(0, (state.game.endsAt || Date.now()) - Date.now());
    await db.ref(`games/${state.gameId}`).update({ status: "paused", pausedRemaining: remaining, pausedAt: Date.now() });
    message("Het spel is gepauzeerd. De timer en GPS-updates zijn stilgezet.");
  }

  // Spel Hervatten
  if (target.id === "resumeGame" || target.closest("#resumeGame")) {
    e.preventDefault();
    if (!state.owner || state.game?.status !== "paused") return;
    const remaining = state.game.pausedRemaining || ((state.game.settings?.duration || 60) * 60000);
    await db.ref(`games/${state.gameId}`).update({ status: "running", endsAt: Date.now() + remaining, pausedRemaining: null, pausedAt: null });
    await maybePublish(true);
    message("Het spel is hervat!");
  }

  // Verlaat Potje
  if (target.id === "leaveGame" || target.closest("#leaveGame")) {
    e.preventDefault();
    if (confirm("Terug naar start? Je blijft als deelnemer in het potje staan.")) {
      cleanListeners();
      endCall();
      state.gameId = null; state.game = null; state.member = null; state.owner = false; state.lastSent = 0;
      show("home"); renderSavedGames(); refreshSavedGames(); loadUpdateLog();
    }
  }

  // Refresh Saved Games
  if (target.id === "refreshSavedGames" || target.closest("#refreshSavedGames")) {
    e.preventDefault();
    refreshSavedGames();
  }

  // Open Saved Game
  const openBtn = target.closest("[data-open-saved]");
  if (openBtn) {
    e.preventDefault();
    openSavedGame(openBtn.dataset.openSaved);
  }

  // Opnemen Call
  if (target.id === "acceptCallBtn" || target.closest("#acceptCallBtn")) {
    e.preventDefault();
    const callId = state.incomingCallId;
    if (!callId) return;
    if ($("incomingCallOverlay")) $("incomingCallOverlay").hidden = true;
    state.activeCallId = callId;

    try {
      const snap = await db.ref(`games/${state.gameId}/calls/${callId}`).get();
      if (!snap.exists()) return message("Oproep is al verlopen.");
      const callData = snap.val();

      const stream = await getMicrophoneStream();
      state.peerConnection = new RTCPeerConnection(rtcConfig);
      stream.getTracks().forEach(track => state.peerConnection.addTrack(track, stream));

      state.peerConnection.ontrack = evt => {
        if ($("remoteAudio")) $("remoteAudio").srcObject = evt.streams[0];
      };

      state.peerConnection.onicecandidate = evt => {
        if (evt.candidate) db.ref(`games/${state.gameId}/calls/${callId}/targetCandidates`).push(evt.candidate.toJSON());
      };

      await state.peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
      const answer = await state.peerConnection.createAnswer();
      await state.peerConnection.setLocalDescription(answer);

      await db.ref(`games/${state.gameId}/calls/${callId}`).update({
        answer: { type: answer.type, sdp: answer.sdp },
        status: "connected"
      });

      listen(`games/${state.gameId}/calls/${callId}/callerCandidates`, candidateData => {
        if (!candidateData || !state.peerConnection) return;
        Object.values(candidateData).forEach(cand => {
          try { state.peerConnection.addIceCandidate(new RTCIceCandidate(cand)); } catch (err) {}
        });
      });

      listen(`games/${state.gameId}/calls/${callId}/status`, status => {
        if (status === "ended") endCall();
      });

      showActiveCallBar(`IN GESPREK MET ${callData.callerName.toUpperCase()}`);
      startCallTimer();
    } catch (err) {
      message("Opnemen mislukt: " + err.message);
      endCall();
    }
  }

  // Weigeren Call
  if (target.id === "rejectCallBtn" || target.closest("#rejectCallBtn")) {
    e.preventDefault();
    if (state.incomingCallId && state.gameId) {
      await db.ref(`games/${state.gameId}/calls/${state.incomingCallId}`).update({ status: "rejected" });
      state.incomingCallId = null;
    }
    if ($("incomingCallOverlay")) $("incomingCallOverlay").hidden = true;
  }

  // Ophangen Call
  if (target.id === "hangupBtn" || target.closest("#hangupBtn")) {
    e.preventDefault();
    endCall();
  }
});

// TABS SWITCHEN
document.querySelectorAll("[data-tab]").forEach(b => {
  b.onclick = () => {
    document.querySelectorAll("[data-tab]").forEach(x => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab-content").forEach(x => x.hidden = x.id !== `tab-${b.dataset.tab}`);
    if (b.dataset.tab === "location" && state.map) setTimeout(() => state.map.invalidateSize(), 100);
  };
});

// CHAT VERSTUREN
if ($("chatForm")) {
  $("chatForm").onsubmit = async e => {
    e.preventDefault();
    const text = $("chatText").value.trim();
    if (!text || !state.gameId) return;
    await db.ref(`games/${state.gameId}/chat`).push({ uid: state.uid, name: state.game?.members?.[state.uid]?.name || "Speler", text: text.slice(0, 300), at: Date.now() });
    $("chatText").value = "";
  };
}

// ONZICHTBAAR MAKEN (BOEVEN)
if ($("offlineButton")) {
  $("offlineButton").onclick = async () => {
    const m = state.game?.members?.[state.uid], settings = state.game?.settings || {};
    if (!m) return;
    if ((m.offlineUses || 0) >= (settings.offlineUses || 0)) return message("Je hebt geen offline-momenten meer.");
    const until = Date.now() + (settings.offlineDuration || 60) * 1000;
    await db.ref(`games/${state.gameId}/members/${state.uid}`).update({ offlineUntil: until, offlineUses: (m.offlineUses || 0) + 1 });
    message(`Je locatie wordt ${settings.offlineDuration || 60} seconden niet bijgewerkt.`);
  };
}

// BOEVEN GETIKT (POLITIE)
if ($("taggedButton")) {
  $("taggedButton").onclick = async () => {
    if (!state.game || (state.game.status !== "running" && state.game.status !== "paused")) return;
    const me = state.game.members?.[state.uid], team = state.game.teams?.[me?.teamId];
    if (team?.role !== "police") return message("Alleen Politie kan aangeven dat de Boeven getikt zijn.");
    if (confirm("Bevestig: de Boeven zijn getikt en Politie wint?")) await db.ref(`games/${state.gameId}`).update({ status: "over", winner: "Politie", endedAt: Date.now() });
  };
}

// BOEVEN GEWONNEN (HOST)
if ($("robbersWinButton")) {
  $("robbersWinButton").onclick = async () => {
    if (!state.owner) return message("Alleen de host kan dit aangeven.");
    if (confirm("Boeven als winnaar instellen?")) await db.ref(`games/${state.gameId}`).update({ status: "over", winner: "Boeven", endedAt: Date.now() });
  };
}

window.addEventListener("beforeunload", () => {
  cleanListeners();
  if (state.watch !== null) navigator.geolocation.clearWatch(state.watch);
  endCall();
});

// STARTUP INITIALISATIE
loadUpdateLog();
