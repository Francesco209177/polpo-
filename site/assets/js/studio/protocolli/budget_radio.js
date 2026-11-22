// Polpo Studio — app «Tempo radio a 433 MHz»: quanto dura in aria un codice rc-switch e quante volte
// rientra nel limite orario di trasmissione del Polpo (8% di un'ora).
// Porting della parte di calcolo di studio/polpo_studio/apps/radio_budget.py (senza l'interfaccia Qt).

import { divisioneIntera, divisioneVera, interoDa, testoPy, veroPy, virgolaFissa } from "./flipper.js";
import { CodiceRc, tempoInAriaRcUs } from "./subghz.js";

/** Limite orario di trasmissione in ms (8% di un'ora, come il firmware). */
export const LIMITE_BUDGET_RF_MS = 288_000;

/** Descrizione dell'app (stesse chiavi del MANIFEST Python). */
export const MANIFEST = Object.freeze({
  id: "tempo_radio",
  name: "Tempo radio a 433 MHz",
  description: "Calcola quanto dura in aria un codice fisso e quante trasmissioni rientrano nel limite orario del Polpo (8%).",
  version: "1.0",
  category: "radio",
  author: "Progetto Polpo",
  icon: "radio",
});

/** I campi dell'app: etichetta, intervallo ammesso, valore iniziale, unità. */
export const CAMPI_STIMA = Object.freeze([
  Object.freeze({ chiave: "protocollo", etichetta: "Protocollo rc-switch", min: 1, max: 12, valore: 1, unita: "" }),
  Object.freeze({ chiave: "bit", etichetta: "Bit", min: 1, max: 32, valore: 24, unita: "" }),
  Object.freeze({ chiave: "impulsoUs", etichetta: "Impulso", min: 50, max: 5000, valore: 350, unita: " µs" }),
  Object.freeze({ chiave: "ripetizioni", etichetta: "Ripetizioni", min: 1, max: 20, valore: 4, unita: "" }),
]);

/** Durata di un invio in ms e quanti invii rientrano nel limite orario: `[ms, quanti]`. */
export function stima(protocollo, bit, impulsoUs, ripetizioni) {
  const us = tempoInAriaRcUs(new CodiceRc(protocollo, bit, 0, impulsoUs), ripetizioni);
  const ms = divisioneVera(us, 1000);
  return [ms, veroPy(ms) ? interoDa(divisioneIntera(LIMITE_BUDGET_RF_MS, ms)) : 0];
}

/** La frase mostrata dall'app. */
export function testoStima(protocollo, bit, impulsoUs, ripetizioni) {
  const [ms, n] = stima(protocollo, bit, impulsoUs, ripetizioni);
  return (
    `Un invio dura circa ${virgolaFissa(ms, 1)} ms. ` +
    `Nel limite di ${virgolaFissa(LIMITE_BUDGET_RF_MS / 1000, 0)} s all'ora ne rientrano circa ${testoPy(n)}.`
  );
}
