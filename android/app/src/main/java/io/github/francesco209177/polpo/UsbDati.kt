package io.github.francesco209177.polpo

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Le opzioni di «serialeApri(id, opzioni)»: le regole di Polpo Studio per l'ESP32-S3 sono quelle predefinite
 * (115200 baud, DTR attivo, RTS basso); altre schede possono chiedere altro, ma mai 1200 baud, che riavvierebbe
 * il Polpo nel bootloader (per quello c'è solo «serialeToccoBootloader»). Parte pura, provata senza Android.
 */
data class OpzioniSeriale(val baud: Int = BAUD_POLPO, val dtr: Boolean = true, val rts: Boolean = false) {
    companion object {
        const val BAUD_POLPO = 115200
        const val BAUD_BOOTLOADER = 1200
        const val BAUD_MIN = 300
        const val BAUD_MAX = 4_000_000
        private const val NON_VALIDE = "Opzioni della porta non valide."

        /** Le opzioni dal JSON della pagina; vuoto (o «undefined», come arriva dal JavaScript) = quelle predefinite. */
        fun da(json: String?): OpzioniSeriale {
            val testo = json?.trim().orEmpty()
            if (testo.isEmpty() || testo == "undefined" || testo == "null") return OpzioniSeriale()
            val o = try { JSONObject(testo) } catch (e: JSONException) { throw Rifiutato(NON_VALIDE) }
            val baud = when (val b = o.opt("baud")) {
                null -> BAUD_POLPO
                is Number -> if (b.toDouble() == b.toInt().toDouble()) b.toInt() else throw Rifiutato(NON_VALIDE)
                else -> throw Rifiutato(NON_VALIDE)
            }
            controllaBaud(baud)
            return OpzioniSeriale(baud, booleano(o, "dtr", true), booleano(o, "rts", false))
        }

        /** Le velocità accettate: quelle delle porte seriali USB comuni, tranne 1200. */
        fun controllaBaud(baud: Int) {
            if (baud == BAUD_BOOTLOADER) throw Rifiutato("1200 baud non è permesso: riavvierebbe il Polpo nel bootloader.")
            if (baud !in BAUD_MIN..BAUD_MAX) throw Rifiutato("Velocità non valida: da $BAUD_MIN a $BAUD_MAX baud.")
        }

        private fun booleano(o: JSONObject, nome: String, predefinito: Boolean): Boolean =
            when (val v = o.opt(nome)) {
                null -> predefinito
                is Boolean -> v
                else -> throw Rifiutato(NON_VALIDE)
            }
    }
}

/** Le voci di «usbElenco()» e «serialeElenco()». Parte pura, provata senza Android. */
object UsbDati {
    const val VID_ESPRESSIF = 0x303A

    /** Le classi USB del dispositivo: quelle delle sue interfacce, oppure la classe del dispositivo se non ne ha. */
    fun classi(classeDispositivo: Int, classiInterfacce: List<Int>): List<Int> =
        classiInterfacce.distinct().ifEmpty { listOf(classeDispositivo) }

    fun voce(
        id: Int, nome: String, produttore: String, vid: Int, pid: Int, classi: List<Int>,
        seriale: Boolean, permesso: Boolean,
    ): JSONObject = JSONObject()
        .put("id", id.toString())
        .put("nome", nome)
        .put("produttore", produttore)
        .put("vid", vid)
        .put("pid", pid)
        .put("classi", JSONArray().apply { classi.forEach { put(it) } })
        .put("seriale", seriale)
        .put("polpo", vid == VID_ESPRESSIF)
        .put("permesso", permesso)
}
