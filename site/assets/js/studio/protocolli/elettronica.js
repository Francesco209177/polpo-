// Polpo Studio — calcolatori di elettronica: legge di Ohm, partitore, resistenza per LED, codice colori.
// Copia JavaScript di studio/polpo_studio/protocols/electronics.py, più i testi della scheda «Calcolatori»
// (studio/polpo_studio/app/tools/gpio_tools.py). Stesse operazioni nello stesso ordine: stessi numeri di Python.

import { dividiPy, errorePy, eValueErrorPy, floatPy, floorPy, formatPy, roundInteroPy, roundPy, splitPy, stripPy } from "../strumenti/convertitore.js";

export const E12 = Object.freeze([1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]);
export const E24 = Object.freeze([1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1]);
export const COLORI = Object.freeze(["nero", "marrone", "rosso", "arancione", "giallo", "verde", "blu", "viola", "grigio", "bianco"]);
export const MOLTIPLICATORI = new Map([...COLORI.map((c, i) => [c, 10 ** i]), ["oro", 0.1], ["argento", 0.01]]);
export const TOLLERANZE = new Map([
  ["marrone", 1.0], ["rosso", 2.0], ["verde", 0.5], ["blu", 0.25], ["viola", 0.1], ["grigio", 0.05], ["oro", 5.0], ["argento", 10.0],
]);

const errore = (msg) => errorePy("ValueError", msg);

// 10 ** n come in Python: intero esatto per n >= 0 (convertito al double più vicino), altrimenti il double più vicino.
function potenzaDi10(n) {
  return n >= 0 ? Number(10n ** BigInt(n)) : Number(`1e${n}`);
}

/**
 * Dati due valori tra tensione `v` (V), corrente `i` (A) e resistenza `r` (Ω), calcola il terzo e la potenza `p` (W).
 * Il valore da calcolare si lascia null.
 */
export function ohm({ v = null, i = null, r = null } = {}) {
  const noti = [v, i, r].filter((x) => x !== null && x !== undefined).length;
  if (noti !== 2) throw errore("servono esattamente due valori tra V, I e R");
  if (v === null || v === undefined) v = i * r;
  else if (i === null || i === undefined) {
    if (r === 0) throw errore("R non può essere zero");
    i = v / r;
  } else {
    if (i === 0) throw errore("I non può essere zero");
    r = v / i;
  }
  return { v, i, r, p: v * i };
}

/** Tensione d'uscita del partitore R1 (verso Vin) / R2 (verso massa). */
export function partitore(vin, r1, r2) {
  if (r1 + r2 <= 0) throw errore("R1 + R2 deve essere positivo");
  return (vin * r2) / (r1 + r2);
}

/** Il valore standard più vicino (verso l'alto se `perEccesso`, per non superare la corrente voluta). */
export function piuVicinoStandard(valore, serie = E12, perEccesso = true) {
  if (valore <= 0) throw errore("valore non positivo");
  const decade = potenzaDi10(floorPy(Math.log10(valore)));
  const candidati = [...serie.map((s) => s * decade), serie[0] * decade * 10];
  let migliore = null;
  if (perEccesso) {
    const soglia = valore * (1 - 1e-9);
    for (const c of candidati) if (c >= soglia && (migliore === null || c < migliore)) migliore = c;
    return migliore ?? candidati[candidati.length - 1];
  }
  for (const c of candidati) if (migliore === null || Math.abs(c - valore) < Math.abs(migliore - valore)) migliore = c;
  return migliore;
}

/** Resistenza per un LED: {esatta, standard (E12 per eccesso), correnteMa reale, potenzaW}. */
export function resistenzaLed(alimentazioneV, tensioneLedV, correnteMa) {
  if (alimentazioneV <= tensioneLedV) throw errore("la tensione di alimentazione deve superare quella del LED");
  if (correnteMa <= 0) throw errore("corrente non positiva");
  const i = correnteMa / 1000;
  const esatta = dividiPy(alimentazioneV - tensioneLedV, i);
  const standard = piuVicinoStandard(esatta);
  const iReale = dividiPy(alimentazioneV - tensioneLedV, standard);
  return { esatta, standard, correnteMa: iReale * 1000, potenzaW: iReale * iReale * standard };
}

