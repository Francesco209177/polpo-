// Un ESP32-S3 finto per le prove dell'aggiornamento: la ROM nel modo download e il programma di scrittura (stub) di
// esptool, con il loro protocollo seriale vero (lo stesso di esptool.py e esptool-js), e 8 MB di memoria flash.
//
// Protocollo (esptool, «Serial Protocol»): pacchetti SLIP (0xC0 ... 0xC0, 0xDB 0xDC = 0xC0, 0xDB 0xDD = 0xDB).
//   richiesta: 00 op len(2) checksum(4) dati
//   risposta:  01 op len(2) valore(4) dati, e alla fine dei dati lo stato: 4 byte dalla ROM dell'ESP32-S3
//              (stato, errore, 0, 0), 2 byte dallo stub (stato, errore)
// Comandi capiti: SYNC 08, READ_REG 0A, WRITE_REG 09, GET_SECURITY_INFO 14, MEM_BEGIN/DATA/END 05/07/06 (per caricare
// lo stub: alla fine manda «OHAI» e da lì risponde come lo stub), SPI_ATTACH 0D, SPI_SET_PARAMS 0B, CHANGE_BAUDRATE 0F,
// FLASH_BEGIN/DATA/END 02/03/04, FLASH_DEFL_BEGIN/DATA/END 10/11/12 (dati compressi zlib), SPI_FLASH_MD5 13 (32
// cifre in ASCII dalla ROM, 16 byte dallo stub), e dallo stub ERASE_FLASH D0 / ERASE_REGION D1 (registrati: le prove
// controllano che non arrivino mai).
// Registri: quelli che esptool legge e scrive (riconoscimento del chip, eFuse con MAC e revisione, UARTDEV_BUF_NO,
// watchdog RTC, RTC_CNTL_OPTION1) più la periferica SPI0 quanto basta per il comando RDID (ID della flash).
// Linee USB-Serial-JTAG: (DTR 0, RTS 1) tiene il chip in reset; al rilascio riparte nel bootloader se era richiesto
// (DTR 1 prima del reset, oppure il bit FORCE_DOWNLOAD_BOOT di RTC_CNTL_OPTION1) e altrimenti avvia l'applicazione.

import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

export const SETTORE = 0x1000;
export const MAGIA_CHIP = { "ESP32-S3": 0x00000009, "ESP32-C3": 0x1b31506f, ESP32: 0x00f01d83 };
const ID_CHIP = { "ESP32-S3": 9, "ESP32-C3": 5 }; // GET_SECURITY_INFO (l'ESP32 non ha il comando)

export const REG = Object.freeze({
  MAGIA: 0x40001000,
  UARTDEV_BUF_NO: 0x3fcef14c,
  EFUSE_MAC0: 0x60007044,
  EFUSE_MAC1: 0x60007048,
  EFUSE_BLK1_W3: 0x60007050,
  EFUSE_BLK1_W5: 0x60007058,
  EFUSE_BLK2_W4: 0x6000706c,
  RTC_WDTCONFIG0: 0x60008098,
  RTC_WDTWPROTECT: 0x600080b0,
  RTC_SWD_CONF: 0x600080b4,
  RTC_SWD_WPROTECT: 0x600080b8,
  RTC_OPTION1: 0x6000812c,
  SPI_CMD: 0x60002000,
  SPI_USR2: 0x60002020,
  SPI_W0: 0x60002058,
});

// La mappa degli indirizzi dell'ESP32-S3 (TRM, «System and Memory»): fuori da qui un READ_REG/WRITE_REG su un chip
// vero non ha senso (può anche bloccarlo). Il finto risponde 0 ma lo annota.
const MAPPA_S3 = [
  [0x3fc88000, 0x3fd00000], // DRAM interna
  [0x3ff00000, 0x3ff20000], // ROM (bus dati)
  [0x40000000, 0x40060000], // ROM (bus istruzioni)
  [0x40370000, 0x403e0000], // IRAM interna
  [0x50000000, 0x50002000], // RTC SLOW
  [0x60000000, 0x600d1000], // periferiche
  [0x600fe000, 0x60100000], // RTC FAST
];

const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

