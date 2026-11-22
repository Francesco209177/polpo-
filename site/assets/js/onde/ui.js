// Polpo Onde — la pagina: trasmette, ascolta, mostra il suono, prova nel canale simulato.
// L'audio del microfono viene elaborato qui nel browser e non viene inviato da nessuna parte.

import * as P from "./protocollo.js";
import { sintetizza } from "./tx.js";
import { Ricevitore, ricevi } from "./rx.js";
import { canale, casuale } from "./canale.js";
import { fft } from "./fft.js";
import { salvaFile } from "../salva.js";

const $ = (id) => document.getElementById(id);
const el = {
  testo: $("testo"), conta: $("conta"), trasmetti: $("trasmetti"), txStato: $("tx-stato"), txBarra: $("tx-barra"),
  ascolta: $("ascolta"), rxStato: $("rx-stato"), livello: $("livello"), impostazioni: $("impostazioni"),
  messaggi: $("messaggi"), vuoto: $("vuoto"), spettro: $("spettro"), spartito: $("spartito"), dettagli: $("dettagli"),
  simRumore: $("sim-rumore"), simRumoreVal: $("sim-rumore-val"), simEco: $("sim-eco"), simEcoVal: $("sim-eco-val"),
  simVai: $("sim-vai"), simEsito: $("sim-esito"), simSuona: $("sim-suona"), scarica: $("scarica"), supporto: $("supporto"),
};
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const puoAscoltare = !!(AudioCtx && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
const numero = (v, cifre = 1) => v.toFixed(cifre).replace(".", ",");

// Punto d'appoggio per le prove automatiche (non usato dalla pagina).
const prova = (window.__onde = { ultimaTrasmissione: null, eventi: [] });

let ctx = null;
let ascolto = null; // { stream, nodi, rx }
let riprendiDopo = false;
let trasmissione = null;
const registrazione = { blocchi: [], campioni: 0, fs: 0, massimo: 30 }; // ultimi 30 s, per «Scarica la registrazione»

async function contesto() {
  if (!ctx) ctx = new AudioCtx({ latencyHint: "interactive" });
  if (ctx.state !== "running") await ctx.resume();
  return ctx;
}

// ---------------- grafico del suono (spettrogramma) ----------------
const F_BASSO = 900, F_ALTO = 3700, N_FFT = 2048;
const tavolozza = (() => {
  // dal blu notte all'arancione del Polpo, fino al bianco
  const punti = [[0, [8, 12, 22]], [0.35, [26, 48, 92]], [0.65, [198, 61, 20]], [0.88, [255, 138, 92]], [1, [255, 244, 230]]];
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < punti.length - 2 && t > punti[k + 1][0]) k++;
    const [t0, a] = punti[k], [t1, b] = punti[k + 1];
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(a[c] + (b[c] - a[c]) * u);
  }
  return lut;
})();

class Spettro {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d", { willReadFrequently: false });
    this.finestra = Float32Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT));
    this.buf = new Float32Array(N_FFT);
    this.n = 0;
    this.re = new Float64Array(N_FFT);
    this.im = new Float64Array(N_FFT);
    this.colonna = this.g.createImageData(2, canvas.height);
    this.massimo = -60;
    this.azzera();
  }
  azzera() {
    this.g.fillStyle = "rgb(8,12,22)";
    this.g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.n = 0;
    this.massimo = -60;
    this.griglia();
  }
  griglia() {
    // nulla di fisso sul grafico: le frequenze sono indicate dalla scala accanto
  }
  accoda(campioni, fs) {
    let i = 0;
    while (i < campioni.length) {
      const k = Math.min(campioni.length - i, N_FFT - this.n);
      this.buf.set(campioni.subarray(i, i + k), this.n);
      this.n += k;
      i += k;
      if (this.n === N_FFT) {
        this.disegna(fs);
        this.buf.copyWithin(0, N_FFT / 2);
        this.n = N_FFT / 2;
      }
    }
  }
  disegna(fs) {
    const { re, im, canvas, g } = this;
    for (let i = 0; i < N_FFT; i++) { re[i] = this.buf[i] * this.finestra[i]; im[i] = 0; }
    fft(re, im);
    const H = canvas.height, px = this.colonna.data;
    let picco = -200;
    const db = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      const f = F_ALTO - ((F_ALTO - F_BASSO) * y) / (H - 1);
      const k = Math.round((f * N_FFT) / fs);
      const p = (re[k] * re[k] + im[k] * im[k]) / (N_FFT * N_FFT) + 1e-14;
      db[y] = 10 * Math.log10(p);
      if (db[y] > picco) picco = db[y];
    }
    this.massimo = Math.max(picco, this.massimo - 0.15, -75); // il riferimento scende piano quando il suono cala
    for (let y = 0; y < H; y++) {
      const v = Math.round(255 * Math.min(1, Math.max(0, (db[y] - (this.massimo - 45)) / 45)));
      for (let x = 0; x < 2; x++) {
        const o = (y * 2 + x) * 4;
        px[o] = tavolozza[v * 3]; px[o + 1] = tavolozza[v * 3 + 1]; px[o + 2] = tavolozza[v * 3 + 2]; px[o + 3] = 255;
      }
    }
    g.drawImage(canvas, -2, 0);
    g.putImageData(this.colonna, canvas.width - 2, 0);
  }
  segna(colore) {
    this.g.fillStyle = colore;
    this.g.fillRect(this.canvas.width - 2, 0, 2, this.canvas.height);
  }
}
const spettro = el.spettro ? new Spettro(el.spettro) : null;