/** Colori in italiano (3, 4 o 5 fasce) → [ohm, tolleranza % o null]. */
export function decodificaFasce(fasce) {
  const b = fasce.map((x) => stripPy(x).toLowerCase());
  if (![3, 4, 5].includes(b.length)) throw errore("servono 3, 4 o 5 fasce");
  const nCifre = b.length === 5 ? 3 : 2;
  const cifre = b.slice(0, nCifre).map((c) => COLORI.indexOf(c));
  if (cifre.includes(-1) || !MOLTIPLICATORI.has(b[nCifre])) throw errore("colore non valido per questa posizione");
  const valore = Number(cifre.join("")) * MOLTIPLICATORI.get(b[nCifre]);
  let tolleranza = null;
  if (b.length > nCifre + 1) {
    tolleranza = TOLLERANZE.get(b[nCifre + 1]) ?? null;
    if (tolleranza === null) throw errore("colore di tolleranza non valido");
  }
  return [roundPy(valore, 4), tolleranza];
}

/** Ohm → colori (cifre + moltiplicatore), senza la fascia di tolleranza; `cinque` per le resistenze a 5 fasce. */
export function codificaFasce(ohm, cinque = false) {
  if (ohm <= 0) throw errore("valore non positivo");
  const n = cinque ? 3 : 2;
  let esp = floorPy(Math.log10(ohm)) - (n - 1);
  let cifre = roundInteroPy(dividiPy(ohm, potenzaDi10(esp)));
  if (cifre >= 10 ** n) {
    cifre = Math.floor(cifre / 10);
    esp += 1;
  }
  if (esp < -2 || esp > 9) throw errore("valore fuori dalla gamma del codice colori");
  const molt = esp === -1 ? "oro" : esp === -2 ? "argento" : COLORI[esp];
  return [...String(cifre).padStart(n, "0")].map((d) => COLORI[Number(d)]).concat([molt]);
}

/** 4700 → "4,7 kΩ" (virgola decimale, unità adatta). */
export function formattaOhm(v) {
  for (const [unita, f] of [["MΩ", 1e6], ["kΩ", 1e3]]) {
    if (v >= f) return `${formatPy(v / f, "g")} ${unita}`.replace(/\./g, ",");
  }
  return `${formatPy(v, "g")} Ω`.replace(/\./g, ",");
}

// ======================================================================================================
// Testi della scheda «Calcolatori» (da app/tools/gpio_tools.py). I valori sono quelli dei campi.
// ======================================================================================================

export const NOTA_TENSIONI =
  "Attenzione alle tensioni: i pin dell'ESP32 (Polpo e molte schede) lavorano a 3,3 V e NON tollerano 5 V. " +
  "Arduino Uno/Nano lavorano a 5 V: per collegarli a una scheda a 3,3 V serve un adattatore di livello.";

function testoOErrore(calcola) {
  try {
    return calcola();
  } catch (e) {
    if (eValueErrorPy(e)) return e.message;
    throw e;
  }
}

/** Legge di Ohm: il campo lasciato a 0 è quello da calcolare. */
export function testoOhm(v, i, r) {
  const campo = (x) => (x === 0 ? null : x);
  return testoOErrore(() => {
    const o = ohm({ v: campo(v), i: campo(i), r: campo(r) });
    return `V = ${formatPy(o.v, ".3g")} V · I = ${formatPy(o.i * 1000, ".3g")} mA · R = ${formattaOhm(o.r)} · P = ${formatPy(o.p * 1000, ".3g")} mW`;
  });
}

/** Partitore di tensione. */
export function testoPartitore(vin, r1, r2) {
  return testoOErrore(() => `Vout = ${formatPy(partitore(vin, r1, r2), ".3f")} V`);
}

/** Resistenza per un LED. */
export function testoLed(alimentazioneV, tensioneLedV, correnteMa) {
  return testoOErrore(() => {
    const o = resistenzaLed(alimentazioneV, tensioneLedV, correnteMa);
    return (
      `Esatta ${formattaOhm(roundPy(o.esatta, 1))} · standard (E12, per eccesso) ${formattaOhm(o.standard)} · ` +
      `corrente reale ${formatPy(o.correnteMa, ".1f")} mA · potenza ${formatPy(o.potenzaW * 1000, ".0f")} mW`
    );
  });
}

/** Codice colori: `fasce` è il testo dei colori («giallo viola rosso oro»), `valore` il testo in ohm («4700» o «4,7»). */
export function testoColori(fasce, valore) {
  const parti = [];
  parti.push(
    testoOErrore(() => {
      const [o, tolleranza] = decodificaFasce(splitPy(fasce));
      return formattaOhm(o) + (tolleranza ? ` ±${formatPy(tolleranza, "g")}%` : "");
    }),
  );
  parti.push(testoOErrore(() => codificaFasce(floatPy(valore.replace(/,/g, "."))).join(" ")));
  return parti.join("  ·  ");
}
