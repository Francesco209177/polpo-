// Polpo — pagina del simulatore: schermo, tastiera e oggetti simulati attorno al firmware vero (firmware.js).
// L'unica cosa che questa pagina scarica è il file del firmware, da questo stesso sito.

import { creaPolpo, TASTI, postoDelTasto, LARGHEZZA, ALTEZZA } from "./firmware.js";

const $ = (id) => document.getElementById(id);
const CHIAVE = "polpo-simulatore-firmware-v1";
const stato = $("sim-stato");
const tela = $("schermo");
const g = tela.getContext("2d");
const immagine = g.createImageData(LARGHEZZA, ALTEZZA);
const prova = (window.__sim = { polpo: null, pronto: false, eventi: [] }); // punto d'appoggio per le prove automatiche

let modulo = null;
let polpo = null;
let impronta = -1;
let ultimoTempo = 0;
let salvato = "";
let audio = null;

// tabelle per passare da 5 e 6 bit a 8 bit di colore
const DA5 = Uint8Array.from({ length: 32 }, (_, i) => Math.round((i * 255) / 31));
const DA6 = Uint8Array.from({ length: 64 }, (_, i) => Math.round((i * 255) / 63));

function disegna() {
  const ora = polpo.impronta();
  if (ora === impronta) return;
  impronta = ora;
  const b = polpo.schermo(), px = immagine.data;
  for (let i = 0, o = 0; i < LARGHEZZA * ALTEZZA; i++, o += 4) {
    const v = (b[2 * i] << 8) | b[2 * i + 1];
    px[o] = DA5[v >> 11];
    px[o + 1] = DA6[(v >> 5) & 63];
    px[o + 2] = DA5[v & 31];
    px[o + 3] = 255;
  }
  g.putImageData(immagine, 0, 0);
}

// ---------------- registro e oggetti simulati ----------------
function annota(testo, errore = false) {
  const li = document.createElement("li");
  li.textContent = testo;
  if (errore) li.className = "errore";
  const lista = $("registro");
  lista.prepend(li);
  while (lista.children.length > 40) lista.lastChild.remove();
}

function lampeggia(id) {
  const led = $(id);
  led.classList.add("acceso");
  clearTimeout(led._t);
  led._t = setTimeout(() => led.classList.remove("acceso"), 350);
}

const tv = { accesa: false, volume: 10, muto: false };
function mostraTv() {
  $("tv").textContent = tv.accesa ? `TV accesa · volume ${tv.volume}${tv.muto ? " (muto)" : ""}` : "TV spenta";
  $("tv").classList.toggle("acceso", tv.accesa);
}
// Il televisore finto capisce i codici di un LG (protocollo NEC, indirizzo 4), gli stessi del suo telecomando.
function tvRiceve(e) {
  if (e.protocollo !== "NEC" || e.indirizzo !== 4) return false;
  if (e.comando === 8) tv.accesa = !tv.accesa;
  else if (!tv.accesa) return true;
  else if (e.comando === 2) tv.volume = Math.min(30, tv.volume + 1);
  else if (e.comando === 3) tv.volume = Math.max(0, tv.volume - 1);
  else if (e.comando === 9) tv.muto = !tv.muto;
  else return false;
  mostraTv();
  return true;
}

let presaAccesa = false;
function presaRiceve(e) {
  if (e.bit !== 24 || (e.valore !== 5393 && e.valore !== 5396)) return false;
  presaAccesa = e.valore === 5393;
  $("presa").textContent = presaAccesa ? "Presa accesa" : "Presa spenta";
  $("presa").classList.toggle("acceso", presaAccesa);
  return true;
}

