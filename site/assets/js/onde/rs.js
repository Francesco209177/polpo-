// Polpo Onde — codice di Reed–Solomon su GF(256), sistematico: parola = dati ‖ parità.
// Radici del generatore α^0 … α^(nsym-1), come nei codici QR (così esistono vettori di prova pubblici).
// La decodifica corregge errori e cancellature: 2·errori + cancellature ≤ nsym.

import { mul, div, alfa } from "./gf256.js";

const generatori = new Map();

/** Polinomio generatore, coefficienti dal grado più alto. */
export function generatore(nsym) {
  let g = generatori.get(nsym);
  if (g) return g;
  g = new Uint8Array([1]);
  for (let i = 0; i < nsym; i++) {
    const next = new Uint8Array(g.length + 1);
    const a = alfa(i);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j]; // g · x
      next[j + 1] ^= mul(g[j], a); // g · α^i
    }
    g = next;
  }
  generatori.set(nsym, g);
  return g;
}

/** Aggiunge `nsym` byte di parità ai dati. */
export function codifica(dati, nsym) {
  if (nsym < 1 || dati.length + nsym > 255) throw new RangeError("lunghezza non valida per Reed–Solomon");
  const g = generatore(nsym);
  const out = new Uint8Array(dati.length + nsym);
  out.set(dati);
  for (let i = 0; i < dati.length; i++) {
    const c = out[i];
    if (c !== 0) for (let j = 1; j < g.length; j++) out[i + j] ^= mul(g[j], c);
  }
  out.set(dati); // la divisione ha sporcato la parte dei dati
  return out;
}

/** Sindromi S_j = parola(α^j), j = 0 … nsym-1. Tutte zero = parola valida. */
export function sindromi(parola, nsym) {
  const s = new Uint8Array(nsym);
  for (let j = 0; j < nsym; j++) {
    const a = alfa(j);
    let v = 0;
    for (let i = 0; i < parola.length; i++) v = mul(v, a) ^ parola[i];
    s[j] = v;
  }
  return s;
}

function valuta(poli, grado, x) {
  // coefficienti dal grado più basso
  let v = 0;
  for (let k = grado; k >= 0; k--) v = mul(v, x) ^ poli[k];
  return v;
}

/**
 * Corregge una parola ricevuta.
 * @param {Uint8Array} parola       dati ‖ parità, come ricevuti
 * @param {number} nsym             byte di parità
 * @param {number[]} cancellature   indici (nella parola) dei byte ritenuti inaffidabili
 * @returns {{parola: Uint8Array, errori: number, cancellature: number} | null}  null se non correggibile
 */
export function decodifica(parola, nsym, cancellature = []) {
  const n = parola.length;
  if (n > 255 || nsym < 1 || nsym >= n) throw new RangeError("lunghezza non valida per Reed–Solomon");
  const e = cancellature.length;
  if (e > nsym) return null;
  const S = sindromi(parola, nsym);
  if (S.every((v) => v === 0)) return { parola: Uint8Array.from(parola), errori: 0, cancellature: 0 };

  // Localizzatore delle cancellature Γ(x) = ∏ (1 + X·x), con X = α^(n-1-indice); coefficienti dal grado più basso.
  let lam = new Uint8Array(nsym + 2);
  lam[0] = 1;
  const viste = new Set();
  for (const idx of cancellature) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= n || viste.has(idx)) throw new RangeError("cancellatura non valida");
    viste.add(idx);
    const X = alfa(n - 1 - idx);
    for (let d = viste.size - 1; d >= 0; d--) lam[d + 1] ^= mul(lam[d], X);
  }

  // Berlekamp–Massey esteso alle cancellature (Blahut).
  let B = Uint8Array.from(lam);
  let L = e;
  for (let r = e; r < nsym; r++) {
    let delta = 0;
    for (let j = 0; j <= L; j++) delta ^= mul(lam[j], S[r - j]);
    B.copyWithin(1, 0, nsym + 1); // B ← x·B
    B[0] = 0;
    if (delta !== 0) {
      const T = new Uint8Array(nsym + 2);
      for (let k = 0; k <= nsym; k++) T[k] = lam[k] ^ mul(delta, B[k]);
      if (2 * L <= r + e) {
        const nuovoB = new Uint8Array(nsym + 2);
        for (let k = 0; k <= nsym; k++) nuovoB[k] = div(lam[k], delta);
        B = nuovoB;
        L = r + 1 - L + e;
      }
      lam = T;
    }
  }
  if (L > nsym || lam[L] === 0) return null;
  if (2 * (L - e) + e > nsym) return null;

  // Ricerca di Chien: le radici di Λ sono gli inversi dei localizzatori.
  const potenze = [];
  for (let p = 0; p < n; p++) if (valuta(lam, L, alfa(-p)) === 0) potenze.push(p);
  if (potenze.length !== L) return null;

  // Ω(x) = S(x)·Λ(x) mod x^nsym, poi Forney: valore = X · Ω(X⁻¹) / Λ'(X⁻¹).
  const omega = new Uint8Array(nsym);
  for (let k = 0; k < nsym; k++) {
    let v = 0;
    for (let j = 0; j <= Math.min(k, L); j++) v ^= mul(lam[j], S[k - j]);
    omega[k] = v;
  }
  const out = Uint8Array.from(parola);
  let cambiati = 0;
  for (const p of potenze) {
    const X = alfa(p);
    const Xi = alfa(-p);
    let den = 0; // derivata formale: restano solo i termini di grado dispari
    for (let j = 1; j <= L; j += 2) den ^= mul(lam[j], alfa(-p * (j - 1)));
    if (den === 0) return null;
    const valore = mul(X, div(valuta(omega, nsym - 1, Xi), den));
    if (valore !== 0) cambiati++;
    out[n - 1 - p] ^= valore;
  }
  if (!sindromi(out, nsym).every((v) => v === 0)) return null;
  return { parola: out, errori: L - e, cancellature: e, cambiati };
}
