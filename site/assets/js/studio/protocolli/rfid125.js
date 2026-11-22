// Polpo Studio — tessere 125 kHz (EM4100/EM4102): formati del codice, Wiegand 26, trame del modulo RDM6300.
// Copia JavaScript di studio/polpo_studio/protocols/rfid125.py, più gli aiuti della pagina RFID
// (studio/polpo_studio/app/tools/rfid_tools.py). Solo lettura e conversione: niente scrittura su T5577, niente copie.
//
// Una tessera EM4100 contiene 40 bit: 8 bit di "versione" (o cliente) e 32 bit di numero. I lettori
// "tipo tastiera" di solito scrivono i 32 bit in decimale (10 cifre) seguiti da Invio; sulle tessere
// si trova spesso anche il formato Wiegand 26 "impianto,numero" (8 + 16 bit).

import {
  decodificaAscii,
  errorePy,
  escapeHtml,
  eValueErrorPy,
  formatIntPy,
  formatPy,
  formattaData,
  fromhexPy,
  hexPy,
  interoDaByte,
  interoInByte,
  intPy,
  isdigitPy,
  lunghezzaPy,
  prendiPy,
  stripPy,
  veroPy,
} from "../strumenti/convertitore.js";

/** Un codice EM4100: `versione` (8 bit) e `numero` (32 bit), interi. */
export class Em4100 {
  constructor(versione, numero) {
    this.versione = versione;
    this.numero = numero;
    Object.freeze(this);
  }

  /** I 40 bit come intero (con le regole di Python anche per valori fuori gamma). */
  get valore() {
    return Number((BigInt(this.versione) << 32n) | BigInt(this.numero));
  }

  /** 10 cifre esadecimali maiuscole. */
  get esadecimale() {
    return formatIntPy(this.valore, "010X");
  }

  /** I 32 bit del numero in decimale, 10 cifre. */
  get decimale10() {
    return formatIntPy(this.numero, "010d");
  }

  /** [impianto, numero] dai 24 bit bassi. */
  get w26() {
    const n = BigInt(this.numero);
    return [Number((n >> 16n) & 0xffn), Number(n & 0xffffn)];
  }

  get testoW26() {
    const [fc, cn] = this.w26;
    return `${formatIntPy(fc, "03d")},${formatIntPy(cn, "05d")}`;
  }

  /** I 26 bit Wiegand con le parità (pari sui primi 12, dispari sugli ultimi 12). */
  get bitW26() {
    const [fc, cn] = this.w26;
    const bit = formatIntPy((fc << 16) | cn, "024b");
    const uni = (s) => s.split("").filter((c) => c === "1").length;
    const pari = uni(bit.slice(0, 12)) % 2;
    const dispari = 1 - (uni(bit.slice(12)) % 2);
    return `${pari}${bit}${dispari}`;
  }
}

/** Riconosce il formato di un codice scritto (dal lettore o a mano). Restituisce [codice o null, formato]. */
export function analizzaCodice(testo) {
  const t = stripPy(testo).split(" ").join("");
  if (!t) return [null, ""];
  if (t.includes(",")) {
    const k = t.indexOf(",");
    const a = t.slice(0, k);
    const b = t.slice(k + 1);
    if (isdigitPy(a) && isdigitPy(b) && intPy(a) < 256n && intPy(b) < 65536n) {
      return [new Em4100(0, Number((intPy(a) << 16n) | intPy(b))), "Wiegand 26 (impianto,numero)"];
    }
    return [null, ""];
  }
  const c = Array.from(t);
  if (isdigitPy(t) && c.length === 10 && intPy(t) < 2n ** 32n) return [new Em4100(0, Number(intPy(t))), "decimale a 10 cifre (32 bit)"];
  if (isdigitPy(t) && c.length === 8) {
    const fc = c.slice(0, 3).join("");
    const cn = c.slice(3).join("");
    if (intPy(fc) < 256n && intPy(cn) < 65536n) return [new Em4100(0, Number((intPy(fc) << 16n) | intPy(cn))), "8 cifre (impianto + numero)"];
  }
  let v;
  try {
    v = intPy(t, 16);
  } catch (e) {
    if (e.tipo === "ValueError") return [null, ""];
    throw e;
  }
  if (c.length === 10) return [new Em4100(Number(v >> 32n), Number(v & 0xffffffffn)), "esadecimale a 10 cifre (40 bit)"];
  if (c.length === 8) return [new Em4100(0, Number(v)), "esadecimale a 8 cifre (32 bit)"];
  return [null, ""];
}

