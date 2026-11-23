// Un finto «PolpoNativo» completo per le prove nel browser delle pagine dell'app per Android: tutti i metodi di
// android/PONTE.md (USB e porta seriale, NFC, Bluetooth LE e infrarossi del telefono) con le stesse regole, gli stessi
// limiti e gli stessi messaggi dell'app vera (android/app/src/main/java/io/github/francesco209177/polpo/). Come
// nell'app, i metodi rispondono subito e gli esiti lenti arrivano dopo, in ordine, come eventi con
// window.__polpoNativo({tipo, ...}) (quella impostata da ascoltaNativo in site/assets/js/studio/link/trasporti.js).
// Anche i tipi degli argomenti sono convertiti come fa la WebView: un oggetto al posto di una stringa diventa
// "undefined", undefined diventa "undefined", un numero al posto di un booleano diventa false, una stringa al posto
// di un intero diventa 0; un numero sbagliato di argomenti è l'errore «Method not found».
//
// Uso con Playwright:
//
//   import { nativoFinto, USB_ESEMPI, TAG_ESEMPI } from "./nativo_finto.mjs";
//   await contesto.addInitScript(nativoFinto, { usb: [USB_ESEMPI.ch340], tag: TAG_ESEMPI.link });
//   ...
//   await pagina.evaluate(() => window.__nativoFinto.appoggiaTag());
//
// Manopole (secondo argomento di addInitScript, solo valori JSON; tra parentesi il valore predefinito):
//   versione ("0.5.0")             versione() dell'app
//   nfc ("pronto")                 "pronto" | "spento" | "assente": telefono().nfc
//   bluetooth ("pronto")           "pronto" | "spento" | "assente": telefono().bluetooth
//   ir (true), usbHost (true)      telefono().ir e telefono().usbHost; senza ir, irTrasmetti dà sempre false
//   ritardo (20)                   ms prima di ogni evento
//   tag ({tipo: "ntag213"})        il tag appoggiato al telefono: {tipo, uid, ndef, formattato, solaLettura, bloccato,
//                                  protetto, pagine}. tipo: "ntag213" | "ntag215" | "ntag216" | "ultralight" | "classic"
//                                  | "felica"; uid in esadecimale; ndef = {kind: "uri" | "text", value, lang} oppure null
//                                  (tag vuoto), predefinito il testo «Ciao dal Polpo»; formattato: false = senza CC;
//                                  solaLettura: CC in sola lettura; bloccato: blocchi statici attivi; protetto: memoria
//                                  protetta da password (read_error); pagine: tutta la memoria in esadecimale (vince
//                                  sul resto). Esempi pronti in TAG_ESEMPI.
//   tagDopoMs (300)                dopo nfcAvvia() e nfcScrivi() il tag si appoggia da solo dopo questi ms;
//                                  null = solo con __nativoFinto.appoggiaTag()
//   attesaScritturaMs (20000)      dopo nfcScrivi(), senza tag entro questo tempo: nfc.errore
//   erroreScrittura (null)         un messaggio: la prossima scrittura NFC fallisce con questo nfc.errore
//   blePermesso (true)             false = la persona nega il permesso Bluetooth
//   dispositiviBle (due)           [{name, addr, rssi, mfr_id, connectable, servizi?, valori?}]; servizi come in
//                                  ble.collegato (predefinito per i collegabili: Batteria 0x180F con 0x2A19 read+notify),
//                                  valori = {uuid caratteristica: base64}
//   batteria (87)                  il livello letto da 0x2A19; con le notifiche attive scende di 1 per volta
//   notificheOgniMs (1000)         intervallo delle ble.notifica
//   durataRicercaMs (null)         se c'è, ogni bleScansiona dura questo (per prove veloci) invece di ms
//   limiteRicerche (true)          come Android: al massimo 5 ricerche ogni 30 s
//   ritardoCollegamentoMs (150)    quanto ci mette bleCollega
//   usb ([])                       dispositivi USB collegati, voci come usbElenco (polpo si calcola dal vid); esempi in
//                                  USB_ESEMPI
//   permessoUsb (true)             false = la persona nega il permesso USB
//   usbDopoTocco (null)            dopo serialeToccoBootloader il dispositivo si stacca e l'elenco diventa questo
//                                  (due usb.cambiati); null = niente cambia
//   risorse ({})                   {percorso: base64} per risorsaBase64; gli altri percorsi si leggono dal sito servito
//   radice (null)                  l'indirizzo della radice del sito (predefinito: …/sito/ di aiuto.mjs, o la radice)
//
// Comandi e registri per la prova (window.__nativoFinto):
//   chiamate                       [[metodo, ...argomenti]] nell'ordine
//   eventi                         gli eventi già consegnati
//   salvati                        salvaFile e salvaRisorsa: [{nome, base64} | {percorso, nome}]
//   seriale                        {aperta: {id, baud, dtr, rts} | null, scritture: [Uint8Array], linee: [{dtr, rts}],
//                                  baud: [n], tocchi: [id], testo(): le scritture come testo UTF-8}
//   suScrittura                    null oppure una funzione (Uint8Array) chiamata a ogni serialeScrivi riuscita
//   datiSeriale(dati)              manda seriale.dati: Uint8Array, array di byte o testo; false se la porta è chiusa
//   collegaUsb(voce), scollegaUsb(id)   un dispositivo collegato o staccato (usb.cambiati, seriale.chiusa)
//   tag                            il tag di adesso ({uid, memoria: Uint8Array, ...}); dopo una scrittura ha il messaggio
//   appoggiaTag(tag?)              appoggia il tag (o un altro, stesse chiavi della manopola): scrive se c'è una
//                                  scrittura in attesa, altrimenti nfc.tag se la lettura è avviata; false se niente
//   ir                             le trasmissioni riuscite: [{frequenza, tempi}]
//   ble                            {collegato: addr | null, notifiche: [caratteristica], ricerca: bool}
//   scollegaBle(motivo)            il dispositivo si stacca da sé (predefinito "fuori portata")
//   impostaStato({nfc, bluetooth}) l'NFC o il Bluetooth si spengono o si accendono (nfc.stato, scollegamenti)
//   pausa(), riprendi()            l'app va in secondo piano e torna (la scrittura NFC si annulla, la ricerca finisce)
//   manda(evento)                  un evento qualsiasi per la pagina

