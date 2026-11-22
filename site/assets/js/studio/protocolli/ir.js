// Polpo Studio — segnali infrarossi: protocolli, file .ir, libreria di codici pubblici (come il firmware).
// Porting di studio/polpo_studio/protocols/ir.py, più le parti di logica pura del modulo Infrarossi
// (studio/polpo_studio/app/tools/ir_tools.py) che servono all'interfaccia: tasti della libreria,
// argomenti per Polpo Link, conversione dell'evento `ir.learned`, testi mostrati.

import {
  ErroreChiave,
  ErroreFormato,
  ErroreValore,
  byteEsa,
  daByte,
  decimaleDaTesto,
  dividi,
  elementiPy,
  esaMaiuscolo,
  inByte,
  interoDa,
  interoDaTesto,
  intestazione,
  leggiByteEsa,
  leggiFf,
  prendi,
  reprTesto,
  riga,
  soloCifre,
  spostaDestra,
  testoPy,
  togliSpazi,
  veroPy,
  virgolaFissa,
} from "./flipper.js";

export const MAX_TEMPI_RAW = 1024;
export const MAX_TEMPO_RAW_US = 100_000;
export const MAX_TOTALE_RAW_US = 2_000_000;

/** Un protocollo IR: nome, bit dell'indirizzo e del comando, frequenza portante in Hz. */
export class Protocollo {
  constructor(nome, bitIndirizzo, bitComando, frequenza) {
    this.nome = nome;
    this.bitIndirizzo = bitIndirizzo;
    this.bitComando = bitComando;
    this.frequenza = frequenza;
    Object.freeze(this);
  }
}

/** I protocolli gestiti, per nome in minuscolo. */
export const PROTOCOLLI = Object.freeze(
  Object.assign(
    Object.create(null),
    Object.fromEntries(
      [
        new Protocollo("NEC", 8, 8, 38000),
        new Protocollo("NECext", 16, 16, 38000),
        new Protocollo("NEC42", 13, 8, 38000),
        new Protocollo("NEC42ext", 26, 16, 38000),
        new Protocollo("Samsung32", 8, 8, 38000),
        new Protocollo("RC5", 5, 6, 36000),
        new Protocollo("RC5X", 5, 7, 36000),
        new Protocollo("RC6", 8, 8, 36000),
        new Protocollo("SIRC", 5, 7, 40000),
        new Protocollo("SIRC15", 8, 7, 40000),
        new Protocollo("SIRC20", 13, 7, 40000),
        new Protocollo("Kaseikyo", 26, 10, 37000),
        new Protocollo("RCA", 4, 8, 56000),
        new Protocollo("Pioneer", 8, 8, 40000),
      ].map((p) => [p.nome.toLowerCase(), p]),
    ),
  ),
);

/** Il protocollo con questo nome (maiuscole e minuscole indifferenti), oppure `null`. */
export function protocollo(nome) {
  const k = nome.toLowerCase();
  return Object.hasOwn(PROTOCOLLI, k) ? PROTOCOLLI[k] : null;
}

/** Un tasto: codice di un protocollo (indirizzo e comando) oppure RAW (tempi in µs, portante, duty cycle). */
export class Segnale {
  constructor(
    nome,
    { raw = false, protocollo = "", indirizzo = 0, comando = 0, frequenza = 38000, duty = 0.33, tempi = [] } = {},
  ) {
    this.nome = nome;
    this.raw = raw;
    this.protocollo = protocollo;
    this.indirizzo = indirizzo;
    this.comando = comando;
    this.frequenza = frequenza;
    this.duty = duty;
    this.tempi = tempi;
  }

  /** Testo vuoto se il segnale è valido, altrimenti il motivo. */
  valida() {
    if (!veroPy(this.nome)) return "nome mancante";
    if (veroPy(this.raw)) {
      if (!this.tempi.length) return "nessun tempo nei dati RAW";
      if (this.tempi.length > MAX_TEMPI_RAW) return "troppi tempi (max 1024)";
      if (!(10_000 <= this.frequenza && this.frequenza <= 100_000)) return "frequenza portante fuori range (10-100 kHz)";
      if (!(0.0 < this.duty && this.duty < 1.0)) return "duty cycle non valido";
      if (this.tempi.some((t) => t <= 0 || t > MAX_TEMPO_RAW_US)) return "tempo RAW fuori range (max 100 ms)";
      let somma = 0;
      for (const t of this.tempi) somma += Number(t);
      if (somma > MAX_TOTALE_RAW_US) return "segnale RAW troppo lungo (max 2 s)";
      return "";
    }
    const p = protocollo(this.protocollo);
    if (p === null) return "protocollo sconosciuto";
    if (veroPy(spostaDestra(this.indirizzo, p.bitIndirizzo))) return `indirizzo troppo grande per ${p.nome}`;
    if (veroPy(spostaDestra(this.comando, p.bitComando))) return `comando troppo grande per ${p.nome}`;
    return "";
  }

