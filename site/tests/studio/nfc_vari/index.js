// Permette anche `node --test site/tests/studio/nfc_vari/` (Node 22 non cerca i file di prova in una cartella:
// la carica come modulo, cioè questo file). Il modo consueto resta `node --test "site/tests/studio/nfc_vari/*.test.mjs"`.
import "./py.test.mjs";
import "./ndef.test.mjs";
import "./rfid_onewire.test.mjs";
import "./ducky.test.mjs";
import "./elettronica.test.mjs";
import "./strumenti.test.mjs";
import "./pagine.test.mjs";
import "./regole.test.mjs";
