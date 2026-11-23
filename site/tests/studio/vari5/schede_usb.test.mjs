// Parità di protocolli/schede_usb.js con devices/usb_list.py, serial_ports.py e le pagine USB e GPIO di Polpo Studio.
import test from "node:test";
import assert from "node:assert/strict";
import * as U from "../../../assets/js/studio/protocolli/schede_usb.js";
import { casi, confronta } from "./aiuto.mjs";

const C = casi("schede_usb");
const ordina = (l) => [...l].sort((a, b) => a[0] - b[0] || (a[1] ?? -1) - (b[1] ?? -1));

test("schede_usb: tabelle di classi, produttori e chip, intestazioni e note", () => {
  const T = C.tabelle;
  assert.deepStrictEqual(ordina(Object.entries(U.NOMI_CLASSI).map(([k, v]) => [Number(k), v])), ordina(T.classi));
  assert.deepStrictEqual(ordina(Object.entries(U.PRODUTTORI).map(([k, v]) => [Number(k), v])), ordina(T.produttori));
  assert.deepStrictEqual(ordina(U.CHIP_SERIALI.map((x) => [...x])), T.chip_seriali);
  assert.deepStrictEqual(U.CHIP_NOTI.map((x) => [...x]), T.chip_noti);
  assert.deepStrictEqual(U.USI_HID.map((x) => [...x]), T.usi_hid);
  assert.deepStrictEqual({ periferiche: [...U.COLONNE.periferiche], porte: [...U.COLONNE.porte], hid: [...U.COLONNE.hid], schede: [...U.COLONNE.schede] }, T.colonne);
  assert.ok(T.etichette.includes(U.NOTA_HID));
});

test("schede_usb: chip, VID:PID, produttore e classe", () => {
  confronta(C.chip, (c) => U.nomeChip(c.vid, c.pid));
  confronta(C.dispositivo, (c) => ({ usb_id: U.usbId(c.d.vid, c.d.pid), produttore: U.nomeProduttore(c.d), classe: U.nomeClasse(c.d.classe) }), (c) => ({ usb_id: c.usb_id, produttore: c.produttore, classe: c.classe }));
});

test("schede_usb: tabella «Periferiche» e messaggio", () => {
  confronta(C.periferiche, (c) => ({ righe: U.righeDispositivi(c.d), eventi: [["avviso", U.messaggioDispositivi(c.d), false]] }), (c) => ({ righe: c.righe, eventi: c.eventi }));
});

const daGrezza = (g) => U.porta(g.device, { descrizione: g.description || "", vid: g.vid, pid: g.pid, numeroSerie: g.serial_number || "", produttore: g.manufacturer || "" });

test("schede_usb: porte seriali (ordine, chip, driver mancanti), schede collegate e porte della console", () => {
  confronta(C.porte, (c) => {
    const porte = U.ordinaPorte(c.grezze.map(daGrezza));
    const mancanti = U.driverMancanti(c.dispositivi, U.idPorte(porte));
    return {
      porte,
      usb_id: porte.map(U.usbIdPorta),
      polpo: porte.map(U.forsePolpo),
      righe: U.righePorte(porte),
      nota: U.notaDriver(mancanti),
      schede: U.righeSchede(porte),
      console: U.vociPorte(porte, c.occupata),
      mancanti,
    };
  }, (c) => ({ porte: c.porte, usb_id: c.usb_id, polpo: c.polpo, righe: c.righe, nota: c.nota, schede: c.schede, console: c.console, mancanti: c.mancanti }));
});

test("schede_usb: interfacce HID (programma per PC)", () => {
  confronta(C.hid, (c) => ({ righe: c.d.map(U.rigaHid), eventi: [["avviso", U.messaggioHid(c.d.length), false]] }), (c) => ({ righe: c.righe, eventi: c.eventi }));
});

test("schede_usb: l'elenco del telefono (usbElenco di android/PONTE.md)", () => {
  const elenco = [
    { id: 1003, nome: "USB JTAG/serial debug unit", produttore: "Espressif", vid: 0x303a, pid: 0x1001, classi: [0xef, 2, 10, 0xff], seriale: true, polpo: true, permesso: true },
    { id: 1004, nome: "", produttore: "", vid: 0x1a86, pid: 0x7523, classi: [0xff], seriale: true, polpo: false, permesso: false },
    { id: 1005, nome: "Tastiera", produttore: "", vid: 0x046d, pid: 0xc31c, classi: [0, 3], seriale: false, polpo: false, permesso: false },
    { id: 1006, nome: "CP2102", produttore: "Silicon Labs", vid: 0x10c4, pid: 0xea60, classi: [0], seriale: false, polpo: false, permesso: false },
  ];
  const { dispositivi, porte, mancanti } = U.elencoTelefono(elenco);
  assert.deepStrictEqual(U.righeDispositivi(dispositivi), [
    ["USB JTAG/serial debug unit", "303A:1001", "Espressif", "Varie, Comunicazioni (CDC), Dati CDC, Del produttore", "", "", ""],
    ["WCH (QinHeng)", "1A86:7523", "WCH (QinHeng)", "Del produttore", "", "", ""],
    ["Tastiera", "046D:C31C", "Logitech", "HID (tastiere, mouse…)", "", "", ""],
    ["CP2102", "10C4:EA60", "Silicon Labs", "per interfaccia", "", "", ""],
  ]);
  assert.deepStrictEqual(dispositivi[0].id, 1003);
  assert.equal(dispositivi[0].polpo, true);
  assert.deepStrictEqual(porte.map((p) => [p.dispositivo, p.chip, p.id]), [["USB JTAG/serial debug unit", "Espressif, USB nativa (ESP32-S2/S3/C3/C6)", 1003], ["USB", "WCH CH340", 1004]]);
  assert.deepStrictEqual(U.vociPorte(porte, 1003), [["USB · WCH CH340", 1004]]);
  assert.deepStrictEqual(U.righeSchede(porte).map((r) => r[4]), ["ESP32 con USB nativa: il Polpo o un'altra scheda Espressif", "adattatore USB-seriale (tipico di ESP32 DevKit, Arduino Nano compatibili)"]);
  assert.equal(U.notaDriver(mancanti), "Possibile driver mancante per: CP2102 (10C4:EA60). Installa il driver del produttore del chip.");
  assert.equal(U.nomiClassi([]), "");
  assert.equal(U.nomiClassi([0]), "per interfaccia");
  assert.equal(U.nomiClassi([0x42, 3, 3]), "HID (tastiere, mouse…)");
  assert.equal(U.nomeClasse(true), "Audio");
  assert.equal(U.nomeClasse("3"), "");
  assert.equal(U.messaggioDispositivi([]), "Nessuna periferica elencata (o elenco non disponibile su questo sistema).");
});
