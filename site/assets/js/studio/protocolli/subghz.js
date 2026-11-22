// Polpo Studio — file radio .sub (codici fissi e RAW), analisi degli impulsi, tempo in aria (come il firmware).
// Porting di studio/polpo_studio/protocols/subghz.py, più la logica pura del modulo Radio 433 MHz
// (studio/polpo_studio/app/tools/radio_tools.py) che serve all'interfaccia.
//
// Solo 433,05–434,79 MHz in OOK e codici fissi: è quello che i moduli RF433R/RF433T sanno fare.
// Niente rolling code, disturbo radio o prove a forza bruta: si trasmettono solo i codici fissi salvati
// dall'utente, dopo i controlli di controllaTrasmissibile().

import {
  ErroreFormato,
  ErrorePy,
  ErroreTipo,
  ErroreValore,
  assoluto,
  byteEsa,
  daByte,
  divisioneIntera,
  divisioneVera,
  dividi,
  elemento,
  elementiPy,
  escapeHtml,
  esaMaiuscolo,
  inByte,
  inizioPy,
  interoDa,
  interoDaTesto,
  intestazione,
  leggiByteEsa,
  leggiFf,
  nomeTipoPy,
  normalizzaIntero,
  prendi,
  riga,
  soloCifre,
  spostaDestra,
  testoPy,
  togliSpazi,
  veroPy,
  virgolaFissa,
} from "./flipper.js";

export const TIPO_CHIAVE = "Flipper SubGhz Key File";
export const TIPO_RAW = "Flipper SubGhz RAW File";
export const RAW_MAX_PER_RIGA = 512;
export const RAW_MAX_TEMPI = 4096;
export const BANDA_MIN = 433_050_000;
export const BANDA_MAX = 434_790_000;
export const RC_PROTOCOLLI = 12;
export const RC_MAX_BIT = 32;
export const PRESET_PREDEFINITO = "FuriHalSubGhzPresetOok650Async";

// Tabella dei protocolli di rc-switch 2.6.4: {sinc. alto, basso}, {zero alto, basso}, {uno alto, basso}.
export const TABELLA_RC = Object.freeze(
  [
    [1, 31, 1, 3, 3, 1], [1, 10, 1, 2, 2, 1], [30, 71, 4, 11, 9, 6], [1, 6, 1, 3, 3, 1],
    [6, 14, 1, 2, 2, 1], [23, 1, 1, 2, 2, 1], [2, 62, 1, 6, 6, 1], [3, 130, 7, 16, 3, 16],
    [130, 7, 16, 7, 16, 3], [18, 1, 3, 1, 1, 3], [36, 1, 1, 2, 2, 1], [36, 1, 1, 2, 2, 1],
  ].map((r) => Object.freeze(r)),
);

/** Un codice fisso rc-switch: protocollo (1…12), numero di bit, valore, durata dell'impulso base in µs. */
export class CodiceRc {
  constructor(protocollo = 1, bit = 24, valore = 0, impulsoUs = 350) {
    this.protocollo = protocollo;
    this.bit = bit;
    this.valore = valore;
    this.impulsoUs = impulsoUs;
  }
}

/** Contenuto di un file .sub: frequenza in Hz, preset, codice fisso oppure tempi RAW (µs, positivi = portante accesa). */
export class FileSub {
  constructor({
    frequenza = 433_920_000,
    preset = PRESET_PREDEFINITO,
    raw = false,
    codice = new CodiceRc(),
    tempiRaw = [],
  } = {}) {
    this.frequenza = frequenza;
    this.preset = preset;
    this.raw = raw;
    this.codice = codice;
    this.tempiRaw = tempiRaw;
  }

  /** Vero se la frequenza è nella banda 433,05–434,79 MHz. */
  get inBanda() {
    return BANDA_MIN <= this.frequenza && this.frequenza <= BANDA_MAX;
  }
}