  /** Argomenti per `ir.send` di Polpo Link (le chiavi sono quelle del protocollo). */
  argomentiLink() {
    if (veroPy(this.raw)) return { raw: true, frequency: this.frequenza, duty: this.duty, timings: [...this.tempi] };
    const p = protocollo(this.protocollo);
    return { protocol: p ? p.nome : this.protocollo, address: this.indirizzo, command: this.comando };
  }
}

/** Contenuto di un file .ir: i tasti validi e gli avvisi per quelli saltati. */
export class FileIr {
  constructor(tipoFile = "IR signals file", segnali = [], avvisi = []) {
    this.tipoFile = tipoFile;
    this.segnali = segnali;
    this.avvisi = avvisi;
  }
}

/** Legge un file .ir. Lancia ErroreFormato se non è un file infrarossi; i tasti non validi diventano avvisi. */
export function leggiIr(testo) {
  const doc = leggiFf(testo);
  if (doc.tipoFile !== "IR signals file" && doc.tipoFile !== "IR library file") {
    throw new ErroreFormato(`non è un file infrarossi (Filetype: ${doc.tipoFile})`);
  }
  const out = new FileIr(doc.tipoFile);
  let cur = null;
  let cattivo = false;
  const chiudi = () => {
    if (cur !== null && !cattivo) {
      const perche = cur.valida();
      if (perche) out.avvisi.push(`"${cur.nome}" saltato: ${perche}`);
      else out.segnali.push(cur);
    }
  };
  for (const [chiave, valore] of doc.righe) {
    if (chiave === "name") {
      chiudi();
      cur = new Segnale(valore);
      cattivo = false;
      continue;
    }
    if (cur === null || cattivo) continue;
    const salta = (perche) => {
      out.avvisi.push(`"${cur.nome}" saltato: ${perche}`);
      cattivo = true;
    };
    if (chiave === "type") {
      if (valore === "raw" || valore === "parsed") cur.raw = valore === "raw";
      else salta(`tipo ${valore}`);
    } else if (chiave === "protocol") {
      const p = protocollo(valore);
      if (p === null) salta(`protocollo ${valore} non supportato`);
      else cur.protocollo = p.nome;
    } else if (chiave === "address" || chiave === "command") {
      const b = leggiByteEsa(valore);
      if (b === null || b.length !== 4) salta(`${chiave} non valido`);
      else cur[chiave === "address" ? "indirizzo" : "comando"] = daByte(b, "little");
    } else if (chiave === "frequency") {
      if (soloCifre(valore)) cur.frequenza = interoDaTesto(valore);
      else salta("frequenza non valida");
    } else if (chiave === "duty_cycle") {
      try {
        cur.duty = decimaleDaTesto(valore);
      } catch (e) {
        if (!(e instanceof ErroreValore)) throw e;
        salta("duty cycle non valido");
      }
    } else if (chiave === "data") {
      for (const tok of dividi(valore)) {
        if (!soloCifre(tok)) {
          salta("dato RAW non numerico");
          break;
        }
        cur.tempi.push(interoDaTesto(tok));
      }
    }
  }
  chiudi();
  return out;
}

/** Scrive un file .ir (il duty cycle con 6 decimali, indirizzo e comando su 4 byte little-endian). */
export function scriviIr(f) {
  let out = intestazione(f.tipoFile);
  for (const s of f.segnali) {
    out += "#\n" + riga("name", s.nome);
    if (veroPy(s.raw)) {
      out += riga("type", "raw") + riga("frequency", s.frequenza) + riga("duty_cycle", virgolaFissa(s.duty, 6));
      out += riga("data", s.tempi.map(testoPy).join(" "));
    } else {
      out += riga("type", "parsed") + riga("protocol", s.protocollo);
      out += riga("address", byteEsa(inByte(s.indirizzo, 4, "little")));
      out += riga("command", byteEsa(inByte(s.comando, 4, "little")));
    }
  }
  return out;
}

// ---------------- libreria ----------------

/** Nomi dei tasti della libreria. */
export const TASTI = Object.freeze({
  power: "Accendi / spegni",
  vol_up: "Volume +",
  vol_down: "Volume -",
  mute: "Muto",
  ch_up: "Canale +",
  ch_down: "Canale -",
});
/** Categorie della libreria. */
export const CATEGORIE = Object.freeze({ tv: "Televisori", audio: "Audio" });

