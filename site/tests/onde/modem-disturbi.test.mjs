// Il modem con rumore, stanze che rimbombano e disturbi: le soglie qui sotto sono il "minimo garantito" nel canale simulato.
import test from "node:test";
import assert from "node:assert/strict";
import { attraversoIlCanale } from "./aiuto.mjs";

const soglia = (t, nome, parametri, minimo) => {
  const e = attraversoIlCanale(parametri);
  t.diagnostic(`${nome}: ${e.arrivati}/${e.n} arrivati, parità usata ${e.paritaUsata}, qualità dell'aggancio ${e.qualita}`);
  assert.equal(e.sbagliati, 0, `${nome}: un messaggio è arrivato con il testo sbagliato`);
  assert.ok(e.arrivati >= (minimo ?? e.n), `${nome}: arrivati solo ${e.arrivati} su ${e.n}`);
};

test("rumore bianco: tutto arriva fino a 0 dB di rapporto segnale/rumore in banda", (t) => {
  for (const snr of [20, 10, 5, 0]) soglia(t, `SNR ${snr} dB`, { n: 25, seme: 40 + snr, opzioni: { snr } });
  soglia(t, "SNR −3 dB", { n: 25, seme: 37, opzioni: { snr: -3 } }, 23);
  soglia(t, "rumore rosa, SNR 5 dB", { n: 20, seme: 38, opzioni: { snr: 5, rumore: "rosa" } });
});

test("stanza: riverbero di mezzo secondo con rumore a 10 dB", (t) => {
  soglia(t, "RT60 0,3 s, diretto/riverbero +6 dB", { n: 20, seme: 51, opzioni: { rt60: 0.3, drr: 6, snr: 10 } });
  soglia(t, "RT60 0,5 s, diretto/riverbero 0 dB", { n: 40, seme: 52, opzioni: { rt60: 0.5, drr: 0, snr: 10 } }, 39);
  soglia(t, "RT60 0,8 s, diretto/riverbero 0 dB", { n: 20, seme: 53, opzioni: { rt60: 0.8, drr: 0, snr: 10 } }, 19);
  soglia(t, "riflessioni che scavano buchi in banda", {
    n: 20, seme: 54,
    opzioni: (r) => ({ riflessioni: [{ ritardo: r.tra(0.0004, 0.003), guadagno: 0.8 }, { ritardo: r.tra(0.004, 0.02), guadagno: -0.6 }], snr: 15 }),
  });
});

test("stanza molto difficile: si degrada senza inventare testi", (t) => {
  const e = attraversoIlCanale({ n: 20, seme: 55, opzioni: { rt60: 0.8, drr: -6, snr: 10 } });
  t.diagnostic(`RT60 0,8 s, diretto/riverbero −6 dB: ${e.arrivati}/${e.n} arrivati`);
  assert.equal(e.sbagliati, 0);
  assert.ok(e.arrivati >= 10, "anche qui almeno metà dei messaggi deve arrivare");
});

test("disturbi: toni fissi anche più forti del segnale, scatti", (t) => {
  soglia(t, "tono fisso a 2000 Hz forte come il segnale", { n: 20, seme: 61, opzioni: { disturbi: [{ f: 2000, db: 0 }], snr: 20 } });
  soglia(t, "tre toni fissi a +6 dB", { n: 20, seme: 62, opzioni: { disturbi: [{ f: 1650, db: 6 }, { f: 2400, db: 6 }, { f: 3100, db: 6 }], snr: 20 } }, 19);
  soglia(t, "20 scatti al secondo a +20 dB", { n: 20, seme: 63, opzioni: { scatti: { alSecondo: 20, db: 20 }, snr: 20 } });
});

test("tutto insieme: stanza, orologio, rumore rosa, altoparlante piccolo, 48 → 44,1 kHz", (t) => {
  soglia(t, "tutto insieme", {
    n: 30, seme: 71,
    opzioni: (r) => ({
      rt60: 0.5, drr: 0, riflessioni: [{ ritardo: r.tra(0.001, 0.01), guadagno: 0.5 }],
      ppm: r.tra(-300, 300), fsUscita: 44100, snr: 10, rumore: "rosa", passaAlto: 700, saturazione: 1.5,
    }),
  }, 29);
});

test("oltre il limite (rumore 15 dB più forte del segnale): nessun messaggio, mai uno sbagliato", (t) => {
  const e = attraversoIlCanale({ n: 15, seme: 81, opzioni: { snr: -15 } });
  t.diagnostic(`SNR −15 dB: ${e.arrivati}/${e.n} arrivati`);
  assert.equal(e.sbagliati, 0);
});
