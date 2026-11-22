// Modulo «Polpo»: informazioni, diagnostica, microSD, reti Wi-Fi e dispositivi Bluetooth vicini (dal Polpo).
import { h, tabella, sostituisci, dimensione } from "../ui.js";
import { percorsoValido } from "../link/proto.js";
import { creaZip } from "../zip.js";

const WIFI_AUTH = { 0: "aperta", 1: "WEP", 2: "WPA", 3: "WPA2", 4: "WPA/WPA2", 5: "WPA2 Enterprise", 6: "WPA3", 7: "WPA2/WPA3", 8: "WAPI" };
const MODULI = { ir_tx: "Trasmettitore IR", wifi: "Wi-Fi", ble: "Bluetooth", usb_hid: "Tastiera USB", rfid2: "NFC (RFID2)", rf433: "Radio 433 MHz", ir_unit: "Ricevitore IR" };
const PRESENZA = { available: "presente", missing: "non trovato", unverifiable: "non rilevabile da solo", simulated: "simulato" };

export function crea(ctx) {
  const sim = () => (ctx.simulato ? " (SIMULATO)" : "");

  // ---- informazioni ----
  const infoOut = h("div");
  const leggiInfo = async () => {
    try {
      const d = await ctx.richiesta("info");
      ctx.info = { ...ctx.info, ...d };
      const sd = d.sd || {};
      sostituisci(infoOut, tabella(["Cosa", "Valore"], [
        ["Firmware", d.firmware], ["Scheda", d.board],
        ["Batteria", `${d.battery}%${d.charging ? " (in carica)" : ""}`],
        ["Memoria libera", dimensione(d.heap_free || 0)], ["Acceso da", `${d.uptime_s} s`],
        ["microSD", sd.ok ? `${dimensione(sd.used || 0)} usati su ${dimensione(sd.total || 0)}` : "assente o non leggibile"],
        ["Livello", String(d.level)], ["Tastiera", d.layout],
        ["Trasmissioni radio nell'ultima ora", d.rf_budget ? `${(d.rf_budget.used_ms / 1000).toFixed(1).replace(".", ",")} s su ${Math.round(d.rf_budget.limit_ms / 1000)} s` : "—"],
        ...Object.entries(d.modules || {}).map(([k, v]) => [MODULI[k] || k, PRESENZA[v] || v]),
      ]), ctx.simulato ? h("p", { class: "small" }, h("span", { class: "badge sim" }, "Simulato"), " Dati del Polpo virtuale.") : null);
      ctx.aggiorna();
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };

  // ---- diagnostica ----
  const diagOut = h("div");
  const diagnostica = async () => {
    try {
      const d = await ctx.richiesta("diag");
      sostituisci(diagOut, tabella(["Prova", "Esito"], [
        ["Scrittura sulla microSD", d.sd_test ? "riuscita" : "non riuscita"],
        ["Bus I2C della porta Grove", (d.i2c || []).length ? d.i2c.map((a) => "0x" + a.toString(16).padStart(2, "0")).join(", ") : "nessun dispositivo"],
      ]));
      ctx.registro.aggiungi("polpo", `Diagnostica: microSD ${d.sd_test ? "ok" : "con problemi"}, ${(d.i2c || []).length} dispositivi I2C${sim()}.`, d.sd_test ? "ok" : "avviso", ctx.simulato);
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };

  // ---- microSD ----
  let cartella = "/polpo";
  const sdPercorso = h("p", { class: "small" });
  const sdElenco = h("ul", { class: "st-file" });
  const scelta = h("input", { type: "file", hidden: true });
  const elenca = async () => {
    sdPercorso.textContent = `Cartella: ${cartella}`;
    try {
      const d = await ctx.richiesta("fs.list", { path: cartella });
      const voci = [...(d.entries || [])].sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
      const righe = [];
      if (cartella !== "/polpo") righe.push(h("li", {}, h("button", { type: "button", class: "btn btn-ghost", onclick: () => { cartella = cartella.slice(0, cartella.lastIndexOf("/")) || "/polpo"; elenca(); } }, "↑ Cartella superiore")));
      for (const e of voci) {
        const p = `${cartella}/${e.name}`;
        righe.push(e.dir
          ? h("li", {}, h("button", { type: "button", class: "btn btn-ghost", onclick: () => { cartella = p; elenca(); } }, `📁 ${e.name}`))
          : h("li", {}, h("span", {}, `${e.name} · ${dimensione(e.size)}`), " ",
            h("button", { type: "button", class: "btn btn-ghost", onclick: () => scarica(p) }, "Salva"), " ",
            h("button", { type: "button", class: "btn btn-ghost", onclick: () => elimina(p) }, "Elimina")));
      }
      sostituisci(sdElenco, righe.length ? righe : [h("li", { class: "small" }, "Cartella vuota.")]);
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };
  const scarica = async (p) => {
    try {
      const dati = await ctx.client.leggiFile(p, (a, b) => ctx.avvisa(`Leggo ${p}: ${a} di ${b} byte…`));
      ctx.salvaFile(new Blob([dati]), p.slice(p.lastIndexOf("/") + 1));
      ctx.avvisa(`Letto ${p}${sim()}.`, "ok");
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };
  const elimina = async (p) => {
    if (!confirm(`Eliminare ${p} dalla microSD del Polpo?`)) return;
    try {
      await ctx.richiesta("fs.delete", { path: p });
      ctx.avvisa(`Eliminato ${p}.`, "ok", "polpo");
      elenca();
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };
  scelta.addEventListener("change", async () => {
    const f = scelta.files[0];
    scelta.value = "";
    if (!f) return;
    const p = `${cartella}/${f.name}`;
    if (!percorsoValido(p)) { ctx.avvisa("Nome non valido: solo lettere senza accenti, numeri, «_», «-» e «.», senza spazi.", "errore"); return; }
    try {
      await ctx.client.scriviFile(p, new Uint8Array(await f.arrayBuffer()), (a, b) => ctx.avvisa(`Scrivo ${p}: ${a} di ${b} byte…`));
      ctx.avvisa(`Copiato ${f.name} in ${cartella}${sim()}.`, "ok", "polpo");
      elenca();
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  });
  const copiaTutto = async () => {
    const file = [];
    const visita = async (dir) => {
      const d = await ctx.richiesta("fs.list", { path: dir });
      for (const e of d.entries || []) {
        const p = `${dir}/${e.name}`;
        if (e.dir) await visita(p);
        else if (e.size <= 256 * 1024) {
          ctx.avvisa(`Copio ${p}…`);
          file.push({ nome: p.slice(1), dati: await ctx.client.leggiFile(p) });
        }
      }
    };
    try {
      await visita("/polpo");
      ctx.salvaFile(creaZip(file), "microsd-polpo.zip");
      ctx.avvisa(`Copia della microSD: ${file.length} file${sim()}.`, "ok", "polpo");
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };

  // ---- reti e Bluetooth ----
  const wifiOut = h("div"), bleOut = h("div");
  const reti = async () => {
    try {
      ctx.avvisa("Il Polpo ascolta le reti Wi-Fi vicine…");
      const d = await ctx.richiesta("wifi.scan");
      const n = d.networks || [];
      sostituisci(wifiOut, n.length ? tabella(["Nome", "Canale", "Segnale", "Protezione"],
        n.map((r) => [r.ssid || "(nascosta)", String(r.channel), `${r.rssi} dBm`, WIFI_AUTH[r.auth] ?? String(r.auth)])) : h("p", { class: "small" }, "Nessuna rete trovata."));
      ctx.avvisa(`${n.length} reti Wi-Fi${sim()}.`, "ok");
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };
  const bluetooth = async () => {
    try {
      ctx.avvisa("Il Polpo ascolta i dispositivi Bluetooth vicini per 4 secondi…");
      const d = await ctx.richiesta("ble.scan", { ms: 4000 });
      const n = d.devices || [];
      sostituisci(bleOut, n.length ? tabella(["Nome", "Indirizzo", "Segnale", "Collegabile"],
        n.map((r) => [r.name || "(senza nome)", r.addr, `${r.rssi} dBm`, r.connectable ? "sì" : "no"])) : h("p", { class: "small" }, "Nessun dispositivo trovato."));
      ctx.avvisa(`${n.length} dispositivi Bluetooth${sim()}.`, "ok");
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };

  const el = h("div", { class: "st-griglia" },
    ctx.scheda("polpo.info", h("button", { type: "button", class: "btn btn-studio", onclick: leggiInfo }, "Leggi le informazioni"), infoOut),
    ctx.scheda("polpo.diag", h("button", { type: "button", class: "btn btn-ghost", onclick: diagnostica }, "Esegui la diagnostica"), diagOut),
    ctx.scheda("polpo.sd_backup",
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn btn-ghost", onclick: elenca }, "Apri la microSD"),
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => scelta.click() }, "Copia un file dal telefono"),
        h("button", { type: "button", class: "btn btn-ghost", onclick: copiaTutto }, "Salva tutta la microSD (.zip)")),
      scelta, sdPercorso, sdElenco),
    ctx.scheda("polpo.wifi_scan", h("p", { class: "small" }, "Solo ascolto: il Polpo non si collega a nessuna rete."),
      h("button", { type: "button", class: "btn btn-ghost", onclick: reti }, "Cerca le reti"), wifiOut),
    ctx.scheda("polpo.ble_scan", h("p", { class: "small" }, "Scansione passiva: il Polpo non si collega a nessun dispositivo."),
      h("button", { type: "button", class: "btn btn-ghost", onclick: bluetooth }, "Cerca i dispositivi"), bleOut),
    ctx.scheda("polpo.firmware"),
  );
  ctx.suAggiornamento(() => { if (!ctx.collegato()) { sostituisci(sdElenco); sdPercorso.textContent = ""; } });
  return { id: "polpo", titolo: "Polpo", el };
}