/** File valido ma non trasmissibile con questo hardware (protocollo non gestito). È anche un ErroreFormato. */
export class NonSupportato extends ErroreFormato {
  static tipo = "Unsupported";
}

/** Vero se i tempi RAW iniziano con un impulso e alternano impulsi (> 0) e pause (< 0), senza zeri. */
export function rawValido(t) {
  if (!t.length || t[0] <= 0) return false;
  for (let i = 0; i < t.length; i++) {
    if (t[i] == 0) return false; // «==» perché valga anche per 0n
    if (i > 0 && t[i] > 0 === t[i - 1] > 0) return false;
  }
  return true;
}

/** Scrive un file .sub (codice fisso: Princeton o Polpo_RCSwitch; RAW: al massimo 512 tempi per riga). */
export function scriviSub(f) {
  let out = intestazione(veroPy(f.raw) ? TIPO_RAW : TIPO_CHIAVE) + riga("Frequency", f.frequenza) + riga("Preset", f.preset);
  if (veroPy(f.raw)) {
    out += riga("Protocol", "RAW");
    for (let i = 0; i < f.tempiRaw.length; i += RAW_MAX_PER_RIGA) {
      out += riga("RAW_Data", f.tempiRaw.slice(i, i + RAW_MAX_PER_RIGA).map(testoPy).join(" "));
    }
    return out;
  }
  const p = f.codice.protocollo;
  if (p === 1 || p === 1n || p === true) out += riga("Protocol", "Princeton");
  else out += riga("Protocol", "Polpo_RCSwitch") + riga("RCS_Protocol", p);
  out += riga("Bit", f.codice.bit) + riga("Key", byteEsa(inByte(f.codice.valore, 8, "big")));
  return out + riga("TE", f.codice.impulsoUs);
}

/** Legge un file .sub. Lancia ErroreFormato se è illeggibile, NonSupportato se il protocollo non è gestito. */
export function leggiSub(testo) {
  const doc = leggiFf(testo);
  if (doc.tipoFile !== TIPO_CHIAVE && doc.tipoFile !== TIPO_RAW) throw new ErroreFormato("non è un file radio .sub");
  const out = new FileSub();
  let proto = "";
  let haChiave = false;
  const entro = (v, a, b) => a <= v && v <= b;
  for (const [chiave, valore] of doc.righe) {
    if (chiave === "Frequency") {
      if (!soloCifre(valore)) throw new ErroreFormato("frequenza non valida");
      out.frequenza = interoDaTesto(valore);
    } else if (chiave === "Preset") {
      out.preset = valore;
    } else if (chiave === "Protocol") {
      proto = valore;
    } else if (chiave === "RAW_Data") {
      for (const tok of dividi(valore)) {
        let v;
        try {
          v = interoDaTesto(tok);
        } catch (e) {
          if (e instanceof ErroreValore) throw new ErroreFormato("dato RAW non valido");
          throw e;
        }
        if (out.tempiRaw.length >= RAW_MAX_TEMPI) throw new ErroreFormato("segnale RAW troppo lungo (max 4096 tempi)");
        out.tempiRaw.push(v);
      }
    } else if (chiave === "Bit") {
      if (!soloCifre(valore) || !entro(interoDaTesto(valore), 1, 32)) throw new ErroreFormato("Bit non valido (da 1 a 32)");
      out.codice.bit = interoDaTesto(valore);
    } else if (chiave === "Key") {
      const b = leggiByteEsa(valore);
      if (!b || !b.length || b.length > 8) throw new ErroreFormato("Key non valida");
      out.codice.valore = daByte(b, "big");
      haChiave = true;
    } else if (chiave === "TE") {
      if (!soloCifre(valore) || !entro(interoDaTesto(valore), 50, 5000)) throw new ErroreFormato("TE non valido");
      out.codice.impulsoUs = interoDaTesto(valore);
    } else if (chiave === "RCS_Protocol") {
      if (!soloCifre(valore) || !entro(interoDaTesto(valore), 1, RC_PROTOCOLLI)) throw new ErroreFormato("RCS_Protocol non valido");
      out.codice.protocollo = interoDaTesto(valore);
    }
  }
  if (proto === "RAW") {
    out.raw = true;
    if (!rawValido(out.tempiRaw)) {
      if (out.tempiRaw.length && out.tempiRaw[0] < 0) out.tempiRaw.shift(); // molte catture iniziano con una pausa
      if (!rawValido(out.tempiRaw)) throw new ErroreFormato("dati RAW non alternati");
    }
    return out;
  }
  if (proto === "Princeton") out.codice.protocollo = 1;
  else if (proto !== "Polpo_RCSwitch") {
    throw new NonSupportato(`protocollo ${proto} non supportato (solo codici fissi Princeton o RAW)`);
  }
  if (!haChiave) throw new ErroreFormato("manca il campo Key");
  if (veroPy(spostaDestra(out.codice.valore, out.codice.bit))) throw new ErroreFormato("Key più lunga dei bit dichiarati");
  return out;
}

