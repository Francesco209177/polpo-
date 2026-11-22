// Polpo — simulatore: carica il firmware vero compilato in WebAssembly (polpo/sim) e ne espone le funzioni.
// Questo file non scarica nulla: riceve i byte del modulo da chi lo usa (la pagina del sito, le prove, altri programmi).

export const LARGHEZZA = 240;
export const ALTEZZA = 135;

// Disposizione della tastiera del Cardputer: 4 file da 14 tasti. I caratteri di controllo indicano i tasti speciali.
export const TASTI = [
  ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "canc"],
  ["tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\"],
  ["fn", "maiusc", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "ok"],
  ["ctrl", "opt", "alt", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "spazio"],
];
export const TASTI_MAIUSC = [
  ["~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+", "canc"],
  ["tab", "Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "{", "}", "|"],
  ["fn", "maiusc", "A", "S", "D", "F", "G", "H", "J", "K", "L", ":", '"', "ok"],
  ["ctrl", "opt", "alt", "Z", "X", "C", "V", "B", "N", "M", "<", ">", "?", "spazio"],
];
const ALIAS = { indietro: "`", su: ";", giu: ".", sinistra: ",", destra: "/" };

/** Dove sta un tasto: per nome («ok», «indietro», «su»…) o per carattere. Restituisce {fila, colonna, maiuscolo} o null. */
export function postoDelTasto(nome) {
  const cercato = ALIAS[nome] ?? (nome === " " ? "spazio" : nome === "\n" ? "ok" : nome === "\t" ? "tab" : nome === "\b" ? "canc" : nome);
  for (const [tabella, maiuscolo] of [[TASTI, false], [TASTI_MAIUSC, true]]) {
    for (let f = 0; f < 4; f++) {
      const c = tabella[f].indexOf(cercato);
      if (c >= 0) return { fila: f, colonna: c, maiuscolo };
    }
  }
  return null;
}

/**
 * Crea un Polpo simulato.
 * @param {BufferSource | WebAssembly.Module} modulo  i byte di polpo-sim.wasm (o il modulo già compilato)
 * @param {{suTesto?: (riga: string) => void}} [o]    dove mandare ciò che il programma stampa (di norma nulla)
 */
export async function creaPolpo(modulo, { suTesto = () => {} } = {}) {
  let mem;
  const dec = new TextDecoder(), enc = new TextEncoder();
  const wasi = {
    fd_write(fd, iov, n, scritti) {
      const dv = new DataView(mem.buffer);
      let tot = 0, testo = "";
      for (let i = 0; i < n; i++) {
        const p = dv.getUint32(iov + 8 * i, true), l = dv.getUint32(iov + 8 * i + 4, true);
        testo += dec.decode(new Uint8Array(mem.buffer, p, l));
        tot += l;
      }
      dv.setUint32(scritti, tot, true);
      if (testo) suTesto(testo);
      return 0;
    },
    proc_exit(codice) { throw new Error(`il firmware simulato si è fermato (codice ${codice})`); },
  };
  // qualunque altra funzione di sistema richiesta dal modulo risponde «non disponibile»: il simulatore non tocca
  // file, rete o orologio del computer
  const nonDisponibile = (t) => new Proxy(t, { get: (o, k) => o[k] ?? (() => 52) });
  const compilato = modulo instanceof WebAssembly.Module ? modulo : await WebAssembly.compile(modulo);
  const { exports: x } = await WebAssembly.instantiate(compilato, {
    wasi_snapshot_preview1: nonDisponibile(wasi),
    env: nonDisponibile({ emscripten_notify_memory_growth() {} }),
  });
  mem = x.memory;
  if (x._initialize) x._initialize();

  const leggiTesto = (p) => {
    if (!p) return null;
    const b = new Uint8Array(mem.buffer);
    let fine = p;
    while (b[fine]) fine++;
    return dec.decode(b.subarray(p, fine));
  };
  const conDati = (dati, fn) => {
    const p = x.sim_alloca(Math.max(1, dati.length));
    new Uint8Array(mem.buffer, p, dati.length).set(dati);
    try { return fn(p, dati.length); } finally { x.sim_libera(p); }
  };

  return {
    avvia: () => x.sim_avvia(),
    avanza: (ms) => x.sim_avanza(Math.max(0, Math.round(ms))),
    ora: () => x.sim_ora() >>> 0,
    occupato: () => x.sim_occupato() >>> 0,
    tasto: (fila, colonna, premuto) => x.sim_tasto(fila, colonna, premuto ? 1 : 0),
    g0: () => x.sim_g0(),
    /** Lo schermo: 240×135 punti a 16 bit (RGB565, byte alto per primo). La vista vale fino alla prossima chiamata. */
    schermo: () => new Uint8Array(mem.buffer, x.sim_schermo(), LARGHEZZA * ALTEZZA * 2),
    impronta: () => x.sim_impronta_schermo() >>> 0,
    /** Comando al mondo simulato (oggetto o testo JSON); restituisce la risposta come oggetto. */
    mondo(comando) {
      const testo = typeof comando === "string" ? comando : JSON.stringify(comando);
      return JSON.parse(this.mondoTesto(testo));
    },
    mondoTesto: (testo) => conDati(enc.encode(testo + "\0"), (p) => leggiTesto(x.sim_mondo(p))),
    /** Prossimo evento (oggetto) oppure null. */
    evento() {
      const t = leggiTesto(x.sim_evento());
      return t === null ? null : JSON.parse(t);
    },
    eventoTesto: () => leggiTesto(x.sim_evento()),
    serialeScrivi: (dati) => conDati(typeof dati === "string" ? enc.encode(dati) : dati, (p, n) => x.sim_seriale_scrivi(p, n)),
    serialeLeggi() {
      let testo = "";
      const p = x.sim_alloca(4096);
      try {
        for (let n; (n = x.sim_seriale_leggi(p, 4096)) > 0; ) testo += dec.decode(new Uint8Array(mem.buffer, p, n), { stream: true });
      } finally { x.sim_libera(p); }
      return testo;
    },
    /** microSD e impostazioni in un blocco di byte, da conservare fuori dal simulatore. */
    statoEsporta() {
      const pn = x.sim_alloca(4);
      try {
        const p = x.sim_stato_esporta(pn);
        const n = new DataView(mem.buffer).getUint32(pn, true);
        return new Uint8Array(mem.buffer, p, n).slice();
      } finally { x.sim_libera(pn); }
    },
    /** Da chiamare prima di avvia(). Restituisce false se il blocco non è valido (e non cambia nulla). */
    statoImporta: (dati) => conDati(dati, (p, n) => x.sim_stato_importa(p, n) === 1),
  };
}
