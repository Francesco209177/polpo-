package io.github.francesco209177.polpo

import org.json.JSONException
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Messaggi NDEF (NFC Forum) con un solo record, link o testo: gli stessi byte del firmware del Polpo
 * (polpo/lib/polpo_core/src/polpo/nfc/ndef.cpp) e di Polpo Studio (site/assets/js/studio/protocolli/ndef.js).
 * Parte pura, provata senza Android.
 */
object NdefDati {
    /** Al massimo 400 byte di contenuto, come «nfc.write_ndef» del Polpo. */
    const val VALORE_MAX = 400
    private const val LINGUA_MAX = 63 // 6 bit nel byte di stato del record Testo

    /** I prefissi URI della specifica NFC Forum RTD URI: il codice è la posizione nella lista. */
    val PREFISSI = listOf(
        "", "http://www.", "https://www.", "http://", "https://", "tel:", "mailto:",
        "ftp://anonymous:anonymous@", "ftp://ftp.", "ftps://", "sftp://", "smb://", "nfs://",
        "ftp://", "dav://", "news:", "telnet://", "imap:", "rtsp://", "urn:",
        "pop:", "sip:", "sips:", "tftp:", "btspp://", "btl2cap://", "btgoep://",
        "tcpobex://", "irdaobex://", "file://", "urn:epc:id:", "urn:epc:tag:", "urn:epc:pat:",
        "urn:epc:raw:", "urn:epc:", "urn:nfc:",
    )

    /** Il codice del prefisso più lungo con cui comincia [uri] (0 = nessuno). */
    fun prefisso(uri: String): Int {
        var migliore = 0
        for (i in 1 until PREFISSI.size) {
            if (PREFISSI[i].length > PREFISSI[migliore].length && uri.startsWith(PREFISSI[i])) migliore = i
        }
        return migliore
    }

    fun messaggioUri(uri: String): ByteArray {
        val codice = prefisso(uri)
        return record("U", byteArrayOf(codice.toByte()) + uri.substring(PREFISSI[codice].length).toByteArray(Charsets.UTF_8))
    }

    fun messaggioTesto(testo: String, lingua: String = "it"): ByteArray {
        val l = lingua.toByteArray(Charsets.US_ASCII)
        return record("T", byteArrayOf((l.size and 0x3F).toByte()) + l + testo.toByteArray(Charsets.UTF_8))
    }

    /** Il messaggio dentro il TLV NDEF dei tag Type 2 (03, lunghezza, messaggio, FE): i byte che occupa sul tag. */
    fun avvolgiTlv(messaggio: ByteArray): ByteArray {
        val n = messaggio.size
        val lunghezza = if (n < 0xFF) byteArrayOf(n.toByte()) else byteArrayOf(0xFF.toByte(), (n shr 8).toByte(), n.toByte())
        return byteArrayOf(0x03) + lunghezza + messaggio + byteArrayOf(0xFE.toByte())
    }

    // un record «well-known» (TNF 1) che è primo e ultimo del messaggio; corto (SR) se il contenuto sta in un byte
    private fun record(tipo: String, contenuto: ByteArray): ByteArray {
        val corto = contenuto.size <= 255
        val out = ByteArrayOutputStream()
        out.write(0x80 or 0x40 or (if (corto) 0x10 else 0) or 0x01)
        out.write(tipo.length)
        if (corto) {
            out.write(contenuto.size)
        } else {
            for (s in intArrayOf(24, 16, 8, 0)) out.write(contenuto.size shr s)
        }
        out.write(tipo.toByteArray(Charsets.US_ASCII))
        out.write(contenuto)
        return out.toByteArray()
    }

    /**
     * La richiesta di «nfcScrivi(json)»: `{kind: "uri" | "text", value, lang}` → il messaggio NDEF da scrivere.
     * Lancia [Rifiutato] con il motivo se la richiesta non va bene.
     */
    fun richiesta(json: String?): ByteArray {
        val o = try { JSONObject(json ?: "") } catch (e: JSONException) { throw Rifiutato("Richiesta di scrittura non valida.") }
        val valore = o.optString("value", "").trim()
        if (valore.isEmpty() || valore.toByteArray(Charsets.UTF_8).size > VALORE_MAX) throw Rifiutato("Contenuto vuoto o oltre $VALORE_MAX byte.")
        return when (o.optString("kind")) {
            "uri" -> messaggioUri(valore)
            "text" -> {
                val lingua = o.optString("lang", "").trim().ifEmpty { "it" }
                if (lingua.length > LINGUA_MAX || !lingua.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '-' }) {
                    throw Rifiutato("Lingua non valida: per esempio «it» o «en-US».")
                }
                messaggioTesto(valore, lingua)
            }
            else -> throw Rifiutato("Il tipo deve essere «uri» (link) o «text» (testo).")
        }
    }
}
