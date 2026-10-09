import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, getDocs, query, where,
  onSnapshot, updateDoc, deleteDoc, serverTimestamp, writeBatch, runTransaction
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const configured = firebaseConfig.projectId && firebaseConfig.projectId !== "REMPLACEZ_MOI";
let app, auth, db, currentUser = null;
let gameUnsubscribe = null, playersUnsubscribe = null, timerInterval = null, heartbeatInterval = null;
let room = { id: null, game: null, players: [] };

if (configured) {
  try { app = initializeApp(firebaseConfig); auth = getAuth(app); db = getFirestore(app); }
  catch (error) { console.error(error); }
}

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[char]));
const statusText = { open: "Inscriptions ouvertes", waiting: "En attente", playing: "En cours", ended: "Terminée" };
const teamText = { seekers: "🔴 Chercheurs", hiders: "🔵 Cachés", pending: "À répartir" };

function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timeout); toast.timeout = setTimeout(() => el.classList.remove("show"), 3600);
}
function ready() {
  if (configured && auth && db) return true;
  toast("Configurez d’abord js/firebase-config.js avec votre projet Firebase."); return false;
}
function showView(id) {
  $$(".view").forEach(view => view.classList.toggle("active", view.id === id));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (id !== "roomView") leaveRoom(false);
  if (id === "createView" && (!currentUser || currentUser.isAnonymous)) showView("authView");
  if (id === "organizerView") loadMyGames();
}
function getCode() {
  const symbols = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => symbols[Math.floor(Math.random() * symbols.length)]).join("");
}
function isOrganizer(game = room.game) { return !!(game && currentUser && game.organizerId === currentUser.uid); }
function isRecent(player) {
  const ms = player.lastSeen?.toMillis?.() || 0;
  return ms && Date.now() - ms < 75_000;
}
function gameUrl(game) { return `${location.origin}${location.pathname}?game=${encodeURIComponent(game.code)}`; }
function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderAccount() {
  const button = $("#accountButton");
  button.textContent = currentUser && !currentUser.isAnonymous ? "Mes parties" : "Espace organisateur";
}
function switchAuthTab(tab) {
  $$("[data-auth-tab]").forEach(button => button.classList.toggle("active", button.dataset.authTab === tab));
  $("#loginForm").classList.toggle("hidden", tab !== "login");
  $("#registerForm").classList.toggle("hidden", tab !== "register");
}

async function ensurePlayerAuth() {
  if (!ready()) return null;
  if (currentUser) return currentUser;
  await signInAnonymously(auth);
  return auth.currentUser;
}
async function createGame(event) {
  event.preventDefault();
  if (!ready() || !currentUser || currentUser.isAnonymous) { showView("authView"); return; }
  const form = new FormData(event.currentTarget);
  const maxPlayers = Number(form.get("maxPlayers")), durationMinutes = Number(form.get("durationMinutes")), seekerCount = Number(form.get("seekerCount"));
  if (seekerCount >= maxPlayers) return toast("Il faut laisser au moins une place pour les cachés.");
  const button = $("button[type=submit]", event.currentTarget); button.disabled = true;
  try {
    let ref, game;
    // Le code est aussi l'identifiant Firestore. Une transaction refuse donc toute collision,
    // même si deux organisateurs créent une salle exactement au même instant.
    for (let attempt = 0; attempt < 5 && !ref; attempt += 1) {
      const code = getCode();
      const candidate = doc(db, "games", code);
      game = { name: form.get("name").trim(), code, organizerId: currentUser.uid,
        maxPlayers, durationMinutes, seekerCount, status: "open", createdAt: serverTimestamp(), result: null };
      try {
        await runTransaction(db, async transaction => {
          if ((await transaction.get(candidate)).exists()) throw new Error("CODE_EXISTS");
          transaction.set(candidate, game);
        });
        ref = candidate;
      } catch (error) {
        if (error.message !== "CODE_EXISTS" || attempt === 4) throw error;
      }
    }
    toast(`Partie créée — code ${game.code}`); openRoom(ref.id);
  } catch (error) { console.error(error); toast("Impossible de créer la partie. Vérifiez Firebase et les règles."); }
  finally { button.disabled = false; }
}
async function joinGame(event) {
  event.preventDefault();
  if (!ready()) return;
  const form = new FormData(event.currentTarget);
  const code = String(form.get("code")).trim().toUpperCase();
  const displayName = String(form.get("displayName")).trim();
  if (!displayName || !/^[A-Z0-9]{6}$/.test(code)) return toast("Saisissez un pseudo et un code à 6 caractères valide.");
  const button = $("button[type=submit]", event.currentTarget); button.disabled = true;
  try {
    const user = await ensurePlayerAuth();
    const gameDoc = await getDoc(doc(db, "games", code));
    if (!gameDoc.exists()) return toast("Aucune partie ne correspond à ce code.");
    const game = gameDoc.data();
    if (game.status !== "open") return toast("Les inscriptions à cette partie sont fermées.");
    const playerRef = doc(db, "games", gameDoc.id, "players", user.uid);
    const existing = await getDoc(playerRef);
    if (!existing.exists()) {
      const players = await getDocs(collection(db, "games", gameDoc.id, "players"));
      if (players.size >= game.maxPlayers) return toast("Cette partie est complète.");
      await setDoc(playerRef, { uid: user.uid, displayName, team: "pending", joinedAt: serverTimestamp(), lastSeen: serverTimestamp() });
    } else {
      await updateDoc(playerRef, { lastSeen: serverTimestamp() });
    }
    openRoom(gameDoc.id);
  } catch (error) { console.error(error); toast("Connexion impossible. Réessayez dans un instant."); }
  finally { button.disabled = false; }
}

