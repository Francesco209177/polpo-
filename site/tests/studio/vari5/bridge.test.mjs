// Parità di protocolli/bridge.js con devices/bridge.py, app/tools/bridge_panel.py e le schede Bridge, Grove e iButton
// di Polpo Studio (casi generati da genera_vari5.py con gli strumenti veri e un contesto finto).
import test from "node:test";
import assert from "node:assert/strict";
import * as B from "../../../assets/js/studio/protocolli/bridge.js";
import { vociPorte } from "../../../assets/js/studio/protocolli/schede_usb.js";
import { ErroreLink, ErroreTrasporto } from "../../../assets/js/studio/link/client.js";
import { AZIONI, ModalitaLaboratorio } from "../../../assets/js/studio/sicurezza/laboratorio.js";
import { STAMP, casi, confronta, esito } from "./aiuto.mjs";

const C = casi("bridge");

test("bridge: costanti, nomi I2C, modi dei pin e testi delle pagine", () => {
  const ordina = (l) => [...l].sort((a, b) => a[0] - b[0]);
  assert.deepStrictEqual(ordina(Object.entries(B.NOMI_I2C).map(([k, v]) => [Number(k), v])), ordina(C.costanti.i2c));
  assert.deepStrictEqual(B.MODI_PIN.map(([m, n]) => [n, m]), C.costanti.modi);
  assert.equal(B.TESTI.tensioni, C.costanti.tensioni);
  for (const t of [B.TESTI.grove, B.TESTI.notaIButton, B.TESTI.esclusioniIButton, B.testoInfo({})]) assert.ok(C.costanti.etichette.includes(t), t);
  assert.deepStrictEqual({ ...AZIONI }, C.costanti.laboratorio);
  assert.ok(Object.hasOwn(AZIONI, B.AZIONE_USCITE));
  assert.equal(B.conOra("pin 4 = 1", STAMP), C.riga_con_ora);
});

test("bridge: testo del pannello, menu dei pin e porte", () => {
  confronta(C.info, (c) => esito(() => B.testoInfo(c.info)));
  confronta(C.pin, (c) => B.vociPin(c.info));
  confronta(C.porte, (c) => vociPorte(c.porte, c.occupata));
});

test("bridge: pannello di collegamento (collega e scollega)", () => {
  confronta(C.pannello, (c) => {
    const ev = [];
    const p = B.preparaCollegamento(c.porta);
    if (p.errore) ev.push(["avviso", p.errore, true]);
    else {
      ev.push(["avviso", p.messaggio, false], ["collega", c.porta]);
      if (c.risposta[0] === "ok") ev.push(["avviso", B.TESTI.collegato, false]);
      else {
        const r = c.risposta[1];
        const e = r.tipo === "LinkError" ? new ErroreLink(r.code, r.msg) : new Error(r.msg);
        const t = B.testoFallimento(e);
        ev.push(["avviso", t, true], ["attivita", "gpio", t, "errore"]);
      }
    }
    return ev;
  }, (c) => c.eventi);
  assert.deepStrictEqual(C.scollega, [["avviso", B.TESTI.scollegato, false]]);
});

const AZIONI_PAGINA = {
  modo: (c) => B.preparaModo(c.pin, c.modo),
  leggi: (c) => B.preparaLettura(c.pin),
  alta: (c) => B.preparaScrittura(c.pin, 1),
  bassa: (c) => B.preparaScrittura(c.pin, 0),
  adc: (c) => B.preparaAdc(c.pin),
  i2c: () => B.preparaI2c(),
  cerca: () => B.preparaRicercaIButton(),
  presenza: () => B.preparaPresenzaIButton(),
};

async function esegui(c) {
  const ev = [];
  const laboratorio = new ModalitaLaboratorio();
  if (c.lab) laboratorio.abilita(30);
  const gestore = {
    collegato: c.collegato,
    richiesta(cmd, args, tempo) {
      ev.push(["richiesta", cmd, args, tempo / 1000]);
      const [k, v] = c.risposta;
      return k === "ok" ? Promise.resolve(v) : Promise.reject(new ErroreLink(v.code, v.msg));
    },
  };
  try {
    await B.eseguiAzione(AZIONI_PAGINA[c.tipo](c), {
      gestore,
      laboratorio,
      conferma: async (titolo, testo) => {
        ev.push(["conferma", titolo, testo]);
        return c.conferma;
      },
      avvisa: (t, e) => ev.push(["avviso", t, e]),
      scrivi: (r) => ev.push(["riga", r]),
      registro: { aggiungi: (cat, m, l) => ev.push(["attivita", cat, m, l]) },
      categoria: c.tipo === "cerca" || c.tipo === "presenza" ? "ibutton" : "gpio",
    });
  } catch (e) {
    if (!e.tipo) throw e;
    ev.push(["errore", { tipo: e.tipo, msg: e.message }]);
  }
  return ev;
}

