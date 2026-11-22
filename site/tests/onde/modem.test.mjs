// Il modem su canale pulito e con i difetti tipici di dispositivi e orologi.
import test from "node:test";
import assert from "node:assert/strict";
import { trasmetti, sintetizza, chirp, TEMPI } from "../../assets/js/onde/tx.js";
import { ricevi, Ricevitore } from "../../assets/js/onde/rx.js";
import { Ricampionatore, ricampiona } from "../../assets/js/onde/ricampiona.js";
import { canale, casuale as generatore } from "../../assets/js/onde/canale.js";
import { fft, potenzaDiDue } from "../../assets/js/onde/fft.js";
import * as P from "../../assets/js/onde/protocollo.js";
import { attraversoIlCanale } from "./aiuto.mjs";

const tutti = (t, nome, parametri, minimo) => {
  const e = attraversoIlCanale(parametri);
  t.diagnostic(`${nome}: ${e.arrivati}/${e.n} arrivati, parità usata ${e.paritaUsata}, qualità dell'aggancio ${e.qualita}`);
  assert.equal(e.sbagliati, 0, `${nome}: un messaggio è arrivato con il testo sbagliato`);
  assert.ok(e.arrivati >= (minimo ?? e.n), `${nome}: arrivati solo ${e.arrivati} su ${e.n}`);
};

test("trasmettitore: durata, livello e spettro del segnale", () => {
  const fs = 48000;
  const { trama, audio } = trasmetti("Ciao!", fs);
  assert.equal(audio.length, Math.ceil(P.durata(5) * fs));
  assert.ok(audio.every((v) => Math.abs(v) <= 0.8 + 1e-6), "il segnale non supera l'ampiezza richiesta");
  assert.equal(trama.toni.length, 52);
  // spettro: quasi tutta l'energia sta tra 900 e 3600 Hz, niente "clic" in alta frequenza
  const n = potenzaDiDue(audio.length);
  const re = new Float64Array(n), im = new Float64Array(n);
  re.set(audio);
  fft(re, im);
  let dentro = 0, alto = 0, basso = 0;
  for (let k = 1; k < n / 2; k++) {
    const f = (k * fs) / n, e = re[k] * re[k] + im[k] * im[k];
    if (f >= 900 && f <= 3600) dentro += e;
    else if (f > 5000) alto += e;
    else if (f < 600) basso += e;
  }
  assert.ok(10 * Math.log10(alto / dentro) < -50, `energia sopra 5 kHz: ${(10 * Math.log10(alto / dentro)).toFixed(1)} dB`);
  assert.ok(10 * Math.log10(basso / dentro) < -40, `energia sotto 600 Hz: ${(10 * Math.log10(basso / dentro)).toFixed(1)} dB`);
  // i due fischi sono uno lo specchio dell'altro nel tempo, a parte il segno
  const su = chirp(8000, +1), giu = chirp(8000, -1);
  assert.equal(su.length, 800);
  assert.ok(Math.abs(TEMPI.primoSimbolo - 0.53) < 1e-9);
  for (let i = 1; i < 800; i += 37) assert.ok(Math.abs(Math.abs(su[i]) - Math.abs(giu[800 - i])) < 0.02);
  // la stessa trama ha la stessa durata a ogni frequenza di campionamento
  for (const f of [16000, 22050, 44100, 96000]) assert.equal(sintetizza(trama, f).length, Math.ceil(P.durata(5) * f));
});