// ---------------- il messaggio in note ----------------
function disegnaSpartito(trama) {
  const c = el.spartito;
  if (!c) return;
  const g = c.getContext("2d");
  const stile = getComputedStyle(document.documentElement);
  const colore = (nome, riserva) => stile.getPropertyValue(nome).trim() || riserva;
  g.clearRect(0, 0, c.width, c.height);
  if (!trama) return;
  const durata = P.T_PREAMBOLO + trama.toni.length * P.T_SIMBOLO;
  const X = (t) => 4 + ((c.width - 8) * t) / durata;
  const Y = (f) => c.height - 6 - ((c.height - 12) * (f - 900)) / (3300 - 900);
  g.lineWidth = 2;
  g.strokeStyle = colore("--muted", "#888");
  g.beginPath(); g.moveTo(X(0), Y(P.F_AVVIO)); g.lineTo(X(P.T_AVVIO), Y(P.F_AVVIO)); g.stroke(); // tono d'avvio
  g.strokeStyle = colore("--studio", "#5b3be0");
  const t1 = P.T_AVVIO, t2 = t1 + P.T_CHIRP, t3 = t2 + P.T_PAUSA_CHIRP, t4 = t3 + P.T_CHIRP;
  g.beginPath(); g.moveTo(X(t1), Y(P.F_MIN)); g.lineTo(X(t2), Y(P.F_MAX)); g.stroke(); // fischio che sale
  g.beginPath(); g.moveTo(X(t3), Y(P.F_MAX)); g.lineTo(X(t4), Y(P.F_MIN)); g.stroke(); // fischio che scende
  const larga = Math.max(1.5, X(P.T_SIMBOLO) - X(0) - 1);
  trama.toni.forEach((tono, i) => {
    g.fillStyle = i < P.ADDESTRAMENTO.length ? colore("--muted", "#888") : i < P.SIMBOLI_FISSI ? colore("--sim", "#1c62b3") : colore("--btn-bg", "#c63d14");
    g.fillRect(X(P.T_PREAMBOLO + i * P.T_SIMBOLO), Y(tono.frequenza) - 1.5, larga, 3);
  });
}

function leggiTesto() {
  const testo = el.testo.value;
  const byte = new TextEncoder().encode(testo).length;
  let trama = null;
  if (byte >= 1 && byte <= P.MAX_BYTE) trama = P.componi(testo);
  return { testo, byte, trama };
}

function aggiornaTesto() {
  const { byte, trama } = leggiTesto();
  const troppo = byte > P.MAX_BYTE;
  el.conta.textContent = troppo
    ? `${byte} byte: troppo lungo, il massimo è ${P.MAX_BYTE}`
    : byte === 0 ? `Scrivi un messaggio (fino a ${P.MAX_BYTE} byte)` : `${byte} di ${P.MAX_BYTE} byte · ${trama.toni.length} note · ${numero(P.durata(byte))} secondi`;
  el.conta.classList.toggle("errore", troppo);
  el.trasmetti.disabled = !trama || !AudioCtx || !!trasmissione;
  el.simVai.disabled = !trama;
  if (el.dettagli) {
    el.dettagli.textContent = trama
      ? `${byte} byte di testo + 2 di controllo + ${P.parita(byte + 2)} di correzione = ${trama.dati.length} byte, cioè ${2 * trama.dati.length} note; più ${P.SIMBOLI_FISSI} note di addestramento e intestazione.`
      : "";
  }
  disegnaSpartito(trama);
}

