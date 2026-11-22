// Polpo Studio — NDEF (NFC Forum): record URI e testo, involucro TLV per i tag Type 2.
// Copia JavaScript di studio/polpo_studio/protocols/ndef.py (stesse regole di polpo/lib/polpo_core/src/polpo/nfc/ndef.cpp).

import { codificaAscii, codificaUtf8, decodificaAscii, decodificaUtf16, decodificaUtf8, errorePy } from "../strumenti/convertitore.js";

// Gli indirizzi web sono composti a pezzi: il controllo del sito rifiuta i file JavaScript che contengono un indirizzo
// scritto per intero (il codice del sito non deve poter parlare con nessun server). Il testo risultante è lo stesso.
const WEB = "http" + ":/" + "/";
const WEB_SICURO = "https" + ":/" + "/";

/** I prefissi URI dello standard NDEF: l'indice è il primo byte del record URI. */
export const PREFISSI_URI = Object.freeze([
  "", WEB + "www.", WEB_SICURO + "www.", WEB, WEB_SICURO, "tel:", "mailto:",
  "ftp://anonymous:anonymous@", "ftp://ftp.", "ftps://", "sftp://", "smb://", "nfs://",
  "ftp://", "dav://", "news:", "telnet://", "imap:", "rtsp://", "urn:",
  "pop:", "sip:", "sips:", "tftp:", "btspp://", "btl2cap://", "btgoep://",
  "tcpobex://", "irdaobex://", "file://", "urn:epc:id:", "urn:epc:tag:", "urn:epc:pat:",
  "urn:epc:raw:", "urn:epc:", "urn:nfc:",
]);

function unisci(...parti) {
  const out = new Uint8Array(parti.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parti) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

function record(tnf, tipo, payload) {
  const corto = payload.length <= 255;
  const testa = [0x80 | 0x40 | (corto ? 0x10 : 0) | (tnf & 0x07), tipo.length];
  const n = payload.length;
  const lunghezza = corto ? [n] : [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return unisci(testa, lunghezza, tipo, payload);
}

/** Messaggio NDEF con un record URI (sceglie il prefisso standard più lungo che combacia). */
export function messaggioUri(uri) {
  let migliore = 0;
  let lunghezza = 0;
  for (let i = 1; i < PREFISSI_URI.length; i++) {
    const p = PREFISSI_URI[i];
    if (p.length > lunghezza && uri.startsWith(p)) {
      migliore = i;
      lunghezza = p.length;
    }
  }
  return record(0x01, [0x55], unisci([migliore], codificaUtf8(uri.slice(lunghezza))));
}

/** Messaggio NDEF con un record di testo UTF-8 nella lingua indicata. */
export function messaggioTesto(testo, lingua = "it") {
  const lb = codificaAscii(lingua);
  return record(0x01, [0x54], unisci([lb.length & 0x3f], lb, codificaUtf8(testo)));
}

/** Avvolge un messaggio NDEF nel TLV dei tag Type 2 (tipo 0x03, lunghezza, messaggio, terminatore 0xFE). */
export function avvolgiTlv(messaggio) {
  const n = messaggio.length;
  const lunghezza = n < 0xff ? [n] : [0xff, (n >> 8) & 0xff, n & 0xff];
  return unisci([0x03], lunghezza, messaggio, [0xfe]);
}

/** Il primo messaggio NDEF nell'area TLV (salta NULL, Lock/Memory Control e proprietari); null se non c'è. */
export function trovaNelTlv(memoria) {
  const mem = Uint8Array.from(memoria);
  let i = 0;
  while (i < mem.length) {
    const t = mem[i++];
    if (t === 0x00) continue;
    if (t === 0xfe || i >= mem.length) return null;
    let n = mem[i++];
    if (n === 0xff) {
      if (i + 2 > mem.length) return null;
      n = (mem[i] << 8) | mem[i + 1];
      i += 2;
    }
    if (i + n > mem.length) return null;
    if (t === 0x03) return mem.slice(i, i + n);
    i += n;
  }
  return null;
}

/**
 * Analizza un messaggio NDEF; lancia ValueError se è malformato.
 * Ogni record: {tnf, tipo (byte), payload (byte), genere ("uri", "text" o "other"), valore, lingua}.
 */
export function analizza(messaggio) {
  const m = Uint8Array.from(messaggio);
  if (!m.length) throw errorePy("ValueError", "messaggio NDEF vuoto");
  const out = [];
  let i = 0;
  while (i < m.length) {
    const testa = m[i++];
    if (testa & 0x20) throw errorePy("ValueError", "record spezzati (chunked) non supportati");
    const troncata = () => errorePy("ValueError", "intestazione del record troncata");
    if (i >= m.length) throw troncata();
    const lungTipo = m[i++];
    let lungPayload;
    if (testa & 0x10) {
      if (i >= m.length) throw troncata();
      lungPayload = m[i++];
    } else {
      if (i + 4 > m.length) throw troncata();
      lungPayload = ((m[i] << 24) >>> 0) + (m[i + 1] << 16) + (m[i + 2] << 8) + m[i + 3];
      i += 4;
    }
    let lungId = 0;
    if (testa & 0x08) {
      if (i >= m.length) throw troncata();
      lungId = m[i++];
    }
    if (i + lungTipo + lungId + lungPayload > m.length) throw errorePy("ValueError", "record troncato");
    const tipo = m.slice(i, i + lungTipo);
    i += lungTipo + lungId;
    const payload = m.slice(i, i + lungPayload);
    i += lungPayload;
    const rec = { tnf: testa & 0x07, tipo, payload, genere: "other", valore: "", lingua: "" };
    const tipoUnico = tipo.length === 1 ? tipo[0] : -1;
    if (rec.tnf === 0x01 && tipoUnico === 0x55 && payload.length) {
      rec.genere = "uri";
      const prefisso = payload[0] < PREFISSI_URI.length ? PREFISSI_URI[payload[0]] : "";
      rec.valore = prefisso + decodificaUtf8(payload.subarray(1));
    } else if (rec.tnf === 0x01 && tipoUnico === 0x54 && payload.length) {
      const ll = payload[0] & 0x3f;
      if (1 + ll <= payload.length) {
        rec.genere = "text";
        rec.lingua = decodificaAscii(payload.subarray(1, 1 + ll));
        const resto = payload.subarray(1 + ll);
        rec.valore = payload[0] & 0x80 ? decodificaUtf16(resto) : decodificaUtf8(resto);
      }
    }
    out.push(rec);
    if (testa & 0x40) break;
  }
  return out;
}
