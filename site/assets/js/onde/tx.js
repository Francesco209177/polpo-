// Polpo Onde — trasmettitore: dalla trama ai campioni audio, a qualsiasi frequenza di campionamento.

import * as P from "./protocollo.js";

/** Inviluppo a coseno rialzato: sale in `rampa` secondi, resta a 1, scende in `rampa` secondi. */
function inviluppo(t, durata, rampa) {
  if (t < 0 || t > durata) return 0;
  if (t < rampa) return 0.5 - 0.5 * Math.cos((Math.PI * t) / rampa);
  if (t > durata - rampa) return 0.5 - 0.5 * Math.cos((Math.PI * (durata - t)) / rampa);
  return 1;
}

/**
 * Un fischio (chirp) lineare. `verso` = +1 sale da 1600 a 3150 Hz, −1 scende.
 * `quadratura` restituisce la versione sfasata di 90° (serve al ricevitore).
 */
export function chirp(fs, verso, quadratura = false) {
  const n = Math.round(P.T_CHIRP * fs);
  const out = new Float32Array(n);
  const f0 = verso > 0 ? P.F_MIN : P.F_MAX;
  const f1 = verso > 0 ? P.F_MAX : P.F_MIN;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const fase = 2 * Math.PI * (f0 * t + ((f1 - f0) * t * t) / (2 * P.T_CHIRP));
    out[i] = (quadratura ? Math.cos(fase) : Math.sin(fase)) * inviluppo(t, P.T_CHIRP, P.T_RAMPA);
  }
  return out;
}

/** Istanti (in secondi dall'inizio della trama) delle parti del preambolo e del primo simbolo. */
export const TEMPI = Object.freeze({
  chirpSu: P.T_AVVIO,
  chirpGiu: P.T_AVVIO + P.T_CHIRP + P.T_PAUSA_CHIRP,
  primoSimbolo: P.T_PREAMBOLO,
});

/**
 * Sintetizza l'audio di una trama.
 * @param {{toni: {frequenza:number}[]}} trama  risultato di protocollo.componi()
 * @param {number} fs                           frequenza di campionamento desiderata
 * @param {{ampiezza?: number}} [o]
 * @returns {Float32Array}
 */
export function sintetizza(trama, fs, { ampiezza = 0.8 } = {}) {
  const durata = P.T_PREAMBOLO + trama.toni.length * P.T_SIMBOLO + P.T_CODA;
  const out = new Float32Array(Math.ceil(durata * fs));

  // tono d'avvio, leggero
  const nAvvio = Math.round(P.T_AVVIO * fs);
  for (let i = 0; i < nAvvio; i++) {
    const t = i / fs;
    out[i] = ampiezza * P.A_AVVIO * Math.sin(2 * Math.PI * P.F_AVVIO * t) * inviluppo(t, P.T_AVVIO, 0.01);
  }
  // i due fischi
  for (const [inizio, verso] of [[TEMPI.chirpSu, +1], [TEMPI.chirpGiu, -1]]) {
    const c = chirp(fs, verso);
    const n0 = Math.round(inizio * fs);
    for (let i = 0; i < c.length; i++) out[n0 + i] += ampiezza * c[i];
  }
  // i simboli: una nota ciascuno
  trama.toni.forEach(({ frequenza }, k) => {
    const t0 = TEMPI.primoSimbolo + k * P.T_SIMBOLO;
    const n0 = Math.ceil(t0 * fs);
    const n1 = Math.min(out.length, Math.floor((t0 + P.T_SIMBOLO) * fs));
    for (let i = n0; i < n1; i++) {
      const t = i / fs - t0;
      out[i] += ampiezza * Math.sin(2 * Math.PI * frequenza * t) * inviluppo(t, P.T_SIMBOLO, P.T_RAMPA);
    }
  });
  return out;
}

/** Testo → audio, in un solo passo. */
export function trasmetti(testo, fs, opzioni) {
  const trama = P.componi(testo);
  return { trama, audio: sintetizza(trama, fs, opzioni) };
}