/** Motivo per cui il file non si può trasmettere col Polpo (testo vuoto = si può). */
export function controllaTrasmissibile(f) {
  if (!f.inBanda) return "il modulo RF433T trasmette solo a 433,92 MHz (banda 433,05–434,79 MHz)";
  if (!veroPy(f.raw) && f.codice.bit > RC_MAX_BIT) return "rc-switch trasmette al massimo 32 bit";
  return "";
}

/** Statistiche degli impulsi di una cattura RAW. */
export class StatisticheImpulsi {
  constructor() {
    this.conteggio = 0;
    this.minUs = 0;
    this.maxUs = 0;
    this.breveUs = 0;
    this.lungoUs = 0;
    this.rapporto = 0.0;
    this.gruppi = 0;
  }
}

/** Raggruppa le durate (50 µs…20 ms) e trova l'impulso breve e quello lungo più frequenti. */
export function analizzaImpulsi(tempi) {
  const st = new StatisticheImpulsi();
  const v = [];
  for (const t of tempi) {
    const a = assoluto(t);
    if (50 <= a && a <= 20_000) v.push(Number(a));
  }
  v.sort((x, y) => x - y);
  st.conteggio = v.length;
  if (!v.length) return st;
  st.minUs = v[0];
  st.maxUs = v[v.length - 1];
  const gruppi = []; // [somma, numero]
  for (const x of v) {
    const g = gruppi[gruppi.length - 1];
    if (!g || x > divisioneIntera(divisioneIntera(g[0], g[1]) * 14, 10)) gruppi.push([x, 1]);
    else {
      g[0] += x;
      g[1] += 1;
    }
  }
  st.gruppi = Math.min(gruppi.length, 255);
  const ordine = gruppi.map((_, i) => i).sort((i, j) => gruppi[j][1] - gruppi[i][1]); // ordinamento stabile
  let a = ordine[0];
  let b = ordine.length > 1 ? ordine[1] : ordine[0];
  const media = (i) => divisioneIntera(gruppi[i][0], gruppi[i][1]);
  if (media(a) > media(b)) [a, b] = [b, a];
  st.breveUs = media(a);
  st.lungoUs = media(b);
  st.rapporto = veroPy(st.breveUs) ? divisioneVera(st.lungoUs, st.breveUs) : 0.0;
  return st;
}

/** Ipotesi prudente sul protocollo dal rapporto tra impulsi lunghi e corti. */
export function ipotesiProtocollo(st) {
  if (st.conteggio < 16) return "troppi pochi impulsi per un'ipotesi";
  if (2.6 <= st.rapporto && st.rapporto <= 3.4 && 150 <= st.breveUs && st.breveUs <= 700) {
    return 'compatibile con PT2262 / EV1527 (rc-switch 1, "Princeton")';
  }
  if (1.7 <= st.rapporto && st.rapporto <= 2.3) return "compatibile con rc-switch 2 o 5 (rapporto 1:2)";
  return "protocollo non riconosciuto: tienilo come RAW";
}

