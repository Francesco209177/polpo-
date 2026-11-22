// Regole comuni dei moduli (la copia di studio/polpo_studio/app/tools/common.py).

/** I dati inventati dal Polpo virtuale non vanno mai al Polpo vero: il messaggio se `voce` non si può inviare. */
export function nonInviabile(ctx, voce) {
  if (voce && voce.simulato && ctx.collegato() && !ctx.simulato) {
    return `«${voce.nome}» viene dal Polpo virtuale (SIMULATO): non si invia al Polpo vero.`;
  }
  return "";
}

/** La cassaforte aperta e sbloccata, oppure null (con un avviso che spiega dove aprirla). */
export function cassaforteAperta(ctx, avvisa = true) {
  const c = ctx.cassaforte;
  if (c && c.aperta && !c.bloccoRapido) return c;
  if (avvisa) ctx.avvisa("Per salvare serve la cassaforte: aprila (o creala) nel modulo Sicurezza.", "errore");
  return null;
}

/** Origine da segnare su ciò che arriva dal Polpo collegato. */
export const origine = (ctx) => (ctx.simulato ? "simulato" : "reale");

const enc = new TextEncoder();
export const utf8 = (t) => enc.encode(t);
export const testo = (b) => new TextDecoder("utf-8").decode(b);