// Il computer finto traduce i tasti USB in caratteri secondo la SUA impostazione di tastiera, come un PC vero:
// se non coincide con quella scelta sul Polpo, i simboli escono sbagliati.
const LETTERE = "abcdefghijklmnopqrstuvwxyz";
const TASTIERE = {
  us: { cifre: ["1234567890", "!@#$%^&*()"], 0x2d: "-_", 0x2e: "=+", 0x2f: "[{", 0x30: "]}", 0x31: "\\|", 0x33: ";:", 0x34: "'\"", 0x35: "`~", 0x36: ",<", 0x37: ".>", 0x38: "/?" },
  it: { cifre: ["1234567890", '!"£$%&/()='], 0x2d: "'?", 0x2e: "ì^", 0x2f: "èé", 0x30: "+*", 0x31: "ù§", 0x32: "ù§", 0x33: "òç", 0x34: "à°", 0x35: "\\|", 0x36: ",;", 0x37: ".:", 0x38: "-_", 0x64: "<>",
        altgr: { 0x33: "@", 0x34: "#", 0x2f: "[", 0x30: "]", 0x08: "€" }, altgrMaiusc: { 0x2f: "{", 0x30: "}" } },
};
const SPECIALI = { 0x28: "\n", 0x2b: "\t", 0x2c: " ", 0x29: "[Esc]", 0x4f: "[→]", 0x50: "[←]", 0x51: "[↓]", 0x52: "[↑]", 0x4c: "[Canc]", 0x4a: "[Home]", 0x4d: "[Fine]" };
function pcRiceve(e) {
  const t = TASTIERE[$("pc-layout").value], area = $("pc-testo");
  const maiusc = (e.modificatori & 0x22) !== 0, altgr = (e.modificatori & 0x40) !== 0;
  const altri = [[0x11, "Ctrl"], [0x04, "Alt"], [0x88, "Win"]].filter(([m]) => e.modificatori & m).map(([, n]) => n);
  const c = e.codice;
  let testo;
  if (c >= 0x04 && c <= 0x1d) testo = maiusc ? LETTERE[c - 4].toUpperCase() : LETTERE[c - 4];
  else if (c >= 0x1e && c <= 0x27) testo = t.cifre[maiusc ? 1 : 0][c - 0x1e];
  else if (c >= 0x3a && c <= 0x45) testo = `[F${c - 0x39}]`;
  else if (SPECIALI[c]) testo = SPECIALI[c];
  else if (t[c]) testo = t[c][maiusc ? 1 : 0];
  if (altgr && t.altgr) testo = (maiusc && t.altgrMaiusc[c]) || t.altgr[c] || testo;
  if (c === 0x2a) area.value = area.value.slice(0, -1); // cancella
  else if (altri.length) area.value += `[${altri.join("+")}${c ? "+" + (testo ?? "?").trim() : ""}]`;
  else if (testo !== undefined) area.value += testo;
  else if (c) area.value += "[?]";
  area.scrollTop = area.scrollHeight;
}

function suona(hz, ms) {
  if (!$("suoni").checked || !audio || audio.state !== "running") return;
  const o = audio.createOscillator(), v = audio.createGain();
  o.type = "square";
  o.frequency.value = hz;
  v.gain.value = 0.04;
  o.connect(v).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + Math.min(ms, 400) / 1000);
}

