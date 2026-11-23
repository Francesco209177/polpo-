// Parità di protocolli/ble.js con devices/ble.py, app/tools/bluetooth_tools.py (strumento vero con un Bluetooth finto),
// la scansione di polpo_tools.py e la tabella dei produttori del firmware (wireless_apps.cpp).
import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../../../assets/js/studio/protocolli/ble.js";
import { B, D, ORA, casi, confronta, esito } from "./aiuto.mjs";

const C = casi("ble");
const ordina = (l) => [...l].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

test("ble: servizi noti, produttori del firmware, intestazioni e testi", () => {
  assert.deepStrictEqual(ordina(Object.entries(L.SERVIZI_NOTI)), ordina(C.servizi_noti));
  assert.deepStrictEqual(ordina(Object.entries(L.PRODUTTORI_BLE).map(([k, v]) => [Number(k), v])), ordina(C.produttori_firmware));
  assert.ok(C.produttori_firmware.length >= 10);
  assert.equal(L.nomeProduttoreBle(0x004c), "Apple");
  assert.equal(L.nomeProduttoreBle(0x1234), null);
  assert.equal(L.descriviProduttore(0x004c), "Apple (0x004C)");
  assert.equal(L.descriviProduttore(0x1234), "? (0x1234)");
  const K = C.costanti;
  assert.deepStrictEqual([...L.COLONNE.dispositivi], K.colonne);
  assert.deepStrictEqual([...L.COLONNE.servizi], K.servizi);
  assert.deepStrictEqual([L.SECONDI_SCANSIONE.min, L.SECONDI_SCANSIONE.max, L.SECONDI_SCANSIONE.predefiniti], K.secondi);
  assert.ok(K.etichette.includes(L.TESTI.nota));
  assert.equal(L.NOME_REGISTRO, K.nome_registro);
  assert.deepStrictEqual([L.msScansioneTelefono(), L.msScansioneTelefono(2), L.msScansioneTelefono(20), L.msScansioneTelefono(1), L.msScansioneTelefono("x")], [5000, 2000, 10000, 2000, 5000]);
});

test("ble: nome dei servizi, valori letti, errori spiegati", () => {
  confronta(C.nome_servizio, (c) => L.nomeServizio(c.uuid, c.desc));
  confronta(C.valore, (c) => L.formattaValore(B(c.d)));
  confronta(C.spiega, (c) => L.spiegaErrore(c.msg, c.tipo));
});

test("ble: ordine della scansione (dal segnale più forte)", () => {
  confronta(C.scansione_pc, (c) =>
    L.ordinaDispositivi(c.trovati.map(([a, nd, na, r, m]) => ({ address: a, name: na || nd || "", rssi: r, manufacturers: m, services: ["0000180f-0000-1000-8000-00805f9b34fb"], tx_power: null }))),
  );
  const ev = { devices: [{ name: "A", addr: "11", rssi: -80, mfr_id: 0x004c, connectable: true }, { name: null, addr: "22", rssi: -40, mfr_id: 0, connectable: false }, { addr: "33" }] };
  assert.deepStrictEqual(L.dispositiviDaTelefono(ev), [
    { address: "22", name: "", rssi: -40, manufacturers: [0], services: [], tx_power: null },
    { address: "11", name: "A", rssi: -80, manufacturers: [0x004c], services: [], tx_power: null },
    { address: "33", name: "", rssi: null, manufacturers: [], services: [], tx_power: null },
  ]);
});

test("ble: registro dei dispositivi autorizzati (lettura, controllo, aggiunta)", () => {
  for (const c of C.autorizzati) {
    const dati = c.dati === null || c.dati === "rotta" ? null : B(c.dati);
    const reg = L.leggiAutorizzati(dati);
    assert.deepStrictEqual({ ok: reg }, c.load, `load ${c.dati}`);
    assert.deepStrictEqual(esito(() => L.autorizzato(reg, "AA")), c.aa, `AA ${c.dati}`);
    assert.deepStrictEqual(esito(() => L.autorizzato(reg, "ZZ")), c.zz, `ZZ ${c.dati}`);
    let attuale = reg;
    for (const [k, ind, nome] of [["add0", "AA", "Nuovo"], ["add1", "DD", ""]]) {
      const atteso = c[k];
      let r;
      try {
        r = L.aggiungiAutorizzato(attuale, ind, nome, ORA);
      } catch (e) {
        if (!e.tipo) throw e;
        assert.deepStrictEqual({ errore: { tipo: e.tipo, msg: e.message } }, atteso.r, `add ${ind} ${c.dati}`);
        assert.deepStrictEqual(atteso.eventi, []);
        continue;
      }
      assert.deepStrictEqual(atteso.r, { ok: null });
      assert.equal(atteso.eventi.length, 1);
      const [tipo, categoria, nomeFile, testo] = atteso.eventi[0];
      assert.equal(tipo, c.dati === null && ind === "AA" ? "messo" : "aggiornato", `${c.dati}: nuovo file o aggiornamento`);
      assert.deepStrictEqual([categoria, nomeFile, D(testo)], [L.CATEGORIA_REGISTRO, L.NOME_REGISTRO, r.testo], `add ${ind} ${c.dati}`);
      assert.deepStrictEqual(new TextDecoder().decode(r.dati), r.testo);
      attuale = L.leggiAutorizzati(r.dati);
    }
  }
});

