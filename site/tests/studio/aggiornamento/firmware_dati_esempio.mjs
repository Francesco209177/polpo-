// Come assets/js/studio/firmware-dati.js, che la costruzione del sito genera da
// studio/polpo_studio/resources/firmware.json: qui si legge lo stesso file, così le prove seguono la versione vera
// (il file dell'applicazione è in polpo/release). aggiornamento/firmware.js non lo importa: la pagina lo passa a
// firmwareIncluso() e aggiorna().
import fs from "node:fs";

const info = JSON.parse(fs.readFileSync(new URL("../../../../studio/polpo_studio/resources/firmware.json", import.meta.url), "utf8"));
export const FIRMWARE = Object.freeze({ version: info.version, app_file: info.app_file, app_offset: info.app_offset, sha256: info.sha256 });