// ---------------- trasmissione ----------------
async function trasmetti() {
  const { testo, trama } = leggiTesto();
  if (!trama || trasmissione) return;
  let c;
  try {
    c = await contesto();
  } catch (e) {
    el.txStato.textContent = "Il browser non permette di riprodurre l'audio.";
    return;
  }
  if (ascolto) { // mai trasmettere e ascoltare insieme: su molti telefoni il microfono acceso abbassa l'altoparlante
    riprendiDopo = true;
    fermaAscolto("Ascolto in pausa durante la trasmissione.");
  }
  const audio = sintetizza(trama, c.sampleRate);
  const buffer = c.createBuffer(1, audio.length, c.sampleRate);
  buffer.getChannelData(0).set(audio);
  const sorgente = c.createBufferSource();
  sorgente.buffer = buffer;
  sorgente.connect(c.destination);
  const inizio = c.currentTime + 0.05;
  sorgente.start(inizio);
  prova.ultimaTrasmissione = { audio, fs: c.sampleRate, testo };
  trasmissione = { sorgente };
  el.trasmetti.disabled = true;
  el.txBarra.hidden = false;
  el.txBarra.max = buffer.duration;
  const passo = () => {
    if (!trasmissione) return;
    const t = Math.max(0, c.currentTime - inizio);
    el.txBarra.value = Math.min(buffer.duration, t);
    el.txStato.textContent = t < P.T_PREAMBOLO ? "Trasmetto: preambolo…" : `Trasmetto: nota ${Math.min(trama.toni.length, 1 + Math.floor((t - P.T_PREAMBOLO) / P.T_SIMBOLO))} di ${trama.toni.length}`;
    requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
  sorgente.onended = () => {
    trasmissione = null;
    el.txBarra.hidden = true;
    el.txStato.textContent = `Trasmesso in ${numero(buffer.duration)} secondi.`;
    aggiornaTesto();
    if (riprendiDopo) { riprendiDopo = false; avviaAscolto(); }
  };
}

// ---------------- ascolto ----------------
function suEvento(e, origine) {
  prova.eventi.push({ ...e, origine });
  if (e.tipo === "aggancio") {
    if (origine === "microfono") { el.rxStato.textContent = "Preambolo trovato, leggo l'intestazione…"; spettro && spettro.segna("rgba(255,255,255,.85)"); }
  } else if (e.tipo === "intestazione") {
    if (origine === "microfono") el.rxStato.textContent = `Ricevo un messaggio di ${e.lunghezza} byte (${numero(e.durata)} s)…`;
  } else if (e.tipo === "fallito") {
    if (origine === "microfono") el.rxStato.textContent = e.fase === "dati" ? "Messaggio troppo rovinato per essere ricostruito. Riprova più vicino o con il volume più alto." : "Ho sentito l'inizio di un messaggio ma non sono riuscito a leggerlo. In ascolto…";
  } else if (e.tipo === "messaggio") {
    if (origine === "microfono") el.rxStato.textContent = "Messaggio ricevuto. In ascolto…";
    aggiungiMessaggio(e, origine);
  }
}

function aggiungiMessaggio(e, origine) {
  el.vuoto.hidden = true;
  const li = document.createElement("li");
  const testo = document.createElement("p");
  testo.className = "onde-testo";
  testo.textContent = e.testo; // sempre come testo semplice: quello che arriva dall'aria non è fidato
  const nota = document.createElement("p");
  nota.className = "small";
  const ora = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const correzioni = e.byteCorretti === 0 ? "arrivato pulito" : `${e.byteCorretti} byte corretti (su ${e.byteParita} correggibili al massimo)`;
  nota.textContent = `${ora} · ${correzioni}`;
  if (origine === "simulato") {
    const b = document.createElement("span");
    b.className = "badge sim";
    b.textContent = "Simulato";
    nota.append(" ", b);
  }
  li.append(testo, nota);
  el.messaggi.prepend(li);
}

function blocco(campioni, fs) {
  if (!ascolto) return;
  ascolto.rx.accoda(campioni);
  spettro && spettro.accoda(campioni, fs);
  // livello: picco del blocco, con discesa lenta
  let picco = 0;
  for (let i = 0; i < campioni.length; i++) { const v = Math.abs(campioni[i]); if (v > picco) picco = v; }
  ascolto.picco = Math.max(picco, (ascolto.picco || 0) * 0.85);
  el.livello.value = Math.min(1, ascolto.picco);
  el.livello.classList.toggle("forte", picco > 0.97);
  // registrazione degli ultimi secondi (resta in memoria, serve solo a «Scarica la registrazione»)
  registrazione.fs = fs;
  registrazione.blocchi.push(campioni);
  registrazione.campioni += campioni.length;
  while (registrazione.campioni - registrazione.blocchi[0].length > registrazione.massimo * fs) registrazione.campioni -= registrazione.blocchi.shift().length;
  el.scarica.disabled = false;
}

async function avviaAscolto() {
  if (ascolto || !puoAscoltare) return;
  el.ascolta.disabled = true;
  el.rxStato.textContent = "Chiedo il permesso di usare il microfono…";
  let stream;
  try {
    // i filtri pensati per la voce (eco, rumore, guadagno automatico) rovinano le note del modem: vanno spenti
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false });
  } catch (e) {
    el.ascolta.disabled = false;
    el.rxStato.textContent = e && e.name === "NotAllowedError" ? "Permesso negato. Per ascoltare, consenti il microfono a questa pagina nelle impostazioni del browser." : "Nessun microfono disponibile.";
    return;
  }
  try {
    const c = await contesto();
    const sorgente = c.createMediaStreamSource(stream);
    const muto = c.createGain();
    muto.gain.value = 0; // il nodo va collegato all'uscita perché il browser lo faccia lavorare, ma non deve sentirsi
    let nodo;
    if (c.audioWorklet && window.AudioWorkletNode) {
      await c.audioWorklet.addModule(new URL("./worklet.js", import.meta.url));
      nodo = new AudioWorkletNode(c, "polpo-cattura", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      nodo.port.onmessage = (ev) => blocco(ev.data, c.sampleRate);
    } else {
      nodo = c.createScriptProcessor(4096, 1, 1); // browser più vecchi
      nodo.onaudioprocess = (ev) => blocco(Float32Array.from(ev.inputBuffer.getChannelData(0)), c.sampleRate);
    }
    sorgente.connect(nodo);
    nodo.connect(muto);
    muto.connect(c.destination);
    ascolto = { stream, nodi: [sorgente, nodo, muto], rx: new Ricevitore(c.sampleRate, { suEvento: (e) => suEvento(e, "microfono") }) };
    const s = stream.getAudioTracks()[0].getSettings ? stream.getAudioTracks()[0].getSettings() : {};
    const accesi = [["echoCancellation", "cancellazione dell'eco"], ["noiseSuppression", "riduzione del rumore"], ["autoGainControl", "guadagno automatico"]].filter(([k]) => s[k] === true).map(([, nome]) => nome);
    el.impostazioni.textContent = `Microfono a ${c.sampleRate} Hz. ` + (accesi.length ? `Il browser ha lasciato accesi: ${accesi.join(", ")}. La ricezione può peggiorare.` : "Filtri per la voce spenti.");
    el.impostazioni.classList.toggle("errore", accesi.length > 0);
    if (navigator.wakeLock) navigator.wakeLock.request("screen").then((b) => { if (ascolto) ascolto.blocco = b; else b.release(); }).catch(() => {}); // schermo acceso finché si ascolta
    el.ascolta.textContent = "Smetti di ascoltare";
    el.ascolta.setAttribute("aria-pressed", "true");
    el.rxStato.textContent = "In ascolto…";
    el.livello.hidden = false;
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    el.rxStato.textContent = "Non riesco ad avviare l'ascolto in questo browser.";
  }
  el.ascolta.disabled = false;
}