test("bridge: azioni dei pulsanti (laboratorio, conferme, richieste, risposte, errori)", async () => {
  const diversi = [];
  for (const c of C.azioni) {
    const ev = await esegui(c);
    try {
      assert.deepStrictEqual(ev, c.eventi);
    } catch (e) {
      diversi.push(`${JSON.stringify(c).slice(0, 300)}\n  ${e.message.split("\n").slice(0, 10).join("\n  ")}`);
    }
  }
  if (diversi.length) assert.fail(`${diversi.length} casi su ${C.azioni.length} diversi:\n${diversi.slice(0, 5).join("\n")}`);
  assert.ok(C.azioni.length > 300);
  // chi chiede la modalità laboratorio: solo le uscite
  assert.equal(B.preparaModo(4, "output").laboratorio, "gpio.output");
  assert.ok(B.preparaModo(4, "output").conferma);
  for (const m of ["input", "input_pullup"]) assert.deepStrictEqual([B.preparaModo(4, m).laboratorio, B.preparaModo(4, m).conferma], [null, null]);
  assert.equal(B.preparaScrittura(4, 1).laboratorio, "gpio.output");
  assert.equal(B.preparaScrittura(4, 1).conferma, null);
  for (const a of [B.preparaLettura(4), B.preparaAdc(4), B.preparaI2c(), B.preparaRicercaIButton(), B.preparaPresenzaIButton()]) assert.equal(a.laboratorio, null);
  const comandi = new Set(C.azioni.flatMap((c) => c.eventi.filter((e) => e[0] === "richiesta").map((e) => e[1])));
  for (const cmd of comandi) assert.ok(Object.values(B.COMANDI).includes(cmd), cmd);
});

test("bridge: testi delle risposte (ADC, I2C, lettura, modo, scrittura) anche con dati strani", () => {
  const riga = (f) => esito(() => f().riga);
  confronta(C.adc, (c) => esito(() => B.testoAdc(c.pin, c.d)));
  confronta(C.i2c, (c) => esito(() => B.testoI2c(c.d)));
  confronta(C.leggi, (c) => riga(() => B.preparaLettura(5).esito(c.d)));
  confronta(C.modo, (c) => riga(() => B.preparaModo(5, "input").esito(c.d)));
  confronta(C.scrivi, (c) => riga(() => B.preparaScrittura(5, 1).esito(c.d)));
});

test("bridge: porta Grove del Polpo (gpio.pins, gpio.i2c_scan)", () => {
  confronta(C.grove, (c) => esito(() => (c.cmd === "gpio.pins" ? B.testoPinGrove(c.d, c.sim, STAMP) : B.testoI2cGrove(c.d, c.sim, STAMP))));
});

// ---------------- collegamento: GestoreBridge come BridgeManager ----------------

class TrasportoFinto {
  constructor(azioni, apertura) {
    this.azioni = azioni.map((a) => [...a]);
    this.apertura = apertura;
    this.scritte = [];
    this.simulato = false;
    this.nome = "finto";
  }

  async apri(suRiga, suChiusura) {
    if (this.apertura) throw new ErroreTrasporto(this.apertura);
    this.suRiga = suRiga;
    this.suChiusura = suChiusura;
  }

  scriviRiga(riga) {
    const msg = JSON.parse(new TextDecoder().decode(riga));
    this.scritte.push(msg);
    const a = this.azioni.length ? this.azioni.shift() : ["zitto"];
    const manda = (testo) => queueMicrotask(() => this.suRiga(testo));
    if (a[0] === "ok") manda(JSON.stringify({ id: msg.id, ok: true, data: a[1] }));
    else if (a[0] === "err" || a[0] === "err0") manda(JSON.stringify({ id: a[0] === "err" ? msg.id : 0, ok: false, error: { code: a[1], msg: a[2] } }));
    else if (a[0] === "riga") manda(a[1]);
  }

  async chiudi() {}
}

const comeEsito = async (p) => {
  try {
    return { ok: await p };
  } catch (e) {
    if (!(e instanceof ErroreLink)) throw e;
    return { errore: { tipo: "LinkError", msg: e.message, code: e.codice } };
  }
};

test("bridge: collegamento, hello ripetuto all'avvio, riconoscimento, scollegamento (come BridgeManager)", async () => {
  for (const c of C.collega) {
    const ev = [];
    let t = -1000; // come il tempo finto di bridge.py: un secondo in più a ogni lettura
    const g = new B.GestoreBridge({
      registro: { aggiungi: (cat, m, l) => ev.push(["attivita", cat, m, l]) },
      suStato: ({ collegato, info }) => ev.push(["stato", "bridge.state", collegato, info]),
      adesso: () => (t += 1000),
      opzioniClient: { attesaOccupato: 20 },
    });
    let presenza = null;
    Object.defineProperty(g, "presenza", {
      get: () => presenza,
      set: (v) => {
        presenza = v;
        if (v) ev.push(["hardware", "bridge", v.presenza, v.dettaglio]);
      },
    });
    const tr = new TrasportoFinto(c.azioni, c.apertura);
    const r = await comeEsito(g.collega(tr, c.porta, { attesaAvvio: c.attesa * 1000, tempoHello: 400 }));
    assert.deepStrictEqual(r, c.r, `${c.nome}: esito`);
    assert.deepStrictEqual(ev, c.eventi, `${c.nome}: eventi`);
    assert.equal(g.collegato, c.collegato, `${c.nome}: collegato`);
    ev.length = 0;
    if (c.dopo === "scollega") await g.scollega();
    else if (c.dopo === "stacca") tr.suChiusura("scollegato");
    else if (c.dopo === "richiesta") {
      assert.deepStrictEqual(await comeEsito(g.richiesta("pin.read", { pin: 4 })), c.richiesta, `${c.nome}: richiesta`);
      await g.scollega();
    }
    assert.deepStrictEqual(ev, c.eventi_dopo, `${c.nome}: eventi dopo`);
    assert.equal(g.collegato, c.collegato_dopo);
    assert.deepStrictEqual(await comeEsito(g.richiesta("pin.read", { pin: 4 })), c.richiesta_dopo);
    assert.deepStrictEqual(tr.scritte, c.scritte, `${c.nome}: righe inviate`);
    if (g.client) await g.client.chiudi(false);
  }
});
