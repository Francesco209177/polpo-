// Polpo Studio — validatore DuckyScript con le stesse regole del firmware (polpo_core/src/polpo/ducky).
// Copia JavaScript di studio/polpo_studio/protocols/ducky.py, più gli aiuti della scheda DuckyScript
// (studio/polpo_studio/app/tools/usb_tools.py).
//
// Questo modulo NON esegue gli script e non invia tasti: li controlla soltanto. Lo script parte solo dal Polpo,
// dall'app BadUSB, dopo la conferma sul suo schermo.

import { codificaUtf8, formatPy, intPy, isasciiPy, isdigitPy, lunghezzaPy, splitPy, stripPy } from "../strumenti/convertitore.js";

export const MAX_BYTE = 32 * 1024;
export const MAX_RIGHE = 2000;
export const MAX_AZIONI = 1200;
export const MAX_PAUSA_MS = 60_000;
export const MAX_RIPETIZIONI = 500;

// Modificatori e codici dei tasti HID (tabella di utilizzo "Keyboard/Keypad").
export const MOD_LCTRL = 0x01, MOD_LSHIFT = 0x02, MOD_LALT = 0x04, MOD_LGUI = 0x08, MOD_RALT = 0x40;
export const K_A = 0x04, K_1 = 0x1e, K_0 = 0x27, K_ENTER = 0x28, K_ESC = 0x29, K_BKSP = 0x2a, K_TAB = 0x2b, K_SPACE = 0x2c;
export const K_MINUS = 0x2d, K_EQUAL = 0x2e, K_LBR = 0x2f, K_RBR = 0x30, K_BSLASH = 0x31, K_NONUS_HASH = 0x32;
export const K_SEMI = 0x33, K_QUOTE = 0x34, K_GRAVE = 0x35, K_COMMA = 0x36, K_PERIOD = 0x37, K_SLASH = 0x38, K_CAPS = 0x39, K_F1 = 0x3a;
export const K_PRTSC = 0x46, K_SCROLL = 0x47, K_PAUSE = 0x48, K_INS = 0x49, K_HOME = 0x4a, K_PGUP = 0x4b, K_DEL = 0x4c, K_END = 0x4d, K_PGDN = 0x4e;
export const K_RIGHT = 0x4f, K_LEFT = 0x50, K_DOWN = 0x51, K_UP = 0x52, K_NUM = 0x53, K_NONUS_BSLASH = 0x64, K_APP = 0x65;

/** I tasti con un nome (ENTER, TAB, HOME, ...) e il loro codice. */
export const TASTI_NOMINATI = new Map(Object.entries({
  ENTER: K_ENTER, ESC: K_ESC, ESCAPE: K_ESC, TAB: K_TAB, SPACE: K_SPACE, BACKSPACE: K_BKSP,
  DELETE: K_DEL, DEL: K_DEL, INSERT: K_INS, HOME: K_HOME, END: K_END, PAGEUP: K_PGUP,
  PAGEDOWN: K_PGDN, UP: K_UP, UPARROW: K_UP, DOWN: K_DOWN, DOWNARROW: K_DOWN, LEFT: K_LEFT,
  LEFTARROW: K_LEFT, RIGHT: K_RIGHT, RIGHTARROW: K_RIGHT, CAPSLOCK: K_CAPS, NUMLOCK: K_NUM,
  SCROLLLOCK: K_SCROLL, PRINTSCREEN: K_PRTSC, PAUSE: K_PAUSE, BREAK: K_PAUSE, MENU: K_APP, APP: K_APP,
}));

/** I modificatori (CTRL, SHIFT, ALT, ALTGR, GUI...) e il loro bit. */
export const MODIFICATORI = new Map(Object.entries({
  CTRL: MOD_LCTRL, CONTROL: MOD_LCTRL, SHIFT: MOD_LSHIFT, ALT: MOD_LALT,
  ALTGR: MOD_RALT, GUI: MOD_LGUI, WINDOWS: MOD_LGUI, COMMAND: MOD_LGUI,
}));