function openRoom(id) {
  if (!ready()) return;
  leaveRoom(false); room.id = id; showRoomView();
  gameUnsubscribe = onSnapshot(doc(db, "games", id), snapshot => {
    if (!snapshot.exists()) { toast("Cette partie n’existe plus."); showView("homeView"); return; }
    room.game = { id: snapshot.id, ...snapshot.data() }; renderRoom();
  }, error => { console.error(error); toast("Lecture de la partie refusée par les règles Firebase."); });
  playersUnsubscribe = onSnapshot(collection(db, "games", id, "players"), snapshot => {
    room.players = snapshot.docs.map(item => ({ id: item.id, ...item.data() })).sort((a,b) => (a.joinedAt?.seconds || 0) - (b.joinedAt?.seconds || 0));
    renderRoom();
  });
  heartbeatInterval = setInterval(heartbeat, 40_000);
  heartbeat();
}
function showRoomView() {
  $$(".view").forEach(view => view.classList.toggle("active", view.id === "roomView"));
  $("#roomContent").innerHTML = ""; $("#roomContent").append($("#roomTemplate").content.cloneNode(true));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function leaveRoom(navigate = true) {
  if (gameUnsubscribe) gameUnsubscribe(); if (playersUnsubscribe) playersUnsubscribe();
  clearInterval(timerInterval); clearInterval(heartbeatInterval);
  gameUnsubscribe = playersUnsubscribe = timerInterval = heartbeatInterval = null;
  room = { id: null, game: null, players: [] };
  if (navigate) showView("homeView");
}
async function heartbeat() {
  if (!room.id || !currentUser || !db) return;
  try {
    const ref = doc(db, "games", room.id, "players", currentUser.uid);
    const snap = await getDoc(ref); if (snap.exists()) await updateDoc(ref, { lastSeen: serverTimestamp() });
  } catch (_) { /* the visitor may be the organizer, not a player */ }
}
function updateTimer() {
  const output = $("[data-timer]"); if (!output || !room.game) return;
  if (room.game.status !== "playing" || !room.game.startAt?.toMillis) { output.textContent = room.game.status === "ended" ? "00:00" : "--:--"; return; }
  const remaining = room.game.startAt.toMillis() + room.game.durationMinutes * 60_000 - Date.now();
  output.textContent = formatCountdown(remaining);
  if (remaining <= 0 && isOrganizer()) endGame(true);
}
function renderRoom() {
  const root = $("#roomContent"); if (!root || !room.game) return;
  $("[data-room-name]", root).textContent = room.game.name;
  $("[data-room-status]", root).textContent = statusText[room.game.status] || "En attente";
  const copy = $("[data-copy-code]", root); copy.textContent = room.game.code; copy.onclick = () => copyText(room.game.code, "Code copié !");
  $("[data-player-count]", root).textContent = `${room.players.length}/${room.game.maxPlayers}`;
  const mine = room.players.find(player => player.id === currentUser?.uid);
  $("[data-room-message]", root).textContent = isOrganizer() ? "Vous êtes organisateur." : (mine ? `Votre équipe : ${teamText[mine.team]}` : "Spectateur");
  $("[data-players]", root).innerHTML = room.players.length ? room.players.map(player => playerRow(player)).join("") : `<div class="empty-state">Personne n’a encore rejoint la partie.</div>`;
  $("[data-controls]", root).innerHTML = controlsHTML();
  $$("[data-team-select]", root).forEach(select => select.addEventListener("change", () => setTeam(select.dataset.teamSelect, select.value)));
  $$("[data-remove]", root).forEach(button => button.addEventListener("click", () => removePlayer(button.dataset.remove)));
  bindControlEvents(root);
  clearInterval(timerInterval); updateTimer(); timerInterval = setInterval(updateTimer, 1000);
}
function playerRow(player) {
  const controls = isOrganizer() && room.game.status !== "ended"
    ? `<select data-team-select="${player.id}" aria-label="Équipe de ${escapeHTML(player.displayName)}"><option value="pending" ${player.team === "pending" ? "selected" : ""}>À répartir</option><option value="seekers" ${player.team === "seekers" ? "selected" : ""}>🔴 Chercheurs</option><option value="hiders" ${player.team === "hiders" ? "selected" : ""}>🔵 Cachés</option></select><button class="button button-danger" data-remove="${player.id}" title="Exclure">×</button>`
    : `<span class="team-badge team-${player.team}">${teamText[player.team]}</span>`;
  return `<div class="player-row"><div><div class="player-name">${escapeHTML(player.displayName)}</div><div class="player-meta">${isRecent(player) ? "● connecté récemment" : "○ absent"}</div></div><div class="player-actions">${controls}</div></div>`;
}
function controlsHTML() {
  const game = room.game, organizer = isOrganizer();
  const safety = `<p class="muted">Restez prudents : piétons prioritaires, pas de route traversée en courant, aucun accès privé.</p>`;
  const result = game.result ? `<div class="result-box"><strong>Résultat :</strong> ${escapeHTML(game.result.winner || "Non renseigné")}<br>${escapeHTML(game.result.notes || "")}</div>` : "";
  if (!organizer) return `<h2>Votre salle</h2><p class="muted">Votre liste et le chronomètre se mettent à jour automatiquement.</p><hr>${safety}${result}`;
  let actions = "";
  if (game.status === "open") actions += `<button class="button button-secondary" data-action="close">Fermer les inscriptions</button><button class="button button-blue" data-action="auto">Répartir automatiquement</button><button class="button button-primary" data-action="start">Démarrer la partie</button>`;
  if (game.status === "waiting") actions += `<button class="button button-secondary" data-action="open">Rouvrir les inscriptions</button><button class="button button-blue" data-action="auto">Répartir automatiquement</button><button class="button button-primary" data-action="start">Démarrer la partie</button>`;
  if (game.status === "playing") actions += `<button class="button button-danger" data-action="end">Terminer la partie</button>`;
  const resultForm = game.status === "ended" ? `<hr><h2>Résultat</h2><form id="resultForm" class="form-stack"><label>Équipe gagnante<select name="winner"><option>Non renseigné</option><option>Les chercheurs</option><option>Les cachés</option></select></label><label>Note finale<input name="notes" maxlength="160" value="${escapeHTML(game.result?.notes || "")}" placeholder="Ex. 8 cachés trouvés" /></label><button class="button button-primary" type="submit">Enregistrer le résultat</button></form>` : "";
  return `<h2>Commandes</h2><p class="muted">Seul votre compte peut modifier cette partie.</p><div class="share-box">Lien d’invitation<br>${escapeHTML(gameUrl(game))}</div><div class="control-actions"><button class="button button-secondary" data-action="copy-link">Copier le lien</button>${actions}</div>${resultForm}<hr>${safety}${result}`;
}
function bindControlEvents(root) {
  $$('[data-action]', root).forEach(button => button.addEventListener("click", () => {
    const actions = { open: () => setGameStatus("open"), close: () => setGameStatus("waiting"), auto: autoTeams, start: startGame, end: () => endGame(false), "copy-link": () => copyText(gameUrl(room.game), "Lien d’invitation copié !") };
    actions[button.dataset.action]?.();
  }));
  const resultForm = $("#resultForm", root); if (resultForm) resultForm.addEventListener("submit", saveResult);
}
async function setGameStatus(status) { try { await updateDoc(doc(db, "games", room.id), { status }); } catch (e) { console.error(e); toast("Action refusée."); } }
async function setTeam(playerId, team) { try { await updateDoc(doc(db, "games", room.id, "players", playerId), { team }); } catch (e) { console.error(e); toast("Équipe non modifiée."); } }
async function removePlayer(playerId) { if (!confirm("Exclure ce joueur de la partie ?")) return; try { await deleteDoc(doc(db, "games", room.id, "players", playerId)); } catch (e) { console.error(e); toast("Joueur non exclu."); } }
async function autoTeams() {
  const shuffled = [...room.players].sort(() => Math.random() - .5); const batch = writeBatch(db);
  shuffled.forEach((player, index) => batch.update(doc(db, "games", room.id, "players", player.id), { team: index < room.game.seekerCount ? "seekers" : "hiders" }));
  try { await batch.commit(); toast("Équipes réparties."); } catch (e) { console.error(e); toast("Répartition impossible."); }
}
async function startGame() {
  if (room.players.length < 2) return toast("Ajoutez au moins deux joueurs avant de démarrer.");
  if (room.players.some(player => player.team === "pending")) return toast("Répartissez tous les joueurs avant de démarrer.");
  try { await updateDoc(doc(db, "games", room.id), { status: "playing", startAt: serverTimestamp(), endedAt: null }); toast("La partie est lancée !"); }
  catch (e) { console.error(e); toast("Démarrage impossible."); }
}
async function endGame(expired) {
  if (!room.id || !isOrganizer()) return;
  try { await updateDoc(doc(db, "games", room.id), { status: "ended", endedAt: serverTimestamp() }); if (expired) toast("Temps écoulé : la partie est terminée."); }
  catch (e) { console.error(e); toast("Fin de partie impossible."); }
}
async function saveResult(event) {
  event.preventDefault(); const data = new FormData(event.currentTarget);
  try { await updateDoc(doc(db, "games", room.id), { result: { winner: data.get("winner"), notes: String(data.get("notes")).trim(), validatedAt: serverTimestamp() } }); toast("Résultat enregistré."); }
  catch (e) { console.error(e); toast("Résultat non enregistré."); }
}
async function copyText(value, message) { try { await navigator.clipboard.writeText(value); toast(message); } catch (_) { toast("Copie impossible : sélectionnez le texte manuellement."); } }
async function loadMyGames() {
  const target = $("#myGames");
  if (!ready() || !currentUser || currentUser.isAnonymous) { showView("authView"); return; }
  target.innerHTML = `<div class="empty-state">Chargement de vos parties…</div>`;
  try {
    const snapshot = await getDocs(query(collection(db, "games"), where("organizerId", "==", currentUser.uid)));
    const games = snapshot.docs.map(item => ({ id: item.id, ...item.data() })).sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    target.innerHTML = games.length ? games.map(game => `<article class="panel game-card"><div class="eyebrow"><span></span>${statusText[game.status]}</div><h2>${escapeHTML(game.name)}</h2><p class="muted">Code : <b>${game.code}</b> · ${game.durationMinutes} min · ${game.maxPlayers} joueurs max.</p><div class="game-card-footer"><button class="button button-secondary" data-open-game="${game.id}">Gérer</button><button class="button button-danger" data-delete-game="${game.id}">Supprimer</button></div></article>`).join("") : `<div class="empty-state">Vous n’avez pas encore créé de partie.</div>`;
    $$('[data-open-game]', target).forEach(button => button.addEventListener("click", () => openRoom(button.dataset.openGame)));
    $$('[data-delete-game]', target).forEach(button => button.addEventListener("click", () => deleteGame(button.dataset.deleteGame)));
  } catch (error) { console.error(error); target.innerHTML = `<div class="empty-state">Impossible de lire vos parties. Vérifiez les règles Firestore.</div>`; }
}
async function deleteGame(id) {
  if (!confirm("Supprimer cette partie ? Les joueurs ne pourront plus y accéder.")) return;
  try { await deleteDoc(doc(db, "games", id)); toast("Partie supprimée."); loadMyGames(); }
  catch (error) { console.error(error); toast("Suppression impossible. Consultez les règles Firestore."); }
}

$("#accountButton").addEventListener("click", () => showView(currentUser && !currentUser.isAnonymous ? "organizerView" : "authView"));
$$('[data-go]').forEach(button => button.addEventListener("click", () => showView(button.dataset.go)));
$$('[data-auth-tab]').forEach(button => button.addEventListener("click", () => switchAuthTab(button.dataset.authTab)));
$("#createGameForm").addEventListener("submit", createGame); $("#joinGameForm").addEventListener("submit", joinGame);
$("#loginForm").addEventListener("submit", async event => { event.preventDefault(); if (!ready()) return; const d = new FormData(event.currentTarget); try { await signInWithEmailAndPassword(auth, d.get("email"), d.get("password")); toast("Connexion réussie."); showView("organizerView"); } catch (e) { console.error(e); toast("Connexion refusée : vérifiez vos identifiants."); } });
$("#registerForm").addEventListener("submit", async event => { event.preventDefault(); if (!ready()) return; const d = new FormData(event.currentTarget); try { await createUserWithEmailAndPassword(auth, d.get("email"), d.get("password")); toast("Compte créé."); showView("organizerView"); } catch (e) { console.error(e); toast("Création impossible : cet e-mail est peut-être déjà utilisé."); } });
if (auth) onAuthStateChanged(auth, user => { currentUser = user; renderAccount(); });
else renderAccount();

const inviteCode = new URLSearchParams(location.search).get("game");
if (inviteCode) { showView("joinView"); $("#joinGameForm [name=code]").value = inviteCode.toUpperCase(); }