const numeroPy = (x) => (typeof x === "boolean" ? Number(x) : x);
const interoPy = (x) => typeof x === "bigint" || (typeof x === "number" && Number.isInteger(x));

/** Durata in µs di `ripetizioni` invii del codice (0 se protocollo o bit non sono validi). */
export function tempoInAriaRcUs(codice, ripetizioni) {
  const p = numeroPy(codice.protocollo);
  const b = numeroPy(codice.bit);
  if (!(1 <= p && p <= RC_PROTOCOLLI) || !(1 <= b && b <= RC_MAX_BIT)) return 0;
  if (!interoPy(p)) throw new ErroreTipo(`tuple indices must be integers or slices, not ${nomeTipoPy(p)}`);
  const t = TABELLA_RC[Number(p) - 1];
  const perBit = Math.max(t[2] + t[3], t[4] + t[5]);
  const imp = numeroPy(codice.impulsoUs);
  const rip = numeroPy(ripetizioni);
  if (interoPy(b) && interoPy(imp) && interoPy(rip)) {
    return normalizzaIntero((BigInt(perBit) * BigInt(b) + BigInt(t[0]) + BigInt(t[1])) * BigInt(imp) * BigInt(rip));
  }
  return (perBit * Number(b) + t[0] + t[1]) * Number(imp) * Number(rip); // con i decimali, come Python
}

/** Da un evento `rf.code` di Polpo Link (valore in esadecimale) a un file .sub. */
export function codiceInSub(protocollo, bit, valoreEsa, impulsoUs) {
  if (typeof valoreEsa !== "string") throw new ErroreTipo("int() can't convert non-string with explicit base");
  return new FileSub({ codice: new CodiceRc(protocollo, bit, interoDaTesto(valoreEsa, 16), impulsoUs) });
}

// ---------------- aiuti per l'interfaccia (dal modulo Radio 433 MHz) ----------------

/** Comandi ed evento di Polpo Link usati dal modulo Radio. */
export const COMANDI_RF = Object.freeze({
  avviaRicezione: "rf.rx.start",
  fermaRicezione: "rf.rx.stop",
  avviaRaw: "rf.raw.start",
  istantaneaRaw: "rf.raw.snapshot",
  fermaRaw: "rf.raw.stop",
  trasmetti: "rf.tx",
  eventoCodice: "rf.code",
});

/** Intestazioni della tabella dei codici ricevuti. */
export const COLONNE_RICEZIONE = Object.freeze(["Ora", "Protocollo", "Bit", "Codice", "Impulso", "Origine"]);

/** Suffisso dei messaggi quando si lavora col Polpo virtuale. */
export function suffissoSimulato(simulato) {
  return veroPy(simulato) ? " · SIMULATO" : "";
}

/** Le celle di un codice ricevuto (evento `rf.code`), senza l'ora: il codice ha tante cifre quante ne chiedono i bit. */
export function rigaCodiceRicevuto(dati, simulato) {
  const valore = interoDaTesto(testoPy(prendi(dati, "value", "0")), 16);
  const bit = interoDa(prendi(dati, "bits", 0));
  const quarti = divisioneIntera(normalizzaIntero(BigInt(bit) + 3n), 4);
  return {
    protocollo: testoPy(prendi(dati, "protocol")),
    bit: testoPy(bit),
    codice: "0x" + esaMaiuscolo(valore, quarti > 1 ? Number(quarti) : 1),
    impulso: `${testoPy(prendi(dati, "pulse_us"))} µs`,
    origine: veroPy(simulato) || veroPy(prendi(dati, "simulated")) ? "SIMULATO" : "reale",
  };
}

/** Il file .sub di un codice ricevuto (evento `rf.code`). */
export function subDaEvento(dati) {
  return codiceInSub(
    interoDa(elemento(dati, "protocol")),
    interoDa(elemento(dati, "bits")),
    testoPy(elemento(dati, "value")),
    interoDa(elemento(dati, "pulse_us")),
  );
}