let pagineNfc = [];
function suEvento(e) {
  prova.eventi.push(e);
  if (prova.eventi.length > 500) prova.eventi.shift();
  if (e.tipo === "suono") suona(e.hz, e.ms);
  else if (e.tipo.startsWith("script.")) scriptEvento(e);
  else if (e.tipo === "luminosita") tela.style.filter = `brightness(${(0.35 + (0.65 * e.valore) / 255).toFixed(2)})`;
  else if (e.tipo === "ir.tx") {
    lampeggia("led-ir");
    const capito = e.protocollo ? `${e.protocollo}, indirizzo ${e.indirizzo}, comando ${e.comando}` : `segnale grezzo a ${Math.round(e.portante / 1000)} kHz`;
    annota(`Infrarossi dal Polpo: ${capito}.${tvRiceve(e) ? " Il televisore ha reagito." : ""}`);
  } else if (e.tipo === "rf.tx") {
    lampeggia("led-rf");
    const capito = e.valore !== undefined ? `codice ${e.valore} (${e.bit} bit)` : `segnale grezzo, ${e.impulsi} impulsi`;
    annota(`Radio 433 MHz dal Polpo: ${capito}, ${e.ms} ms.${presaRiceve(e) ? " La presa ha reagito." : ""}`);
  } else if (e.tipo === "usb.tasto") {
    lampeggia("led-usb");
    pcRiceve(e);
  } else if (e.tipo === "nfc.scrittura") {
    pagineNfc.push(e.pagina);
    clearTimeout(suEvento._nfc);
    suEvento._nfc = setTimeout(() => { annota(`Il Polpo ha scritto ${pagineNfc.length} pagine del tag NFC.`); pagineNfc = []; }, 300);
  } else if (e.tipo === "ble.annuncio") annota(`Bluetooth: il Polpo si presenta come «${e.nome}». Il telefono finto lo abbina.`);
  else if (e.tipo === "ble.tasto") annota(`Bluetooth: tasto multimediale ${e.uso} ricevuto dal telefono finto.`);
}

// ---------------- stato salvato nel browser ----------------
const inBase64 = (b) => { let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s); };
const daBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function salva() {
  if (!polpo) return;
  try {
    const testo = inBase64(polpo.statoEsporta());
    if (testo !== salvato) { localStorage.setItem(CHIAVE, testo); salvato = testo; }
  } catch (e) { /* memoria del browser non disponibile o piena: il simulatore funziona lo stesso, senza ricordare */ }
}

// ---------------- avvio e ciclo principale ----------------
function comandoMondo(c) {
  const r = polpo.mondo(c);
  if (r.ok === false) annota(`Non succede nulla: ${r.errore}.`, true);
  return r;
}

async function accendi() {
  polpo = await creaPolpo(modulo);
  prova.polpo = polpo;
  try {
    const s = localStorage.getItem(CHIAVE);
    if (s && polpo.statoImporta(daBase64(s))) salvato = s;
  } catch (e) { /* stato salvato illeggibile: si parte da zero */ }
  // il mondo riparte da ciò che è impostato nei pannelli
  polpo.mondo({ cmd: "modulo", valore: $("grove").value });
  polpo.mondo({ cmd: "sd", presente: $("sd").checked });
  polpo.mondo({ cmd: "batteria", livello: Number($("batteria").value) });
  polpo.mondo({ cmd: "pc", collegato: $("pc-collegato").checked });
  polpo.mondo({ cmd: "tag", tipo: $("tag-tipo").value, vicino: $("tag-vicino").checked });
  polpo.avvia();
  azzeraTasti();
  impronta = -1;
  ultimoTempo = performance.now();
  stato.textContent = "Polpo acceso. Premi OK (Invio) per aprire il menu.";
  scriptPulsanti(false, false); // dopo un riavvio non c'è nessun programma aperto
  prova.pronto = true;
}

function ciclo(adesso) {
  if (polpo) {
    const dt = Math.min(200, Math.max(0, adesso - ultimoTempo)); // dopo una pausa (scheda nascosta) non si recupera tutto
    ultimoTempo = adesso;
    const indietro = polpo.occupato(); // dopo un'operazione lunga il firmware è «avanti» e per un po' non gira
    polpo.avanza(dt);
    tempoLetto += Math.max(0, dt - indietro);
    smaltisciTasti();
    for (let e; (e = polpo.evento()) !== null; ) suEvento(e);
    disegna();
  }
  requestAnimationFrame(ciclo);
}

// ---------------- tastiera ----------------
const MODIFICATORI = new Set(["fn", "maiusc", "ctrl", "opt", "alt"]);
const ETICHETTE = { canc: "del", spazio: "␣", maiusc: "aa", "`": "esc" };
const FRECCE = { ";": "▲", ".": "▼", ",": "◀", "/": "▶" };
const pulsanti = new Map(); // "fila,colonna" -> button
const fissati = new Set();