/** Da passare a addInitScript: definisce window.PolpoNativo e window.__nativoFinto. Deve bastare a sé stessa. */
export function nativoFinto(opzioni = {}) {
  const o = {
    versione: "0.5.0", nfc: "pronto", bluetooth: "pronto", ir: true, usbHost: true, ritardo: 20,
    tag: { tipo: "ntag213" }, tagDopoMs: 300, attesaScritturaMs: 20000, erroreScrittura: null,
    blePermesso: true, dispositiviBle: null, batteria: 87, notificheOgniMs: 1000, durataRicercaMs: null,
    limiteRicerche: true, ritardoCollegamentoMs: 150,
    usb: [], permessoUsb: true, usbDopoTocco: null, risorse: {}, radice: null,
    ...opzioni,
  };

  // ---------------- aiuti ----------------

  const enc = new TextEncoder();
  const b64 = (byte) => {
    let s = "";
    for (let i = 0; i < byte.length; i += 0x8000) s += String.fromCharCode.apply(null, byte.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const daB64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  const hex = (byte) => Array.from(byte, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  const daHex = (t) => Uint8Array.from(String(t).replace(/\s+/g, "").match(/../g) || [], (h) => parseInt(h, 16));
  const copia = (x) => JSON.parse(JSON.stringify(x));

  // come la WebView converte gli argomenti per i metodi Java
  const comeStringa = (v, metodo) => {
    if (typeof v === "string") return v;
    if (v === null) return null;
    if (typeof v === "object") console.warn(`PolpoNativo.${metodo}: un oggetto dove serve una stringa, nell'app arriva "undefined" (serve JSON.stringify?)`);
    if (v === undefined || typeof v === "object" || typeof v === "function") return "undefined";
    return String(v);
  };
  const comeIntero = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);
  const comeBooleano = (v) => v === true;

  const fi = {
    opzioni: o, chiamate: [], eventi: [], salvati: [], ir: [], suScrittura: null,
    seriale: {
      aperta: null, scritture: [], linee: [], baud: [], tocchi: [],
      testo() {
        const tutto = new Uint8Array(this.scritture.reduce((n, s) => n + s.length, 0));
        let i = 0;
        for (const s of this.scritture) { tutto.set(s, i); i += s.length; }
        return new TextDecoder().decode(tutto);
      },
    },
    ble: { collegato: null, notifiche: [], ricerca: false },
  };
  let inPrimoPiano = true;

  const manda = (ev, dopo = o.ritardo) => {
    const copiato = copia(ev);
    setTimeout(() => {
      fi.eventi.push(copiato);
      const f = window.__polpoNativo;
      if (typeof f === "function") f(copia(copiato));
    }, dopo);
  };

  const metodi = {};
  const definisci = (nome, arita, fn) => {
    metodi[nome] = (...a) => {
      if (!arita.includes(a.length)) throw new Error("Method not found");
      fi.chiamate.push([nome, ...a]);
      return fn(...a);
    };
  };

  // ---------------- generali ----------------

  definisci("versione", [0], () => o.versione);
  definisci("telefono", [0], () => JSON.stringify({ nfc: o.nfc, bluetooth: o.bluetooth, ir: !!o.ir, usbHost: !!o.usbHost }));
  definisci("salvaFile", [2], (nome, base64) => { fi.salvati.push({ nome: comeStringa(nome), base64: comeStringa(base64) }); });
  definisci("salvaRisorsa", [2], (percorso, nome) => { fi.salvati.push({ percorso: comeStringa(percorso), nome: comeStringa(nome) }); });

  // le regole di Risorse.file: niente «.», «..», «\», NUL; le cartelle diventano il loro index.html
  definisci("risorsaBase64", [1], (percorso) => {
    const p = (comeStringa(percorso, "risorsaBase64") ?? "").replace(/^\/+/, "");
    let dec;
    try { dec = decodeURIComponent(p.replace(/\+/g, "%2B")); } catch { return ""; }
    if (dec.includes("\0") || dec.includes("\\")) return "";
    const parti = dec.split("/").filter((x) => x.length);
    if (parti.some((x) => x === "." || x === "..")) return "";
    const file = (dec === "" || dec.endsWith("/") ? [...parti, "index.html"] : parti).join("/");
    if (Object.prototype.hasOwnProperty.call(o.risorse, file)) return o.risorse[file];
    const radice = o.radice || location.origin + (location.pathname.startsWith("/sito/") ? "/sito/" : "/");
    try {
      const x = new XMLHttpRequest();
      x.open("GET", radice + file, false);
      x.overrideMimeType("text/plain; charset=x-user-defined");
      x.send();
      if (x.status !== 200) return "";
      const t = x.responseText;
      const byte = new Uint8Array(t.length);
      for (let i = 0; i < t.length; i++) byte[i] = t.charCodeAt(i) & 0xff;
      return b64(byte);
    } catch {
      return "";
    }
  });

  // ---------------- USB e porta seriale ----------------

  const usb = { lista: (o.usb || []).map(copia), porta: null };
  const VID_ESPRESSIF = 0x303a;
  const voce = (d) => ({
    id: String(d.id), nome: d.nome ?? "", produttore: d.produttore ?? "", vid: d.vid ?? 0, pid: d.pid ?? 0,
    classi: d.classi ?? [], seriale: !!d.seriale, polpo: d.vid === VID_ESPRESSIF, permesso: !!d.permesso,
  });
  const ordinati = () => [...usb.lista].sort((a, b) => (a.vid === VID_ESPRESSIF ? 0 : 1) - (b.vid === VID_ESPRESSIF ? 0 : 1));
  const trova = (id) => usb.lista.find((d) => String(d.id) === id);
  const PERMESSO_USB_NEGATO = "Permesso USB negato: senza il permesso l'app non può parlare con il dispositivo.";
  const errSeriale = (messaggio) => manda({ tipo: "seriale.errore", messaggio });
  const tocco = (ok, messaggio) => manda({ tipo: "seriale.tocco", ok, messaggio });
  const chiudiPorta = (motivo) => {
    if (!usb.porta) return;
    usb.porta = null;
    fi.seriale.aperta = null;
    manda({ tipo: "seriale.chiusa", motivo });
  };
  const baudValido = (b) => b !== 1200 && b >= 300 && b <= 4000000;

  // le regole di OpzioniSeriale.da: {baud: 115200, dtr: true, rts: false}, mai 1200 baud
  function opzioniSeriale(testo) {
    const t = (testo ?? "").trim();
    const polpo = { baud: 115200, dtr: true, rts: false };
    if (t === "" || t === "undefined" || t === "null") return polpo;
    const nonValide = new Error("Opzioni della porta non valide.");
    let v;
    try { v = JSON.parse(t); } catch { throw nonValide; }
    if (!v || typeof v !== "object" || Array.isArray(v)) throw nonValide;
    const r = { ...polpo };
    if ("baud" in v) {
      if (typeof v.baud !== "number" || !Number.isInteger(v.baud)) throw nonValide;
      r.baud = v.baud;
    }
    if (r.baud === 1200) throw new Error("1200 baud non è permesso: riavvierebbe il Polpo nel bootloader.");
    if (!baudValido(r.baud)) throw new Error("Velocità non valida: da 300 a 4000000 baud.");
    for (const k of ["dtr", "rts"]) {
      if (!(k in v)) continue;
      if (typeof v[k] !== "boolean") throw nonValide;
      r[k] = v[k];
    }
    return r;
  }

  // il permesso di Android per un dispositivo: nel finto la risposta è subito
  const conPermesso = (d) => {
    if (d.permesso) return true;
    if (!o.permessoUsb) return false;
    d.permesso = true;
    return true;
  };

  definisci("usbElenco", [0], () => JSON.stringify(ordinati().map(voce)));
  definisci("serialeElenco", [0], () => JSON.stringify(ordinati().filter((d) => d.seriale).map(voce)));

  definisci("serialeApri", [1, 2], (id, opzioniJson) => {
    const idS = comeStringa(id, "serialeApri") ?? "";
    let op;
    try { op = opzioniSeriale(opzioniJson === undefined ? null : comeStringa(opzioniJson, "serialeApri")); } catch (e) { return errSeriale(e.message); }
    chiudiPorta("porta chiusa");
    const d = trova(idS);
    if (!d) return errSeriale("Il dispositivo USB non c'è più: è stato scollegato?");
    if (!conPermesso(d)) return errSeriale(PERMESSO_USB_NEGATO);
    if (!d.seriale) return errSeriale("Questo dispositivo USB non è una porta seriale.");
    usb.porta = { id: idS, ...op };
    fi.seriale.aperta = { id: idS, ...op };
    manda({ tipo: "seriale.aperta", nome: d.nome ?? "" });
  });

  definisci("serialeScrivi", [1], (base64) => {
    const t = comeStringa(base64, "serialeScrivi");
    if (!usb.porta || t === null) return false;
    let dati;
    try { dati = daB64(t); } catch { return false; }
    fi.seriale.scritture.push(dati);
    if (typeof fi.suScrittura === "function") {
      try { fi.suScrittura(dati); } catch (e) { console.error(e); }
    }
    return true;
  });

  definisci("serialeLinee", [2], (dtr, rts) => {
    if (!usb.porta) return false;
    usb.porta.dtr = comeBooleano(dtr);
    usb.porta.rts = comeBooleano(rts);
    fi.seriale.linee.push({ dtr: usb.porta.dtr, rts: usb.porta.rts });
    return true;
  });

  definisci("serialeBaud", [1], (baud) => {
    const b = comeIntero(baud);
    if (!usb.porta || !baudValido(b)) return false;
    usb.porta.baud = b;
    fi.seriale.baud.push(b);
    return true;
  });

  definisci("serialeToccoBootloader", [1], (id) => {
    const idS = comeStringa(id, "serialeToccoBootloader") ?? "";
    const d = trova(idS);
    if (!d) return tocco(false, "Il dispositivo USB non c'è più: è stato scollegato?");
    if (usb.porta && usb.porta.id === idS) chiudiPorta("porta chiusa");
    if (!conPermesso(d)) return tocco(false, PERMESSO_USB_NEGATO);
    if (!d.seriale) return tocco(false, "Questo dispositivo USB non è una porta seriale.");
    fi.seriale.tocchi.push(idS);
    tocco(true, "Segnale mandato: un ESP32-S3 con l'USB nativa ora riparte nel bootloader.");
    if (Array.isArray(o.usbDopoTocco)) {
      setTimeout(() => {
        usb.lista = usb.lista.filter((x) => x !== d);
        manda({ tipo: "usb.cambiati" });
        setTimeout(() => {
          usb.lista = o.usbDopoTocco.map(copia);
          manda({ tipo: "usb.cambiati" });
        }, 300);
      }, 100);
    }
  });

  definisci("serialeChiudi", [0], () => { chiudiPorta("porta chiusa"); });

  fi.datiSeriale = (dati) => {
    if (!usb.porta) return false;
    const byte = typeof dati === "string" ? enc.encode(dati) : Uint8Array.from(dati);
    manda({ tipo: "seriale.dati", dati: b64(byte) });
    return true;
  };
  fi.collegaUsb = (d) => {
    usb.lista.push(copia(d));
    manda({ tipo: "usb.cambiati" });
  };
  fi.scollegaUsb = (id) => {
    const idS = String(id ?? usb.porta?.id ?? usb.lista[0]?.id);
    usb.lista = usb.lista.filter((d) => String(d.id) !== idS);
    manda({ tipo: "usb.cambiati" }); // nell'app prima usb.cambiati, poi seriale.chiusa
    if (usb.porta && usb.porta.id === idS) chiudiPorta("scollegato");
  };

  // ---------------- NFC del telefono ----------------

  const NFC_ASSENTE = "Questo telefono non ha l'NFC.";
  const NFC_SPENTO = "L'NFC è spento: accendilo nelle impostazioni del telefono.";
  const PREFISSI = [
    "", "http://www.", "https://www.", "http://", "https://", "tel:", "mailto:",
    "ftp://anonymous:anonymous@", "ftp://ftp.", "ftps://", "sftp://", "smb://", "nfs://",
    "ftp://", "dav://", "news:", "telnet://", "imap:", "rtsp://", "urn:",
    "pop:", "sip:", "sips:", "tftp:", "btspp://", "btl2cap://", "btgoep://",
    "tcpobex://", "irdaobex://", "file://", "urn:epc:id:", "urn:epc:tag:", "urn:epc:pat:",
    "urn:epc:raw:", "urn:epc:", "urn:nfc:",
  ];
  const unisci = (...parti) => Uint8Array.from(parti.flatMap((p) => Array.from(p)));
  const record = (tipo, contenuto) => {
    const corto = contenuto.length <= 255;
    const lunghezza = corto ? [contenuto.length] : [24, 16, 8, 0].map((s) => (contenuto.length >> s) & 0xff);
    return unisci([0xc0 | (corto ? 0x10 : 0) | 0x01, 1], lunghezza, [tipo.charCodeAt(0)], contenuto);
  };
  const messaggioUri = (uri) => {
    let c = 0;
    for (let i = 1; i < PREFISSI.length; i++) if (PREFISSI[i].length > PREFISSI[c].length && uri.startsWith(PREFISSI[i])) c = i;
    return record("U", unisci([c], enc.encode(uri.slice(PREFISSI[c].length))));
  };
  const messaggioTesto = (testo, lingua) => record("T", unisci([lingua.length & 0x3f], enc.encode(lingua), enc.encode(testo)));
  const messaggio = (n) => (n.kind === "uri" ? messaggioUri(n.value) : messaggioTesto(n.value, n.lang || "it"));
  const avvolgiTlv = (m) => unisci([0x03], m.length < 0xff ? [m.length] : [0xff, (m.length >> 8) & 0xff, m.length & 0xff], m, [0xfe]);

  const MODELLI = {
    ntag213: { nome: "NTAG213", pagine: 45, ultima: 39, dinamico: 40, cc: 0x12, memoria: 0x0f },
    ntag215: { nome: "NTAG215", pagine: 135, ultima: 129, dinamico: 130, cc: 0x3e, memoria: 0x11 },
    ntag216: { nome: "NTAG216", pagine: 231, ultima: 225, dinamico: 226, cc: 0x6d, memoria: 0x13 },
    ultralight: { nome: "MIFARE Ultralight", pagine: 16, ultima: 15, dinamico: 0, cc: 0x06, memoria: null },
  };

  function creaTag(t = {}) {
    const tipo = t.tipo || "ntag213";
    if (tipo === "classic") return { tipo, uid: daHex(t.uid || "DEADBEEF"), atqa: 0x0004, sak: 0x08, tecnologie: ["NfcA", "MifareClassic", "NdefFormatable"] };
    if (tipo === "felica") return { tipo, uid: daHex(t.uid || "012E4CD1A2B3C4D5"), atqa: -1, sak: -1, tecnologie: ["NfcF"] };
    const m = MODELLI[tipo];
    if (!m) throw new Error(`nativoFinto: tag sconosciuto «${tipo}»`);
    const uid = daHex(t.uid || "04513A7C226B80");
    const mem = new Uint8Array(m.pagine * 4);
    if (t.pagine) {
      mem.set(daHex(t.pagine).subarray(0, mem.length));
    } else {
      // come il Polpo virtuale (polpo/sim/mondo.cpp): UID con i byte di controllo, CC, poi il messaggio NDEF
      mem.set([uid[0], uid[1], uid[2], 0x88 ^ uid[0] ^ uid[1] ^ uid[2], uid[3], uid[4], uid[5], uid[6], uid[3] ^ uid[4] ^ uid[5] ^ uid[6], 0x48]);
      if (t.bloccato) mem.set([0xf8, 0xff], 10);
      if (t.formattato !== false) {
        mem.set([0xe1, 0x10, m.cc, t.solaLettura ? 0x0f : 0x00], 12);
        const n = t.ndef === undefined ? { kind: "text", value: "Ciao dal Polpo", lang: "it" } : t.ndef;
        mem.set(n ? avvolgiTlv(messaggio(n)) : [0x03, 0x00, 0xfe], 16);
      }
      if (m.dinamico) mem.set([0x00, 0x00, 0x00, 0xbd], m.dinamico * 4);
    }
    return {
      tipo, modello: m, uid, atqa: 0x0044, sak: 0x00, protetto: !!t.protetto, memoria: mem,
      versione: m.memoria === null ? null : Uint8Array.from([0x00, 0x04, 0x04, 0x02, 0x01, 0x00, m.memoria, 0x03]),
      tecnologie: ["NfcA", "MifareUltralight", mem[12] === 0xe1 ? "Ndef" : "NdefFormatable"],
    };
  }

  const famiglia = (sak, atqa) =>
    ({
      0x00: "NFC Type 2 (NTAG / MIFARE Ultralight)", 0x08: "MIFARE Classic 1K (o compatibile)", 0x09: "MIFARE Mini",
      0x18: "MIFARE Classic 4K (o compatibile)", 0x10: "MIFARE Plus (SL2)", 0x11: "MIFARE Plus (SL2)",
      0x28: "Smart card con emulazione MIFARE Classic", 0x38: "Smart card con emulazione MIFARE Classic",
    })[sak] ??
    (sak === 0x20 ? (atqa === 0x0344 ? "MIFARE DESFire" : "Smart card ISO 14443-4 (DESFire, Plus SL3, carta bancaria, documento...)") : "Carta ISO 14443-A non riconosciuta");
  const famigliaAltra = (tec) =>
    tec.includes("NfcB") ? "Carta ISO 14443-B (NFC-B)" : tec.includes("NfcF") ? "FeliCa (NFC-F)" : tec.includes("NfcV") ? "Tag ISO 15693 (NFC-V)" : "Tag NFC non riconosciuto";

  // la carta di «nfc.tag», come Carta.carta nell'app (e la risposta nfc.read del Polpo)
  function carta(t) {
    const c = { present: true, uid: hex(t.uid) };
    if (t.sak === -1) {
      Object.assign(c, { atqa: -1, sak: -1, family: famigliaAltra(t.tecnologie) });
    } else {
      Object.assign(c, { atqa: t.atqa, sak: t.sak, family: famiglia(t.sak, t.atqa) });
      if (t.sak === 0x00) {
        c.model = t.modello.nome;
        if (t.versione) c.version = hex(t.versione);
        if (t.protetto) c.read_error = "memoria non leggibile (pagine protette?)";
        else c.pages = hex(t.memoria.subarray(0, (t.modello.ultima + 1) * 4));
      }
    }
    c.tecnologie = [...t.tecnologie];
    return c;
  }

  // la richiesta di nfcScrivi, come NdefDati.richiesta
  function richiestaNdef(json) {
    let v;
    try { v = JSON.parse(json ?? ""); } catch { throw new Error("Richiesta di scrittura non valida."); }
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Richiesta di scrittura non valida.");
    const valore = (v.value === undefined || v.value === null ? "" : String(v.value)).trim();
    if (!valore || enc.encode(valore).length > 400) throw new Error("Contenuto vuoto o oltre 400 byte.");
    if (v.kind === "uri") return messaggioUri(valore);
    if (v.kind !== "text") throw new Error("Il tipo deve essere «uri» (link) o «text» (testo).");
    const lingua = (v.lang === undefined || v.lang === null ? "" : String(v.lang)).trim() || "it";
    if (!/^[A-Za-z0-9-]{1,63}$/.test(lingua)) throw new Error("Lingua non valida: per esempio «it» o «en-US».");
    return messaggioTesto(valore, lingua);
  }

  const nfc = { lettura: false, scrittura: null, timer: null };
  fi.tag = creaTag(o.tag || {});
  const errNfc = (messaggio) => manda({ tipo: "nfc.errore", messaggio });
  const prendiScrittura = () => {
    const m = nfc.scrittura;
    nfc.scrittura = null;
    clearTimeout(nfc.timer);
    return m;
  };
  const prontoNfc = () => {
    if (o.nfc === "pronto") return true;
    errNfc(o.nfc === "assente" ? NFC_ASSENTE : NFC_SPENTO);
    return false;
  };
  const appoggiaDaSolo = () => { if (o.tagDopoMs !== null && o.tagDopoMs !== undefined) setTimeout(() => fi.appoggiaTag(), o.tagDopoMs); };

  function scriviTag(t, m) {
    if (o.erroreScrittura) {
      const e = o.erroreScrittura;
      o.erroreScrittura = null;
      return errNfc(e);
    }
    if (t.sak === 0x00) {
      const s = t.memoria;
      const d = t.modello.dinamico * 4;
      const problema = s[12] !== 0xe1 ? "tag non formattato NDEF" : s[15] !== 0x00 ? "tag in sola lettura"
        : s[10] || s[11] ? "tag con pagine bloccate" : d && (s[d] || s[d + 1] || s[d + 2]) ? "tag con blocchi dinamici attivi" : null;
      if (problema) return errNfc(`Scrittura rifiutata: ${problema}.`);
    }
    if (!t.tecnologie.includes("Ndef")) {
      return errNfc(t.tecnologie.includes("NdefFormatable") ? "Scrittura rifiutata: tag non formattato NDEF (l'app non formatta i tag)." : "Scrittura rifiutata: questo tag non supporta NDEF.");
    }
    if (t.protetto) return errNfc("Errore di scrittura: tieni fermo il tag e riprova.");
    // lo spazio del CC meno l'intestazione del TLV (sul telefono vero può essere qualche byte in meno)
    const area = t.memoria[14] * 8;
    const massimo = area - (area - 2 > 254 ? 4 : 2);
    if (m.length > massimo) return errNfc(`Scrittura rifiutata: contenuto troppo grande per questo tag (${m.length} byte, al massimo ${massimo}).`);
    const tlv = avvolgiTlv(m);
    t.memoria.set(tlv, 16);
    manda({ tipo: "nfc.scritto", bytes: tlv.length, model: t.modello.nome, uid: hex(t.uid) });
  }

  definisci("nfcAvvia", [0], () => {
    if (!prontoNfc()) return false;
    nfc.lettura = true;
    appoggiaDaSolo();
    return true;
  });
  definisci("nfcFerma", [0], () => { nfc.lettura = false; });
  definisci("nfcScrivi", [1], (json) => {
    if (!prontoNfc()) return false;
    let m;
    try { m = richiestaNdef(comeStringa(json, "nfcScrivi")); } catch (e) { errNfc(e.message); return false; }
    if (nfc.scrittura) { errNfc("C'è già una scrittura in attesa di un tag."); return false; }
    nfc.scrittura = m;
    nfc.timer = setTimeout(() => { if (prendiScrittura()) errNfc("Nessun tag appoggiato entro 20 s."); }, o.attesaScritturaMs);
    appoggiaDaSolo();
    return true;
  });

  fi.appoggiaTag = (nuovo) => {
    if (nuovo) fi.tag = creaTag(nuovo);
    if (o.nfc !== "pronto" || !inPrimoPiano) return false;
    if (nfc.scrittura) {
      scriviTag(fi.tag, prendiScrittura());
      return true;
    }
    if (!nfc.lettura) return false;
    manda({ tipo: "nfc.tag", carta: carta(fi.tag) });
    return true;
  };

  // ---------------- Bluetooth LE del telefono ----------------

  const BLE_ASSENTE = "Questo telefono non ha il Bluetooth LE.";
  const BLE_SPENTO = "Il Bluetooth è spento: accendilo nelle impostazioni del telefono.";
  const BLE_NEGATO = "Permesso negato: senza «Dispositivi nelle vicinanze» l'app non può usare il Bluetooth. Puoi concederlo nelle impostazioni dell'app.";
  const BASE_UUID = "-0000-1000-8000-00805f9b34fb";
  const BATTERIA = "0000180f" + BASE_UUID;
  const LIVELLO = "00002a19" + BASE_UUID;
  const dispositivi = (o.dispositiviBle || [
    { name: "Cuffie di Marta", addr: "6A:14:9F:20:3B:11", rssi: -52, mfr_id: 0x004c, connectable: true },
    { name: "", addr: "42:9B:E0:55:D2:7F", rssi: -83, mfr_id: -1, connectable: false },
  ]).map(copia);
  const ble = { ricerca: null, collegato: null, inCollegamento: null, ultimo: "", notifiche: new Map(), avvii: [] };
  const errBle = (messaggio) => manda({ tipo: "ble.errore", messaggio });
  const prontoBle = () => {
    if (o.bluetooth === "pronto") return true;
    errBle(o.bluetooth === "assente" ? BLE_ASSENTE : BLE_SPENTO);
    return false;
  };
  const serviziDi = (d) => d.servizi ?? [{ uuid: BATTERIA, caratteristiche: [{ uuid: LIVELLO, proprieta: ["read", "notify"] }] }];
  const scollegato = (addr, motivo) => ({ tipo: "ble.scollegato", addr, motivo });

  // come BleDati.uuid: per intero oppure corto a 16 o 32 bit
  function uuid(testo) {
    const s = (testo ?? "").trim().toLowerCase().replace(/^0x/, "");
    if (/^[0-9a-f]{4}$/.test(s)) return "0000" + s + BASE_UUID;
    if (/^[0-9a-f]{8}$/.test(s)) return s + BASE_UUID;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) return s;
    throw new Error(`UUID non valido: ${(testo ?? "").slice(0, 40)}`);
  }

  function finisciRicerca() {
    if (!ble.ricerca) return;
    clearTimeout(ble.ricerca);
    ble.ricerca = null;
    fi.ble.ricerca = false;
    const devices = [...dispositivi].sort((a, b) => b.rssi - a.rssi).slice(0, 40)
      .map(({ name, addr, rssi, mfr_id, connectable }) => ({ name, addr, rssi, mfr_id, connectable }));
    manda({ tipo: "ble.risultato", devices });
  }

  function staccaBle(motivo) {
    const d = ble.collegato;
    if (!d) return;
    for (const t of ble.notifiche.values()) clearInterval(t);
    ble.notifiche.clear();
    ble.collegato = null;
    fi.ble.collegato = null;
    fi.ble.notifiche = [];
    manda(scollegato(d.addr.toUpperCase(), motivo));
  }

  definisci("bleScansiona", [1], (ms) => {
    if (ble.ricerca) return errBle("C'è già una ricerca in corso.");
    if (!prontoBle()) return;
    if (!o.blePermesso) return errBle(BLE_NEGATO);
    if (!inPrimoPiano) return errBle("La ricerca Bluetooth funziona solo con l'app in primo piano.");
    const adesso = Date.now();
    ble.avvii = ble.avvii.filter((t) => adesso - t < 30000);
    if (o.limiteRicerche && ble.avvii.length >= 5) return errBle("Troppe ricerche ravvicinate: Android ne permette 5 ogni 30 secondi. Aspetta un poco e riprova.");
    ble.avvii.push(adesso);
    const durata = o.durataRicercaMs ?? Math.min(10000, Math.max(500, comeIntero(ms)));
    ble.ricerca = setTimeout(finisciRicerca, durata);
    fi.ble.ricerca = true;
  });

  definisci("bleCollega", [1], (addr) => {
    const a = (comeStringa(addr, "bleCollega") ?? "").trim().toUpperCase();
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(a)) return errBle("Indirizzo Bluetooth non valido.");
    if (!prontoBle()) return;
    if (!o.blePermesso) return errBle(BLE_NEGATO);
    finisciRicerca();
    staccaBle("nuovo collegamento");
    ble.ultimo = a;
    ble.inCollegamento = a;
    const d = dispositivi.find((x) => x.addr.toUpperCase() === a);
    setTimeout(() => {
      if (ble.inCollegamento !== a) return;
      ble.inCollegamento = null;
      if (!d || !d.connectable) return errBle("Il dispositivo non risponde: è acceso e vicino?");
      ble.collegato = d;
      fi.ble.collegato = a;
      manda({ tipo: "ble.collegato", addr: a, servizi: serviziDi(d) });
    }, o.ritardoCollegamentoMs);
  });

  function caratteristica(servizio, car, metodo) {
    if (!ble.collegato) { errBle("Nessun dispositivo collegato."); return null; }
    let s, c;
    try {
      s = uuid(comeStringa(servizio, metodo));
      c = uuid(comeStringa(car, metodo));
    } catch (e) { errBle(e.message); return null; }
    const trovata = serviziDi(ble.collegato).find((x) => x.uuid === s)?.caratteristiche.find((x) => x.uuid === c);
    if (!trovata) { errBle("Servizio o caratteristica non trovati sul dispositivo."); return null; }
    return { servizio: s, caratteristica: c, proprieta: trovata.proprieta };
  }
  const valore = (d, c) => (c === LIVELLO ? b64(Uint8Array.of(Math.max(0, Math.min(100, o.batteria)))) : d.valori?.[c] ?? "");

  definisci("bleLeggi", [2], (servizio, car) => {
    const c = caratteristica(servizio, car, "bleLeggi");
    if (!c) return;
    if (!c.proprieta.includes("read")) return errBle("La caratteristica non si può leggere.");
    manda({ tipo: "ble.letto", servizio: c.servizio, caratteristica: c.caratteristica, dati: valore(ble.collegato, c.caratteristica) });
  });

  definisci("bleNotifiche", [3], (servizio, car, attive) => {
    const c = caratteristica(servizio, car, "bleNotifiche");
    if (!c) return;
    if (!c.proprieta.includes("notify") && !c.proprieta.includes("indicate")) return errBle("La caratteristica non manda notifiche.");
    clearInterval(ble.notifiche.get(c.caratteristica));
    ble.notifiche.delete(c.caratteristica);
    if (comeBooleano(attive)) {
      const d = ble.collegato;
      ble.notifiche.set(c.caratteristica, setInterval(() => {
        if (ble.collegato !== d) return;
        if (c.caratteristica === LIVELLO) o.batteria = Math.max(0, o.batteria - 1);
        manda({ tipo: "ble.notifica", servizio: c.servizio, caratteristica: c.caratteristica, dati: valore(d, c.caratteristica) }, 0);
      }, o.notificheOgniMs));
    }
    fi.ble.notifiche = [...ble.notifiche.keys()];
  });

  definisci("bleScollega", [0], () => {
    if (ble.collegato) return staccaBle("richiesta");
    ble.inCollegamento = null;
    manda(scollegato(ble.ultimo, "richiesta"));
  });

  fi.scollegaBle = (motivo = "fuori portata") => staccaBle(motivo);

  // ---------------- infrarossi del telefono ----------------

  definisci("irTrasmetti", [2], (frequenza, tempi) => {
    const f = comeIntero(frequenza);
    if (!o.ir) return false;
    let durate;
    try { durate = JSON.parse(comeStringa(tempi, "irTrasmetti") ?? ""); } catch { return false; }
    if (!Array.isArray(durate) || durate.length === 0 || durate.length > 1024) return false;
    if (!durate.every((d) => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 2000000)) return false;
    if (f < 20000 || f > 60000 || durate.reduce((a, b) => a + b, 0) > 2000000) return false;
    fi.ir.push({ frequenza: f, tempi: durate });
    return true;
  });

  // ---------------- il telefono intorno ----------------

  fi.impostaStato = ({ nfc: nuovoNfc, bluetooth } = {}) => {
    if (nuovoNfc && nuovoNfc !== o.nfc) {
      o.nfc = nuovoNfc;
      if (nuovoNfc !== "assente") manda({ tipo: "nfc.stato", stato: nuovoNfc });
      if (nuovoNfc !== "pronto" && prendiScrittura()) errNfc(NFC_SPENTO);
    }
    if (bluetooth && bluetooth !== o.bluetooth) {
      o.bluetooth = bluetooth;
      if (bluetooth !== "pronto") {
        if (ble.ricerca) {
          clearTimeout(ble.ricerca);
          ble.ricerca = null;
          fi.ble.ricerca = false;
          errBle("Il Bluetooth è stato spento.");
        }
        staccaBle("bluetooth spento");
      }
    }
  };
  fi.pausa = () => {
    inPrimoPiano = false;
    if (prendiScrittura()) errNfc("Scrittura annullata: l'app non è più in primo piano.");
    finisciRicerca();
  };
  fi.riprendi = () => { inPrimoPiano = true; };
  fi.manda = (ev) => manda(ev);

  window.PolpoNativo = metodi;
  window.__nativoFinto = fi;
}