// ---------------- RDM6300 ----------------

/** Trame: 0x02, 10 caratteri esadecimali (5 byte), 2 caratteri di controllo (XOR), 0x03. */
export class ParserRdm6300 {
  constructor() {
    this._buf = [];
    this.trameScartate = 0;
  }

  /** Aggiunge i byte arrivati dalla seriale; restituisce le tessere lette nelle trame complete. */
  alimenta(dati) {
    const out = [];
    for (const b of dati) this._buf.push(b);
    for (;;) {
      const inizio = this._buf.indexOf(0x02);
      if (inizio < 0) {
        this._buf = [];
        return out;
      }
      if (inizio) this._buf.splice(0, inizio);
      if (this._buf.length < 14) return out;
      const trama = this._buf.slice(0, 14);
      if (trama[13] !== 0x03) {
        this.trameScartate += 1;
        this._buf.splice(0, 1);
        continue;
      }
      this._buf.splice(0, 14);
      let payload;
      let controllo;
      try {
        if (trama.slice(1, 13).some((b) => b >= 0x80)) throw errorePy("UnicodeDecodeError", "byte non ASCII");
        payload = fromhexPy(decodificaAscii(trama.slice(1, 11)));
        controllo = intPy(decodificaAscii(trama.slice(11, 13)), 16);
      } catch (e) {
        if (!eValueErrorPy(e)) throw e;
        this.trameScartate += 1;
        continue;
      }
      let x = 0;
      for (const b of payload) x ^= b;
      if (BigInt(x) !== controllo) {
        this.trameScartate += 1;
        continue;
      }
      if (!payload.length) throw errorePy("IndexError", "index out of range");
      out.push(new Em4100(payload[0], Number(interoDaByte(payload.subarray(1)))));
    }
  }
}

/** Costruisce una trama RDM6300 per una tessera (serve alle prove del modulo). */
export function tramaRdm6300(carta) {
  const payload = interoInByte(carta.valore, 5);
  let x = 0;
  for (const b of payload) x ^= b;
  const testo = hexPy(payload).toUpperCase() + formatIntPy(x, "02X");
  return Uint8Array.from([0x02, ...Array.from(testo, (c) => c.charCodeAt(0)), 0x03]);
}

// ---------------- lettori "tipo tastiera" ----------------

/** Una raffica di tasti fino all'Invio: testo, durata e pausa più lunga tra due tasti (millisecondi). */
export class Raffica {
  constructor(testo, durataMs, pausaMaxMs) {
    this.testo = testo;
    this.durataMs = durataMs;
    this.pausaMaxMs = pausaMaxMs;
  }

  /** Un lettore scrive tutto in pochi millisecondi; una persona è molto più lenta. */
  get sembraLettore() {
    return lunghezzaPy(this.testo) >= 8 && this.pausaMaxMs < 40 && this.durataMs < 400;
  }
}

/** `caratteri`: [carattere, istante in secondi] fino all'Invio escluso. */
export function rafficaDaTempi(caratteri) {
  if (!caratteri.length) return new Raffica("", 0, 0);
  const tempi = caratteri.map(([, t]) => t);
  const pause = tempi.slice(1).map((b, k) => (b - tempi[k]) * 1000);
  if (!pause.length) pause.push(0);
  return new Raffica(caratteri.map(([c]) => c).join(""), (tempi[tempi.length - 1] - tempi[0]) * 1000, pause.reduce((m, p) => (p > m ? p : m)));
}