/** Un codice pubblico della libreria. */
export class CodiceLibreria {
  constructor(categoria, marca, tasto, protocollo, indirizzo, comando) {
    this.categoria = categoria;
    this.marca = marca;
    this.tasto = tasto;
    this.protocollo = protocollo;
    this.indirizzo = indirizzo;
    this.comando = comando;
    Object.freeze(this);
  }

  /** Il segnale da inviare, chiamato «marca tasto» (es. "LG power"). */
  segnale() {
    return new Segnale(`${this.marca} ${this.tasto}`, {
      protocollo: this.protocollo,
      indirizzo: this.indirizzo,
      comando: this.comando,
    });
  }
}

// Stessa tabella di polpo/lib/polpo_core/src/polpo/ir/ir_library.cpp: codici pubblici molto diffusi.
export const LIBRERIA = Object.freeze(
  [
    ["tv", "Samsung", "power", "Samsung32", 0x07, 0x02],
    ["tv", "Samsung", "vol_up", "Samsung32", 0x07, 0x07],
    ["tv", "Samsung", "vol_down", "Samsung32", 0x07, 0x0b],
    ["tv", "Samsung", "mute", "Samsung32", 0x07, 0x0f],
    ["tv", "Samsung", "ch_up", "Samsung32", 0x07, 0x12],
    ["tv", "Samsung", "ch_down", "Samsung32", 0x07, 0x10],
    ["tv", "LG", "power", "NEC", 0x04, 0x08],
    ["tv", "LG", "vol_up", "NEC", 0x04, 0x02],
    ["tv", "LG", "vol_down", "NEC", 0x04, 0x03],
    ["tv", "LG", "mute", "NEC", 0x04, 0x09],
    ["tv", "LG", "ch_up", "NEC", 0x04, 0x00],
    ["tv", "LG", "ch_down", "NEC", 0x04, 0x01],
    ["tv", "Sony", "power", "SIRC", 0x01, 0x15],
    ["tv", "Sony", "vol_up", "SIRC", 0x01, 0x12],
    ["tv", "Sony", "vol_down", "SIRC", 0x01, 0x13],
    ["tv", "Sony", "mute", "SIRC", 0x01, 0x14],
    ["tv", "Sony", "ch_up", "SIRC", 0x01, 0x10],
    ["tv", "Sony", "ch_down", "SIRC", 0x01, 0x11],
    ["tv", "Philips RC5", "power", "RC5", 0x00, 0x0c],
    ["tv", "Philips RC5", "vol_up", "RC5", 0x00, 0x10],
    ["tv", "Philips RC5", "vol_down", "RC5", 0x00, 0x11],
    ["tv", "Philips RC5", "mute", "RC5", 0x00, 0x0d],
    ["tv", "Philips RC5", "ch_up", "RC5", 0x00, 0x20],
    ["tv", "Philips RC5", "ch_down", "RC5", 0x00, 0x21],
    ["tv", "Philips RC6", "power", "RC6", 0x00, 0x0c],
    ["tv", "Philips RC6", "vol_up", "RC6", 0x00, 0x10],
    ["tv", "Philips RC6", "vol_down", "RC6", 0x00, 0x11],
    ["tv", "Philips RC6", "mute", "RC6", 0x00, 0x0d],
    ["tv", "Panasonic", "power", "Kaseikyo", 0x200280, 0x3d0],
    ["tv", "Toshiba", "power", "NEC", 0x40, 0x12],
    ["audio", "Sony", "power", "SIRC", 0x10, 0x15],
    ["audio", "Sony", "vol_up", "SIRC", 0x10, 0x12],
    ["audio", "Sony", "vol_down", "SIRC", 0x10, 0x13],
    ["audio", "Sony", "mute", "SIRC", 0x10, 0x14],
    ["audio", "Yamaha", "power", "NEC", 0x7a, 0x1f],
    ["audio", "Yamaha", "vol_up", "NEC", 0x7a, 0x1a],
    ["audio", "Yamaha", "vol_down", "NEC", 0x7a, 0x1b],
    ["audio", "Yamaha", "mute", "NEC", 0x7a, 0x1c],
  ].map((r) => new CodiceLibreria(...r)),
);

/** Le marche di una categoria, nell'ordine della tabella. */
export function marche(categoria) {
  const viste = [];
  for (const c of LIBRERIA) if (c.categoria === categoria && !viste.includes(c.marca)) viste.push(c.marca);
  return viste;
}

/** I codici di una marca in una categoria. */
export function codici(categoria, marca) {
  return LIBRERIA.filter((c) => c.categoria === categoria && c.marca === marca);
}

// ---------------- aiuti per l'interfaccia (dal modulo Infrarossi) ----------------

/** Comandi ed evento di Polpo Link usati dal modulo Infrarossi. */
export const COMANDI_IR = Object.freeze({
  invia: "ir.send",
  avviaApprendimento: "ir.learn.start",
  fermaApprendimento: "ir.learn.stop",
  eventoImparato: "ir.learned",
});

