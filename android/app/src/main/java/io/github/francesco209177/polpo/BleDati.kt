package io.github.francesco209177.polpo

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Bluetooth LE del telefono, la parte pura (provata senza Android): i risultati della scansione nella forma della
 * risposta «ble.scan» del Polpo, i servizi GATT, gli UUID e i testi degli errori.
 */
object BleDati {
    const val DURATA_MIN_MS = 500
    const val DURATA_MAX_MS = 10_000
    const val DISPOSITIVI_MAX = 40 // come il Polpo

    /** Un dispositivo trovato dalla scansione (gli annunci dello stesso indirizzo si sommano con [unisci]). */
    data class Trovato(val name: String, val addr: String, val rssi: Int, val mfrId: Int, val connectable: Boolean) {
        fun unisci(nuovo: Trovato) = Trovato(
            name = nuovo.name.ifEmpty { name },
            addr = addr,
            rssi = nuovo.rssi,
            mfrId = if (mfrId != -1) mfrId else nuovo.mfrId,
            connectable = connectable || nuovo.connectable,
        )
    }

    /** La durata della scansione, entro i limiti del ponte. */
    fun durata(ms: Int): Long = ms.coerceIn(DURATA_MIN_MS, DURATA_MAX_MS).toLong()

    /**
     * Il codice del produttore (Bluetooth SIG) del primo dato «Manufacturer Specific» (tipo 0xFF) nell'annuncio
     * grezzo, little-endian come lo legge il Polpo; -1 se non c'è.
     */
    fun produttore(annuncio: ByteArray?): Int {
        if (annuncio == null) return -1
        var i = 0
        while (i < annuncio.size) {
            val lunghezza = annuncio[i].toInt() and 0xFF
            if (lunghezza == 0 || i + lunghezza >= annuncio.size) return -1
            if ((annuncio[i + 1].toInt() and 0xFF) == 0xFF && lunghezza >= 3) {
                return (annuncio[i + 2].toInt() and 0xFF) or ((annuncio[i + 3].toInt() and 0xFF) shl 8)
            }
            i += lunghezza + 1
        }
        return -1
    }

    /** L'evento «ble.risultato»: i più vicini per primi, al massimo [DISPOSITIVI_MAX]. */
    fun risultato(trovati: Collection<Trovato>): JSONObject {
        val lista = JSONArray()
        for (t in trovati.sortedByDescending { it.rssi }.take(DISPOSITIVI_MAX)) {
            lista.put(
                JSONObject().put("name", t.name).put("addr", t.addr).put("rssi", t.rssi)
                    .put("mfr_id", t.mfrId).put("connectable", t.connectable),
            )
        }
        return JSONObject().put("tipo", "ble.risultato").put("devices", lista)
    }

    // i bit di BluetoothGattCharacteristic.PROPERTY_*
    private val PROPRIETA = listOf(
        0x01 to "broadcast", 0x02 to "read", 0x04 to "write_no_response", 0x08 to "write",
        0x10 to "notify", 0x20 to "indicate", 0x40 to "signed_write", 0x80 to "extended",
    )

    fun proprieta(bit: Int): List<String> = PROPRIETA.filter { (bit and it.first) != 0 }.map { it.second }

    /** Un servizio dell'evento «ble.collegato»: `{uuid, caratteristiche: [{uuid, proprieta}]}`. */
    fun servizio(uuid: UUID, caratteristiche: List<Pair<UUID, Int>>): JSONObject {
        val lista = JSONArray()
        for ((u, bit) in caratteristiche) {
            lista.put(JSONObject().put("uuid", u.toString()).put("proprieta", JSONArray().apply { proprieta(bit).forEach { put(it) } }))
        }
        return JSONObject().put("uuid", uuid.toString()).put("caratteristiche", lista)
    }

    private const val BASE = "-0000-1000-8000-00805f9b34fb"

    /** Un UUID scritto per intero, oppure corto a 16 o 32 bit («180f», «0x2A19»); lancia [Rifiutato] se non valido. */
    fun uuid(testo: String?): UUID {
        val t = testo?.trim()?.lowercase().orEmpty().removePrefix("0x")
        val esa = t.all { it in '0'..'9' || it in 'a'..'f' }
        return try {
            when {
                esa && t.length == 4 -> UUID.fromString("0000$t$BASE")
                esa && t.length == 8 -> UUID.fromString(t + BASE)
                t.length == 36 -> UUID.fromString(t).also { if (it.toString() != t) throw IllegalArgumentException() }
                else -> throw IllegalArgumentException()
            }
        } catch (e: IllegalArgumentException) {
            throw Rifiutato("UUID non valido: ${testo.orEmpty().take(40)}")
        }
    }

    /** Il motivo di «ble.scollegato» dal codice di stato GATT. */
    fun motivo(stato: Int): String = when (stato) {
        0, 22 -> "richiesta" // 22 = scollegato da questo telefono
        19 -> "dispositivo" // il dispositivo ha chiuso il collegamento
        8 -> "fuori portata" // nessuna risposta entro il tempo del collegamento
        else -> "errore $stato"
    }

    /** Il messaggio di «ble.errore» per un'operazione GATT non riuscita («Lettura», «Attivazione delle notifiche»). */
    fun erroreOperazione(cosa: String, stato: Int): String = when (stato) {
        5, 8, 15, 137 -> "$cosa non riuscita: la caratteristica richiede l'abbinamento, che l'app non fa."
        else -> "$cosa non riuscita (codice $stato)."
    }

    /** Android permette 5 avvii di scansione ogni 30 s; oltre, la scansione parte ma non trova niente. */
    class LimiteScansioni(private val massimo: Int = 5, private val finestraMs: Long = 30_000) {
        private val avvii = ArrayDeque<Long>()

        fun permetti(adesso: Long): Boolean {
            while (avvii.isNotEmpty() && adesso - avvii.first() >= finestraMs) avvii.removeFirst()
            if (avvii.size >= massimo) return false
            avvii.addLast(adesso)
            return true
        }
    }
}