// ======================================================================================================
// Aiuti della pagina RFID 125 kHz (da app/tools/rfid_tools.py): testi e HTML, niente interfaccia.
// ======================================================================================================

/** Nota fissa della pagina. */
export const NOTA_ESCLUSIONI =
  "Scrittura su T5577 e copia di tessere: non disponibili (i lettori previsti non scrivono; la copia è esclusa per scelta).";

/** I testi fissi delle schede della pagina. */
export const TESTI_PAGINA = Object.freeze({
  lettoreUsb:
    "I lettori USB economici «scrivono» il codice come una tastiera. Polpo Studio misura la velocità: un lettore scrive tutto in pochi millisecondi.",
  campoLettore: "Fai clic qui e avvicina la tessera al lettore USB…",
  campoNome: "Nome (es. «badge palestra mio»)",
  supportoProva: "È un supporto di prova",
  rdm6300: "Modulo RDM6300 collegato a un adattatore USB-seriale (TX del modulo → RX dell'adattatore, 5 V, 9600 baud).",
  formati: "Scrivi il codice stampato sulla TUA tessera: 10 cifre decimali, 10 esadecimali, oppure «impianto,numero».",
  primaLeggi: "Leggi prima una tessera.",
});

/** L'HTML del risultato (show_card): formati della tessera, fonte e formato riconosciuto. */
export function rendiTessera(carta, fonte, formato = "") {
  const [fc, cn] = carta.w26;
  return (
    `<b>EM4100</b> · ${escapeHtml(fonte)}` +
    (formato ? ` · ${escapeHtml(formato)}` : "") +
    "<table cellspacing='4'>" +
    `<tr><td>Esadecimale (40 bit)</td><td><tt>${carta.esadecimale}</tt></td></tr>` +
    `<tr><td>Decimale (32 bit)</td><td><tt>${carta.decimale10}</tt></td></tr>` +
    `<tr><td>Wiegand 26</td><td><tt>${carta.testoW26}</tt> (impianto ${fc}, numero ${cn})</td></tr>` +
    `<tr><td>Bit Wiegand</td><td><tt>${carta.bitW26}</tt></td></tr></table>`
  );
}

/**
 * Una raffica dal lettore USB (on_burst). `lettoreDichiarato`: il lettore USB è già dichiarato nelle impostazioni.
 * Restituisce {carta, fonte, formato, html, messaggi}; `messaggi` sono [testo, errore] nell'ordine in cui la pagina li mostra.
 */
export function esitoRaffica(raffica, lettoreDichiarato) {
  const [carta, formato] = analizzaCodice(raffica.testo);
  if (carta === null) return { carta: null, messaggi: [[`«${raffica.testo}» non è un codice 125 kHz riconosciuto.`, true]] };
  const messaggi = [];
  let fonte;
  if (raffica.sembraLettore) {
    fonte = `lettore USB (${formatPy(raffica.durataMs, ".0f")} ms)`;
    messaggi.push(["Tessera letta.", false]);
    if (!lettoreDichiarato) messaggi.push(["Tessera letta. Sembra un lettore USB: puoi dichiararlo in Impostazioni › Hardware.", false]);
  } else {
    fonte = "digitato a mano?";
    messaggi.push(["Codice accettato, ma è arrivato lentamente: sembra digitato a mano, non da un lettore.", false]);
  }
  return { carta, fonte, formato, html: rendiTessera(carta, fonte, formato), messaggi };
}