const S = MOD_LSHIFT;
const G = MOD_RALT;
const US = new Map(Object.entries({
  "!": [S, K_1], "@": [S, K_1 + 1], "#": [S, K_1 + 2], "$": [S, K_1 + 3], "%": [S, K_1 + 4], "^": [S, K_1 + 5],
  "&": [S, K_1 + 6], "*": [S, K_1 + 7], "(": [S, K_1 + 8], ")": [S, K_0], "-": [0, K_MINUS], "_": [S, K_MINUS],
  "=": [0, K_EQUAL], "+": [S, K_EQUAL], "[": [0, K_LBR], "{": [S, K_LBR], "]": [0, K_RBR], "}": [S, K_RBR],
  "\\": [0, K_BSLASH], "|": [S, K_BSLASH], ";": [0, K_SEMI], ":": [S, K_SEMI], "'": [0, K_QUOTE], '"': [S, K_QUOTE],
  "`": [0, K_GRAVE], "~": [S, K_GRAVE], ",": [0, K_COMMA], "<": [S, K_COMMA], ".": [0, K_PERIOD], ">": [S, K_PERIOD],
  "/": [0, K_SLASH], "?": [S, K_SLASH],
}));
const IT = new Map(Object.entries({
  "!": [S, K_1], '"': [S, K_1 + 1], "£": [S, K_1 + 2], "$": [S, K_1 + 3], "%": [S, K_1 + 4], "&": [S, K_1 + 5],
  "/": [S, K_1 + 6], "(": [S, K_1 + 7], ")": [S, K_1 + 8], "=": [S, K_0], "'": [0, K_MINUS], "?": [S, K_MINUS],
  "ì": [0, K_EQUAL], "^": [S, K_EQUAL], "è": [0, K_LBR], "é": [S, K_LBR], "[": [G, K_LBR], "{": [G | S, K_LBR],
  "+": [0, K_RBR], "*": [S, K_RBR], "]": [G, K_RBR], "}": [G | S, K_RBR], "ò": [0, K_SEMI], "ç": [S, K_SEMI],
  "@": [G, K_SEMI], "à": [0, K_QUOTE], "°": [S, K_QUOTE], "#": [G, K_QUOTE], "ù": [0, K_NONUS_HASH],
  "§": [S, K_NONUS_HASH], "\\": [0, K_GRAVE], "|": [S, K_GRAVE], "<": [0, K_NONUS_BSLASH], ">": [S, K_NONUS_BSLASH],
  ",": [0, K_COMMA], ";": [S, K_COMMA], ".": [0, K_PERIOD], ":": [S, K_PERIOD], "-": [0, K_SLASH], "_": [S, K_SLASH],
  "€": [G, K_A + 4],
}));

/** I layout di tastiera conosciuti: "IT" e "US". */
export const LAYOUT = new Map([["IT", IT], ["US", US]]);

/** [modificatori, codice] per digitare il carattere `ch` con il layout (sconosciuto = US); null se non si può. */
export function cercaNelLayout(layout, ch) {
  const o = ch.codePointAt(0);
  if (ch >= "a" && ch <= "z" && ch.length === 1) return [0, K_A + o - 0x61];
  if (ch >= "A" && ch <= "Z" && ch.length === 1) return [S, K_A + o - 0x41];
  if (ch >= "1" && ch <= "9" && ch.length === 1) return [0, K_1 + o - 0x31];
  if (ch === "0") return [0, K_0];
  if (ch === " ") return [0, K_SPACE];
  if (ch === "\n") return [0, K_ENTER];
  if (ch === "\t") return [0, K_TAB];
  return (LAYOUT.get(layout) ?? US).get(ch) ?? null;
}

/** Un'azione: tipo "text", "key" o "delay", con la riga dello script da cui viene. */
function azione(tipo, riga, { testo = "", modificatori = 0, codice = 0, ms = 0 } = {}) {
  return { tipo, riga, testo, modificatori, codice, ms };
}

/**
 * Il risultato del controllo: azioni, errori ([riga, messaggio]), righe lette, totale delle pause (ms) e dei caratteri.
 * `ok` è vero se non ci sono errori.
 */
class Script {
  constructor() {
    this.azioni = [];
    this.errori = [];
    this.righe = 0;
    this.pauseTotaliMs = 0;
    this.caratteriTotali = 0;
  }

  get ok() {
    return !this.errori.length;
  }
}

function u32(s) {
  s = stripPy(s);
  return isdigitPy(s) && lunghezzaPy(s) <= 10 ? Number(intPy(s)) : null;
}