// Ogni cambio di un tasto passa da una coda e aspetta che il firmware abbia letto la tastiera per almeno TENUTA_MS
// con lo stato precedente. Così una pressione breve non va persa se il browser salta dei fotogrammi o se il Polpo
// è impegnato in un'operazione lunga: arriva appena torna a leggere i tasti, e nell'ordine giusto.
const TENUTA_MS = 30;
let tempoLetto = 0; // millisecondi in cui il firmware ha davvero girato (e quindi letto la tastiera)
const codaTasti = [];
const tastiGiu = new Set();
const ultimoCambio = new Map();

function premi(f, c, giu) {
  if (!polpo) return;
  codaTasti.push({ f, c, giu });
  smaltisciTasti();
}
function smaltisciTasti() {
  while (codaTasti.length) {
    const { f, c, giu } = codaTasti[0], k = `${f},${c}`;
    if (tastiGiu.has(k) === giu) { codaTasti.shift(); continue; } // è già così
    if (tempoLetto - (ultimoCambio.get(k) ?? -TENUTA_MS) < TENUTA_MS) break; // prima il firmware deve vedere lo stato di adesso
    codaTasti.shift();
    ultimoCambio.set(k, tempoLetto);
    if (giu) tastiGiu.add(k); else tastiGiu.delete(k);
    polpo.tasto(f, c, giu);
    pulsanti.get(k)?.classList.toggle("giu", giu);
  }
}
function azzeraTasti() { // a ogni accensione: nessun tasto premuto, nessuno in attesa
  codaTasti.length = 0;
  ultimoCambio.clear();
  for (const k of tastiGiu) pulsanti.get(k)?.classList.remove("giu");
  tastiGiu.clear();
}
function rilasciaFissati() {
  for (const k of fissati) {
    const [f, c] = k.split(",").map(Number);
    premi(f, c, false);
    pulsanti.get(k).setAttribute("aria-pressed", "false");
  }
  fissati.clear();
}

TASTI.forEach((fila, f) => fila.forEach((nome, c) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = ETICHETTE[nome] ?? nome;
  if (FRECCE[nome]) { const s = document.createElement("small"); s.textContent = FRECCE[nome]; b.prepend(s); }
  b.setAttribute("aria-label", { canc: "cancella", spazio: "spazio", maiusc: "maiuscole", ok: "OK, invio", "`": "indietro", ";": "su", ".": "giù", ",": "sinistra", "/": "destra" }[nome] ?? nome);
  if (nome.length > 1 || nome === "`") b.classList.add("speciale");
  const k = `${f},${c}`;
  pulsanti.set(k, b);
  if (MODIFICATORI.has(nome)) {
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => { // i modificatori restano premuti fino al tasto successivo
      const su = fissati.has(k);
      if (su) fissati.delete(k); else fissati.add(k);
      premi(f, c, !su);
      b.setAttribute("aria-pressed", String(!su));
    });
  } else {
    let giu_ = false;
    const giu = (ev) => { ev.preventDefault(); sveglia(); giu_ = true; premi(f, c, true); };
    const su = () => {
      if (!giu_) return;
      giu_ = false;
      premi(f, c, false);
      rilasciaFissati();
    };
    b.addEventListener("pointerdown", giu);
    b.addEventListener("pointerup", su);
    b.addEventListener("pointerleave", su);
    b.addEventListener("pointercancel", su);
    b.addEventListener("keydown", (ev) => { if ((ev.key === " " || ev.key === "Enter") && !ev.repeat) { ev.stopPropagation(); giu(ev); } });
    b.addEventListener("keyup", (ev) => { if (ev.key === " " || ev.key === "Enter") { ev.stopPropagation(); su(); } });
  }
  $("tastiera").append(b);
}));

$("g0").addEventListener("click", () => { sveglia(); polpo?.g0(); });

