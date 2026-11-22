// Gli aiuti puri delle pagine NFC, RFID, iButton, USB (DuckyScript) e GPIO (calcolatori): stessi testi, HTML e
// argomenti dei metodi Python di studio/polpo_studio/app/tools/*.py, eseguiti dal generatore con widget finti.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as nfc from "../../../assets/js/studio/strumenti/ndef_app.js";
import * as rfid from "../../../assets/js/studio/protocolli/rfid125.js";
import * as ow from "../../../assets/js/studio/protocolli/onewire.js";
import * as ducky from "../../../assets/js/studio/protocolli/ducky.js";
import * as el from "../../../assets/js/studio/protocolli/elettronica.js";
import { decodificaUtf8 } from "../../../assets/js/studio/strumenti/convertitore.js";
import { B, casi, confronta, esito, ORA } from "./aiuto.mjs";

const NFC = casi("pagina_nfc");
const RF = casi("pagina_rfid");
const IB = casi("pagina_ibutton");
const USB = casi("pagina_usb");
const GP = casi("pagina_gpio");
const tale = (x) => x;

// ---------------- NFC ----------------

test("NFC: HTML dell'analisi di una lettura", () => {
  confronta(NFC.render, (c) => esito(() => nfc.rendiLettura(c.card, c.sim), tale));
});

test("NFC: analizzatore NDEF in esadecimale", () => {
  confronta(
    NFC.analyse_ndef,
    (c) => {
      const r = nfc.analizzaNdefEsadecimale(c.t);
      return { html: r.html, r: { ok: r.ok ? r.html : "error" } };
    },
    (c) => ({ html: c.html, r: c.r }),
  );
});

test("NFC: spazio occupato dal contenuto da scrivere", () => {
  confronta(NFC.size, (c) => nfc.testoSpazio(c.k, c.v, c.l));
});

test("NFC: preparazione di nfc.write_ndef e messaggi dopo la scrittura", () => {
  confronta(
    NFC.write,
    (c) => {
      const p = nfc.preparaScrittura(c.k, c.v, c.l);
      if (!p.ok) return { msg: [[p.errore, true]], conferma: [], req: [], dopo: [] };
      return {
        msg: [[p.messaggioAttesa, false]],
        conferma: [[p.titoloConferma, p.testoConferma]],
        req: [[p.comando, p.args, p.timeout]],
        dopo: c.dopo.map(({ d }) => {
          const e = nfc.esitoScrittura(d, c.sim);
          return { d, msg: [[e.messaggio, false]], att: [["nfc", e.attivita, "avviso", c.sim]] };
        }),
      };
    },
    (c) => ({ msg: c.msg, conferma: c.conferma, req: c.req, dopo: c.dopo }),
  );
  assert.ok(NFC.write.some((c) => c.req.length) && NFC.write.some((c) => !c.req.length));
});

test("NFC: risposta di nfc.read (HTML, messaggio, registro attività)", () => {
  confronta(
    NFC.read,
    (c) => {
      let e;
      try {
        e = nfc.esitoLettura(c.d, c.sim);
      } catch (err) {
        if (!err.tipo) throw err;
        return { r: { errore: { tipo: err.tipo, msg: err.message } } };
      }
      return {
        r: { ok: null },
        html: e.html,
        card_sim: e.simulato,
        msg: [[e.messaggio, false]],
        att: e.attivita === null ? [] : [["nfc", e.attivita, "ok", e.simulato]],
      };
    },
    (c) => ("errore" in c.r ? { r: c.r } : { r: c.r, html: c.html, card_sim: c.card_sim, msg: c.msg, att: c.att }),
  );
});

test("NFC: salvataggio di una lettura nella cassaforte", () => {
  confronta(
    NFC.save,
    (c) => {
      const carta = c.card && Object.fromEntries(c.chiavi.map((k) => [k, c.card[k]]));
      const s = nfc.salvataggioLettura(carta, c.sim, ORA, c.nome);
      if (!s.ok) return { r: { ok: false }, msg: [[s.errore, true]], messi: [] };
      return { r: { ok: true }, msg: [[s.messaggio, false]], messi: [{ categoria: "nfc", nome: s.nome, dati: s.testo, origin: s.origine, meta: s.meta }] };
    },
    (c) => ({ r: c.r, msg: c.msg, messi: c.messi }),
  );
});