function gettoni(riga) {
  const out = [];
  let cur = "";
  for (const c of riga) {
    if (c === " " || c === "\t" || (c === "-" && cur)) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

class Analizzatore {
  constructor(layout, out) {
    this.layout = layout;
    this.out = out;
    this.no = 0;
    this.pausaPredefinita = 0;
    this.ultimo = [0, 0];
    this.traboccato = false;
  }

  errore(msg) {
    this.out.errori.push([this.no, msg]);
  }

  spazio() {
    if (this.out.azioni.length >= MAX_AZIONI) {
      if (!this.traboccato) this.errore("script troppo lungo (max 1200 azioni)");
      this.traboccato = true;
      return false;
    }
    return true;
  }

  aggiungi(a) {
    if (!this.spazio()) return;
    if (a.tipo === "delay") this.out.pauseTotaliMs += a.ms;
    if (a.tipo === "text") this.out.caratteriTotali += lunghezzaPy(a.testo);
    this.out.azioni.push(a);
  }

  riga(no, grezza) {
    this.no = no;
    const ln = stripPy(grezza);
    if (!ln) return;
    const parti = splitPy(ln, 1);
    const cmd = isasciiPy(parti[0]) ? parti[0].toUpperCase() : parti[0];
    const arg = parti.length > 1 ? ln.slice(parti[0].length + 1) : "";
    if (cmd === "REM" || cmd === "//") return;
    if (cmd === "DEFAULT_DELAY" || cmd === "DEFAULTDELAY") {
      const v = u32(arg);
      if (v === null || v > 10_000) return this.errore("DEFAULT_DELAY richiede un numero 0-10000");
      this.pausaPredefinita = v;
      return;
    }
    if (cmd === "REPEAT") {
      const n = u32(arg);
      if (n === null || !(n >= 1 && n <= MAX_RIPETIZIONI)) return this.errore("REPEAT richiede un numero 1-500");
      const [b, e] = this.ultimo;
      if (b === e) return this.errore("REPEAT senza un comando precedente");
      for (let k = 0; k < n; k++) {
        for (let i = b; i < e; i++) {
          if (!this.spazio()) return;
          const a = this.out.azioni[i];
          this.aggiungi(azione(a.tipo, no, { testo: a.testo, modificatori: a.modificatori, codice: a.codice, ms: a.ms }));
        }
      }
      return;
    }
    const inizio = this.out.azioni.length;
    if (cmd === "DELAY") {
      const v = u32(arg);
      if (v === null || v > MAX_PAUSA_MS) return this.errore("DELAY richiede un numero 0-60000");
      this.aggiungi(azione("delay", no, { ms: v }));
    } else if (cmd === "STRING" || cmd === "STRINGLN") {
      if (!this.testo(arg)) return;
      if (cmd === "STRINGLN") this.aggiungi(azione("key", no, { codice: K_ENTER }));
    } else if (!this.combinazione(ln)) return;
    if (this.pausaPredefinita && cmd !== "DELAY") this.aggiungi(azione("delay", no, { ms: this.pausaPredefinita }));
    this.ultimo = [inizio, this.out.azioni.length];
  }

  testo(s) {
    for (const ch of s) {
      if (cercaNelLayout(this.layout, ch) === null) {
        this.errore(`carattere '${ch}' non digitabile con layout ${this.layout}`);
        return false;
      }
    }
    this.aggiungi(azione("text", this.no, { testo: s }));
    return true;
  }

  combinazione(ln) {
    const toks = gettoni(ln);
    let mods = 0;
    let codice = 0;
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      const up = isasciiPy(tok) ? tok.toUpperCase() : tok;
      if (MODIFICATORI.has(up)) {
        mods |= MODIFICATORI.get(up);
        continue;
      }
      if (i + 1 !== toks.length || codice) {
        this.errore(`comando sconosciuto: ${tok}`);
        return false;
      }
      if (TASTI_NOMINATI.has(up)) {
        codice = TASTI_NOMINATI.get(up);
        continue;
      }
      if (lunghezzaPy(up) >= 2 && up[0] === "F" && isdigitPy(up.slice(1))) {
        const f = intPy(up.slice(1));
        if (f >= 1n && f <= 12n) {
          codice = K_F1 + Number(f) - 1;
          continue;
        }
      }
      if (lunghezzaPy(tok) === 1) {
        const ch = tok >= "A" && tok <= "Z" ? tok.toLowerCase() : tok;
        const ks = cercaNelLayout(this.layout, ch);
        if (ks) {
          mods |= ks[0];
          codice = ks[1];
          continue;
        }
      }
      this.errore(`comando sconosciuto: ${tok}`);
      return false;
    }
    if (!toks.length) return false;
    this.aggiungi(azione("key", this.no, { modificatori: mods, codice }));
    return true;
  }
}

/** Controlla uno script DuckyScript con il layout indicato ("IT" o "US"; altri valori = "US"). Non lo esegue. */
export function analizza(sorgente, layout = "IT") {
  const out = new Script();
  if (codificaUtf8(sorgente).length > MAX_BYTE) {
    out.errori.push([0, "file troppo grande (max 32 KB)"]);
    return out;
  }
  const p = new Analizzatore(LAYOUT.has(layout) ? layout : "US", out);
  const righe = sorgente.split("\n");
  if (righe.length && righe[righe.length - 1] === "") righe.pop();
  for (let i = 0; i < righe.length; i++) {
    const no = i + 1;
    if (no > MAX_RIGHE) {
      out.errori.push([no, "troppe righe (max 2000)"]);
      break;
    }
    p.riga(no, righe[i]);
  }
  out.righe = Math.min(righe.length, MAX_RIGHE + 1);
  return out;
}

/** Durata stimata in secondi: pause + caratteri × `msPerCarattere` + 20 ms per ogni tasto. */
export function stimaSecondi(s, msPerCarattere = 12) {
  return (s.pauseTotaliMs + s.caratteriTotali * msPerCarattere + s.azioni.filter((a) => a.tipo === "key").length * 20) / 1000;
}

// ======================================================================================================
// Aiuti della scheda DuckyScript (da app/tools/usb_tools.py): solo testi e nomi, nessuna esecuzione.
// ======================================================================================================

export const AVVISO =
  "Scrivi e controlla uno script per la tastiera del Polpo. Polpo Studio NON lo esegue: lo copia sulla microSD e parte solo dal Polpo, " +
  "dopo la sua conferma. Usalo solo sui tuoi computer.";

/** Lo script di esempio della scheda. */
export const ESEMPIO = "REM Apre il Blocco note e scrive un saluto (Windows)\nDELAY 500\nGUI r\nDELAY 300\nSTRING notepad\nENTER\nDELAY 700\nSTRINGLN Ciao dal Polpo!\n";

/** Il pulsante «Controlla»: {script, testo} con il riassunto o le righe con gli errori. */
export function esitoControllo(sorgente, layout) {
  const s = analizza(sorgente, layout);
  const testo = s.ok
    ? `Valido: ${s.azioni.length} azioni, ${s.caratteriTotali} caratteri, pause totali ${formatPy(s.pauseTotaliMs / 1000, ".1f")} s, ` +
      `durata stimata ${formatPy(stimaSecondi(s), ".1f")} s (layout ${layout}).`
    : s.errori.map(([n, m]) => `Riga ${n}: ${m}`).join("\n");
  return { script: s, testo };
}

/** Il nome del file sulla microSD dal nome scritto dall'utente: {nome: "x.txt"} oppure {errore}. */
export function nomeFileScript(nome) {
  const n = stripPy(nome).replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 40);
  if (!n) return { errore: "Scrivi un nome per lo script." };
  return { nome: n + ".txt" };
}