// tastiera del computer
const DA_TASTO = { Enter: "ok", Escape: "indietro", Backspace: "canc", Tab: "tab", ArrowUp: "su", ArrowDown: "giu", ArrowLeft: "sinistra", ArrowRight: "destra", " ": "spazio" };
const fisici = new Map(); // codice del tasto fisico -> posto premuto
document.addEventListener("keydown", (ev) => {
  const dove = document.activeElement;
  if (!polpo || ev.ctrlKey || ev.metaKey || ev.altKey || (dove && dove !== document.body && dove !== tela)) return;
  const posto = postoDelTasto(DA_TASTO[ev.key] ?? ev.key);
  if (!posto) return;
  ev.preventDefault();
  if (ev.repeat || fisici.has(ev.code)) return;
  sveglia();
  fisici.set(ev.code, posto);
  if (posto.maiuscolo) premi(2, 1, true);
  premi(posto.fila, posto.colonna, true);
});
document.addEventListener("keyup", (ev) => {
  const posto = fisici.get(ev.code);
  if (!posto) return;
  fisici.delete(ev.code);
  premi(posto.fila, posto.colonna, false);
  if (posto.maiuscolo && ![...fisici.values()].some((p) => p.maiuscolo)) premi(2, 1, false);
});
window.addEventListener("blur", () => { // se la finestra perde il fuoco nessun tasto deve restare giù
  for (const posto of fisici.values()) premi(posto.fila, posto.colonna, false);
  fisici.clear();
  premi(2, 1, false);
});

function sveglia() { // l'audio del browser parte solo dopo un gesto di chi guarda
  if (!audio && (window.AudioContext || window.webkitAudioContext)) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio && audio.state === "suspended") audio.resume();
}
tela.addEventListener("pointerdown", () => { sveglia(); tela.focus(); });

// ---------------- script (PolpoScript) ----------------
// Il programma scritto qui viene copiato sulla microSD del Polpo simulato ed eseguito dal firmware vero, come se lo
// si scegliesse dal menu «Script». Tutto resta in questa pagina.
const FILE_SCRIPT = "/polpo/script/prova.polpo";
const BOZZA = "polpo-simulatore-script-v1";
const scriptTesto = $("script-testo"), scriptStato = $("script-stato"), scriptUscita = $("script-uscita");
try { const b = localStorage.getItem(BOZZA); if (b !== null) scriptTesto.value = b; } catch (e) { /* senza memoria si parte dall'esempio */ }
scriptTesto.addEventListener("input", () => { try { localStorage.setItem(BOZZA, scriptTesto.value); } catch (e) { /* pazienza */ } });

