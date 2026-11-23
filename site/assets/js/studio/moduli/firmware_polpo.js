// La scheda «Aggiornamento del firmware» del modulo Polpo: scrive sul Polpo, con il cavo USB OTG, il firmware incluso
// nell'app (solo l'applicazione a 0x10000, con l'impronta SHA-256 fissata). Sperimentale: mai provato su un Polpo vero.
// Chiede la modalità laboratorio e una conferma, come in Polpo Studio per PC.
import { h } from "../ui.js";
import { firmwareIncluso, aggiorna, ErroreAggiornamento } from "../aggiornamento/firmware.js";
import { FIRMWARE } from "../firmware-dati.js";

const NOMI_FASI = {
  controllo: "Controllo del file",
  bootloader: "Riavvio nel bootloader",
  collegamento: "Collegamento al bootloader",
  preparazione: "Preparazione",
  scrittura: "Scrittura",
  verifica: "Verifica",
  riavvio: "Riavvio del Polpo",
};

export function schedaFirmware(ctx, scollegaPolpo) {
  const nativo = globalThis.PolpoNativo;
  let incluso = null; // {dati, verificato, problema}
  let incorso = false;
  let annulla = null;

  const stato = h("p", { class: "small" });
  const barra = h("progress", { max: "100", value: "0", hidden: true, "aria-label": "Avanzamento dell'aggiornamento" });
  const fase = h("p", { class: "small", "aria-live": "polite" });
  const registro = h("pre", { class: "st-log", hidden: true });
  const righe = [];
  const scrivi = (riga, livello) => {
    if (livello === "esptool") return; // le righe di esptool-js (in inglese) restano fuori: il riassunto basta
    righe.push((livello === "errore" ? "✗ " : livello === "avviso" ? "! " : "") + riga);
    registro.hidden = false;
    registro.textContent = righe.slice(-200).join("\n");
  };

  const controlla = async () => {
    if (!nativo) { stato.textContent = "L'aggiornamento via cavo si fa dall'app Polpo per Android."; return null; }
    stato.textContent = "Controllo il firmware incluso nell'app…";
    incluso = await firmwareIncluso(nativo, FIRMWARE);
    const polpo = ctx.collegato() && !ctx.simulato ? ` Il Polpo collegato ha il firmware ${ctx.info.firmware || "?"}.` : "";
    stato.textContent = incluso.verificato
      ? `Firmware incluso: versione ${FIRMWARE.version}, impronta SHA-256 verificata.${polpo}`
      : `Il firmware incluso non si può usare: ${incluso.problema}`;
    return incluso;
  };

  const avvia = async () => {
    if (incorso) return;
    if (!ctx.richiediLaboratorio("fw.flash")) return;
    const inc = incluso && incluso.verificato ? incluso : await controlla();
    if (!inc || !inc.verificato) { ctx.avvisa(stato.textContent, "errore"); return; }
    if (!confirm(
      `Aggiornare il firmware del Polpo alla versione ${FIRMWARE.version}?\n\n` +
      "Sperimentale: non è mai stato provato su un Polpo vero.\n" +
      "• Lascia collegato solo il Polpo, con il cavo USB OTG, e la batteria carica.\n" +
      "• Tieni lo schermo del telefono acceso e non staccare il cavo finché non finisce.\n" +
      "• Si scrive solo l'applicazione: le impostazioni e la microSD restano.\n" +
      "• Android può chiedere di nuovo il permesso USB: rispondi sì.",
    )) return;
    incorso = true;
    righe.length = 0;
    barra.hidden = false;
    barra.value = 0;
    const controllo = new AbortController();
    annulla = controllo;
    pulsanteAnnulla.hidden = false;
    pulsanteAvvia.disabled = true;
    let blocco = null;
    try { blocco = navigator.wakeLock ? await navigator.wakeLock.request("screen") : null; } catch { blocco = null; }
    try {
      if (ctx.collegato() && !ctx.simulato) await scollegaPolpo();
      ctx.registro.aggiungi("polpo", `Aggiornamento del firmware alla versione ${FIRMWARE.version} avviato`, "avviso", false);
      const r = await aggiorna({
        nativo, firmware: FIRMWARE, dati: inc.dati, segnale: controllo.signal, log: scrivi,
        avanzamento: (a) => {
          barra.value = a.percento;
          fase.textContent = `${NOMI_FASI[a.fase] || a.fase} · ${a.percento}%`;
          if (a.fase === "scrittura") pulsanteAnnulla.hidden = true; // da qui la scrittura va fino in fondo
        },
      });
      const msg = r.ripartito
        ? `Firmware ${r.versione} scritto e verificato: il Polpo è ripartito. Ricollegalo e accetta sul suo schermo.`
        : `Firmware ${r.versione} scritto e verificato, ma il Polpo non è ricomparso: spegnilo e riaccendilo.`;
      fase.textContent = msg;
      ctx.avvisa(msg, "ok");
      ctx.registro.aggiungi("polpo", `Firmware aggiornato alla versione ${r.versione} (MD5 ${r.md5})`, "ok", false);
    } catch (e) {
      const t = e instanceof ErroreAggiornamento ? e.message : `Errore inatteso: ${e && e.message ? e.message : e}`;
      const extra = e instanceof ErroreAggiornamento && e.scritto
        ? " La scrittura era cominciata: il Polpo potrebbe non partire. Riprova l'aggiornamento, o installa il firmware dal computer (pagina Installa)."
        : "";
      fase.textContent = t + extra;
      ctx.avvisa(t + extra, "errore");
      ctx.registro.aggiungi("polpo", `Aggiornamento del firmware non riuscito: ${t}`, "errore", false);
    } finally {
      incorso = false;
      annulla = null;
      pulsanteAnnulla.hidden = true;
      pulsanteAvvia.disabled = false;
      if (blocco) { try { await blocco.release(); } catch { /* già rilasciato */ } }
      ctx.aggiorna();
    }
  };

  const pulsanteAvvia = h("button", { type: "button", class: "btn btn-studio", onclick: avvia }, `Aggiorna il Polpo alla ${FIRMWARE.version}…`);
  const pulsanteAnnulla = h("button", { type: "button", class: "btn btn-ghost", hidden: true, onclick: () => { if (annulla) annulla.abort(); } }, "Annulla");
  const el = ctx.scheda("polpo.firmware",
    h("p", { class: "small" }, "Sperimentale. Scrive sul Polpo il firmware incluso in questa versione dell'app, con il cavo USB OTG. Serve la modalità laboratorio (modulo Sicurezza). Per la prima installazione è più semplice un computer con Chrome o Edge."),
    h("div", { class: "btn-row" }, h("button", { type: "button", class: "btn btn-ghost", onclick: controlla }, "Controlla il firmware incluso"), pulsanteAvvia, pulsanteAnnulla),
    stato, barra, fase, registro);
  stato.textContent = `Firmware incluso: versione ${FIRMWARE.version} (premi «Controlla» per verificarne l'impronta).`;
  return el;
}
