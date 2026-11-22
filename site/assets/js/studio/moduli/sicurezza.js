// Modulo «Sicurezza»: cassaforte cifrata (la stessa di Polpo Studio per PC), PIN e blocco automatico, chiave di
// recupero, backup .polpobak scambiabili con il PC, registro attività cifrato, modalità laboratorio.
import { h, sostituisci } from "../ui.js";
import { Cassaforte, ErroreCassaforte } from "../sicurezza/cassaforte.js";
import { ArchivioIndexedDB } from "../sicurezza/archivio.js";
import { problemiFrase, SUGGERIMENTI_FRASE } from "../sicurezza/cripto.js";
import { esportaBackup, importaBackup, ESTENSIONE } from "../sicurezza/backup.js";
import { RegistroSicuro } from "../sicurezza/registro_sicuro.js";
import { ModalitaLaboratorio, PermessoNegato, confermaPerLaboratorio, AZIONI, REGOLE, MINUTI_MIN, MINUTI_MAX } from "../sicurezza/laboratorio.js";

const pwd = (etichetta, extra = {}) => h("input", { type: "password", autocomplete: "off", "aria-label": etichetta, placeholder: etichetta, ...extra });
const errTesto = (e) => (e instanceof ErroreCassaforte || e instanceof PermessoNegato ? e.message : e && e.message ? e.message : String(e));