test("ble: righe dei dispositivi vicini e albero dei servizi", () => {
  confronta(C.dispositivi, (c) => {
    const reg = L.leggiAutorizzati(c.registro);
    return { righe: c.d.map((d) => L.rigaDispositivo(d, L.autorizzato(reg, d.address))), eventi: [["avviso", L.messaggioVicini(c.d.length), false]] };
  }, (c) => ({ righe: c.righe, eventi: c.eventi }));
  confronta(C.servizi, (c) => ({ albero: L.alberoServizi(c.s), eventi: [["avviso", L.messaggioServizi(c.s.length), false]] }), (c) => ({ albero: c.albero, eventi: c.eventi }));
  const ev = { addr: "AA", servizi: [{ uuid: "0000180F-0000-1000-8000-00805F9B34FB", caratteristiche: [{ uuid: "00002a19-0000-1000-8000-00805f9b34fb", proprieta: ["read", "notify"] }] }] };
  assert.deepStrictEqual(L.alberoServizi(L.serviziDaTelefono(ev)), [
    { testo: "Batteria · 0000180F-0000-1000-8000-00805F9B34FB", proprieta: "", caratteristiche: [{ testo: "Caratteristica · 00002a19-0000-1000-8000-00805f9b34fb", proprieta: "read, notify", uuid: "00002a19-0000-1000-8000-00805f9b34fb" }] },
  ]);
  assert.deepStrictEqual(L.datiEvento({ dati: "VQ==" }), Uint8Array.of(0x55));
  assert.deepStrictEqual(L.datiEvento({ dati: "!!" }), new Uint8Array(0));
});

test("ble: scansione, autorizzazione, collegamento, letture e notifiche (messaggi e ordine)", () => {
  const uuid = "00002a19-0000-1000-8000-00805f9b34fb";
  const avviso = (t, e = false) => ["avviso", t, e];
  const fallimento = (msg, assente) => {
    const e = assente ? new L.BleNonDisponibile(msg) : new Error(msg);
    const t = L.testoErrore(e);
    return [...(t.adattatoreAssente ? [["hardware", "pc.ble", "assente", msg]] : []), avviso(t.messaggio, true), ["riga", t.riga]];
  };
  let registro = [];
  const atteso = (f) => {
    const d = f.d;
    switch (f.passo) {
      case "scansione":
        return [avviso(L.TESTI.scansione), ["hardware", "pc.ble", "rilevato", L.TESTI.adattatoreOk], avviso(L.messaggioVicini(f.devs.length))];
      case "autorizza_senza_selezione":
      case "collega_senza_selezione":
        return [avviso(L.TESTI.selezionaDispositivo, true)];
      case "collega_non_autorizzato":
        return [avviso(L.preparaCollegamento(d, registro).errore, true)];
      case "autorizza_no":
        return [["conferma", L.TESTI.titoloAutorizza, L.testoAutorizza(d)]];
      case "autorizza_si":
      case "autorizza_senza_nome":
      case "autorizza_di_nuovo": {
        const primo = !registro.length;
        const r = L.aggiungiAutorizzato(registro, d.address, d.name, ORA);
        registro = r.registro;
        const salva = primo ? ["messo", L.CATEGORIA_REGISTRO, L.NOME_REGISTRO, r.testo, {}] : ["aggiornato", L.CATEGORIA_REGISTRO, L.NOME_REGISTRO, r.testo];
        return [["conferma", L.TESTI.titoloAutorizza, L.testoAutorizza(d)], salva, ["attivita", ...L.attivitaAutorizzato(d.address)], avviso(L.messaggioVicini(2))];
      }
      case "collega_errore":
        return [avviso(L.preparaCollegamento(d, registro).messaggio), ...fallimento("nessun adattatore Bluetooth trovato o acceso", true)];
      case "collega": {
        const e = L.esitoCollegamento(d.address);
        return [avviso(L.preparaCollegamento(d, registro).messaggio), avviso(L.messaggioServizi(1)), ["riga", e.riga], ["attivita", ...e.attivita]];
      }
      case "leggi_senza_caratteristica":
      case "leggi_su_servizio":
        return [avviso(L.TESTI.selezionaCaratteristica, true)];
      case "leggi":
        return [["leggi", uuid], ["riga", L.rigaLettura(uuid, B(f.dati))]];
      case "leggi_errore":
        return [["leggi", uuid], ...fallimento("lettura non permessa", false)];
      case "notifiche_si":
        return [["riga", L.rigaNotificheAttive(uuid)]];
      case "notifica":
        return [["riga", L.rigaNotifica(uuid, B(f.dati))]];
      case "notifiche_no":
        return [["riga", L.TESTI.notificheSpente]];
      case "scollega":
        return [["riga", L.TESTI.scollegato]];
      case "scansione_errore":
        return [avviso(L.TESTI.scansione), ...fallimento("nessun adattatore Bluetooth trovato o acceso", true)];
      case "scansione_errore_altro":
        return [avviso(L.TESTI.scansione), ...fallimento("scansione scaduta", false)];
    }
    throw new Error(`passo sconosciuto: ${f.passo}`);
  };
  for (const f of C.flussi) assert.deepStrictEqual(atteso(f), f.eventi, f.passo);
  assert.equal(C.flussi.length, 25);
});

test("ble: scansione del Polpo o del telefono (righe e messaggio, come il modulo Polpo)", () => {
  confronta(C.scansione_polpo, (c) => {
    const r = esito(() => L.righeScansione(c.d));
    const inizio = [L.TESTI.scansionePolpo, false];
    if (r.errore) return { r, tabella: null, messaggi: [inizio] };
    return { r: { ok: null }, tabella: [[...L.COLONNE.scansionePolpo], r.ok], messaggi: [inizio, [L.messaggioScansione(r.ok.length, c.sim), false]], cmd: ["ble.scan", { ms: 4000 }] };
  }, (c) => (c.r.errore ? { r: c.r, tabella: c.tabella, messaggi: c.messaggi } : { r: c.r, tabella: c.tabella, messaggi: c.messaggi, cmd: c.cmd }));
});
