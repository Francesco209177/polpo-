package io.github.francesco209177.polpo

import org.json.JSONArray
import org.json.JSONObject

/**
 * La carta dell'evento «nfc.tag»: la stessa forma della risposta «nfc.read» del Polpo (polpo/src/link/link.cpp,
 * fill_card), così Polpo Studio la analizza allo stesso modo (site/assets/js/studio/protocolli/type2.js). Modelli e
 * famiglie da polpo/lib/polpo_core/src/polpo/nfc/type2.cpp. Parte pura, provata senza Android.
 */
object Carta {
    /** Un tag NFC Forum Type 2: nome, ultima pagina di memoria utente, pagina dei blocchi dinamici (0 = nessuna). */
    class Modello(val nome: String, val ultimaUtente: Int, val paginaBloccoDinamico: Int)

    val ULTRALIGHT = Modello("MIFARE Ultralight", 15, 0)
    val SCONOSCIUTO = Modello("Type 2 sconosciuto", 15, 0)
    private val NTAG = mapOf(
        0x0B to Modello("NTAG210", 15, 0),
        0x0E to Modello("NTAG212", 35, 36),
        0x0F to Modello("NTAG213", 39, 40),
        0x11 to Modello("NTAG215", 129, 130),
        0x13 to Modello("NTAG216", 225, 226),
    )
    private val ULTRALIGHT_EV1 = mapOf(
        0x0B to Modello("MIFARE Ultralight EV1 (MF0UL11)", 15, 0),
        0x0E to Modello("MIFARE Ultralight EV1 (MF0UL21)", 35, 36),
    )

    const val ERRORE_LETTURA = "memoria non leggibile (pagine protette?)"

    /** Il modello dalla risposta a GET_VERSION (8 byte); senza risposta è un MIFARE Ultralight originale. */
    fun modello(versione: ByteArray?): Modello {
        if (versione == null) return ULTRALIGHT
        if (versione.size < 8 || versione[0].toInt() != 0x00 || versione[1].toInt() != 0x04) return SCONOSCIUTO
        val memoria = versione[6].toInt() and 0xFF
        return when (versione[2].toInt() and 0xFF) {
            0x04 -> NTAG[memoria]
            0x03 -> ULTRALIGHT_EV1[memoria]
            else -> null
        } ?: SCONOSCIUTO
    }

    /** La famiglia della carta ISO 14443-A da SAK e ATQA. Solo identificazione. */
    fun famiglia(sak: Int, atqa: Int): String = when (sak) {
        0x00 -> "NFC Type 2 (NTAG / MIFARE Ultralight)"
        0x08 -> "MIFARE Classic 1K (o compatibile)"
        0x09 -> "MIFARE Mini"
        0x18 -> "MIFARE Classic 4K (o compatibile)"
        0x10, 0x11 -> "MIFARE Plus (SL2)"
        0x20 -> if (atqa == 0x0344) "MIFARE DESFire" else "Smart card ISO 14443-4 (DESFire, Plus SL3, carta bancaria, documento...)"
        0x28, 0x38 -> "Smart card con emulazione MIFARE Classic"
        else -> "Carta ISO 14443-A non riconosciuta"
    }

    /** La famiglia di un tag che non è ISO 14443-A, dalle tecnologie che Android riconosce. */
    fun famigliaAltra(tecnologie: List<String>): String = when {
        "NfcB" in tecnologie -> "Carta ISO 14443-B (NFC-B)"
        "NfcF" in tecnologie -> "FeliCa (NFC-F)"
        "NfcV" in tecnologie -> "Tag ISO 15693 (NFC-V)"
        else -> "Tag NFC non riconosciuto"
    }

    /** L'ATQA come lo riporta il Polpo: i due byte nell'ordine di arrivo, il primo è il meno significativo. */
    fun atqa(byte: ByteArray): Int =
        (byte.getOrElse(0) { 0 }.toInt() and 0xFF) or ((byte.getOrElse(1) { 0 }.toInt() and 0xFF) shl 8)