export function crea(ctx) {
  let cassaforte = null, registroSicuro = null, archivio = null;
  const lab = new ModalitaLaboratorio({ alCambio: () => ctx.aggiorna() });
  const corpo = h("div", { class: "st-griglia" });
  const di = (t, livello = "info") => ctx.avvisa(t, livello);
  const progresso = (testo) => (f) => di(`${testo}… ${Math.round(f * 100)}%`);

  /** Le azioni che cambiano il mondo reale chiedono la modalità laboratorio, come nel programma per PC. */
  ctx.richiediLaboratorio = (azione) => {
    try {
      lab.richiedi(azione);
      return true;
    } catch (e) {
      di(e instanceof PermessoNegato ? `${e.message} Attivala nel modulo Sicurezza.` : errTesto(e), "errore");
      return false;
    }
  };
  ctx.laboratorio = lab;

  async function dopoApertura() {
    ctx.cassaforte = cassaforte;
    try {
      registroSicuro = await RegistroSicuro.apri(cassaforte);
      ctx.registro.collega((v) => registroSicuro.aggiungi(v), await registroSicuro.leggi(500));
    } catch (e) {
      registroSicuro = null;
      di(`Registro attività cifrato non leggibile (${errTesto(e)}): le voci restano solo in memoria.`, "avviso");
    }
    ctx.registro.aggiungi("sicurezza", "Cassaforte aperta.", "ok");
    ctx.aggiorna();
    disegna();
  }

  function dopoChiusura(motivo) {
    lab.disabilita();
    ctx.registro.scollega();
    if (registroSicuro) registroSicuro.chiudi();
    registroSicuro = null;
    ctx.cassaforte = null;
    if (motivo) di(motivo, "avviso");
    ctx.aggiorna();
    disegna();
  }

  // ---------------- schermate ----------------

  function schedaCrea() {
    const f1 = pwd("Frase di accesso"), f2 = pwd("Ripeti la frase");
    const nota = h("p", { class: "small" });
    const crea = async () => {
      const problemi = problemiFrase(f1.value);
      if (problemi.length) { nota.textContent = "Frase troppo debole: " + problemi.map((p) => SUGGERIMENTI_FRASE[p] || p).join(", ") + "."; return; }
      if (f1.value !== f2.value) { nota.textContent = "Le due frasi non sono uguali."; return; }
      try {
        const recupero = await cassaforte.crea(f1.value, { progresso: progresso("Creo la cassaforte") });
        f1.value = f2.value = "";
        mostraRecupero(recupero, "Cassaforte creata.");
      } catch (e) { di(errTesto(e), "errore"); }
    };
    return h("article", { class: "card" }, h("h3", {}, "Crea la cassaforte"),
      h("p", { class: "small" }, "Tiene cifrati nel telefono i codici, le letture e i telecomandi che salvi, come in Polpo Studio per PC. Scegli una frase di accesso di almeno 12 caratteri (quattro parole a caso vanno benissimo): servirà per aprirla."),
      f1, f2, nota, h("button", { type: "button", class: "btn btn-studio", onclick: crea }, "Crea la cassaforte"));
  }

  function mostraRecupero(chiave, titolo) {
    const fatto = h("button", { type: "button", class: "btn btn-studio", onclick: () => dopoApertura() }, "L'ho scritta su carta");
    sostituisci(corpo, h("article", { class: "card notice" }, h("h3", {}, titolo),
      h("p", {}, "Questa è la tua ", h("strong", {}, "chiave di recupero"), ". Scrivila su carta e tienila al sicuro: se dimentichi la frase di accesso è l'unico modo per riaprire la cassaforte, e nessuno può farlo al posto tuo. Non la vedrai più."),
      h("p", { class: "sha", id: "st-recupero" }, chiave), fatto));
  }

  function schedaApri() {
    const f = pwd("Frase di accesso");
    const r = h("input", { type: "text", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", "aria-label": "Chiave di recupero", placeholder: "Chiave di recupero (XXXX-XXXX-…)" });
    const apri = async (conRecupero) => {
      try {
        if (conRecupero) await cassaforte.sbloccaConRecupero(r.value, { progresso: progresso("Apro la cassaforte") });
        else await cassaforte.sblocca(f.value, { progresso: progresso("Apro la cassaforte") });
        f.value = r.value = "";
        di("Cassaforte aperta.", "ok");
        await dopoApertura();
      } catch (e) { di(errTesto(e), "errore"); }
    };
    f.addEventListener("keydown", (e) => { if (e.key === "Enter") apri(false); });
    return h("article", { class: "card" }, h("h3", {}, "Apri la cassaforte"), f,
      h("button", { type: "button", class: "btn btn-studio", onclick: () => apri(false) }, "Apri"),
      h("details", {}, h("summary", {}, "Ho dimenticato la frase"),
        h("p", { class: "small" }, "Usa la chiave di recupero che hai scritto su carta, poi scegli una frase nuova."), r,
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => apri(true) }, "Apri con la chiave di recupero")));
  }

  function schedaBloccoRapido() {
    const p = pwd("PIN", { inputmode: "numeric" });
    const sblocca = async () => {
      const ok = await cassaforte.sbloccaPin(p.value);
      p.value = "";
      if (ok) { di("Sbloccato.", "ok"); disegna(); ctx.aggiorna(); return; }
      if (!cassaforte.aperta) { dopoChiusura("Troppi PIN sbagliati: la cassaforte si è chiusa, serve la frase di accesso."); return; }
      di(`PIN sbagliato (${cassaforte.erroriPin} su 5).`, "errore");
    };
    p.addEventListener("keydown", (e) => { if (e.key === "Enter") sblocca(); });
    return h("article", { class: "card" }, h("h3", {}, "Studio bloccato"), h("p", { class: "small" }, "Inserisci il PIN per continuare. Dopo 5 errori serve la frase di accesso."),
      p, h("button", { type: "button", class: "btn btn-studio", onclick: sblocca }, "Sblocca"));
  }

  function schedeAperta() {
    const st = cassaforte.statistiche();
    // PIN
    const pin = pwd("Nuovo PIN (da 4 a 12 cifre)", { inputmode: "numeric" });
    const schedaPin = h("article", { class: "card" }, h("h3", {}, "PIN e blocco"),
      h("p", { class: "small" }, cassaforte.haPin
        ? `PIN impostato. Dopo ${ctx.impostazioni.bloccoMinuti} minuti senza usare Studio serve il PIN; dopo 5 PIN sbagliati serve la frase.`
        : `Senza PIN, dopo ${ctx.impostazioni.bloccoMinuti} minuti senza usare Studio la cassaforte si chiude e serve la frase.`),
      pin,
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn btn-ghost", onclick: async () => {
          try { await cassaforte.impostaPin(pin.value); pin.value = ""; di("PIN impostato.", "ok", "sicurezza"); disegna(); } catch (e) { di(errTesto(e), "errore"); }
        } }, "Imposta il PIN"),
        cassaforte.haPin ? h("button", { type: "button", class: "btn btn-ghost", onclick: async () => { await cassaforte.togliPin(); di("PIN tolto.", "info", "sicurezza"); disegna(); } }, "Togli il PIN") : null,
        cassaforte.haPin ? h("button", { type: "button", class: "btn btn-ghost", onclick: () => { cassaforte.bloccaSchermo(); lab.disabilita(); disegna(); } }, "Blocca ora") : null,
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => { cassaforte.chiudi(); dopoChiusura("Cassaforte chiusa."); } }, "Chiudi la cassaforte")));

    // frase e recupero
    const vecchia = pwd("Frase attuale"), nuova = pwd("Frase nuova"), nuova2 = pwd("Ripeti la frase nuova");
    const schedaFrase = h("article", { class: "card" }, h("h3", {}, "Frase di accesso e chiave di recupero"),
      h("details", {}, h("summary", {}, "Cambia la frase di accesso"), vecchia, nuova, nuova2,
        h("button", { type: "button", class: "btn btn-ghost", onclick: async () => {
          const problemi = problemiFrase(nuova.value);
          if (problemi.length) { di("Frase troppo debole: " + problemi.map((p) => SUGGERIMENTI_FRASE[p] || p).join(", ") + ".", "errore"); return; }
          if (nuova.value !== nuova2.value) { di("Le due frasi nuove non sono uguali.", "errore"); return; }
          try {
            await cassaforte.cambiaFrase(vecchia.value, nuova.value, { progresso: progresso("Cambio la frase") });
            vecchia.value = nuova.value = nuova2.value = "";
            di("Frase di accesso cambiata.", "ok", "sicurezza");
          } catch (e) { di(errTesto(e), "errore"); }
        } }, "Cambia")),
      h("p", { class: "small" }, "Una chiave di recupero nuova sostituisce la vecchia, che smette di funzionare."),
      h("button", { type: "button", class: "btn btn-ghost", onclick: async () => {
        if (!confirm("Creare una nuova chiave di recupero? Quella vecchia smetterà di funzionare.")) return;
        try {
          const k = await cassaforte.nuovaChiaveRecupero({ progresso: progresso("Creo la chiave") });
          ctx.registro.aggiungi("sicurezza", "Nuova chiave di recupero creata.", "avviso");
          mostraRecupero(k, "Nuova chiave di recupero");
        } catch (e) { di(errTesto(e), "errore"); }
      } }, "Nuova chiave di recupero…"));

    // backup
    const pBackup = pwd("Password del backup (almeno 12 caratteri)");
    const fileImport = h("input", { type: "file", accept: ESTENSIONE, hidden: true });
    const pImport = pwd("Password del backup da importare");
    fileImport.addEventListener("change", async () => {
      const f = fileImport.files[0];
      fileImport.value = "";
      if (!f) return;
      try {
        const r = await importaBackup(cassaforte, new Uint8Array(await f.arrayBuffer()), pImport.value, { progresso: progresso("Apro il backup") });
        pImport.value = "";
        di(`Backup importato: ${r.aggiunti} aggiunti, ${r.saltati} già presenti.`, "ok", "sicurezza");
        ctx.aggiorna();
      } catch (e) { di(errTesto(e), "errore"); }
    });
    const schedaBackup = h("article", { class: "card" }, h("h3", {}, "Backup (.polpobak)"),
      h("p", { class: "small" }, "Un file cifrato con tutto il contenuto della cassaforte. Si apre anche con Polpo Studio per PC, e i backup del PC si importano qui."),
      pBackup,
      h("button", { type: "button", class: "btn btn-ghost", onclick: async () => {
        if (problemiFrase(pBackup.value).includes("short")) { di("La password del backup deve avere almeno 12 caratteri.", "errore"); return; }
        try {
          const { dati, quanti } = await esportaBackup(cassaforte, pBackup.value, { progresso: progresso("Preparo il backup") });
          pBackup.value = "";
          const oggi = new Date().toISOString().slice(0, 10);
          ctx.salvaFile(new Blob([dati]), `polpo-${oggi}${ESTENSIONE}`);
          di(`Backup pronto: ${quanti} elementi.`, "ok", "sicurezza");
        } catch (e) { di(errTesto(e), "errore"); }
      } }, "Crea un backup"),
      pImport,
      h("button", { type: "button", class: "btn btn-ghost", onclick: () => fileImport.click() }, "Importa un backup…"), fileImport);

    // verifiche
    const esitoVerifica = h("ul", { class: "st-righe" });
    const schedaVerifica = h("article", { class: "card" }, h("h3", {}, "Controllo di integrità"),
      h("p", { class: "small" }, `${st.numero} elementi${st.simulati ? `, di cui ${st.simulati} dal Polpo virtuale` : ""}.`),
      h("button", { type: "button", class: "btn btn-ghost", onclick: async () => {
        const problemi = [...(await cassaforte.verifica()).map((p) => p.cosa), ...(registroSicuro ? await registroSicuro.verifica() : [])];
        sostituisci(esitoVerifica, problemi.length ? problemi.map((p) => h("li", { class: "off" }, p)) : [h("li", {}, "Tutto integro: niente di modificato, tolto o scambiato.")]);
        ctx.registro.aggiungi("sicurezza", problemi.length ? `Controllo di integrità: ${problemi.length} problemi.` : "Controllo di integrità: tutto integro.", problemi.length ? "errore" : "ok");
      } }, "Controlla la cassaforte e il registro"), esitoVerifica);
    return [schedaPin, schedaFrase, schedaBackup, schedaVerifica];
  }

  function schedaLaboratorio() {
    if (lab.abilitata) {
      const m = Math.floor(lab.secondiRimasti / 60), s = lab.secondiRimasti % 60;
      return h("article", { class: "card notice" }, h("h3", {}, "Modalità laboratorio ", h("span", { class: "badge exp" }, "attiva")),
        h("p", {}, `Ancora ${m} min ${String(s).padStart(2, "0")} s. Ogni trasmissione o scrittura chiede comunque la conferma sullo schermo del Polpo.`),
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => { lab.disabilita(); ctx.registro.aggiungi("sicurezza", "Modalità laboratorio disattivata", "info"); disegna(); } }, "Disattiva ora"));
    }
    const accetto = h("input", { type: "checkbox" });
    const minuti = h("input", { type: "number", min: String(MINUTI_MIN), max: String(MINUTI_MAX), value: String(ctx.impostazioni.minutiLaboratorio) });
    const segreto = pwd("PIN o frase di accesso, per conferma");
    const attiva = async () => {
      if (!accetto.checked) { di("Serve accettare le regole.", "errore"); return; }
      const n = Math.min(MINUTI_MAX, Math.max(MINUTI_MIN, Number(minuti.value) || 30));
      const { giusto, chiusa } = await confermaPerLaboratorio(cassaforte, segreto.value, { progresso: progresso("Controllo") });
      segreto.value = "";
      if (chiusa) { dopoChiusura("Troppi PIN sbagliati: la cassaforte si è chiusa."); return; }
      if (!giusto) { di("PIN o frase sbagliati.", "errore"); return; }
      ctx.impostazioni.minutiLaboratorio = n;
      ctx.salvaImpostazioni();
      lab.abilita(n);
      ctx.registro.aggiungi("sicurezza", `Modalità laboratorio attivata per ${n} minuti`, "avviso");
      disegna();
    };
    return h("article", { class: "card" }, h("h3", {}, "Modalità laboratorio"),
      h("p", { class: "small" }, "Permette di: " + Object.values(AZIONI).join("; ") + ". Nel telefono servono per ora: trasmettere a 433 MHz e scrivere un tag NFC."),
      h("p", { class: "notice warn small" }, REGOLE),
      h("label", { class: "sim-spunta" }, accetto, " Ho letto e accetto queste regole"),
      h("label", {}, "Per ", minuti, " minuti"), segreto,
      h("button", { type: "button", class: "btn btn-ghost", onclick: attiva }, "Attiva"));
  }

  function disegna() {
    if (!cassaforte) { sostituisci(corpo, h("p", { class: "small" }, "Apro la cassaforte…")); return; }
    if (!cassaforte.esiste) { sostituisci(corpo, schedaCrea()); return; }
    if (!cassaforte.aperta) { sostituisci(corpo, schedaApri()); return; }
    if (cassaforte.bloccoRapido) { sostituisci(corpo, schedaBloccoRapido()); return; }
    sostituisci(corpo, schedaLaboratorio(), ...schedeAperta());
  }

  // blocco automatico dopo un po' senza usare Studio
  let ultimoUso = Date.now();
  for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, () => { ultimoUso = Date.now(); }, { passive: true });
  setInterval(() => {
    if (lab.abilitata && !document.getElementById("m-sicurezza")?.hidden) disegna(); // il conto alla rovescia
    const minuti = ctx.impostazioni.bloccoMinuti;
    if (!cassaforte || !cassaforte.aperta || cassaforte.bloccoRapido || !minuti || Date.now() - ultimoUso < minuti * 60000) return;
    lab.disabilita();
    if (cassaforte.haPin) { cassaforte.bloccaSchermo(); di("Studio bloccato dopo un po' di inattività: serve il PIN.", "avviso"); disegna(); ctx.aggiorna(); }
    else { cassaforte.chiudi(); dopoChiusura("Cassaforte chiusa dopo un po' di inattività."); }
  }, 1000);

  (async () => {
    try {
      archivio = await ArchivioIndexedDB.apri("cassaforte");
      cassaforte = await Cassaforte.apri(archivio);
      ctx.apriCassaforte = () => { location.hash = "#sicurezza"; };
    } catch (e) {
      sostituisci(corpo, h("p", { class: "small" }, `La memoria del telefono per la cassaforte non è disponibile: ${errTesto(e)}.`));
      return;
    }
    disegna();
  })();
  disegna();

  return { id: "sicurezza", titolo: "Sicurezza", el: h("div", {}, corpo), mostrato: disegna };
}