export const NOTA_LIBRERIA = "Codici pubblici molto diffusi: possono non funzionare con tutti i modelli.";

/** Suffisso dei messaggi quando si lavora col Polpo virtuale. */
export function suffissoSimulato(simulato) {
  return veroPy(simulato) ? " · SIMULATO" : "";
}

/** I tasti di una marca della libreria, già con il nome del tasto in italiano (es. "Volume +"). */
export function segnaliLibreria(categoria, marca) {
  return codici(categoria, marca).map((c) => {
    const s = c.segnale();
    if (!Object.hasOwn(TASTI, c.tasto)) throw new ErroreChiave(reprTesto(c.tasto));
    s.nome = TASTI[c.tasto];
    return s;
  });
}

/** Titolo del telecomando della libreria: "Samsung · Televisori". */
export function titoloLibreria(categoria, marca) {
  if (!Object.hasOwn(CATEGORIE, categoria)) throw new ErroreChiave(reprTesto(categoria));
  return `${marca} · ${CATEGORIE[categoria]}`;
}

/** Nota sotto un telecomando personale: tasti saltati e origine simulata. */
export function notaTelecomando(avvisi, simulato) {
  let nota = "Telecomando personale.";
  if (avvisi.length) nota += " Tasti saltati: " + avvisi.join("; ");
  if (veroPy(simulato)) nota += " Creato col Polpo virtuale: non si invia al Polpo vero.";
  return nota;
}

/** Descrizione breve di un tasto (il suggerimento sul pulsante). */
export function descriviSegnale(s) {
  if (veroPy(s.raw)) return "RAW";
  return `${testoPy(s.protocollo)} · indirizzo 0x${esaMaiuscolo(s.indirizzo)} · comando 0x${esaMaiuscolo(s.comando)}`;
}

/** Nome del file di un nuovo telecomando: aggiunge ".ir" se manca. */
export function nomeFileIr(nome) {
  const pulito = togliSpazi(nome);
  return pulito.endsWith(".ir") ? pulito : pulito + ".ir";
}

/** Nome proposto copiando un telecomando: il titolo senza " · ". */
export function nomeCopiaTelecomando(titolo) {
  return titolo.replaceAll(" · ", " ");
}

/** Messaggio dopo l'importazione di un file .ir. */
export function messaggioImportazione(f) {
  let msg = `Importato: ${f.segnali.length} tasti.`;
  if (f.avvisi.length) msg += " Saltati: " + f.avvisi.join("; ");
  return msg;
}

/** Cosa inviare con `ir.send`: `{errore}` se il segnale non è valido, altrimenti comando e argomenti. */
export function preparaInvioIr(s) {
  const errore = s.valida();
  if (errore) return { errore, comando: "", argomenti: null };
  return { errore: "", comando: COMANDI_IR.invia, argomenti: s.argomentiLink() };
}

/** Messaggio dopo l'invio riuscito. */
export function messaggioInviatoIr(s, simulato) {
  return `Inviato «${testoPy(s.nome)}».` + suffissoSimulato(simulato);
}

/** Il segnale descritto dall'evento `ir.learned` (il tasto numero `n` del telecomando). */
export function segnaleImparato(dati, n) {
  const nome = `tasto ${testoPy(n)}`;
  if (veroPy(prendi(dati, "raw"))) {
    return new Segnale(nome, { raw: true, tempi: elementiPy(prendi(dati, "timings", [])).map(interoDa) });
  }
  const proto = testoPy(prendi(dati, "protocol"));
  const indirizzo = interoDa(prendi(dati, "address", 0));
  const comando = interoDa(prendi(dati, "command", 0));
  return new Segnale(nome, { protocollo: proto, indirizzo, comando });
}

/**
 * Esito dell'evento `ir.learned` per il tasto numero `n`: `errore` se il segnale non va bene, altrimenti
 * il segnale, il messaggio da mostrare e se il telecomando va segnato SIMULATO.
 */
export function tastoImparato(dati, n, simulato) {
  const segnale = segnaleImparato(dati, n);
  const perche = segnale.valida();
  if (perche) return { errore: `Segnale ricevuto ma non valido: ${perche}`, segnale: null, simulato: false, messaggio: "" };
  return {
    errore: "",
    segnale,
    simulato: veroPy(simulato) || veroPy(prendi(dati, "simulated")),
    messaggio:
      `Imparato «${segnale.nome}» (${veroPy(segnale.raw) ? "RAW" : testoPy(segnale.protocollo)}). Rinominalo dal file se vuoi.` +
      suffissoSimulato(simulato),
  };
}
