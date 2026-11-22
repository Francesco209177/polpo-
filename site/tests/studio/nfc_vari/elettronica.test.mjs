// Calcolatori di elettronica: stessi numeri (confronto esatto dei double) di studio/polpo_studio/protocols/electronics.py.
import { test } from "node:test";
import * as el from "../../../assets/js/studio/protocolli/elettronica.js";
import { casi, confronta, D, esito, J } from "./aiuto.mjs";

const C = casi("elettronica");

test("legge di Ohm", () => {
  confronta(C.ohm, (c) => esito(() => el.ohm({ v: D(c.v), i: D(c.i), r: D(c.r) })), (c) => c.out);
});

test("partitore di tensione", () => {
  confronta(C.divider, (c) => esito(() => el.partitore(c.vin, c.r1, c.r2)), (c) => c.out);
});

test("valore standard più vicino (E12, E24, per eccesso o no)", () => {
  confronta(C.nearest_standard, (c) => esito(() => el.piuVicinoStandard(D(c.x), c.serie === "E12" ? el.E12 : el.E24, c.up)));
});

test("resistenza per un LED", () => {
  confronta(
    C.led_resistor,
    (c) =>
      esito(() => {
        const r = el.resistenzaLed(D(c.s), D(c.l), D(c.ma));
        return J({ exact: r.esatta, standard: r.standard, current_ma: r.correnteMa, power_w: r.potenzaW });
      }),
    (c) => c.out,
  );
});

test("codice colori: decodifica e codifica", () => {
  confronta(C.decode_bands, (c) => esito(() => el.decodificaFasce(c.b)));
  confronta(C.encode_bands, (c) => esito(() => el.codificaFasce(D(c.x), c.five)));
});

test("formattazione in ohm", () => {
  confronta(C.format_ohms, (c) => el.formattaOhm(D(c.x)));
});