/** Dispositivi USB d'esempio per la manopola `usb` (id come nell'app: il numero del dispositivo, in una stringa). */
export const USB_ESEMPI = Object.freeze({
  polpo: { id: "1002", nome: "Polpo", produttore: "Espressif", vid: 0x303a, pid: 0x1001, classi: [2, 10, 3], seriale: true, permesso: false },
  polpoRom: { id: "1004", nome: "USB JTAG/serial debug unit", produttore: "Espressif", vid: 0x303a, pid: 0x1001, classi: [2, 10, 255], seriale: true, permesso: false },
  ch340: { id: "1003", nome: "USB Serial", produttore: "QinHeng Electronics", vid: 0x1a86, pid: 0x7523, classi: [255], seriale: true, permesso: false },
  cp2102: { id: "1005", nome: "CP2102 USB to UART Bridge Controller", produttore: "Silicon Labs", vid: 0x10c4, pid: 0xea60, classi: [255], seriale: true, permesso: false },
  chiavetta: { id: "1006", nome: "USB Flash Disk", produttore: "Generic", vid: 0x058f, pid: 0x6387, classi: [8], seriale: false, permesso: false },
});

/** Tag d'esempio per la manopola `tag` e per appoggiaTag(). */
export const TAG_ESEMPI = Object.freeze({
  ntag213: { tipo: "ntag213" }, // testo «Ciao dal Polpo» in italiano
  link: { tipo: "ntag215", ndef: { kind: "uri", value: "https" + "://example.org/polpo" } },
  vuoto: { tipo: "ntag213", ndef: null },
  nonFormattato: { tipo: "ntag213", formattato: false },
  solaLettura: { tipo: "ntag213", solaLettura: true },
  bloccato: { tipo: "ntag213", bloccato: true },
  protetto: { tipo: "ntag216", protetto: true },
  ultralight: { tipo: "ultralight" },
  classic: { tipo: "classic" },
  felica: { tipo: "felica" },
});