function fermaAscolto(messaggio = "Ascolto fermo.") {
  if (!ascolto) return;
  ascolto.stream.getTracks().forEach((t) => t.stop());
  ascolto.nodi.forEach((n) => { try { n.disconnect(); } catch (e) { /* già scollegato */ } });
  if (ascolto.nodi[1].port) ascolto.nodi[1].port.onmessage = null;
  if (ascolto.blocco) ascolto.blocco.release().catch(() => {});
  ascolto = null;
  el.ascolta.textContent = "Ascolta";
  el.ascolta.setAttribute("aria-pressed", "false");
  el.rxStato.textContent = messaggio;
  el.livello.hidden = true;
}

// ---------------- canale simulato ----------------
let ultimoSimulato = null;
function simula() {
  const { testo, trama } = leggiTesto();
  if (!trama) return;
  const snr = -Number(el.simRumore.value), rt60 = Number(el.simEco.value); // il cursore dà il rumore rispetto al segnale
  el.simVai.disabled = true;
  el.simEsito.textContent = "Calcolo…";
  setTimeout(() => { // lascia al browser il tempo di mostrare «Calcolo…»
    const fs = 48000;
    const ricevuto = canale(sintetizza(trama, fs), fs, { snr, rt60, drr: 0, anticipo: 0.4, coda: 0.3 }, casuale((Date.now() & 0x7fffffff) || 1));
    const r = ricevi(ricevuto, fs, { suEvento: () => {} });
    if (spettro) { spettro.azzera(); spettro.accoda(ricevuto, fs); }
    r.eventi.forEach((e) => suEvento(e, "simulato"));
    const m = r.messaggi[0];
    el.simEsito.textContent = m
      ? m.testo === testo ? (m.byteCorretti ? `Arrivato, dopo aver corretto ${m.byteCorretti} byte rovinati su ${m.byteParita} correggibili.` : "Arrivato pulito, senza nessun errore da correggere.") : "Arrivato un testo diverso: questo non dovrebbe succedere mai. Segnalalo, per favore."
      : r.eventi.some((e) => e.tipo === "aggancio") ? "Non arrivato: il ricevitore ha trovato il messaggio ma era troppo rovinato per ricostruirlo." : "Non arrivato: nel rumore il ricevitore non ha nemmeno trovato l'inizio del messaggio.";
    ultimoSimulato = { audio: ricevuto, fs };
    el.simSuona.disabled = !AudioCtx;
    el.simVai.disabled = false;
  }, 30);
}