/** Il convertitore di formati (convert): {carta, fonte, formato, html} oppure {carta: null, errore}. */
export function esitoConversione(testo) {
  const [carta, formato] = analizzaCodice(testo);
  if (carta === null) return { carta: null, errore: "Formato non riconosciuto." };
  const fonte = "scritto a mano";
  return { carta, fonte, formato, html: rendiTessera(carta, fonte, formato) };
}

/** Byte arrivati dall'RDM6300 (rdm_feed): tessere lette, messaggi e il contatore delle trame scartate. */
export function esitoRdm6300(parser, dati) {
  const tessere = [];
  const messaggi = [];
  for (const carta of parser.alimenta(dati)) {
    const formato = "trama con controllo XOR valido";
    tessere.push({ carta, fonte: "RDM6300", formato, html: rendiTessera(carta, "RDM6300", formato) });
    messaggi.push(["Tessera letta dall'RDM6300.", false]);
  }
  return { tessere, messaggi, info: `Trame scartate (controllo errato): ${parser.trameScartate}` };
}

/**
 * Il salvataggio nella cassaforte (save_card): {ok: false, errore} se non c'è una tessera letta, altrimenti
 * {ok: true, nome, dati, testo, meta, attivita, messaggio}; `testo` è il JSON da cifrare (come json.dumps(indent=2)).
 * `fonte` è da dove arriva la tessera, `prova` la casella «supporto di prova», `nome` il testo del campo nome
 * (vuoto: "tessera-<hex>"), `adesso` un Date (ora locale).
 */
export function salvataggioTessera(carta, fonte, prova, nome, adesso) {
  if (carta === null || carta === undefined) return { ok: false, errore: "Leggi prima una tessera." };
  const n = stripPy(nome) || `tessera-${carta.esadecimale}`;
  const dati = {
    formato: "EM4100",
    hex: carta.esadecimale,
    decimale: carta.decimale10,
    w26: carta.testoW26,
    fonte,
    supporto_di_prova: prova,
    letto_il: formattaData("%Y-%m-%d %H:%M", adesso),
  };
  return {
    ok: true,
    nome: n + ".json",
    dati,
    testo: JSON.stringify(dati, null, 2),
    meta: { hex: carta.esadecimale, prova },
    attivita: `Tessera 125 kHz salvata: ${n}`,
    messaggio: "Salvata nella cassaforte.",
  };
}

/** Una riga dell'archivio: [nome, esadecimale, W26, prova]. `meta` è quello salvato con la tessera. */
export function rigaArchivioTessera(nome, meta) {
  const [carta] = analizzaCodice(prendiPy(meta, "hex", ""));
  return [nome, prendiPy(meta, "hex", ""), carta ? carta.testoW26 : "", veroPy(prendiPy(meta, "prova")) ? "sì" : ""];
}

/** Il report HTML delle tessere salvate. `voci`: [{nome, meta}]; `adesso` è un Date (ora locale). */
export function reportTessere(voci, adesso) {
  const righe = [];
  for (const v of voci) {
    const [carta] = analizzaCodice(prendiPy(v.meta, "hex", ""));
    if (carta) {
      righe.push(
        `<tr><td>${escapeHtml(v.nome)}</td><td><tt>${carta.esadecimale}</tt></td><td><tt>${carta.decimale10}</tt></td><td><tt>${carta.testoW26}</tt></td><td>${veroPy(prendiPy(v.meta, "prova")) ? "sì" : ""}</td></tr>`,
      );
    }
  }
  return (
    "<!doctype html><meta charset='utf-8'><title>Report RFID 125 kHz</title><style>body{font-family:sans-serif;margin:2em}td,th{border-bottom:1px solid #ccc;padding:4px 8px}</style>" +
    `<h1>Tessere 125 kHz</h1><p>${formattaData("%d/%m/%Y %H:%M", adesso)} · solo tessere proprie.</p><table><tr><th>Nome</th><th>Esadecimale</th><th>Decimale</th><th>W26</th><th>Prova</th></tr>${righe.join("")}</table>`
  );
}
