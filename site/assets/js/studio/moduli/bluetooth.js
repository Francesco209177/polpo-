// Modulo «Bluetooth»: dispositivi vicini con il Bluetooth del telefono (scansione passiva) o del Polpo, servizi GATT,
// letture e notifiche SOLO dei dispositivi autorizzati (tuoi), registro degli autorizzati nella cassaforte.
// Niente scritture, niente annunci, niente disturbo: esclusi per scelta. Come in Polpo Studio per PC.
import { h, sostituisci, tabella } from "../ui.js";
import { cassaforteAperta } from "../comune.js";
import { ascoltaNativo } from "../link/trasporti.js";
import {
  TESTI, COLONNE, NOME_REGISTRO, CATEGORIA_REGISTRO, msScansioneTelefono, dispositiviDaTelefono, rigaDispositivo,
  messaggioVicini, righeScansione, messaggioScansione, serviziDaTelefono, alberoServizi, messaggioServizi, datiEvento,
  rigaLettura, rigaNotifica, rigaNotificheAttive, conOra, leggiAutorizzati, autorizzato, aggiungiAutorizzato,
  testoAutorizza, attivitaAutorizzato, preparaCollegamento, esitoCollegamento,
} from "../protocolli/ble.js";

const ora = () => new Date().toTimeString().slice(0, 8);