/** Nome proposto per salvare un codice ricevuto: "codice 515A01". */
export function nomeCodiceRicevuto(dati) {
  const v = elemento(dati, "value");
  if (typeof v !== "string") throw new ErrorePy(`'${nomeTipoPy(v)}' object has no attribute 'lstrip'`, "AttributeError");
  return `codice ${v.replace(/^0+/, "") || "0"}`;
}

/** Cosa salvare nella cassaforte per un codice ricevuto: nome del file, testo .sub, origine, metadati. */
export function salvataggioCodice(dati, simulato, nome, idDispositivo = "") {
  const sim = veroPy(simulato) || veroPy(prendi(dati, "simulated"));
  const sub = subDaEvento(dati);
  return {
    nomeFile: `${testoPy(nome)}.sub`,
    testo: scriviSub(sub),
    origine: sim ? "simulato" : "reale",
    meta: {
      device: veroPy(idDispositivo) ? idDispositivo : "",
      protocol: sub.codice.protocollo,
      bits: sub.codice.bit,
      pulse_us: sub.codice.impulsoUs,
    },
    messaggio: `Salvato «${testoPy(nome)}» nella cassaforte.`,
  };
}

/** I tempi della risposta a `rf.raw.snapshot`. */
export function tempiDaInstantanea(dati) {
  return elementiPy(prendi(dati, "timings", [])).map(interoDa);
}

/** Il .sub RAW da salvare: toglie le pause iniziali; `errore` se non resta niente di valido. */
export function rawDaSalvare(tempi) {
  const t = [...tempi];
  while (t.length && t[0] < 0) t.shift();
  if (!rawValido(t)) return { errore: "Niente di valido da salvare: registra prima qualche impulso.", sub: null, testo: "" };
  const sub = new FileSub({ raw: true, tempiRaw: t });
  return { errore: "", sub, testo: scriviSub(sub) };
}

/** Il riquadro dell'analisi di una cattura RAW. */
export function testoAnalisi(tempi) {
  const st = analizzaImpulsi(tempi);
  return (
    `Impulsi: ${st.conteggio} · breve ≈ ${testoPy(st.breveUs)} µs · lungo ≈ ${testoPy(st.lungoUs)} µs · ` +
    `rapporto ${virgolaFissa(st.rapporto, 2)} · gruppi ${st.gruppi}\nIpotesi: ${ipotesiProtocollo(st)}`
  );
}

/** Somma esatta dei valori assoluti (interi grandi compresi). */
function sommaAssoluti(tempi) {
  if (tempi.every(interoPy)) return normalizzaIntero(tempi.reduce((s, x) => s + BigInt(assoluto(x)), 0n));
  return tempi.reduce((s, x) => s + Math.abs(Number(x)), 0);
}

/** La scritta sotto il grafico degli impulsi. */
export function didascaliaImpulsi(tempi) {
  if (!tempi.length) return "Nessun impulso registrato";
  const totale = sommaAssoluti(tempi);
  return `${tempi.length} impulsi · ${virgolaFissa(divisioneVera(veroPy(totale) ? totale : 1, 1000), 1)} ms`;
}

/** Tipo e trasmissibilità di un file dell'archivio (le colonne «Tipo» e «Trasmissibile»). */
export function descriviArchivio(testo) {
  let tipo;
  let perche;
  try {
    const sub = leggiSub(testo);
    tipo = veroPy(sub.raw) ? "RAW" : `rc-switch ${testoPy(sub.codice.protocollo)}, ${testoPy(sub.codice.bit)} bit`;
    perche = controllaTrasmissibile(sub);
  } catch (e) {
    if (!(e instanceof ErroreFormato)) throw e;
    tipo = "non valido";
    perche = e.message;
  }
  return { tipo, trasmissibile: perche ? "no: " + perche : "sì" };
}

