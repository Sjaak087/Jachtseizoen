import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getDatabase, ref, set, update, get, onValue, push, runTransaction } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

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
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const $ = id => document.getElementById(id);
const state = {
  uid: localStorage.getItem("js_uid") || crypto.randomUUID(), pos:null, watch:null,
  gameId:null, game:null, member:null, owner:false, map:null, markers:{},
  unsubs:[], tick:null, lastSent:0, lastAttempt:0, publishing:false,
  geoError:null, lastGeoAt:0, resumeBusy:false, mapFitGameId:null,
  routeLine:null, routeLineUid:null, routeStats:{}, routeRequestKeys:{},
  routeCache:{}, routePending:{}, routeQueue:[], routeWorkerRunning:false,
  lastRouteRequestAt:0, lastTrackPositions:{}, movementLines:{}
};
const HISTORY_KEY = "js_game_history";
localStorage.setItem("js_uid",state.uid);
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const code = () => Math.random().toString(36).slice(2,8).toUpperCase();
function show(id){["locationGate","home","lobby"].forEach(x=>$(x).hidden=x!==id)}
function message(text){alert(text)}
function cleanListeners(){state.unsubs.forEach(fn=>fn());state.unsubs=[];if(state.tick)clearInterval(state.tick);state.tick=null}
function listen(path,cb){state.unsubs.push(onValue(ref(db,path),s=>cb(s.val())))}
function hasLocation(){return !!state.pos}
function getPosition(){return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}),reject,{enableHighAccuracy:true,timeout:15000,maximumAge:5000}))}
$("enableLocation").onclick=async()=>{if(!navigator.geolocation){$("locationError").hidden=false;return}try{state.pos=await getPosition();$("locationError").hidden=true;show("home");startWatch();renderSavedGames();refreshSavedGames()}catch(e){state.geoError="permission";$("locationError").hidden=false}};
function updateLocationNotice(){
  const el=$("locationNotice");if(!el)return;
  const game=state.game,me=game?.members?.[state.uid];
  if(!state.gameId||!game||game.status!=="running"){el.hidden=true;return}
  const teams=game.teams||{},members=game.members||{};
  const myRole=teams[me?.teamId]?.role;
  if(!myRole){el.hidden=true;return}
  const interval=Math.max(5,Number(game.settings?.updateInterval)||30)*1000;
  const staleAfter=Math.max(45000,interval*2);
  const now=Date.now();
  const opponents=Object.entries(members).filter(([uid,m])=>uid!==state.uid&&teams[m.teamId]?.role&&teams[m.teamId].role!==myRole);
  if(!opponents.length){el.hidden=true;return}
  const delayed=opponents.filter(([,m])=>{
    const last=Number(m.location?.updatedAt||m.lastSeen||0);
    return Number(m.offlineUntil||0)>now||!m.location||!last||now-last>staleAfter;
  });
  if(!delayed.length){el.hidden=true;el.classList.remove("ok");el.textContent="";return}
  const names=delayed.slice(0,3).map(([,m])=>m.name||"Tegenstander");
  const extra=delayed.length>3?` en ${delayed.length-3} andere speler(s)`:"";
  const temporarilyHidden=delayed.every(([,m])=>Number(m.offlineUntil||0)>now);
  el.hidden=false;el.classList.remove("ok");
  el.textContent=temporarilyHidden
    ? `Locatie van ${names.join(", ")}${extra} is tijdelijk verborgen.`
    : `Locatie van ${names.join(", ")}${extra} komt niet binnen of is niet recent bijgewerkt.`;
}
function updateLocationSendCountdown(){
  const bar=$("locationCountdownBar");if(!bar)return;
  const game=state.game;
  if(!state.gameId||!game||game.status!=="running"){bar.hidden=true;return}
  bar.hidden=false;
  const interval=Math.max(5,Number(game.settings?.updateInterval)||30)*1000;
  const me=game.members?.[state.uid];
  const now=Date.now();
  const offlineUntil=Number(me?.offlineUntil||0);
  const nextDue=Math.max(state.lastSent?state.lastSent+interval:now,offlineUntil>now?offlineUntil:0);
  const seconds=Math.max(0,Math.ceil((nextDue-now)/1000));
  $("locationSendCountdown").textContent=String(seconds);
  const hint=$("locationCountdownHint");
  if(!navigator.onLine)hint.textContent="Geen internetverbinding — locatie wordt opnieuw verstuurd zodra je weer online bent.";
  else if(state.geoError)hint.textContent="Locatie-update wacht op een werkende GPS-verbinding.";
  else if(offlineUntil>now)hint.textContent="Je locatie staat tijdelijk uit; daarna wordt delen hervat.";
  else if(seconds===0)hint.textContent=state.publishing?"Nieuwe locatie wordt verstuurd…":"Nieuwe locatie wordt nu verstuurd.";
  else hint.textContent=`Automatische GPS-update elke ${Math.round(interval/1000)} seconden.`;
}
function positionSuccess(p){state.pos={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy};state.lastGeoAt=Date.now();state.geoError=null;maybePublish(false);updateLocationNotice();updateLocationSendCountdown()}
function positionError(err){state.geoError=err?.code===1?"permission":"unavailable";updateLocationNotice();updateLocationSendCountdown()}
async function refreshPositionAndPublish(){if(state.resumeBusy||!navigator.geolocation)return;state.resumeBusy=true;try{const p=await getPosition();positionSuccess({coords:{latitude:p.lat,longitude:p.lng,accuracy:p.accuracy}})}catch(e){positionError(e)}finally{state.resumeBusy=false}}
async function startWatch(){if(state.watch!==null)navigator.geolocation.clearWatch(state.watch);state.watch=navigator.geolocation.watchPosition(positionSuccess,positionError,{enableHighAccuracy:true,maximumAge:0,timeout:20000})}
// Browsers often pause web pages in standby. We cannot force background GPS, but
// when the page wakes or connectivity returns, request a fresh fix immediately.
window.addEventListener("online",()=>{state.geoError=null;refreshPositionAndPublish()});
window.addEventListener("pageshow",()=>{if(!document.hidden)refreshPositionAndPublish()});
window.addEventListener("focus",()=>refreshPositionAndPublish());
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshPositionAndPublish();else updateLocationNotice()});
function initMap(){
  if(state.map)return;
  // Start met een overzicht van Nederland. Zodra teams en locaties bekend zijn,
  // zoomt de kaart één keer naar de spelers van het actieve potje.
  state.map=L.map("map").setView([52.1326,5.2913],7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:19,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(state.map);
}
function teamColor(role){return role==="police"?"#5cb5ff":"#ff615a"}
function validPoint(p){return !!p&&Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng))&&Math.abs(Number(p.lat))<=90&&Math.abs(Number(p.lng))<=180}
function routeKey(from,to){return [Number(from.lat).toFixed(4),Number(from.lng).toFixed(4),Number(to.lat).toFixed(4),Number(to.lng).toFixed(4)].join(",")}
function straightDistance(a,b){
  const rad=v=>v*Math.PI/180, earth=6371000;
  const dLat=rad(Number(b.lat)-Number(a.lat)),dLng=rad(Number(b.lng)-Number(a.lng));
  const lat1=rad(Number(a.lat)),lat2=rad(Number(b.lat));
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return earth*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
function formatDistance(m){if(!Number.isFinite(m))return "—";return m<1000?`${Math.round(m)} m`:`${(m/1000).toFixed(1).replace(".",",")} km`}
function formatEstimate(distance,speedKmh){
  if(!Number.isFinite(distance))return "—";
  const minutes=distance/(speedKmh*1000/60);
  if(minutes<1)return "minder dan 1 min";
  if(minutes<60)return `± ${Math.round(minutes)} min`;
  const hours=Math.floor(minutes/60),rest=Math.round(minutes%60);
  return `± ${hours} u ${String(rest).padStart(2,"0")} min`;
}
function cacheRoute(key,result){state.routeCache[key]=result;const keys=Object.keys(state.routeCache);if(keys.length>120)delete state.routeCache[keys[0]]}
function requestFootRoute(from,to,callback,priority=0){
  if(!validPoint(from)||!validPoint(to)){callback(null);return}
  const key=routeKey(from,to);
  if(Object.prototype.hasOwnProperty.call(state.routeCache,key)){callback(state.routeCache[key]);return}
  if(state.routePending[key]){state.routePending[key].push(callback);return}
  state.routePending[key]=[callback];
  state.routeQueue.push({key,from:{lat:Number(from.lat),lng:Number(from.lng)},to:{lat:Number(to.lat),lng:Number(to.lng)},priority});
  processRouteQueue();
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function processRouteQueue(){
  if(state.routeWorkerRunning)return;
  state.routeWorkerRunning=true;
  try{
    while(state.routeQueue.length){
      state.routeQueue.sort((a,b)=>a.priority-b.priority);
      const job=state.routeQueue.shift();
      const wait=Math.max(0,1100-(Date.now()-state.lastRouteRequestAt));
      if(wait)await pause(wait);
      state.lastRouteRequestAt=Date.now();
      let result=null;
      try{
        const coords=`${job.from.lng},${job.from.lat};${job.to.lng},${job.to.lat}`;
        const url=`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&alternatives=true`;
        const response=await fetch(url,{mode:"cors",cache:"no-store"});
        if(!response.ok)throw new Error(`Route-server antwoordde ${response.status}`);
        const data=await response.json();
        if(data.code!=="Ok"||!Array.isArray(data.routes)||!data.routes.length)throw new Error(data.message||"Geen wandelroute gevonden");
        const chosen=data.routes.reduce((best,r)=>!best||Number(r.duration)<Number(best.duration)?r:best,null);
        const coordsOut=chosen.geometry?.coordinates;
        if(!Array.isArray(coordsOut)||coordsOut.length<2)throw new Error("Route heeft geen kaartlijn");
        result={coords:coordsOut.map(c=>[Number(c[1]),Number(c[0])]),distance:Number(chosen.distance),duration:Number(chosen.duration)};
        cacheRoute(job.key,result);
      }catch(error){console.warn("Wandelroute kon niet worden berekend:",error.message)}
      const callbacks=state.routePending[job.key]||[];
      delete state.routePending[job.key];
      callbacks.forEach(cb=>{try{cb(result)}catch(error){console.warn("Routeweergave mislukt",error)}});
    }
  }finally{
    state.routeWorkerRunning=false;
    if(state.routeQueue.length)processRouteQueue();
  }
}
function clearRouteAndTracks(){
  if(state.routeLine&&state.map)state.map.removeLayer(state.routeLine);
  state.routeLine=null;state.routeLineUid=null;
  Object.values(state.movementLines).flat().forEach(line=>{if(state.map)state.map.removeLayer(line)});
  state.movementLines={};state.lastTrackPositions={};state.routeStats={};state.routeRequestKeys={};
  state.routeQueue=[];state.routePending={};
}
function addMovementSegment(uid,from,to,role,route,gameId){
  if(state.gameId!==gameId||!state.map||!state.game?.members?.[uid])return;
  const coords=route?.coords?.length>=2?route.coords:[[Number(from.lat),Number(from.lng)],[Number(to.lat),Number(to.lng)]];
  const line=L.polyline(coords,{color:teamColor(role),weight:3,opacity:route?.coords?.length >= 2 ? 0.72 : 0.42,dashArray:route?.coords?.length >= 2 ? "7 6" : "2 7",lineCap:"round"}).addTo(state.map);
  line.bindTooltip(route?.coords?.length>=2?"Geschat pad over wandelwegen tussen twee GPS-updates":"GPS-lijn tussen twee locatie-updates (wandelroute niet beschikbaar)");
  if(!state.movementLines[uid])state.movementLines[uid]=[];
  state.movementLines[uid].push(line);
  while(state.movementLines[uid].length>20){const old=state.movementLines[uid].shift();state.map.removeLayer(old)}
}
function rememberOpponentMovement(uid,loc,role){
  if(state.game?.status!=="running"||!validPoint(loc))return;
  const current={lat:Number(loc.lat),lng:Number(loc.lng),updatedAt:Number(loc.updatedAt||0)};
  const previous=state.lastTrackPositions[uid];
  state.lastTrackPositions[uid]=current;
  if(!previous||current.updatedAt<=0||current.updatedAt<=previous.updatedAt||straightDistance(previous,current)<12)return;
  const gameId=state.gameId;
  requestFootRoute(previous,current,route=>addMovementSegment(uid,previous,current,role,route,gameId),1);
}
function setFastestRoute(opponents,origin,myRole){
  if(!state.map||state.game?.status!=="running")return;
  const ready=opponents.map(([uid,m])=>({uid,m,route:state.routeStats[uid],key:state.routeRequestKeys[uid]}))
    .filter(x=>x.route&&!x.route.loading&&!x.route.error&&x.route.key===x.key&&Number.isFinite(x.route.duration));
  ready.sort((a,b)=>a.route.duration-b.route.duration);
  const fastest=ready[0];
  if(!fastest){if(state.routeLine){state.map.removeLayer(state.routeLine);state.routeLine=null;state.routeLineUid=null}return}
  const color=teamColor(myRole),latlngs=fastest.route.coords;
  if(state.routeLine){state.routeLine.setLatLngs(latlngs).setStyle({color,weight:5,opacity:.95,dashArray:null});state.routeLineUid=fastest.uid}
  else{state.routeLine=L.polyline(latlngs,{color,weight:5,opacity:.95,lineCap:"round",lineJoin:"round"}).addTo(state.map);state.routeLineUid=fastest.uid}
  state.routeLine.bindTooltip(`Snelste wandelroute naar ${esc(fastest.m.name||"Tegenstander")}`);
  state.routeLine.bringToFront();
}
function renderRoutePanel(opponents,myRole){
  const panel=$("routePanel");if(!panel)return;
  if(!state.game||state.game.status!=="running"){panel.hidden=true;return}
  panel.hidden=false;
  const status=$("routeStatus"),summary=$("routeSummary"),list=$("routeTargets");
  if(!myRole){status.textContent="Kies eerst een team";summary.innerHTML="<p class=\"route-empty\">Je moet aan een Politie- of Boeven-team zijn toegewezen om routes te berekenen.</p>";list.innerHTML="";return}
  const active=opponents.filter(([,m])=>validPoint(m.location));
  if(!active.length){status.textContent="Wachten op GPS";summary.innerHTML="<p class=\"route-empty\">Nog geen bruikbare locatie van het andere team ontvangen.</p>";list.innerHTML="";return}
  const ready=active.map(([uid,m])=>({uid,m,route:state.routeStats[uid],key:state.routeRequestKeys[uid]}))
    .filter(x=>x.route&&!x.route.loading&&!x.route.error&&x.route.key===x.key&&Number.isFinite(x.route.distance));
  const waiting=active.some(([uid])=>{
    const route=state.routeStats[uid];
    return !route||route.loading||route.key!==state.routeRequestKeys[uid];
  });
  ready.sort((a,b)=>a.route.duration-b.route.duration);
  const fastest=ready[0];
  status.textContent=fastest?`${ready.length}/${active.length} ROUTES KLAAR`:waiting?"Routes berekenen…":"Geen route beschikbaar";
  if(fastest){
    const distance=fastest.route.distance;
    summary.innerHTML=`<div class="route-summary-main"><div><small>SNELSTE WANDELROUTE</small><strong>${esc(fastest.m.name||"Tegenstander")}</strong></div><b>${formatDistance(distance)}</b></div><div class="route-estimates"><div><small>TE VOET</small><strong>${formatEstimate(distance,4.8)}</strong><span>ca. 4,8 km/u</span></div><div><small>RENNEN</small><strong>${formatEstimate(distance,10)}</strong><span>ca. 10 km/u</span></div></div>`;
  }else{
    summary.innerHTML=`<p class="route-empty">${waiting?"De wegafstand wordt berekend via het OpenStreetMap-wandelnetwerk…":"Er kon geen wandelroute worden gevonden. Probeer het opnieuw zodra een locatie wordt bijgewerkt."}</p>`;
  }
  list.innerHTML=active.map(([uid,m])=>{
    const route=state.routeStats[uid],key=state.routeRequestKeys[uid],ok=route&&!route.loading&&!route.error&&route.key===key&&Number.isFinite(route.distance);
    return `<div class="route-target-row"><div class="route-target-name"><i style="background:${teamColor(state.game.teams?.[m.teamId]?.role)}"></i><span>${esc(m.name||"Tegenstander")}</span></div>${ok?`<div class="route-target-meta"><b>${formatDistance(route.distance)}</b><span>lopen ${formatEstimate(route.distance,4.8)} · rennen ${formatEstimate(route.distance,10)}</span></div>`:`<div class="route-target-meta"><b>${route?.error?"Niet beschikbaar":"Berekenen…"}</b><span>via wandelwegen</span></div>`}</div>`;
  }).join("");
}
function renderMap(){
  if(!state.map||!state.game)return;
  const members=state.game.members||{},teams=state.game.teams||{},myRole=teams[members[state.uid]?.teamId]?.role;
  const me=members[state.uid],origin=validPoint(me?.location)?{lat:Number(me.location.lat),lng:Number(me.location.lng)}:state.pos;
  const interval=Math.max(5,Number(state.game.settings?.updateInterval)||30)*1000;
  const now=Date.now(),opponents=[],fitPoints=[];
  Object.entries(members).forEach(([uid,m])=>{
    const loc=m.location,team=teams[m.teamId];
    if(!validPoint(loc)||!m.teamId||!team){
      if(state.markers[uid]){state.map.removeLayer(state.markers[uid]);delete state.markers[uid]}
      return;
    }
    const isOpponent=!!myRole&&team.role!==myRole;
    const offline=!!(isOpponent&&Number(m.offlineUntil||0)>now);
    const last=Number(loc.updatedAt||m.lastSeen||0);
    const stale=isOpponent&&(!last||now-last>Math.max(45000,interval*2));
    const label=offline?"OFFLINE":stale?"LOCATIE NIET BINNEN":team.role==="police"?"POLITIE":"BOEVEN";
    const color=offline?"#a1a8a1":teamColor(team.role);
    const icon=L.divIcon({className:"",html:`<div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 5px ${color}44;opacity:${offline ? 0.65 : 1}"></div>`,iconSize:[18,18],iconAnchor:[9,9]});
    const popup=`<b>${esc(m.name)}</b><br>${label}${offline?" • locatie tijdelijk verborgen":stale?" • apparaat mogelijk offline of in standby":""}`;
    if(state.markers[uid])state.markers[uid].setLatLng([loc.lat,loc.lng]).setIcon(icon).setPopupContent(popup);
    else state.markers[uid]=L.marker([loc.lat,loc.lng],{icon}).addTo(state.map).bindPopup(popup);
    fitPoints.push([Number(loc.lat),Number(loc.lng)]);
    if(isOpponent&&state.game.status==="running"){
      rememberOpponentMovement(uid,loc,team.role);
      if(!offline&&!stale&&validPoint(origin)){
        opponents.push([uid,m]);
        const key=routeKey(origin,loc);
        if(state.routeRequestKeys[uid]!==key){
          state.routeRequestKeys[uid]=key;
          state.routeStats[uid]={key,loading:true};
          const gameId=state.gameId;
          requestFootRoute(origin,loc,route=>{
            if(state.gameId!==gameId||state.routeRequestKeys[uid]!==key)return;
            state.routeStats[uid]=route?{...route,key}:{key,error:true};
            renderMap();
          },0);
        }
      }
    }
  });
  Object.keys(state.markers).forEach(uid=>{if(!members[uid]||!validPoint(members[uid].location)||!members[uid].teamId||!teams[members[uid].teamId]){state.map.removeLayer(state.markers[uid]);delete state.markers[uid]}});
  if(state.mapFitGameId!==state.gameId&&fitPoints.length&&(fitPoints.length>1||state.game.status==="running")){
    state.mapFitGameId=state.gameId;
    if(fitPoints.length>1)state.map.fitBounds(L.latLngBounds(fitPoints),{padding:[28,28],maxZoom:14});
    else state.map.setView(fitPoints[0],13);
  }
  if(state.game.status!=="running"){
    if(state.routeLine){state.map.removeLayer(state.routeLine);state.routeLine=null;state.routeLineUid=null}
    renderRoutePanel([],myRole);
  }else{
    // Houd routeverzoeken beperkt tot tegenstanders die nog recente locaties delen.
    const liveIds=new Set(opponents.map(([uid])=>uid));
    Object.keys(state.routeStats).forEach(uid=>{if(!liveIds.has(uid)&&!Object.keys(members).includes(uid)){delete state.routeStats[uid];delete state.routeRequestKeys[uid]}});
    setFastestRoute(opponents,origin,myRole);
    renderRoutePanel(opponents,myRole);
  }
}
async function maybePublish(force=false){
  if(!state.gameId||!state.member||!state.pos||!state.game||state.game.status!=="running"||state.publishing)return;
  const now=Date.now(),interval=Math.max(5,Number(state.game.settings?.updateInterval)||30)*1000;
  if(!force&&state.lastSent&&now-state.lastSent<interval)return;
  if(!force&&state.lastAttempt&&now-state.lastAttempt<5000)return;
  const me=state.game.members?.[state.uid];if(me?.offlineUntil>now){updateLocationSendCountdown();return}
  state.publishing=true;state.lastAttempt=now;updateLocationSendCountdown();
  try{
    await update(ref(db,`games/${state.gameId}/members/${state.uid}`),{location:{...state.pos,updatedAt:now},lastSeen:now});
    state.lastSent=now;state.geoError=null;updateLocationNotice();
  }catch(e){state.geoError="network";console.warn(e);updateLocationNotice()}
  finally{state.publishing=false;updateLocationSendCountdown()}
}
function updateCountdown(){if(!state.game)return;const g=state.game;const running=g.status==="running";$("gameControls").hidden=!running;$("gameOver").hidden=g.status!=="over";$("gameStatus").textContent=g.status==="running"?"LIVE IN SPEL":g.status==="over"?"GAME OVER":"LOBBY";$("refreshLabel").textContent=running?`GPS-update: elke ${g.settings?.updateInterval||30} sec`:"Locatie wacht op start";if(g.status==="over"){$("winnerText").textContent=g.winner?`${g.winner} hebben gewonnen.`:"Het spel is afgelopen.";updateLocationSendCountdown();return}if(!running){updateLocationSendCountdown();return}const left=Math.max(0,(g.endsAt||Date.now())-Date.now());$("countdown").textContent=`${String(Math.floor(left/60000)).padStart(2,"0")}:${String(Math.floor(left/1000)%60).padStart(2,"0")}`;updateLocationSendCountdown();if(left<=0&&state.owner)update(ref(db,`games/${state.gameId}`),{status:"over",winner:"Boeven"})}
function renderTeams(){if(!state.game)return;const teams=state.game.teams||{},members=state.game.members||{};$("teamList").innerHTML=Object.entries(teams).map(([id,t])=>`<div class="team-card"><div class="team-card-head"><span class="${t.role==="police"?"role-police":"role-robber"}">${esc(t.name)} · ${t.role==="police"?"POLITIE":"BOEVEN"}</span>${state.owner?`<button class="copy" data-rename-team="${id}">HERNOEM</button>`:""}</div>${Object.entries(members).filter(([uid,m])=>m.teamId===id).map(([uid,m])=>`<div class="member-row"><span>${esc(m.name)}${uid===state.uid?" (jij)":""}</span>${state.owner?`<button class="copy" data-remove="${uid}">VERWIJDER</button>`:""}</div>`).join("")||'<div class="hint">Nog geen spelers toegewezen.</div>'}</div>`).join("")||'<p class="hint">Nog geen teams. Maak eerst een Politie- en Boeven-team aan.</p>';
$("memberList").innerHTML=Object.entries(members).map(([uid,m])=>`<div class="member-row"><span>${esc(m.name)}${uid===state.uid?" (jij)":""}</span>${state.owner?`<select data-assign="${uid}"><option value="">Niet toegewezen</option>${Object.entries(teams).map(([id,t])=>`<option value="${id}" ${m.teamId===id?"selected":""}>${esc(t.name)}</option>`).join("")}</select>`:`<small>${esc(teams[m.teamId]?.name||"Niet toegewezen")}</small>`}</div>`).join("");
document.querySelectorAll("[data-assign]").forEach(el=>el.onchange=()=>update(ref(db,`games/${state.gameId}/members/${el.dataset.assign}`),{teamId:el.value||null}));
document.querySelectorAll("[data-remove]").forEach(el=>el.onclick=async()=>{if(el.dataset.remove===state.uid){message("Je kunt jezelf niet als host verwijderen.");return}await set(ref(db,`games/${state.gameId}/members/${el.dataset.remove}`),null)});
document.querySelectorAll("[data-rename-team]").forEach(el=>el.onclick=async()=>{const t=teams[el.dataset.renameTeam],name=prompt("Nieuwe teamnaam:",t.name);if(name?.trim())await update(ref(db,`games/${state.gameId}/teams/${el.dataset.renameTeam}`),{name:name.trim().slice(0,30)})});
}
function renderChat(chat){$("chatMessages").innerHTML=Object.values(chat||{}).sort((a,b)=>a.at-b.at).slice(-100).map(m=>`<div class="chat-message"><small>${esc(m.name)} · ${new Date(m.at).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"})}</small>${esc(m.text)}</div>`).join("");$("chatMessages").scrollTop=$("chatMessages").scrollHeight}
function readGameHistory(){try{const items=JSON.parse(localStorage.getItem(HISTORY_KEY)||"[]");return Array.isArray(items)?items.filter(x=>x&&x.id):[]}catch{return []}}
function writeGameHistory(items){try{localStorage.setItem(HISTORY_KEY,JSON.stringify(items.slice(0,30)))}catch(e){console.warn("Potjesgeschiedenis kon niet worden opgeslagen",e)}}
function rememberGame(id,game,owner){const items=readGameHistory(),old=items.find(x=>x.id===id),entry={id,code:game.code||id,name:game.name||"Jachtseizoen",owner:!!owner,status:game.status||old?.status||"lobby",joinedAt:old?.joinedAt||Date.now(),updatedAt:Date.now(),available:true};writeGameHistory([entry,...items.filter(x=>x.id!==id)]);renderSavedGames()}
function statusLabel(status){return status==="running"?"ACTIEF":status==="over"?"AFGEROND":status==="missing"?"NIET BESCHIKBAAR":"LOBBY"}
function renderSavedGames(){
  const host=$("savedGamesList");if(!host)return;
  const items=readGameHistory();
  if(!items.length){host.innerHTML='<p class="saved-games-empty">Je hebt nog geen potjes gemaakt of gejoint. Je potjes verschijnen hier automatisch.</p>';return}
  host.innerHTML=items.map(item=>`<article class="saved-game-card"><div class="saved-game-main"><div class="saved-game-title">${esc(item.name||"Jachtseizoen")}</div><div class="saved-game-meta">Code: <b>${esc(item.code||item.id)}</b> · ${item.owner?"Door jou gemaakt":"Gejoint"}</div></div><span class="saved-game-status status-${esc(item.status||"lobby")}">${statusLabel(item.status)}</span><button class="btn secondary saved-game-open" data-open-saved="${esc(item.id)}">OPEN POTJE <span>→</span></button></article>`).join("");
}
async function refreshSavedGames(){
  const button=$("refreshSavedGames");if(button)button.disabled=true;
  try{
    const items=readGameHistory();
    await Promise.all(items.map(async item=>{try{const snap=await get(ref(db,`games/${item.id}`));if(snap.exists()){const game=snap.val();item.name=game.name||item.name;item.code=game.code||item.code;item.status=game.status||"lobby";item.owner=game.owner===state.uid;item.available=true}else{item.status="missing";item.available=false}}catch(e){console.warn("Potje kon niet worden ververst",item.id,e)}}));
    writeGameHistory(items);renderSavedGames();
  }finally{if(button)button.disabled=false}
}
async function openSavedGame(id){try{const snap=await get(ref(db,`games/${id}`));if(!snap.exists())return message("Dit potje bestaat niet meer of is niet bereikbaar.");const game=snap.val(),member=game.members?.[state.uid];if(!member)return message("Je bent geen deelnemer meer van dit potje.");rememberGame(id,game,game.owner===state.uid);await enterGame(id,member,game.owner===state.uid)}catch(e){message("Potje openen mislukt. Controleer je verbinding.\n"+e.message)}}
$("savedGamesList").addEventListener("click",e=>{const button=e.target.closest("[data-open-saved]");if(button)openSavedGame(button.dataset.openSaved)});
$("refreshSavedGames").onclick=refreshSavedGames;
function applyGame(g){if(!g)return;state.game=g;state.member=g.members?.[state.uid]||state.member;state.owner=g.owner===state.uid;const locationUpdatedAt=Number(g.members?.[state.uid]?.location?.updatedAt||0);if(locationUpdatedAt>state.lastSent)state.lastSent=locationUpdatedAt;$("lobbyTitle").textContent=g.name||"Jachtseizoen";$("displayCode").textContent=g.code||"------";$("ownerBadge").textContent=state.owner?"ALLEEN HOST":"ALLEEN LEZEN";["duration","updateInterval","offlineUses","offlineDuration"].forEach(id=>$(id).disabled=!state.owner);$("saveSettings").hidden=!state.owner;$("startGame").hidden=!state.owner||g.status!=="lobby";$("addTeam").disabled=!state.owner; $("newTeamName").disabled=!state.owner;$("newTeamRole").disabled=!state.owner;renderTeams();renderMap();updateCountdown();maybePublish();updateLocationNotice();updateLocationSendCountdown();if(g.status==="running"&&!state.tick)state.tick=setInterval(()=>{updateCountdown();maybePublish();updateLocationNotice();updateLocationSendCountdown();renderMap()},1000);if(g.status!=="running"&&state.tick){clearInterval(state.tick);state.tick=null}}
async function enterGame(id,member,owner=false){cleanListeners();clearRouteAndTracks();state.gameId=id;state.game= null;state.mapFitGameId=null;state.member=member;state.owner=owner;state.lastSent=Number(member?.location?.updatedAt||0);state.lastAttempt=0;state.publishing=false;show("lobby");initMap();setTimeout(()=>state.map.invalidateSize(),100);listen(`games/${id}`,applyGame);listen(`games/${id}/chat`,renderChat)}
$("createGame").onclick=async()=>{if(!hasLocation())return message("Locatie is vereist.");const name=$("gameName").value.trim();if(!name)return message("Vul een naam in.");const id=code(),now=Date.now(),game={name:name.slice(0,40),code:id,owner:state.uid,status:"lobby",createdAt:now,settings:{duration:60,updateInterval:30,offlineUses:2,offlineDuration:60},teams:{},members:{[state.uid]:{name:"Host",teamId:null,location:{...state.pos,updatedAt:now},lastSeen:now,offlineUses:0}}};try{await set(ref(db,`games/${id}`),game);await set(ref(db,`codes/${id}`),id);rememberGame(id,game,true);await enterGame(id,game.members[state.uid],true)}catch(e){message("Potje maken mislukt. Controleer of Realtime Database is ingeschakeld en de regels schrijven toestaan.\n"+e.message)}};
$("joinGame").onclick=async()=>{if(!hasLocation())return message("Locatie is vereist.");const c=$("joinCode").value.trim().toUpperCase(),name=$("joinName").value.trim();if(!c||!name)return message("Vul zowel de code als je naam in.");try{const snap=await get(ref(db,`games/${c}`));if(!snap.exists())return message("Deze code bestaat niet (meer).");const g=snap.val();if(g.status==="over")return message("Dit potje is afgelopen.");const now=Date.now(),member={name:name.slice(0,24),teamId:null,location:{...state.pos,updatedAt:now},lastSeen:now,offlineUses:0};await set(ref(db,`games/${c}/members/${state.uid}`),member);rememberGame(c,g,g.owner===state.uid);await enterGame(c,member,g.owner===state.uid)}catch(e){message("Joinen mislukt. Controleer de database-instellingen.\n"+e.message)}};
$("copyCode").onclick=async()=>{try{await navigator.clipboard.writeText($("displayCode").textContent);$("copyCode").textContent="GEKOPIEERD"}catch{message("Code: "+$("displayCode").textContent)}};
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".tab-content").forEach(x=>x.hidden=x.id!==`tab-${b.dataset.tab}`);if(b.dataset.tab==="location"&&state.map)setTimeout(()=>state.map.invalidateSize(),100)});
$("saveSettings").onclick=async()=>{const settings={duration:Math.max(1,Math.min(240,Number($("duration").value)||60)),updateInterval:Math.max(5,Math.min(600,Number($("updateInterval").value)||30)),offlineUses:Math.max(0,Math.min(20,Number($("offlineUses").value)||0)),offlineDuration:Math.max(5,Math.min(600,Number($("offlineDuration").value)||60))};await update(ref(db,`games/${state.gameId}/settings`),settings);message("Instellingen opgeslagen.")};
$("addTeam").onclick=async()=>{if(!state.owner)return;const name=$("newTeamName").value.trim();if(!name)return message("Vul een teamnaam in.");const id=push(ref(db,`games/${state.gameId}/teams`)).key;await set(ref(db,`games/${state.gameId}/teams/${id}`),{name:name.slice(0,30),role:$("newTeamRole").value});$("newTeamName").value=""};
$("startGame").onclick=async()=>{if(!state.owner)return;const g=(await get(ref(db,`games/${state.gameId}`))).val();const teams=Object.values(g.teams||{}),members=Object.values(g.members||{});if(!teams.some(t=>t.role==="police")||!teams.some(t=>t.role==="robber"))return message("Maak minimaal één Politie-team en één Boeven-team.");if(members.some(m=>!m.teamId))return message("Wijs iedere speler toe aan een team voordat je start.");if(!confirm("Het spel starten? De timer begint direct."))return;await update(ref(db,`games/${state.gameId}`),{status:"running",startedAt:Date.now(),endsAt:Date.now()+g.settings.duration*60000});await maybePublish(true)};
$("chatForm").onsubmit=async e=>{e.preventDefault();const text=$("chatText").value.trim();if(!text||!state.gameId)return;await push(ref(db,`games/${state.gameId}/chat`),{uid:state.uid,name:state.game?.members?.[state.uid]?.name||"Speler",text:text.slice(0,300),at:Date.now()});$("chatText").value=""};
$("offlineButton").onclick=async()=>{const m=state.game?.members?.[state.uid],settings=state.game?.settings||{};if(!m)return;if((m.offlineUses||0)>=(settings.offlineUses||0))return message("Je hebt geen offline-momenten meer.");const until=Date.now()+settings.offlineDuration*1000;await update(ref(db,`games/${state.gameId}/members/${state.uid}`),{offlineUntil:until,offlineUses:(m.offlineUses||0)+1});message(`Je locatie wordt ${settings.offlineDuration} seconden niet bijgewerkt.`)};
$("taggedButton").onclick=async()=>{if(!state.game||state.game.status!=="running")return;const me=state.game.members?.[state.uid],team=state.game.teams?.[me?.teamId];if(team?.role!=="police")return message("Alleen Politie kan aangeven dat de Boeven getikt zijn.");if(confirm("Bevestig: de Boeven zijn getikt en Politie wint?"))await update(ref(db,`games/${state.gameId}`),{status:"over",winner:"Politie",endedAt:Date.now()})};
$("robbersWinButton").onclick=async()=>{if(!state.owner)return message("Alleen de host kan dit aangeven.");if(confirm("Boeven als winnaar instellen?"))await update(ref(db,`games/${state.gameId}`),{status:"over",winner:"Boeven",endedAt:Date.now()})};
$("leaveGame").onclick=()=>{if(confirm("Terug naar start? Je blijft als deelnemer in het potje staan.")){cleanListeners();state.gameId=null;state.game=null;state.member=null;state.owner=false;state.lastSent=0;show("home");renderSavedGames();refreshSavedGames()}};
window.addEventListener("beforeunload",()=>{cleanListeners();if(state.watch!==null)navigator.geolocation.clearWatch(state.watch)});