async function suonaSimulato() {
  if (!ultimoSimulato) return;
  const c = await contesto();
  const { audio, fs } = ultimoSimulato;
  let picco = 1e-9;
  for (let i = 0; i < audio.length; i++) picco = Math.max(picco, Math.abs(audio[i]));
  const buffer = c.createBuffer(1, audio.length, fs);
  const dati = buffer.getChannelData(0);
  for (let i = 0; i < audio.length; i++) dati[i] = (0.5 * audio[i]) / picco;
  const sorgente = c.createBufferSource();
  sorgente.buffer = buffer;
  sorgente.connect(c.destination);
  sorgente.start();
}

// ---------------- registrazione da scaricare ----------------
function scaricaRegistrazione() {
  if (!registrazione.campioni) return;
  const n = registrazione.campioni, fs = registrazione.fs;
  const wav = new DataView(new ArrayBuffer(44 + 2 * n));
  const scrivi = (o, s) => { for (let i = 0; i < s.length; i++) wav.setUint8(o + i, s.charCodeAt(i)); };
  scrivi(0, "RIFF"); wav.setUint32(4, 36 + 2 * n, true); scrivi(8, "WAVEfmt "); wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, fs, true); wav.setUint32(28, 2 * fs, true);
  wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); scrivi(36, "data"); wav.setUint32(40, 2 * n, true);
  let o = 44;
  for (const b of registrazione.blocchi) for (let i = 0; i < b.length; i++, o += 2) wav.setInt16(o, Math.round(32767 * Math.max(-1, Math.min(1, b[i]))), true);
  salvaFile(new Blob([wav], { type: "audio/wav" }), "polpo-onde-registrazione.wav");
}

// ---------------- avvio ----------------
el.testo.addEventListener("input", aggiornaTesto);
el.trasmetti.addEventListener("click", trasmetti);
el.ascolta.addEventListener("click", () => (ascolto ? fermaAscolto() : avviaAscolto()));
el.simVai.addEventListener("click", simula);
el.simSuona.addEventListener("click", suonaSimulato);
el.scarica.addEventListener("click", scaricaRegistrazione);
const etichette = () => {
  const snr = -Number(el.simRumore.value), eco = Number(el.simEco.value);
  el.simRumoreVal.textContent = snr >= 25 ? "quasi assente" : snr > 0 ? `segnale ${snr} dB sopra il rumore` : snr === 0 ? "forte quanto il segnale" : `${-snr} dB più forte del segnale`;
  el.simEcoVal.textContent = eco === 0 ? "nessuno" : `${numero(eco)} s (${eco <= 0.3 ? "stanza arredata" : eco <= 0.6 ? "stanza vuota" : "corridoio, bagno"})`;
};
el.simRumore.addEventListener("input", etichette);
el.simEco.addEventListener("input", etichette);
etichette();
if (!AudioCtx) {
  el.supporto.hidden = false;
  el.supporto.textContent = "Questo browser non ha le funzioni audio necessarie: puoi usare solo il canale simulato qui sotto.";
} else if (!puoAscoltare) {
  el.ascolta.disabled = true;
  el.supporto.hidden = false;
  el.supporto.textContent = "Questo browser non dà accesso al microfono: puoi trasmettere e usare il canale simulato, ma non ascoltare.";
}
new MutationObserver(() => disegnaSpartito(leggiTesto().trama)).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
window.matchMedia && matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => disegnaSpartito(leggiTesto().trama));
aggiornaTesto();
