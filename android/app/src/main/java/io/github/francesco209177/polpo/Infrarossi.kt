package io.github.francesco209177.polpo

import android.content.Context
import android.hardware.ConsumerIrManager
import org.json.JSONArray
import org.json.JSONException

/**
 * L'emettitore infrarosso del telefono (pochi modelli ne hanno uno). Trasmette solo entro i limiti del ponte:
 * frequenza 20–60 kHz, al massimo 1024 durate e 2 s in tutto.
 */
class Infrarossi(contesto: Context) {
    private val ir = contesto.getSystemService(Context.CONSUMER_IR_SERVICE) as ConsumerIrManager?

    fun presente(): Boolean = try { ir?.hasIrEmitter() == true } catch (e: RuntimeException) { false }

    /** [tempi] = JSON di durate in µs, impulso e pausa alternati. Blocca finché la trasmissione non è finita. */
    @Synchronized
    fun trasmetti(frequenza: Int, tempi: String?): Boolean {
        val m = ir ?: return false
        if (!presente()) return false
        val durate = try { durate(tempi).also { controlla(frequenza, it) } } catch (e: Rifiutato) { return false }
        return try {
            // se il telefono dichiara le frequenze che sa fare, solo quelle
            val gamme = m.carrierFrequencies
            if (gamme != null && gamme.isNotEmpty() && gamme.none { frequenza in it.minFrequency..it.maxFrequency }) return false
            m.transmit(frequenza, durate)
            true
        } catch (e: RuntimeException) {
            false // IllegalArgumentException, UnsupportedOperationException, SecurityException
        }
    }

    companion object {
        const val FREQUENZA_MIN = 20_000
        const val FREQUENZA_MAX = 60_000
        const val DURATE_MAX = 1024
        const val TOTALE_MAX_US = 2_000_000L

        /** Le durate dal JSON della pagina (numeri interi positivi); lancia [Rifiutato] se non vanno bene. */
        fun durate(json: String?): IntArray {
            val a = try { JSONArray(json ?: "") } catch (e: JSONException) { throw Rifiutato("Tempi non validi: serve un elenco di durate in µs.") }
            if (a.length() == 0 || a.length() > DURATE_MAX) throw Rifiutato("Da 1 a $DURATE_MAX durate.")
            return IntArray(a.length()) { i ->
                val v = a.opt(i)
                if (v !is Number || v.toDouble() != v.toLong().toDouble() || v.toLong() !in 1..TOTALE_MAX_US) {
                    throw Rifiutato("Ogni durata è un numero intero di µs, da 1 a $TOTALE_MAX_US.")
                }
                v.toInt()
            }
        }

        /** I limiti del ponte; lancia [Rifiutato] se la trasmissione li supera. */
        fun controlla(frequenza: Int, durate: IntArray) {
            if (frequenza !in FREQUENZA_MIN..FREQUENZA_MAX) throw Rifiutato("Frequenza fuori da 20–60 kHz.")
            if (durate.isEmpty() || durate.size > DURATE_MAX) throw Rifiutato("Da 1 a $DURATE_MAX durate.")
            if (durate.any { it <= 0 }) throw Rifiutato("Le durate devono essere positive.")
            if (durate.sumOf { it.toLong() } > TOTALE_MAX_US) throw Rifiutato("Oltre 2 s di trasmissione.")
        }
    }
}
