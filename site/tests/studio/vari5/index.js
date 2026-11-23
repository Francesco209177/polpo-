// Con Node 22 «node --test site/tests/studio/vari5/» esegue la cartella come un modulo, cioè questo file:
// qui si caricano tutte le prove della cartella, nello stesso processo.
// Si possono anche eseguire una per una: node --test "site/tests/studio/vari5/*.test.mjs"
import { readdirSync } from "node:fs";

const qui = new URL("./", import.meta.url);
for (const nome of readdirSync(qui).filter((n) => n.endsWith(".test.mjs")).sort()) await import(new URL(nome, qui));