test("NFC: report HTML e righe dell'archivio", () => {
  confronta(NFC.report, (c) => nfc.reportLetture(c.voci.map((v) => ({ nome: v.nome, carta: v.card, simulato: v.sim }))), (c) => c.doc);
  confronta(NFC.archivio, (c) => {
    const voci = nfc.vociArchivio([{ nome: c.nome, meta: c.meta, simulato: c.sim }]);
    return voci.length ? nfc.rigaArchivio(voci[0]) : null;
  }, (c) => c.riga);
});

// ---------------- RFID 125 kHz ----------------

test("RFID: HTML del risultato", () => {
  confronta(RF.show_card, (c) => rfid.rendiTessera(new rfid.Em4100(...c.c), c.fonte, c.fmt));
});

test("RFID: raffica dal lettore USB", () => {
  confronta(
    RF.burst,
    (c) => {
      let e;
      try {
        e = rfid.esitoRaffica(new rfid.Raffica(c.t, c.durata, c.pausa), c.dich);
      } catch (err) {
        if (!err.tipo) throw err;
        return { r: { errore: { tipo: err.tipo, msg: err.message } } };
      }
      if (e.carta === null) return { r: { ok: null }, msg: e.messaggi, html: "", src: "", hex: null };
      return { r: { ok: null }, msg: e.messaggi, html: e.html, src: e.fonte, hex: e.carta.esadecimale };
    },
    (c) => ("errore" in c.r ? { r: c.r } : { r: c.r, msg: c.msg, html: c.html, src: c.src, hex: c.hex }),
  );
});

test("RFID: convertitore di formati", () => {
  confronta(
    RF.convert,
    (c) => {
      let e;
      try {
        e = rfid.esitoConversione(c.t);
      } catch (err) {
        if (!err.tipo) throw err;
        return { r: { errore: { tipo: err.tipo, msg: err.message } }, msg: [], html: "", src: "" };
      }
      return e.carta === null ? { r: { ok: false }, msg: [[e.errore, true]], html: "", src: "" } : { r: { ok: true }, msg: [], html: e.html, src: e.fonte };
    },
    (c) => ({ r: c.r, msg: c.msg, html: c.html, src: c.src }),
  );
});

test("RFID: byte dall'RDM6300", () => {
  confronta(
    RF.rdm_feed,
    (c) => {
      const e = rfid.esitoRdm6300(new rfid.ParserRdm6300(), B(c.dati));
      return { r: { ok: null }, msg: e.messaggi, html: e.tessere.length ? e.tessere[e.tessere.length - 1].html : "", info: e.info };
    },
    (c) => ({ r: c.r, msg: c.msg, html: c.html, info: c.info }),
  );
});

test("RFID: salvataggio, archivio, report", () => {
  confronta(
    RF.save,
    (c) => {
      const s = rfid.salvataggioTessera(c.c && new rfid.Em4100(...c.c), "lettore USB (5 ms)", c.prova, c.nome, ORA);
      if (!s.ok) return { r: { ok: false }, msg: [[s.errore, true]], messi: [], att: [] };
      return { r: { ok: true }, msg: [[s.messaggio, false]], messi: [{ categoria: "rfid", nome: s.nome, dati: s.testo, meta: s.meta }], att: [["rfid", s.attivita, "ok"]] };
    },
    (c) => ({ r: c.r, msg: c.msg, messi: c.messi, att: c.att }),
  );
  confronta(RF.archivio, (c) => rfid.rigaArchivioTessera(c.nome, c.meta), (c) => c.riga);
  confronta(RF.report, (c) => rfid.reportTessere(c.voci, ORA), (c) => c.doc);
});

// ---------------- iButton ----------------

test("iButton: analisi di un codice scritto a mano", () => {
  confronta(IB.analyse, (c) => esito(() => ow.testoAnalisiRom(c.t), tale));
});

