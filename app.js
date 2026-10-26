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
const state = { uid: localStorage.getItem("js_uid") || crypto.randomUUID(), pos:null, watch:null, gameId:null, game:null, member:null, owner:false, map:null, markers:{}, unsubs:[], tick:null, lastSent:0, lastAttempt:0, publishing:false, geoError:null, lastGeoAt:0, resumeBusy:false };
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
function initMap(){if(state.map)return;state.map=L.map("map").setView([51.326,5.98],12);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(state.map);L.circle([51.326,5.98],{radius:8500,color:"#65805f",weight:1,fillOpacity:.025,interactive:false}).addTo(state.map)}
function teamColor(role){return role==="police"?"#5cb5ff":"#ff615a"}
function renderMap(){if(!state.map||!state.game)return;const members=state.game.members||{},teams=state.game.teams||{},myRole=teams[members[state.uid]?.teamId]?.role;Object.entries(members).forEach(([uid,m])=>{if(!m.location||!m.teamId)return;const team=teams[m.teamId];if(!team)return;const loc=m.location,isOpponent=!!myRole&&team.role!==myRole,offline=!!(isOpponent&&m.offlineUntil&&m.offlineUntil>Date.now());const interval=Math.max(5,Number(state.game.settings?.updateInterval)||30)*1000;const last=Number(loc.updatedAt||m.lastSeen||0);const stale=isOpponent&&(!last||Date.now()-last>Math.max(45000,interval*2));const label=offline?"OFFLINE":stale?"LOCATIE NIET BINNEN":team.role==="police"?"POLITIE":"BOEVEN";const color=offline?"#a1a8a1":teamColor(team.role);const icon=L.divIcon({className:"",html:`<div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 5px ${color}44;opacity:${offline ? .65 : 1}"></div>`,iconSize:[18,18],iconAnchor:[9,9]});if(state.markers[uid]){state.markers[uid].setLatLng([loc.lat,loc.lng]).setIcon(icon).setPopupContent(`<b>${esc(m.name)}</b><br>${label}${offline?" • locatie tijdelijk verborgen":stale?" • apparaat mogelijk offline of in standby":""}`)}else state.markers[uid]=L.marker([loc.lat,loc.lng],{icon}).addTo(state.map).bindPopup(`<b>${esc(m.name)}</b><br>${label}`)});Object.keys(state.markers).forEach(uid=>{if(!members[uid]||!members[uid].location){state.map.removeLayer(state.markers[uid]);delete state.markers[uid]}})}
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
async function enterGame(id,member,owner=false){cleanListeners();state.gameId=id;state.member=member;state.owner=owner;state.lastSent=Number(member?.location?.updatedAt||0);state.lastAttempt=0;state.publishing=false;show("lobby");initMap();setTimeout(()=>state.map.invalidateSize(),100);listen(`games/${id}`,applyGame);listen(`games/${id}/chat`,renderChat)}
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
