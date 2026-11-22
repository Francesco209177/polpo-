// Polpo — l'unico file del sito che scarica qualcosa: il firmware compilato per il browser (polpo-sim.wasm), dallo
// stesso sito (o, nell'app per Android, dall'app stessa). Lo usano il simulatore e il Polpo virtuale di Studio.

/** Il modulo WebAssembly del firmware, compilato. `base` è l'indirizzo della cartella del simulatore. */
export async function caricaFirmware(base) {
  const risposta = await fetch(new URL("polpo-sim.wasm", base));
  if (!risposta.ok) throw new Error(`risposta ${risposta.status}`);
  return WebAssembly.compile(await risposta.arrayBuffer());
}