export function slip(pkt) {
  const out = [0xc0];
  for (const b of pkt) {
    if (b === 0xc0) out.push(0xdb, 0xdc);
    else if (b === 0xdb) out.push(0xdb, 0xdd);
    else out.push(b);
  }
  out.push(0xc0);
  return Uint8Array.from(out);
}

/** Generatore pseudo-casuale ripetibile (per riempire la flash con «il contenuto di prima»). */
export function casuale(seme) {
  let x = seme >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
}

export class Esp32s3Finto {
  /**
   * @param o.chip "ESP32-S3" (predefinito), "ESP32-C3" o "ESP32": come si presenta la ROM
   * @param o.dimensioneFlash byte (8 MB)
   * @param o.idFlash risposta a RDID (0x174020: XMC, 8 MB)
   * @param o.stubAtteso lo stub che deve arrivare ({text_start, decodedText, data_start, decodedData, entry}); se
   *   arriva altro, il chip «si pianta» (non risponde più)
   * @param o.uart valore di UARTDEV_BUF_NO (4 = USB-Serial-JTAG, 3 = USB-OTG)
   * @param o.sicuro Secure Download Mode
   * @param o.muto la ROM non risponde a niente
   * @param o.md5Sbagliato lo stub calcola un MD5 sbagliato
   * @param o.dopoBlocchi chiamata (n) dopo ogni FLASH_DEFL_DATA (per staccare il cavo a metà nelle prove)
   */
  constructor({
    chip = "ESP32-S3",
    dimensioneFlash = 8 * 1024 * 1024,
    idFlash = 0x174020,
    stubAtteso = null,
    uart = 4,
    sicuro = false,
    muto = false,
    md5Sbagliato = false,
    dopoBlocchi = null,
    seme = 1234,
  } = {}) {
    this.chip = chip;
    this.idFlash = idFlash;
    this.stubAtteso = stubAtteso;
    this.sicuro = sicuro;
    this.muto = muto;
    this.md5Sbagliato = md5Sbagliato;
    this.dopoBlocchi = dopoBlocchi;
    // la flash con «il contenuto di prima» (bootloader, partizioni, impostazioni, vecchia applicazione...)
    this.flash = new Uint8Array(dimensioneFlash);
    const r = casuale(seme);
    for (let i = 0; i < this.flash.length; i += 4) {
      const v = r();
      this.flash[i] = v;
      this.flash[i + 1] = v >>> 8;
      this.flash[i + 2] = v >>> 16;
      this.flash[i + 3] = v >>> 24;
    }
    this.flashIniziale = this.flash.slice();
    this.registri = new Map([
      [REG.MAGIA, MAGIA_CHIP[chip]],
      [REG.UARTDEV_BUF_NO, uart],
      [REG.EFUSE_MAC0, 0x18123456],
      [REG.EFUSE_MAC1, 0x00003485],
      [REG.EFUSE_BLK1_W3, 2 << 18], // revisione minore 2, contenitore QFN56
      [REG.EFUSE_BLK1_W5, 0],
      [REG.EFUSE_BLK2_W4, 1],
      [REG.RTC_WDTCONFIG0, 0x8000_3c00], // watchdog RTC acceso (come lo lascia un riavvio software)
      [REG.RTC_SWD_CONF, 0x04b0_0000],
      [REG.RTC_OPTION1, 0],
    ]);
    this.modo = "app"; // "app" (gira il firmware), "rom", "stub", "reset", "piantato"
    this.dtr = false;
    this.rts = false;
    this._richiestaDownload = false;
    this._downloadAlReset = false;
    this.invia = () => {}; // impostata da chi collega il chip (il ponte finto)
    this.onRiavvio = null; // (modo) dopo ogni riavvio
    // ciò che è successo, per le prove
    this.comandi = []; // {op, modo}
    this.letture = [];
    this.scrittureRegistri = []; // {indirizzo, valore, maschera}
    this.fuoriMappa = [];
    this.cancellati = []; // [inizio, fine) di flash cancellata
    this.scritti = []; // [inizio, fine) di flash scritta
    this.linee = []; // {dtr, rts}
    this.riavvii = []; // modo dopo ogni riavvio
    this.stubCaricato = false;
    this._azzera();
  }

  _azzera() {
    this._slip = null; // pacchetto in arrivo (null = fuori da un pacchetto)
    this._esc = false;
    this._ram = [];
    this._mem = null;
    this._flash = null;
  }