/** Il messaggio di «Analizza» per un codice fisso: bit, impulso e durata di un invio. */
export function testoCodiceFisso(codice) {
  const us = tempoInAriaRcUs(codice, 1);
  return `Codice fisso ${testoPy(codice.bit)} bit, impulso ${testoPy(codice.impulsoUs)} µs, circa ${virgolaFissa(divisioneVera(us, 1000), 1)} ms per invio.`;
}

/** Nome di un dispositivo registrato ("?" se l'id non c'è), come il registro dei dispositivi. */
export function nomeDispositivo(dispositivi, id) {
  for (const d of dispositivi) if (elemento(d, "id") === id) return elemento(d, "name");
  return "?";
}

/**
 * Controlli prima di trasmettere un file salvato (dopo quello sui dati SIMULATI): `errore` se il file
 * non è valido o non è trasmissibile, altrimenti il file letto.
 */
export function verificaTrasmissione(testo) {
  let sub;
  try {
    sub = leggiSub(testo);
  } catch (e) {
    if (!(e instanceof ErroreFormato)) throw e;
    return { errore: e.message, sub: null };
  }
  const perche = controllaTrasmissibile(sub);
  if (perche) return { errore: `Non trasmissibile: ${perche}`, sub: null };
  return { errore: "", sub };
}

/** Dove copiare il file sul Polpo prima di `rf.tx`. */
export function percorsoTrasmissione(idVoce) {
  return `/polpo/rf433/pc_${inizioPy(idVoce, 8)}.sub`;
}

/** Argomenti di `rf.tx` per un file già copiato sul Polpo. */
export function argomentiTrasmissione(percorso) {
  return { file: percorso };
}

/** Titolo e testo della conferma prima di trasmettere (`meta` della voce, elenco dei dispositivi registrati). */
export function confermaTrasmissione(nome, meta, dispositivi) {
  const id = prendi(meta, "device", "");
  const dispositivo = veroPy(id) ? nomeDispositivo(dispositivi, id) : "nessun dispositivo registrato";
  return {
    titolo: "Trasmettere a 433,92 MHz?",
    testo: `Codice «${testoPy(nome)}» per: ${testoPy(dispositivo)}.\nDopo questa conferma il Polpo ti chiederà di confermare sul suo schermo.`,
  };
}

/** Messaggio dopo una trasmissione riuscita (risposta di `rf.tx`). */
export function testoTrasmesso(dati, simulato) {
  const s = divisioneVera(prendi(dati, "budget_used_ms", 0), 1000);
  return `Trasmesso. Tempo radio usato nell'ultima ora: ${virgolaFissa(s, 1)} s.` + suffissoSimulato(simulato);
}

/** La colonna «Dettagli» del report per un file .sub (già in HTML). */
export function dettagliReport(testo) {
  try {
    const sub = leggiSub(testo);
    let info = veroPy(sub.raw)
      ? "RAW"
      : `rc-switch ${testoPy(sub.codice.protocollo)} · ${testoPy(sub.codice.bit)} bit · ${testoPy(sub.codice.impulsoUs)} µs`;
    if (veroPy(sub.raw)) {
      const st = analizzaImpulsi(sub.tempiRaw);
      info += ` · ${testoPy(st.breveUs)}/${testoPy(st.lungoUs)} µs · ${escapeHtml(ipotesiProtocollo(st))}`;
    }
    return info;
  } catch (e) {
    if (!(e instanceof ErroreFormato)) throw e;
    return escapeHtml(e.message);
  }
}

/** Data e ora nel formato del report ("22/11/2026 18:30", ora locale). */
export function dataReport(data = new Date()) {
  const due = (n) => String(n).padStart(2, "0");
  return `${due(data.getDate())}/${due(data.getMonth() + 1)}/${data.getFullYear()} ${due(data.getHours())}:${due(data.getMinutes())}`;
}

/**
 * Il report HTML dell'archivio radio. `voci`: `{nome, testo, meta, simulato, sha256}` per ogni file;
 * `dispositivi`: il registro (`{id, name}`); `quando`: la data già scritta (vedi dataReport).
 */