/** Dove il Polpo salva lo script (cartella dell'app BadUSB). */
export function percorsoSulPolpo(nomeFile) {
  return `/polpo/badusb/${nomeFile}`;
}

/**
 * «Salva nella cassaforte»: {ok: false, errore} se manca il nome, {ok: false, script} se lo script ha errori (la pagina
 * mostra già le righe sbagliate), altrimenti {ok: true, categoria, nome, contenuto (byte UTF-8), meta, messaggio}.
 */
export function salvataggioScript(nome, sorgente, layout) {
  const file = nomeFileScript(nome);
  if (file.errore) return { ok: false, errore: file.errore };
  const controllo = esitoControllo(sorgente, layout);
  if (!controllo.script.ok) return { ok: false, script: controllo.script, testo: controllo.testo };
  return {
    ok: true,
    categoria: "altro",
    nome: file.nome,
    contenuto: codificaUtf8(sorgente),
    meta: { tipo: "duckyscript", layout },
    messaggio: "Script salvato nella cassaforte.",
  };
}

/**
 * Prepara «Copia sul Polpo…»: {ok: false, errore} se manca il nome o lo script ha errori, altrimenti
 * {ok: true, destinazione, contenuto (byte UTF-8 del file), attesa}. Il file si scrive con la conferma sul Polpo;
 * lo script parte solo dall'app BadUSB del Polpo.
 */
export function preparaCopia(nome, sorgente, layout) {
  const file = nomeFileScript(nome);
  if (file.errore) return { ok: false, errore: file.errore };
  if (!analizza(sorgente, layout).ok) return { ok: false, errore: "Correggi prima gli errori." };
  const destinazione = percorsoSulPolpo(file.nome);
  return { ok: true, destinazione, contenuto: codificaUtf8(sorgente), attesa: "Conferma sullo schermo del Polpo per salvare lo script…" };
}

/** Dopo la copia: {messaggio, attivita}. */
export function esitoCopia(destinazione, simulato) {
  return {
    messaggio: `Copiato in ${destinazione}. Per eseguirlo usa l'app BadUSB sul Polpo.` + (simulato ? " · SIMULATO" : ""),
    attivita: `Script copiato sul Polpo: ${destinazione}`,
  };
}