  reg(indirizzo) {
    return this.registri.get(indirizzo >>> 0) ?? 0;
  }

  // ---- linee e riavvii ----

  /** Il tocco a 1200 baud mentre gira il firmware: il core Arduino accende FORCE_DOWNLOAD_BOOT e riparte. */
  toccoA1200() {
    if (this.modo !== "app") return false;
    this.registri.set(REG.RTC_OPTION1, this.reg(REG.RTC_OPTION1) | 1);
    this._riparti();
    return true;
  }

  impostaLinee(dtr, rts) {
    this.linee.push({ dtr, rts, modo: this.modo });
    this.dtr = dtr;
    this.rts = rts;
    if (this.modo === "app") return; // il firmware (TinyUSB) non usa le linee per il reset
    if (!dtr && rts) {
      if (this.modo !== "reset") {
        this._downloadAlReset = this._richiestaDownload;
        this.modo = "reset";
      }
      return;
    }
    if (dtr && !rts) this._richiestaDownload = true;
    else if (!dtr && !rts) this._richiestaDownload = false;
    if (this.modo === "reset") this._riparti(this._downloadAlReset);
  }

  _riparti(download = false) {
    this._azzera();
    const nelBootloader = download || (this.reg(REG.RTC_OPTION1) & 1) === 1;
    this.modo = nelBootloader ? "rom" : "app";
    this.riavvii.push(this.modo);
    if (this.onRiavvio) this.onRiavvio(this.modo);
  }

  // ---- byte in arrivo dal telefono ----

  ricevi(byte) {
    for (const b of byte) {
      if (this._slip === null) {
        if (b === 0xc0) this._slip = [];
        continue; // fuori da un pacchetto: rumore, ignorato come fa la ROM
      }
      if (this._esc) {
        this._esc = false;
        if (b === 0xdc) this._slip.push(0xc0);
        else if (b === 0xdd) this._slip.push(0xdb);
        else this._slip = null; // escape non valido: pacchetto scartato
        continue;
      }
      if (b === 0xdb) this._esc = true;
      else if (b === 0xc0) {
        const p = this._slip;
        this._slip = [];
        if (p.length) this._pacchetto(Uint8Array.from(p));
      } else this._slip.push(b);
    }
  }

  _rispondi(op, valore, dati = [], stato = 0, errore = 0) {
    const coda = this.modo === "stub" ? [stato, errore] : [stato, errore, 0, 0];
    const corpo = [...dati, ...coda];
    const pkt = [0x01, op, corpo.length & 0xff, corpo.length >> 8, ...le32(valore), ...corpo];
    this.invia(slip(pkt));
  }

  _errore(op, codiceRom, codiceStub) {
    this._rispondi(op, 0, [], 1, this.modo === "stub" ? codiceStub : codiceRom);
  }