export function reportRadio(voci, dispositivi, quando) {
  const perId = new Map();
  for (const d of dispositivi) perId.set(elemento(d, "id"), d);
  const righe = voci.map((it) => {
    const info = dettagliReport(it.testo);
    const d = perId.get(prendi(it.meta ?? {}, "device", ""));
    const dispositivo = d === undefined ? "—" : prendi(d, "name", "—");
    return (
      `<tr><td>${escapeHtml(it.nome)}</td><td>${escapeHtml(dispositivo)}</td><td>${info}</td>` +
      `<td>${veroPy(it.simulato) ? "SIMULATO" : "reale"}</td><td><tt>${inizioPy(it.sha256, 16)}</tt></td></tr>`
    );
  });
  return (
    "<!doctype html><meta charset='utf-8'><title>Report radio</title>" +
    "<style>body{font-family:sans-serif;margin:2em}td,th{border-bottom:1px solid #ccc;padding:4px 8px;text-align:left}</style>" +
    `<h1>Report radio 433 MHz</h1><p>Creato il ${quando} con Polpo Studio. Solo dispositivi propri.</p>` +
    "<table><tr><th>Nome</th><th>Dispositivo</th><th>Dettagli</th><th>Origine</th><th>SHA-256</th></tr>" +
    righe.join("") +
    "</table>"
  );
}

/** Testo iniziale dell'editor .sub: un codice Princeton di esempio a 24 bit. */
export const TESTO_EDITOR_INIZIALE = scriviSub(new FileSub({ codice: new CodiceRc(1, 24, 0x000001, 350) }));
export const NOME_EDITOR_INIZIALE = "nuovo.sub";

/** Lo stato mostrato sotto l'editor .sub. */
export function statoEditor(testo) {
  let sub;
  try {
    sub = leggiSub(testo);
  } catch (e) {
    if (e instanceof NonSupportato) return `Non supportato: ${e.message}`;
    if (e instanceof ErroreFormato) return `Errore: ${e.message}`;
    throw e;
  }
  const perche = controllaTrasmissibile(sub);
  return "Valido. " + (perche ? `Non supportato per la trasmissione: ${perche}` : "Trasmissibile con il Polpo.");
}

/** Nome del file salvato dall'editor: "nuovo.sub" se vuoto, ".sub" aggiunto se manca. */
export function nomeFileSub(nome) {
  const n = togliSpazi(nome) || NOME_EDITOR_INIZIALE;
  return n.endsWith(".sub") ? n : n + ".sub";
}

/** «Salva nella cassaforte» dell'editor: `errore` se il testo non è un .sub valido, altrimenti il nome del file. */
export function salvataggioEditor(testo, nome) {
  try {
    leggiSub(testo);
  } catch (e) {
    if (!(e instanceof ErroreFormato)) throw e;
    return { errore: e.message, nomeFile: "", messaggio: "" };
  }
  return { errore: "", nomeFile: nomeFileSub(nome), messaggio: "Salvato nella cassaforte." };
}

/** La tabella «Bande supportate»: [banda / modulazione, stato]. */
export const BANDE = Object.freeze([
  ["433,92 MHz · OOK/ASK · codici fissi (rc-switch, PT2262/EV1527)", "Supportato"],
  ["433,92 MHz · OOK · RAW (fino a 4096 impulsi)", "Supportato"],
  ["315 / 868 / 915 MHz", "Non supportato: i moduli RF433 lavorano solo a 433,92 MHz"],
  ["FSK / GFSK / LoRa", "Non supportato dall'hardware"],
  ["Rolling code (KeeLoq, Somfy, auto…)", "Escluso per scelta di sicurezza"],
  ["Disturbo radio, prove a forza bruta", "Escluso: illegale"],
]);
export const NOTA_BANDE =
  "In Italia e in Europa la banda 433,05–434,79 MHz ha limiti di tempo di trasmissione: il Polpo ne tiene conto con il suo limite orario.";