test("ricampionatore: tiene la banda del modem, toglie il resto, non dipende da come arrivano i blocchi", () => {
  for (const fs of [16000, 44100, 48000, 96000]) {
    const guadagno = (f) => {
      const x = Float32Array.from({ length: fs }, (_, i) => Math.sin((2 * Math.PI * f * i) / fs));
      const y = ricampiona(x, fs);
      let e = 0;
      for (let i = 2000; i < 6000; i++) e += y[i] * y[i];
      return 10 * Math.log10(e / 4000 / 0.5 + 1e-12);
    };
    for (const f of [1600, 2000, 2400, 3150]) assert.ok(Math.abs(guadagno(f)) < 0.2, `${fs} Hz: ${f} Hz deve passare inalterato`);
    for (const f of [300, 800, 4700, 6000]) assert.ok(guadagno(f) < -60, `${fs} Hz: ${f} Hz deve sparire`);
  }
  const rnd = generatore(4);
  const x = Float32Array.from({ length: 44100 }, () => rnd.gauss());
  const intero = new Ricampionatore(44100).elabora(x);
  const r = new Ricampionatore(44100);
  const pezzi = [];
  for (let i = 0; i < x.length; ) {
    const k = 1 + rnd.intero(3000);
    pezzi.push(r.elabora(x.subarray(i, i + k)));
    i += k;
  }
  const unito = Float32Array.from(pezzi.flatMap((p) => Array.from(p)));
  assert.equal(unito.length, intero.length);
  assert.ok(unito.every((v, i) => v === intero[i]), "a blocchi o tutto insieme il risultato è identico");
});

test("canale pulito: ogni frequenza di campionamento, anche diversa tra chi trasmette e chi riceve", (t) => {
  for (const fs of [16000, 22050, 44100, 48000, 96000]) tutti(t, `${fs} Hz`, { n: 6, seme: fs, fs });
  tutti(t, "44,1 kHz → 48 kHz", { n: 10, seme: 1, fs: 44100, opzioni: { fsUscita: 48000 } });
  tutti(t, "48 kHz → 44,1 kHz", { n: 10, seme: 2, opzioni: { fsUscita: 44100 } });
  tutti(t, "48 kHz → 16 kHz", { n: 6, seme: 3, opzioni: { fsUscita: 16000 } });
});

test("messaggi più corti e più lunghi possibili, e due di seguito", () => {
  const fs = 48000;
  for (const testo of ["a", "è", "x".repeat(120), "è".repeat(60), "🐙🐙🐙"]) {
    const y = canale(trasmetti(testo, fs).audio, fs, { snr: 10 }, generatore(testo.length));
    const r = ricevi(y, fs);
    assert.deepEqual(r.messaggi.map((m) => m.testo), [testo]);
  }
  const rnd = generatore(8);
  const a = canale(trasmetti("Primo", fs).audio, fs, { snr: 10, coda: 0.05 }, rnd);
  const b = canale(trasmetti("Secondo, subito dopo", fs).audio, fs, { snr: 10, anticipo: 0.05 }, rnd);
  const due = new Float32Array(a.length + b.length);
  due.set(a);
  due.set(b, a.length);
  assert.deepEqual(ricevi(due, fs).messaggi.map((m) => m.testo), ["Primo", "Secondo, subito dopo"]);
});

test("il risultato non dipende dalla dimensione dei blocchi in arrivo", () => {
  const fs = 44100;
  const y = canale(trasmetti("Blocchi di ogni misura", fs).audio, fs, { snr: 6, rt60: 0.4, drr: 3 }, generatore(11));
  const riferimento = ricevi(y, fs, { blocco: 4096 }).eventi.map((e) => `${e.tipo}:${e.testo ?? ""}:${(e.qualita ?? 0).toFixed(6)}`);
  assert.ok(riferimento.some((e) => e.startsWith("messaggio:Blocchi di ogni misura")));
  for (const blocco of [128, 1000, 7777, 200000]) {
    assert.deepEqual(ricevi(y, fs, { blocco }).eventi.map((e) => `${e.tipo}:${e.testo ?? ""}:${(e.qualita ?? 0).toFixed(6)}`), riferimento, `blocchi da ${blocco}`);
  }
});