test("iButton: risposta di ow.search e di ow.reset", () => {
  confronta(
    IB.search,
    (c) => {
      let e;
      try {
        e = ow.esitoRicerca(c.d);
      } catch (err) {
        if (!err.tipo) throw err;
        return { r: { errore: { tipo: err.tipo, msg: err.message } } };
      }
      return { r: { ok: null }, righe: e.righe, msg: [[e.messaggio, false]], att: e.attivita ? [["ibutton", e.attivita, "ok"]] : [] };
    },
    (c) => ("errore" in c.r ? { r: c.r } : { r: c.r, righe: c.righe, msg: c.msg, att: c.att }),
  );
  confronta(IB.presence, (c) => [[ow.messaggioPresenza(c.d), false]], (c) => c.msg);
});

test("iButton: salvataggio della chiave selezionata", () => {
  confronta(
    IB.save.filter((c) => c.t !== null),
    (c) => {
      const s = ow.salvataggioRom(ow.analizzaRom(c.t), ORA);
      return { r: { ok: true }, messi: [{ categoria: "ibutton", nome: s.nome, dati: s.testo, meta: s.meta }] };
    },
    (c) => ({ r: c.r, messi: c.messi }),
  );
});

// ---------------- USB: DuckyScript ----------------

test("DuckyScript: testo del pulsante «Controlla»", () => {
  confronta(
    USB.check,
    (c) => esito(() => ducky.esitoControllo(c.src, c.layout), (e) => ({ ok: e.script.ok, testo: e.testo })),
    (c) => ("errore" in c.r ? c.r : { ok: { ok: c.r.ok, testo: c.testo } }),
  );
});

test("DuckyScript: nome del file e copia sul Polpo (senza eseguire nulla)", () => {
  confronta(
    USB.filename,
    (c) => {
      const f = ducky.nomeFileScript(c.n);
      return f.errore ? { r: null, msg: [[f.errore, true]] } : { r: f.nome, msg: [] };
    },
    (c) => ({ r: c.r, msg: c.msg }),
  );
  confronta(
    USB.copy,
    (c) => {
      const p = ducky.preparaCopia(c.n, c.src, "IT");
      if (!p.ok) return { msg: [[p.errore, true]], scritti: [], att: [] };
      const e = ducky.esitoCopia(p.destinazione, c.sim);
      return {
        msg: [[p.attesa, false], [e.messaggio, false]],
        scritti: [[p.destinazione, decodificaUtf8(p.contenuto)]],
        att: [["usb", e.attivita, "avviso", c.sim]],
      };
    },
    (c) => ({ msg: c.msg, scritti: c.scritti, att: c.att }),
  );
});

test("DuckyScript: salvataggio nella cassaforte", () => {
  confronta(
    USB.save,
    (c) => {
      const s = ducky.salvataggioScript(c.n, c.src, c.layout);
      if (s.errore) return { r: { ok: false }, msg: [[s.errore, true]], messi: [], testo: "" };
      if (!s.ok) return { r: { ok: false }, msg: [], messi: [], testo: s.testo };
      const testo = ducky.esitoControllo(c.src, c.layout).testo;
      return { r: { ok: true }, msg: [[s.messaggio, false]], messi: [{ categoria: s.categoria, nome: s.nome, dati: decodificaUtf8(s.contenuto), meta: s.meta }], testo };
    },
    (c) => ({ r: c.r, msg: c.msg, messi: c.messi, testo: c.testo }),
  );
});

// ---------------- GPIO: calcolatori ----------------

test("Calcolatori: legge di Ohm, partitore, LED, codice colori", () => {
  confronta(GP.ohm, (c) => esito(() => el.testoOhm(c.v, c.i, c.r), tale), (c) => c.testo);
  confronta(GP.divider, (c) => esito(() => el.testoPartitore(c.vin, c.r1, c.r2), tale), (c) => c.testo);
  confronta(GP.led, (c) => esito(() => el.testoLed(c.s, c.l, c.ma), tale), (c) => c.testo);
  confronta(GP.colori, (c) => esito(() => el.testoColori(c.b, c.v), tale), (c) => c.testo);
});