function scriptDice(testo, errore = false) {
  scriptStato.textContent = testo;
  scriptStato.classList.toggle("errore", errore);
}
function scriptSegnaRiga(riga) { // mette il cursore sulla riga, così si vede dov'è il problema o dove si è fermi
  if (!riga) return;
  const righe = scriptTesto.value.split("\n");
  let da = 0;
  for (let i = 0; i < riga - 1 && i < righe.length; i++) da += righe[i].length + 1;
  scriptTesto.setSelectionRange(da, da + (righe[riga - 1] ?? "").length);
  const altezza = parseFloat(getComputedStyle(scriptTesto).lineHeight) || 18;
  scriptTesto.scrollTop = Math.max(0, (riga - 3) * altezza);
}
function scriptPulsanti(aperto, fermoSuUnaRiga) {
  $("script-ferma").disabled = !aperto;
  $("script-riprendi").hidden = !fermoSuUnaRiga;
  $("script-passo").textContent = fermoSuUnaRiga ? "Riga successiva" : "Una riga alla volta";
  if (!fermoSuUnaRiga) $("script-variabili").hidden = true;
}
function scriptMostraVariabili() {
  const s = polpo.script({ cmd: "stato" });
  const corpo = $("script-variabili").querySelector("tbody");
  corpo.replaceChildren();
  for (const v of s.variabili ?? []) {
    const tr = document.createElement("tr");
    if (v.locale) tr.className = "locale";
    const nome = document.createElement("td"), valore = document.createElement("td");
    nome.textContent = v.nome;
    valore.textContent = v.valore;
    tr.append(nome, valore);
    corpo.append(tr);
  }
  $("script-variabili").hidden = corpo.children.length === 0;
  const dove = (s.pila ?? []).length > 1 ? ` (dentro «${s.pila[0].funzione}»)` : "";
  scriptDice(`Fermo alla riga ${s.riga}${dove}`);
  scriptSegnaRiga(s.riga);
}
function scriptAvvia(passo) {
  if (!polpo) return;
  sveglia();
  polpo.script({ cmd: "ferma" }); // se ce n'era uno aperto, lascia il posto
  polpo.avanza(30);
  const scritto = polpo.script({ cmd: "scrivi", file: FILE_SCRIPT, testo: scriptTesto.value });
  if (!scritto.ok) { scriptDice("Non riesco a salvare il programma: la microSD del Polpo simulato è inserita?", true); return; }
  const controllo = polpo.script({ cmd: "controlla", file: FILE_SCRIPT });
  scriptUscita.value = "";
  if (!controllo.valido) {
    scriptDice(controllo.riga ? `Riga ${controllo.riga}: ${controllo.errore}` : controllo.errore, true);
    scriptSegnaRiga(controllo.riga);
    scriptPulsanti(false, false);
    return;
  }
  const r = polpo.script({ cmd: "apri", file: FILE_SCRIPT, passo });
  if (!r.ok) { scriptDice(r.errore ?? "Non riesco ad avviare il programma.", true); return; }
  scriptDice(passo ? "Pronto: una riga alla volta" : "In esecuzione sul Polpo");
  scriptPulsanti(true, false);
  salva();
  if (!passo) { // i tasti vanno al Polpo (le frecce comandano il gioco) e, se lo schermo non si vede, ci si torna
    tela.focus({ preventScroll: true });
    const r = tela.getBoundingClientRect();
    if (r.bottom < 60 || r.top > window.innerHeight - 60) {
      tela.scrollIntoView({ block: "center", behavior: document.documentElement.classList.contains("fermo") ? "auto" : "smooth" });
    }
  }
}
function scriptEvento(e) {
  if (e.tipo === "script.print") {
    scriptUscita.value += e.testo + "\n";
    if (scriptUscita.value.length > 20000) scriptUscita.value = scriptUscita.value.slice(-15000);
    scriptUscita.scrollTop = scriptUscita.scrollHeight;
  } else if (e.tipo === "script.paused") {
    scriptPulsanti(true, true);
    scriptMostraVariabili();
  } else if (e.tipo === "script.end") {
    if (e.testo) {
      scriptDice(e.testo, true);
      scriptSegnaRiga(e.riga);
    } else {
      scriptDice(e.fermato ? "Programma fermato" : "Programma finito");
    }
    scriptPulsanti(false, false);
  }
}
$("script-esegui").addEventListener("click", () => scriptAvvia(false));
$("script-passo").addEventListener("click", () => {
  if (polpo && polpo.script({ cmd: "stato" }).stato === "paused") polpo.script({ cmd: "passo", modo: "entra" });
  else scriptAvvia(true);
});
$("script-riprendi").addEventListener("click", () => {
  polpo.script({ cmd: "riprendi" });
  scriptDice("In esecuzione sul Polpo");
  scriptPulsanti(true, false);
});
$("script-ferma").addEventListener("click", () => {
  polpo.script({ cmd: "ferma" }); // lo stato lo aggiorna l'evento script.end che arriva subito dopo
});
$("script-esempio").addEventListener("change", (ev) => {
  const nome = ev.target.value;
  ev.target.value = "";
  if (!nome || !polpo) return;
  const r = polpo.script({ cmd: "leggi", file: `/polpo/script/${nome}.polpo` });
  if (!r.ok) { scriptDice("Questo esempio non c'è sulla microSD del Polpo simulato (prova «Cancella microSD e impostazioni»).", true); return; }
  scriptTesto.value = r.testo;
  scriptTesto.dispatchEvent(new Event("input"));
  scriptTesto.scrollTop = 0;
  scriptDice("Esempio caricato: premi Esegui");
});