test("orologi diversi: scarto fisso fino allo 0,5% e velocità che oscilla", (t) => {
  for (const ppm of [1000, -1000, 5000, -5000]) tutti(t, `orologio ${ppm} ppm`, { n: 12, seme: 100 + ppm, opzioni: { ppm, snr: 15 } });
  tutti(t, "dondolio di 1500 ppm a 0,7 Hz (telefono in mano)", { n: 12, seme: 5, opzioni: { dondolio: { ppm: 1500, hz: 0.7 }, snr: 15 } });
  // l'inseguitore deve aver misurato davvero la deriva
  const fs = 48000;
  // (orologio di chi riceve più veloce dello 0,3% = simboli più lunghi dello 0,3%)
  const lungo = "Deriva dell'orologio misurata bene, con un messaggio abbastanza lungo da lasciarla assestare";
  for (const ppm of [3000, -3000]) {
    const y = canale(trasmetti(lungo, fs).audio, fs, { ppm }, generatore(1));
    const m = ricevi(y, fs).messaggi[0];
    assert.ok(Math.abs(m.deriva - ppm * 1e-6) < 0.0005, `orologio ${ppm} ppm: deriva stimata ${(m.deriva * 1e6).toFixed(0)} ppm`);
  }
});

test("dispositivi: altoparlante piccolo, distorsione, guadagno automatico, volume bassissimo o altissimo", (t) => {
  tutti(t, "altoparlante 900 Hz – 3,4 kHz", { n: 12, seme: 21, opzioni: { passaAlto: 900, passaBasso: 3400, snr: 15 } });
  tutti(t, "saturazione forte e taglio netto", { n: 12, seme: 22, opzioni: { saturazione: 3, taglio: 0.25, snr: 20 } });
  tutti(t, "guadagno automatico che pompa", { n: 12, seme: 23, opzioni: { agc: { obiettivo: 0.3, rilascio: 0.15 }, snr: 10 } });
  tutti(t, "volume −60 dB", { n: 8, seme: 24, opzioni: { guadagno: 0.001 } });
  tutti(t, "volume +20 dB con taglio", { n: 8, seme: 25, opzioni: { guadagno: 10, taglio: 1, snr: 20 } });
});

test("campioni persi dal dispositivo: il ricevitore si riaggancia, e comunque non inventa mai un testo", (t) => {
  tutti(t, "buco di 30 ms", { n: 20, seme: 31, opzioni: (r) => ({ buchi: [{ t: r.tra(2.5, 4), durata: 0.03 }], snr: 20 }) }, 18);
  tutti(t, "buco di 12 ms", { n: 15, seme: 32, opzioni: (r) => ({ buchi: [{ t: r.tra(2.5, 4), durata: 0.012 }], snr: 20 }) }, 14);
  const e = attraversoIlCanale({ n: 15, seme: 33, opzioni: (r) => ({ buchi: [{ t: r.tra(2, 4), durata: r.tra(0.2, 0.6) }], snr: 20 }) });
  t.diagnostic(`buco lungo (0,2–0,6 s): ${e.arrivati}/${e.n} arrivati`);
  assert.equal(e.sbagliati, 0);
});

test("stato e contatori del ricevitore", () => {
  const fs = 48000, eventi = [];
  const rx = new Ricevitore(fs, { suEvento: (e) => eventi.push(e.tipo) });
  assert.equal(rx.stato, "ascolto");
  const y = canale(trasmetti("Stato", fs).audio, fs, { anticipo: 0.2, coda: 0 });
  rx.accoda(y.subarray(0, Math.round(1.6 * fs)));
  assert.equal(rx.stato, "intestazione");
  rx.accoda(y.subarray(Math.round(1.6 * fs), Math.round(2.6 * fs)));
  assert.equal(rx.stato, "dati");
  rx.accoda(y.subarray(Math.round(2.6 * fs)));
  rx.accoda(new Float32Array(fs));
  assert.equal(rx.stato, "ascolto");
  assert.deepEqual(eventi, ["aggancio", "intestazione", "messaggio"]);
  assert.deepEqual(rx.contatori, { agganci: 1, scartati: 0, messaggi: 1, falliti: 0 });
  assert.ok(Math.abs(rx.tempo - (y.length / fs + 1)) < 0.01);
  assert.throws(() => new Ricevitore(4000), RangeError);
});