  _pacchetto(p) {
    if (this.modo !== "rom" && this.modo !== "stub") return; // in reset, piantato o col firmware: nessuna risposta
    if (this.muto || p.length < 8 || p[0] !== 0x00) return;
    const op = p[1];
    const lunghezza = p[2] | (p[3] << 8);
    const controllo = u32(p, 4);
    const d = p.subarray(8);
    if (d.length !== lunghezza) return; // la ROM ignora i pacchetti con la lunghezza sbagliata
    this.comandi.push({ op, modo: this.modo });
    const stub = this.modo === "stub";
    switch (op) {
      case 0x08: {
        // SYNC: 07 07 12 20 e 32 volte 0x55. La ROM risponde 8 volte (valore diverso da 0), lo stub una (valore 0).
        const ok = d.length === 36 && d[0] === 7 && d[1] === 7 && d[2] === 0x12 && d[3] === 0x20 && d.subarray(4).every((x) => x === 0x55);
        if (!ok) return;
        for (let i = 0; i < (stub ? 1 : 8); i++) this._rispondi(op, stub ? 0 : 0x20120707);
        return;
      }
      case 0x0a: {
        const a = u32(d, 0);
        this.letture.push(a);
        if (this.chip === "ESP32-S3" && !MAPPA_S3.some(([i, f]) => a >= i && a < f)) this.fuoriMappa.push(a);
        if (this.sicuro && !stub) return this._errore(op, 0x05, 0xc4);
        return this._rispondi(op, this.reg(a));
      }
      case 0x09: {
        for (let i = 0; i + 16 <= d.length; i += 16) {
          const a = u32(d, i), v = u32(d, i + 4), m = u32(d, i + 8);
          this.scrittureRegistri.push({ indirizzo: a, valore: v, maschera: m, modo: this.modo });
          if (this.chip === "ESP32-S3" && !MAPPA_S3.some(([s, f]) => a >= s && a < f)) this.fuoriMappa.push(a);
          this.registri.set(a, ((this.reg(a) & ~m) | (v & m)) >>> 0);
          if (a === REG.SPI_CMD && v & (1 << 18)) this._comandoSpi();
        }
        return this._rispondi(op, 0);
      }
      case 0x14: {
        if (!ID_CHIP[this.chip]) return this._errore(op, 0x05, 0xff); // l'ESP32 non ha il comando
        const r = [...le32(this.sicuro ? 1 << 2 : 0), 0, 0, 0, 0, 0, 0, 0, 0, ...le32(ID_CHIP[this.chip]), ...le32(0)];
        return this._rispondi(op, 0, r);
      }
      case 0x05: {
        const [dim, blocchi, blocco, ind] = [u32(d, 0), u32(d, 4), u32(d, 8), u32(d, 12)];
        this._mem = { ind, dati: new Uint8Array(dim), blocchi, blocco, seq: 0 };
        this._ram.push(this._mem);
        return this._rispondi(op, 0);
      }
      case 0x07: {
        const m = this._mem;
        const n = u32(d, 0), seq = u32(d, 4), dati = d.subarray(16);
        if (!m || dati.length !== n || seq !== m.seq) return this._errore(op, 0x06, 0xc3);
        if (controllo !== dati.reduce((x, b) => x ^ b, 0xef)) return this._errore(op, 0x07, 0xc2);
        m.dati.set(dati.subarray(0, Math.max(0, m.dati.length - seq * m.blocco)), seq * m.blocco);
        m.seq++;
        return this._rispondi(op, 0);
      }
      case 0x06: {
        const senzaSalto = u32(d, 0), entrata = u32(d, 4);
        this._rispondi(op, 0);
        if (senzaSalto || stub) return;
        if (!this._stubGiusto(entrata)) {
          this.modo = "piantato";
          return;
        }
        this.stubCaricato = true;
        this.modo = "stub";
        this.invia(slip([0x4f, 0x48, 0x41, 0x49])); // "OHAI": lo stub è partito
        return;
      }
      case 0x0d: // SPI_ATTACH
      case 0x0b: // SPI_SET_PARAMS
      case 0x0f: // CHANGE_BAUDRATE
        return this._rispondi(op, 0);
      case 0x02:
      case 0x10: {
        // FLASH_BEGIN / FLASH_DEFL_BEGIN: dimensione, blocchi, dimensione del blocco, indirizzo (+ cifratura dalla ROM)
        const attesi = stub ? 16 : 20;
        if (d.length !== attesi) return this._errore(op, 0x05, 0xc1);
        const [dim, blocchi, blocco, ind] = [u32(d, 0), u32(d, 4), u32(d, 8), u32(d, 12)];
        if (ind % SETTORE || ind + dim > this.flash.length) return this._errore(op, 0x06, 0xc5);
        this._flash = { compresso: op === 0x10, ind, dim, blocchi, blocco, seq: 0, pezzi: [], scritti: 0 };
        if (!stub) this._cancella(ind, ind + dim); // la ROM cancella subito (lo stub invece man mano)
        return this._rispondi(op, 0);
      }
      case 0x03:
      case 0x11: {
        const f = this._flash;
        const n = u32(d, 0), seq = u32(d, 4), dati = d.subarray(16);
        if (!f || f.compresso !== (op === 0x11)) return this._errore(op, 0x06, 0xc7);
        if (dati.length !== n || seq !== f.seq) return this._errore(op, 0x06, 0xc3);
        if (seq >= f.blocchi) return this._errore(op, 0x06, 0xca); // più blocchi di quelli annunciati
        if (controllo !== dati.reduce((x, b) => x ^ b, 0xef)) return this._errore(op, 0x07, 0xc2);
        f.seq++;
        if (f.compresso) f.pezzi.push(dati.slice());
        else this._scrivi(f.ind + seq * f.blocco, dati);
        this._rispondi(op, 0);
        if (f.compresso && this.dopoBlocchi) this.dopoBlocchi(f.seq);
        return;
      }
      case 0x04:
      case 0x12: {
        const f = this._flash;
        if (!f) return this._errore(op, 0x06, 0xc7);
        if (!this._completa()) return this._errore(op, 0x0b, 0xc8);
        if (stub && f.compresso && f.scritti !== f.dim) return this._errore(op, 0x06, 0xc9); // dati mancanti
        this._rispondi(op, 0);
        if (u32(d, 0) === 0) this._riparti(false); // «riavvia» invece di «resta nel caricatore»
        return;
      }
      case 0x13: {
        this._completa();
        const ind = u32(d, 0), dim = u32(d, 4);
        if (ind + dim > this.flash.length) return this._errore(op, 0x0a, 0xc5);
        const h = createHash("md5").update(this.flash.subarray(ind, ind + dim)).digest();
        if (this.md5Sbagliato) h[0] ^= 0xff;
        return stub ? this._rispondi(op, 0, [...h]) : this._rispondi(op, 0, [...Buffer.from(h.toString("hex"), "ascii")]);
      }
      case 0xd0:
      case 0xd1:
      case 0xd2:
      case 0xd3:
        if (!stub) return this._errore(op, 0x05, 0xff);
        if (op === 0xd0) this._cancella(0, this.flash.length);
        if (op === 0xd1) this._cancella(u32(d, 0), u32(d, 0) + u32(d, 4));
        return op === 0xd2 ? this._errore(op, 0x05, 0xff) : this._rispondi(op, 0);
      default:
        return this._errore(op, 0x05, 0xff);
    }
  }

