// Strumenti comuni alle prove: numeri casuali ripetibili (stesso seme = stessa prova) e testi di prova.
import { casuale as base } from "../../assets/js/onde/canale.js";

export function casuale(seme) {
  const f = base(seme);
  f.bytes = (n) => Uint8Array.from({ length: n }, () => f.intero(256));
  /** `quanti` indici distinti tra 0 e n-1 */
  f.scegli = (n, quanti) => {
    const tutti = Array.from({ length: n }, (_, i) => i);
    for (let i = 0; i < quanti; i++) {
      const j = i + f.intero(n - i);
      [tutti[i], tutti[j]] = [tutti[j], tutti[i]];
    }
    return tutti.slice(0, quanti);
  };
  return f;
}

const FRASI = ["Ciao!", "Il polpo ha otto braccia", "perché è così? Già: 100% àèìòù", "433,92 MHz", "🐙", "a"];
export function testoCasuale(rnd, maxByte = 120) {
  const alfabeto = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:!?àèéìòù€";
  if (rnd() < 0.2) return FRASI[rnd.intero(FRASI.length)];
  let s = "";
  const n = 1 + rnd.intero(60);
  for (let i = 0; i < n; i++) s += alfabeto[rnd.intero(alfabeto.length)];
  while (new TextEncoder().encode(s).length > maxByte) s = s.slice(0, -1);
  return s;
}

// ---------------- prove del modem attraverso il canale simulato ----------------
import { trasmetti } from "../../assets/js/onde/tx.js";
import { ricevi } from "../../assets/js/onde/rx.js";
import { canale } from "../../assets/js/onde/canale.js";
import * as P from "../../assets/js/onde/protocollo.js";

/**
 * Trasmette `n` messaggi casuali attraverso il canale e conta quanti arrivano.
 * Ogni messaggio ha un'attesa iniziale casuale e viene consegnato al ricevitore a blocchi di dimensione casuale.
 * Un messaggio arrivato con un testo diverso da quello spedito è sempre un errore grave: `sbagliati` deve restare 0.
 */
export function attraversoIlCanale({ n, seme, opzioni = {}, fs = 48000, maxByte = 40 }) {
  const rnd = casuale(seme);
  const esito = { n, arrivati: 0, sbagliati: 0, agganci: 0, paritaUsata: 0, qualita: 0 };
  for (let k = 0; k < n; k++) {
    const testo = testoCasuale(rnd, maxByte);
    const o = typeof opzioni === "function" ? opzioni(rnd) : opzioni;
    const y = canale(trasmetti(testo, fs).audio, fs, { anticipo: rnd.tra(0.2, 1.2), ...o }, rnd);
    const r = ricevi(y, o.fsUscita ?? fs, { blocco: 256 + rnd.intero(6000) });
    if (r.eventi.some((e) => e.tipo === "aggancio")) esito.agganci++;
    for (const m of r.messaggi) {
      if (m.testo === testo) {
        esito.arrivati++;
        esito.paritaUsata += m.byteCorretti / m.byteParita;
        esito.qualita += m.qualita;
      } else esito.sbagliati++;
    }
  }
  esito.paritaUsata = esito.arrivati ? +(esito.paritaUsata / esito.arrivati).toFixed(2) : null;
  esito.qualita = esito.arrivati ? +(esito.qualita / esito.arrivati).toFixed(2) : null;
  return esito;
}

/** Audio che NON contiene messaggi: il ricevitore non deve mai inventarne uno. */
export const nonMessaggi = {
  "rumore bianco": (n, fs, rnd) => Float32Array.from({ length: n }, () => 0.2 * rnd.gauss()),
  "note casuali sulle frequenze del modem": (n, fs, rnd) => {
    const y = new Float32Array(n);
    let i = 0;
    while (i < n) {
      const f = P.frequenza(rnd.intero(2), rnd.intero(16)), lung = Math.round(fs * rnd.tra(0.03, 0.12));
      for (let k = 0; k < lung && i < n; k++, i++) y[i] = 0.5 * Math.sin((2 * Math.PI * f * k) / fs);
    }
    return y;
  },
  "fischi casuali": (n, fs, rnd) => {
    const y = new Float32Array(n);
    let i = 0;
    while (i < n) {
      const T = rnd.tra(0.05, 0.3), f0 = rnd.tra(500, 4000), f1 = rnd.tra(500, 4000), lung = Math.round(T * fs);
      for (let k = 0; k < lung && i < n; k++, i++) {
        const t = k / fs;
        y[i] = 0.5 * Math.sin(2 * Math.PI * (f0 * t + ((f1 - f0) * t * t) / (2 * T)));
      }
      i += Math.round(fs * rnd.tra(0, 0.1));
    }
    return y;
  },
  "voce sintetica": (n, fs, rnd) => {
    const y = new Float32Array(n);
    let fase = 0, f0 = 140;
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      if (i % 4800 === 0) f0 = rnd.tra(90, 240);
      fase += (2 * Math.PI * f0) / fs;
      const inv = Math.max(0, Math.sin(2 * Math.PI * 3.7 * t)) ** 2;
      let v = 0;
      for (let h = 1; h * f0 < 4000; h++) v += Math.sin(h * fase) / (1 + Math.abs(h * f0 - 2200) / 600);
      y[i] = 0.15 * inv * v + 0.01 * rnd.gauss();
    }
    return y;
  },
  "preamboli veri senza dati": (n, fs, rnd) => {
    const pre = trasmetti("x", fs).audio.subarray(0, Math.round(P.T_PREAMBOLO * fs));
    const y = new Float32Array(n);
    for (let i = 0; i + pre.length + fs < n; i += pre.length + Math.round(fs * rnd.tra(0.2, 1))) y.set(pre, i);
    for (let i = 0; i < n; i++) y[i] += 0.05 * rnd.gauss();
    return y;
  },
};