    /** Esadecimale maiuscolo senza spazi, come to_hex(…, 0) del Polpo. */
    fun hex(byte: ByteArray): String {
        val cifre = "0123456789ABCDEF"
        val s = StringBuilder(byte.size * 2)
        for (b in byte) s.append(cifre[(b.toInt() shr 4) and 0x0F]).append(cifre[b.toInt() and 0x0F])
        return s.toString()
    }

    /**
     * Legge [pagine] pagine dalla pagina 0 con il comando READ, che restituisce 4 pagine (16 byte) per volta.
     * [leggi4] riceve la prima pagina; null se una lettura non riesce.
     */
    fun leggiPagine(pagine: Int, leggi4: (Int) -> ByteArray?): ByteArray? {
        val out = ByteArray(pagine * 4)
        for (p in 0 until pagine step 4) {
            val blocco = leggi4(p) ?: return null
            if (blocco.size < 16) return null
            blocco.copyInto(out, p * 4, 0, minOf(16, out.size - p * 4))
        }
        return out
    }

    /**
     * La carta per l'evento «nfc.tag». [atqa] null = il tag non è ISO 14443-A (allora atqa e sak valgono -1).
     * Per i tag Type 2 (SAK 0): [versione] è la risposta a GET_VERSION (null se non ha risposto), [pagine] la memoria
     * dalla pagina 0 (null se non leggibile).
     */
    fun carta(uid: ByteArray, tecnologie: List<String>, atqa: ByteArray?, sak: Int, versione: ByteArray?, pagine: ByteArray?): JSONObject {
        val c = JSONObject().put("present", true).put("uid", hex(uid))
        if (atqa == null) {
            c.put("atqa", -1).put("sak", -1).put("family", famigliaAltra(tecnologie))
        } else {
            val a = atqa(atqa)
            c.put("atqa", a).put("sak", sak).put("family", famiglia(sak, a))
            if (sak == 0x00) {
                val m = modello(versione)
                c.put("model", m.nome)
                if (versione != null && versione.size >= 8) c.put("version", hex(versione.copyOf(8)))
                val byte = (m.ultimaUtente + 1) * 4
                if (pagine != null && pagine.size >= byte) c.put("pages", hex(pagine.copyOf(byte))) else c.put("read_error", ERRORE_LETTURA)
            }
        }
        return c.put("tecnologie", JSONArray().apply { tecnologie.forEach { put(it) } })
    }

    /**
     * Perché non si scrive su questo tag Type 2, con i testi del Polpo (type2_plan_ndef_write), oppure null se si può:
     * serve un modello noto, formattato NDEF, scrivibile e senza bit di blocco. [testa] = pagine 0-3 (16 byte),
     * [bloccoDinamico] = la pagina dei blocchi dinamici (almeno 4 byte; null se non letta).
     */
    fun problemaScrittura(m: Modello, testa: ByteArray, bloccoDinamico: ByteArray?): String? {
        if (m === SCONOSCIUTO) return "modello di tag non riconosciuto"
        if (testa.size < 16) return "tag non leggibile"
        if (testa[12] != 0xE1.toByte()) return "tag non formattato NDEF"
        if (testa[15].toInt() != 0x00) return "tag in sola lettura"
        if (testa[10].toInt() != 0x00 || testa[11].toInt() != 0x00) return "tag con pagine bloccate"
        if (m.paginaBloccoDinamico != 0) {
            if (bloccoDinamico == null || bloccoDinamico.size < 4) return "impossibile verificare i blocchi del tag"
            if (bloccoDinamico[0].toInt() != 0 || bloccoDinamico[1].toInt() != 0 || bloccoDinamico[2].toInt() != 0) return "tag con blocchi dinamici attivi"
        }
        return null
    }
}
