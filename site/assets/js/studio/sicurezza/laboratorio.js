// Polpo Studio — sicurezza: modalità laboratorio e permessi.
// Porta di studio/polpo_studio/security/lab.py.
//
// Le azioni che cambiano qualcosa nel mondo fisico (trasmettere, scrivere tag, programmare schede, pilotare uscite)
// o che eseguono codice di terzi restano spente finché l'utente non attiva la modalità laboratorio: va riconfermata
// con la frase o il PIN, si spegne da sola dopo un tempo stabilito, al blocco dello schermo e a ogni riavvio
// dell'app (lo stato è solo in memoria).

import { soloCifre } from "./formati.js";

export const AZIONI = Object.freeze({
  "rf.tx": "trasmettere a 433 MHz",
  "nfc.write": "scrivere un tag NFC",
  "fw.flash": "aggiornare il firmware del Polpo",
  "esp.flash": "programmare una scheda ESP32",
  "gpio.output": "pilotare uscite GPIO",
  "apps.third_party": "usare app di terze parti",
});

export const REGOLE =
  "Userò queste funzioni solo con dispositivi miei o per cui ho un'autorizzazione esplicita. " +
  "Non le userò per entrare in cancelli, veicoli, allarmi o sistemi di altre persone, né per disturbare " +
  "comunicazioni radio. So che trasmettere o scrivere può cambiare lo stato reale dei dispositivi.";

/** Durata predefinita e limiti della finestra «Modalità laboratorio» di Polpo Studio, in minuti. */
export const MINUTI_PREDEFINITI = 30;
export const MINUTI_MIN = 1;
export const MINUTI_MAX = 240;

export class PermessoNegato extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = "PermessoNegato";
  }
}

/** Secondi da un orologio che non torna mai indietro (come `time.monotonic`). */
const monotono = () => performance.now() / 1000;

export class ModalitaLaboratorio {
  /**
   * @param alCambio funzione chiamata con `true` quando si accende e `false` quando si spegne (anche da sola)
   * @param adesso   orologio in secondi (per le prove); di solito non serve
   */
  constructor({ alCambio = null, adesso = monotono } = {}) {
    this.alCambio = alCambio;
    this._adesso = adesso;
    this._fino = 0;
  }

  /** Vera se la modalità è accesa; quando scade si spegne e avvisa `alCambio(false)`. */
  get abilitata() {
    const attiva = this._fino > this._adesso();
    const scaduta = this._fino !== 0 && !attiva;
    if (scaduta) {
      this._fino = 0;
      this.alCambio?.(false);
    }
    return attiva;
  }

  /** Secondi che mancano allo spegnimento (0 se è spenta). */
  get secondiRimasti() {
    return this.abilitata ? Math.max(0, Math.trunc(this._fino - this._adesso())) : 0;
  }

  /** Accende per `minuti` minuti (almeno 1). */
  abilita(minuti) {
    this._fino = this._adesso() + Math.max(1, minuti) * 60;
    this.alCambio?.(true);
  }

  disabilita() {
    const era = this._fino > this._adesso();
    this._fino = 0;
    if (era) this.alCambio?.(false);
  }

  /** Lancia PermessoNegato se la modalità è spenta (RangeError se l'azione non esiste). */
  richiedi(azione) {
    if (!Object.hasOwn(AZIONI, azione)) throw new RangeError(`azione sconosciuta: ${azione}`);
    if (!this.abilitata) {
      throw new PermessoNegato(`Per ${AZIONI[azione]} serve la modalità laboratorio (Sicurezza › Modalità laboratorio).`);
    }
  }
}

/**
 * La conferma della finestra «Modalità laboratorio»: se la cassaforte ha un PIN e il testo è fatto di cifre vale
 * come PIN (e conta tra gli errori del PIN), altrimenti come frase di accesso.
 * @returns {Promise<{giusto: boolean, chiusa: boolean}>} `chiusa`: troppi PIN sbagliati, la cassaforte si è chiusa
 *   (serve di nuovo la frase).
 */
export async function confermaPerLaboratorio(cassaforte, testo, opzioni = {}) {
  if (cassaforte.haPin && soloCifre(testo)) {
    const giusto = await cassaforte.sbloccaPin(testo);
    return { giusto, chiusa: !cassaforte.aperta };
  }
  return { giusto: await cassaforte.verificaFrase(testo, opzioni), chiusa: false };
}