export function crea(ctx) {
  const nativo = globalThis.PolpoNativo;
  let dispositivi = []; // dall'ultima scansione del telefono
  let scelto = null; // {address, name}
  let collegato = null; // indirizzo
  let servizi = []; // [{uuid, name, characteristics}]
  let caratteristica = null; // {servizio, uuid, proprieta}
  let attesa = null; // "scansione" | "collegamento"
  let fineAttesa = null;

  const registroRighe = [];
  const registroVista = h("pre", { class: "st-log", "aria-live": "polite" });
  const scrivi = (t) => {
    registroRighe.push(conOra(t, ora()));
    if (registroRighe.length > 500) registroRighe.shift();
    registroVista.textContent = registroRighe.join("\n");
  };

  // ---- registro degli autorizzati (cassaforte, categoria «configurazioni») ----
  const vocRegistro = (c) => c.voci(CATEGORIA_REGISTRO).find((v) => v.nome === NOME_REGISTRO) || null;
  const caricaAutorizzati = async () => {
    const c = cassaforteAperta(ctx, false);
    if (!c) return [];
    const v = vocRegistro(c);
    return v ? leggiAutorizzati(await c.leggi(v.id)) : [];
  };

  const tabellaVicini = h("div", { class: "st-tabella" });
  const sceltaVicino = h("select", { "aria-label": "Dispositivo" });
  const disegnaVicini = async () => {
    let reg = [];
    try { reg = await caricaAutorizzati(); } catch { reg = []; }
    sostituisci(tabellaVicini, dispositivi.length
      ? tabella(COLONNE.dispositivi, dispositivi.map((d) => rigaDispositivo(d, autorizzato(reg, d.address))))
      : h("p", { class: "small" }, "Nessun dispositivo: premi «Cerca»."));
    sostituisci(sceltaVicino, ...dispositivi.map((d, i) => h("option", { value: String(i) }, `${d.name || "—"} · ${d.address}`)));
  };
  const dispositivoScelto = () => {
    const d = dispositivi[Number(sceltaVicino.value)];
    if (!d) { ctx.avvisa(TESTI.selezionaDispositivo, "errore"); return null; }
    return d;
  };

  const finisci = () => { clearTimeout(fineAttesa); attesa = null; };
  ascoltaNativo((ev) => {
    if (!ev || typeof ev.tipo !== "string" || !ev.tipo.startsWith("ble.")) return;
    if (ev.tipo === "ble.risultato" && attesa === "scansione") {
      finisci();
      // mfr_id -1 = nessun dato del produttore nell'annuncio (android/PONTE.md)
      dispositivi = dispositiviDaTelefono(ev).map((d) => ({ ...d, manufacturers: d.manufacturers.filter((m) => m >= 0) }));
      disegnaVicini();
      ctx.avvisa(messaggioVicini(dispositivi.length) + " (Bluetooth del telefono)", "ok");
    } else if (ev.tipo === "ble.collegato" && attesa === "collegamento") {
      finisci();
      collegato = String(ev.addr || (scelto && scelto.address) || "");
      servizi = serviziDaTelefono(ev);
      const e = esitoCollegamento(collegato);
      scrivi(e.riga);
      ctx.registro.aggiungi(e.attivita[0], e.attivita[1], e.attivita[2], false);
      disegnaServizi();
      ctx.avvisa(messaggioServizi(servizi.length), "ok");
    } else if (ev.tipo === "ble.letto") {
      scrivi(rigaLettura(String(ev.caratteristica || ""), datiEvento(ev)));
    } else if (ev.tipo === "ble.notifica") {
      scrivi(rigaNotifica(String(ev.caratteristica || ""), datiEvento(ev)));
    } else if (ev.tipo === "ble.scollegato") {
      if (collegato) scrivi(TESTI.scollegato);
      collegato = null; servizi = []; caratteristica = null;
      disegnaServizi();
    } else if (ev.tipo === "ble.errore") {
      finisci();
      const t = ev.messaggio || "errore";
      scrivi(t);
      ctx.avvisa(`Bluetooth: ${t}`, "errore");
    }
  });

  // ---- scansione con il telefono ----
  const secondi = h("input", { type: "number", min: "2", max: "10", value: "5", "aria-label": "Secondi di scansione", style: "width:5em" });
  const cercaTelefono = () => {
    if (!nativo || !nativo.bleScansiona) { ctx.avvisa("Il Bluetooth del telefono è disponibile solo nell'app per Android.", "errore"); return; }
    const ms = msScansioneTelefono(secondi.value);
    ctx.avvisa(TESTI.scansione);
    attesa = "scansione"; // gli errori arrivano come evento «ble.errore» (android/PONTE.md)
    clearTimeout(fineAttesa);
    fineAttesa = setTimeout(() => { if (attesa === "scansione") { finisci(); ctx.avvisa("La scansione non ha risposto.", "errore"); } }, ms + 5000);
    nativo.bleScansiona(ms);
  };

  // ---- scansione con il Polpo (vero o virtuale) ----
  const tabellaPolpo = h("div", { class: "st-tabella" });
  const cercaPolpo = async () => {
    try {
      ctx.avvisa("Il Polpo ascolta i dispositivi Bluetooth vicini per 4 secondi…");
      const d = await ctx.richiesta("ble.scan", { ms: 4000 });
      const righe = righeScansione(d);
      sostituisci(tabellaPolpo, righe.length ? tabella(COLONNE.scansionePolpo, righe) : h("p", { class: "small" }, "Nessun dispositivo trovato."));
      ctx.avvisa(messaggioScansione(righe.length, ctx.simulato), "ok");
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };

  // ---- autorizzazione ----
  const autorizza = async () => {
    const d = dispositivoScelto();
    if (!d) return;
    const c = cassaforteAperta(ctx);
    if (!c) return;
    if (!confirm(`${TESTI.titoloAutorizza}\n\n${testoAutorizza(d)}\n\nAutorizza solo un dispositivo TUO.`)) return;
    try {
      const v = vocRegistro(c);
      const reg = v ? leggiAutorizzati(await c.leggi(v.id)) : [];
      const r = aggiungiAutorizzato(reg, d.address, d.name || "", new Date());
      if (v) await c.aggiorna(v.id, { dati: r.dati }); else await c.aggiungi(CATEGORIA_REGISTRO, NOME_REGISTRO, r.dati);
      const a = attivitaAutorizzato(d.address);
      ctx.registro.aggiungi(a[0], a[1], a[2], false);
      ctx.avvisa(`Autorizzato: ${testoAutorizza(d)}.`, "ok");
      disegnaVicini();
      disegnaAutorizzati();
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };
  const elencoAutorizzati = h("div", { class: "st-tabella" });
  const disegnaAutorizzati = async () => {
    let reg = [];
    try { reg = await caricaAutorizzati(); } catch { reg = []; }
    const c = cassaforteAperta(ctx, false);
    sostituisci(elencoAutorizzati, !c
      ? h("p", { class: "small" }, "Apri la cassaforte (modulo Sicurezza) per vedere i tuoi dispositivi autorizzati.")
      : Array.isArray(reg) && reg.length
        ? tabella(["Nome", "Indirizzo", "Aggiunto"], reg.map((d) => [String(d.name || "—"), String(d.address || ""), String(d.added || "")]))
        : h("p", { class: "small" }, "Nessun dispositivo autorizzato."));
  };

  // ---- collegamento, servizi, letture ----
  const collega = async () => {
    const d = dispositivoScelto();
    if (!d) return;
    if (!nativo || !nativo.bleCollega) { ctx.avvisa("Il Bluetooth del telefono è disponibile solo nell'app per Android.", "errore"); return; }
    let reg;
    try { reg = await caricaAutorizzati(); } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); return; }
    const p = preparaCollegamento(d, reg);
    if (p.errore) { ctx.avvisa(p.errore + (cassaforteAperta(ctx, false) ? "" : " Il registro è nella cassaforte: aprila."), "errore"); return; }
    scelto = d;
    scrivi(p.messaggio);
    ctx.avvisa(p.messaggio);
    attesa = "collegamento";
    clearTimeout(fineAttesa);
    fineAttesa = setTimeout(() => { if (attesa === "collegamento") { finisci(); ctx.avvisa("Il dispositivo non ha risposto.", "errore"); } }, 20000);
    nativo.bleCollega(d.address);
  };
  const scollega = () => {
    if (!collegato) { ctx.avvisa(TESTI.nessunCollegato); return; }
    if (nativo && nativo.bleScollega) nativo.bleScollega();
  };

  const albero = h("div", { class: "st-ble-servizi" });
  const disegnaServizi = () => {
    if (!collegato) { sostituisci(albero, h("p", { class: "small" }, TESTI.nessunCollegato)); return; }
    const voci = alberoServizi(servizi);
    sostituisci(albero, ...voci.map((s, i) => h("details", { open: true },
      h("summary", {}, s.testo),
      h("ul", { class: "st-elenco" }, ...s.caratteristiche.map((c) => {
        const etichetta = h("label", {},
          h("input", { type: "radio", name: "ble-car", value: c.uuid, onchange: () => {
            caratteristica = { servizio: servizi[i].uuid, uuid: c.uuid, proprieta: c.proprieta };
          } }),
          ` ${c.testo}`, c.proprieta ? h("span", { class: "small" }, ` (${c.proprieta})`) : "");
        return h("li", {}, etichetta);
      })))));
  };
  const serveCaratteristica = () => {
    if (!collegato) { ctx.avvisa(TESTI.nessunCollegato, "errore"); return null; }
    if (!caratteristica) { ctx.avvisa(TESTI.selezionaCaratteristica, "errore"); return null; }
    return caratteristica;
  };
  const leggi = () => {
    const c = serveCaratteristica();
    if (!c) return;
    nativo.bleLeggi(c.servizio, c.uuid);
  };
  const notifiche = (attive) => {
    const c = serveCaratteristica();
    if (!c) return;
    nativo.bleNotifiche(c.servizio, c.uuid, attive);
    scrivi(attive ? rigaNotificheAttive(c.uuid) : TESTI.notificheSpente);
  };

  disegnaVicini();
  disegnaServizi();
  const mostrato = () => { disegnaVicini(); disegnaAutorizzati(); };

  const bottone = (testo, fn, classe = "btn btn-ghost") => h("button", { type: "button", class: classe, onclick: fn }, testo);
  const el = h("div", { class: "st-griglia" },
    ctx.scheda("ble.scan",
      h("p", { class: "small" }, TESTI.nota),
      h("div", { class: "btn-row" }, h("label", { class: "small" }, "Secondi ", secondi), bottone("Cerca con il telefono", cercaTelefono, "btn btn-studio")),
      tabellaVicini,
      h("div", { class: "btn-row" }, bottone("Cerca con il Polpo", cercaPolpo)),
      tabellaPolpo),
    ctx.scheda("ble.authorized",
      h("div", { class: "btn-row" }, sceltaVicino, bottone("Autorizza (è mio)…", autorizza)),
      elencoAutorizzati),
    ctx.scheda("ble.connect",
      h("div", { class: "btn-row" }, bottone("Collega", collega, "btn btn-studio"), bottone("Scollega", scollega))),
    ctx.scheda("ble.gatt", albero),
    ctx.scheda("ble.rw",
      h("div", { class: "btn-row" }, bottone("Leggi", leggi), bottone("Notifiche sì", () => notifiche(true)), bottone("Notifiche no", () => notifiche(false))),
      registroVista),
    ctx.scheda("ble.spam"),
  );
  return { id: "bluetooth", titolo: "Bluetooth", el, mostrato };
}