  _stubGiusto(entrata) {
    const s = this.stubAtteso;
    if (!s) return true;
    const trova = (ind) => this._ram.find((m) => m.ind === ind);
    const testo = trova(s.text_start), dati = trova(s.data_start);
    const uguali = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);
    return entrata === s.entry && uguali(testo && testo.dati, s.decodedText) && uguali(dati && dati.dati, s.decodedData);
  }

  _comandoSpi() {
    const comando = this.reg(REG.SPI_USR2) & 0xffff;
    if (comando === 0x9f) this.registri.set(REG.SPI_W0, this.idFlash); // RDID
    this.registri.set(REG.SPI_CMD, this.reg(REG.SPI_CMD) & ~(1 << 18)); // fatto
  }

  _cancella(inizio, fine) {
    const i = Math.floor(inizio / SETTORE) * SETTORE, f = Math.ceil(fine / SETTORE) * SETTORE;
    if (f <= i) return;
    this.flash.fill(0xff, i, f);
    this.cancellati.push([i, f]);
  }

  _scrivi(ind, dati) {
    if (this.modo === "stub") this._cancellaSePrima(ind, ind + dati.length); // lo stub cancella man mano
    // la flash NOR può solo portare bit da 1 a 0: chi scrive senza cancellare prima ottiene un AND
    for (let i = 0; i < dati.length; i++) this.flash[ind + i] &= dati[i];
    this.scritti.push([ind, ind + dati.length]);
  }

  _cancellaSePrima(inizio, fine) {
    const f = this._flash;
    f.cancellatoFino ??= f.ind;
    const serve = Math.ceil(fine / SETTORE) * SETTORE;
    if (serve > f.cancellatoFino) {
      this._cancella(f.cancellatoFino, serve);
      f.cancellatoFino = serve;
    }
  }

  /** Scompatta e scrive i dati compressi arrivati (lo stub lo fa man mano; qui alla fine o prima dell'MD5). */
  _completa() {
    const f = this._flash;
    if (!f || !f.compresso || !f.pezzi.length) return true;
    let dati;
    try {
      dati = new Uint8Array(inflateSync(Buffer.concat(f.pezzi)));
    } catch {
      return false;
    }
    f.pezzi = [];
    if (f.scritti + dati.length > f.dim) return false; // più dati di quelli annunciati
    this._scrivi(f.ind + f.scritti, dati);
    f.scritti += dati.length;
    return true;
  }
}