// ---------------- pannelli ----------------
$("grove").addEventListener("change", (e) => { comandoMondo({ cmd: "modulo", valore: e.target.value }); annota(e.target.value === "nessuno" ? "Porta Grove: modulo scollegato." : `Porta Grove: collegato ${e.target.selectedOptions[0].textContent}.`); });
const tag = () => comandoMondo({ cmd: "tag", tipo: $("tag-tipo").value, vicino: $("tag-vicino").checked });
$("tag-tipo").addEventListener("change", () => { tag(); annota(`Tag NFC: ora è un ${$("tag-tipo").selectedOptions[0].textContent} nuovo.`); });
$("tag-vicino").addEventListener("change", (e) => { tag(); annota(e.target.checked ? "Tag NFC appoggiato sul lettore." : "Tag NFC allontanato."); });
document.querySelectorAll("[data-ir]").forEach((b) => b.addEventListener("click", () => {
  const r = comandoMondo({ cmd: "telecomando", protocollo: "NEC", indirizzo: 4, comando: Number(b.dataset.ir) });
  if (r.ok) annota(`Telecomando: premuto «${b.textContent}» verso la IR Unit.`);
}));
document.querySelectorAll("[data-rf]").forEach((b) => b.addEventListener("click", () => {
  const r = comandoMondo({ cmd: "radiocomando", valore: Number(b.dataset.rf), bit: 24 });
  if (r.ok) annota(`Telecomando della presa: premuto «${b.textContent}».`);
}));
$("pc-collegato").addEventListener("change", (e) => comandoMondo({ cmd: "pc", collegato: e.target.checked }));
$("pc-pulisci").addEventListener("click", () => { $("pc-testo").value = ""; });
$("sd").addEventListener("change", (e) => { comandoMondo({ cmd: "sd", presente: e.target.checked }); annota(e.target.checked ? "microSD inserita: il Polpo la vede dopo «Spegni e riaccendi»." : "microSD tolta."); });
$("batteria").addEventListener("input", (e) => { $("batteria-val").textContent = `${e.target.value}%`; comandoMondo({ cmd: "batteria", livello: Number(e.target.value) }); });
$("riavvia").addEventListener("click", async () => { salva(); prova.pronto = false; stato.textContent = "Riavvio…"; await accendi(); annota("Polpo spento e riacceso."); });
$("azzera").addEventListener("click", async () => {
  if (!confirm("Cancellare la microSD e le impostazioni del Polpo simulato? I file che hai salvato nel simulatore andranno persi.")) return;
  try { localStorage.removeItem(CHIAVE); } catch (e) { /* niente da cancellare */ }
  salvato = "";
  prova.pronto = false;
  await accendi();
  annota("microSD e impostazioni riportate allo stato iniziale.");
});

// ---------------- partenza ----------------
mostraTv();
(async () => {
  if (typeof WebAssembly !== "object") { stato.textContent = "Questo browser non supporta WebAssembly: il simulatore non può partire."; return; }
  try {
    // l'unico file che la pagina scarica: il firmware, da questo stesso sito
    const risposta = await fetch(new URL("polpo-sim.wasm", document.baseURI));
    if (!risposta.ok) throw new Error(`risposta ${risposta.status}`);
    modulo = await WebAssembly.compile(await risposta.arrayBuffer());
    await accendi();
    requestAnimationFrame(ciclo);
    setInterval(salva, 3000);
    addEventListener("pagehide", salva);
    document.addEventListener("visibilitychange", () => { if (document.hidden) salva(); });
  } catch (e) {
    stato.textContent = "Non riesco a caricare il firmware del simulatore. Ricarica la pagina; se non basta, segnalalo.";
    console.error(e);
  }
})();
