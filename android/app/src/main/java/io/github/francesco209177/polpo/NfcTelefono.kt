package io.github.francesco209177.polpo

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.nfc.FormatException
import android.nfc.NdefMessage
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.TagLostException
import android.nfc.tech.Ndef
import android.nfc.tech.NdefFormatable
import android.nfc.tech.NfcA
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.IOException

/**
 * L'NFC del telefono, in modalità lettore (solo mentre l'app è in primo piano): legge i tag e scrive link o testi
 * NDEF su tag già formattati. Niente emulazione di carte, niente chiavi, niente blocchi: il tag resta riscrivibile.
 * Eventi per la pagina con [manda]: «nfc.tag», «nfc.scritto», «nfc.errore», «nfc.stato».
 */
class NfcTelefono(private val attivita: Activity, private val manda: (JSONObject) -> Unit) : NfcAdapter.ReaderCallback {

    private val adattatore: NfcAdapter? = NfcAdapter.getDefaultAdapter(attivita)
    private val principale = Handler(Looper.getMainLooper())

    // stato toccato solo dal thread principale, tranne [scrittura] (anche dal thread del lettore)
    @Volatile private var lettura = false
    private var scrittura: ByteArray? = null
    private var inPrimoPiano = false
    private var lettoreAcceso = false

    private val scaduta = Runnable {
        if (prendiScrittura() != null) errore("Nessun tag appoggiato entro 20 s.")
        aggiorna()
    }

    private val ricevitore = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            when (intent.getIntExtra(NfcAdapter.EXTRA_ADAPTER_STATE, NfcAdapter.STATE_OFF)) {
                NfcAdapter.STATE_ON -> {
                    manda(JSONObject().put("tipo", "nfc.stato").put("stato", "pronto"))
                    lettoreAcceso = false
                    aggiorna()
                }
                NfcAdapter.STATE_OFF -> {
                    manda(JSONObject().put("tipo", "nfc.stato").put("stato", "spento"))
                    lettoreAcceso = false
                    if (prendiScrittura() != null) errore(SPENTO)
                }
            }
        }
    }

    fun avvia() {
        if (adattatore == null) return
        // un annuncio protetto, che solo il sistema può mandare; «esportato» perché fino ad Android 12 arriva dal
        // processo dell'NFC, che non ha il permesso con cui ContextCompat protegge i ricevitori non esportati
        ContextCompat.registerReceiver(attivita, ricevitore, IntentFilter(NfcAdapter.ACTION_ADAPTER_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED)
    }

    fun ferma() {
        lettura = false
        prendiScrittura()
        inPrimoPiano = false
        aggiorna()
        if (adattatore != null) {
            try { attivita.unregisterReceiver(ricevitore) } catch (e: IllegalArgumentException) { /* non registrato */ }
        }
    }

    fun stato(): String = when {
        adattatore == null -> "assente"
        !adattatore.isEnabled -> "spento"
        else -> "pronto"
    }

    /** Comincia a leggere i tag (finché la pagina non chiama [smetti]); false se l'NFC manca o è spento. */
    fun leggi(): Boolean {
        if (!pronto()) return false
        lettura = true
        principale.post { aggiorna() }
        return true
    }

    fun smetti() {
        lettura = false
        principale.post { aggiorna() }
    }

    /** Prepara la scrittura del messaggio di [json] sul prossimo tag appoggiato entro 20 s; false se rifiutata. */
    fun scrivi(json: String?): Boolean {
        if (!pronto()) return false
        val messaggio = try { NdefDati.richiesta(json) } catch (e: Rifiutato) { errore(e.message.orEmpty()); return false }
        synchronized(this) {
            if (scrittura != null) {
                errore("C'è già una scrittura in attesa di un tag.")
                return false
            }
            scrittura = messaggio
        }
        principale.post {
            principale.removeCallbacks(scaduta)
            principale.postDelayed(scaduta, ATTESA_SCRITTURA_MS)
            aggiorna()
        }
        return true
    }

    fun riprendi() {
        inPrimoPiano = true
        aggiorna()
    }

    fun pausa() {
        inPrimoPiano = false
        if (prendiScrittura() != null) errore("Scrittura annullata: l'app non è più in primo piano.")
        aggiorna()
    }

    private fun pronto(): Boolean {
        val s = stato()
        if (s == "pronto") return true
        errore(if (s == "assente") ASSENTE else SPENTO)
        return false
    }

    @Synchronized
    private fun prendiScrittura(): ByteArray? {
        val s = scrittura
        scrittura = null
        if (s != null) principale.removeCallbacks(scaduta)
        return s
    }

    // la modalità lettore è accesa solo se serve e l'app è in primo piano
    private fun aggiorna() {
        val a = adattatore ?: return
        val serve = inPrimoPiano && (lettura || scrittura != null) && a.isEnabled
        try {
            if (serve && !lettoreAcceso) {
                a.enableReaderMode(attivita, this, TECNOLOGIE, null)
                lettoreAcceso = true
            } else if (!serve && lettoreAcceso) {
                lettoreAcceso = false
                a.disableReaderMode(attivita)
            }
        } catch (e: IllegalStateException) {
            lettoreAcceso = false // l'attività non è in primo piano
        } catch (e: UnsupportedOperationException) {
            lettoreAcceso = false
        }
    }

    // dal thread del lettore NFC: le letture e le scritture possono bloccare
    override fun onTagDiscovered(tag: Tag) {
        val messaggio = prendiScrittura()
        if (messaggio != null) {
            scriviSu(tag, messaggio)
            principale.post { aggiorna() }
        } else if (lettura) {
            manda(JSONObject().put("tipo", "nfc.tag").put("carta", carta(tag)))
        }
    }

    private fun carta(tag: Tag): JSONObject {
        val tecnologie = tag.techList.map { it.substringAfterLast('.') }
        val a = NfcA.get(tag) ?: return Carta.carta(tag.id, tecnologie, null, -1, null, null)
        val sak = a.sak.toInt() and 0xFF
        var versione: ByteArray? = null
        var pagine: ByteArray? = null
        if (sak == 0x00) {
            try {
                a.connect()
                a.timeout = TEMPO_COMANDO_MS
                versione = versione(a)
                pagine = Carta.leggiPagine(Carta.modello(versione).ultimaUtente + 1) { p -> leggi4(a, p) }
            } catch (e: IOException) {
                // tag allontanato: si manda quello che si sa
            } catch (e: SecurityException) {
                // tag non più valido (Android lo segnala così se è già stato tolto)
            } finally {
                try { a.close() } catch (e: IOException) { /* già chiuso */ }
            }
        }
        return Carta.carta(tag.id, tecnologie, a.atqa, sak, versione, pagine)
    }

    // GET_VERSION (0x60) dei NTAG21x e degli Ultralight EV1; l'Ultralight originale non risponde e va riselezionato
    private fun versione(a: NfcA): ByteArray? {
        val v = try { a.transceive(byteArrayOf(0x60)) } catch (e: IOException) { null }
        if (v != null && v.size >= 8) return v.copyOf(8)
        try {
            a.close()
            a.connect()
            a.timeout = TEMPO_COMANDO_MS
        } catch (e: IOException) { /* la lettura delle pagine dirà se il tag c'è ancora */ }
        return null
    }

    // READ (0x30): 4 pagine da 16 byte a partire da [pagina]
    private fun leggi4(a: NfcA, pagina: Int): ByteArray? =
        try { a.transceive(byteArrayOf(0x30, pagina.toByte())) } catch (e: IOException) { null }

    private fun scriviSu(tag: Tag, messaggio: ByteArray) {
        try {
            var modello: String? = null
            val a = NfcA.get(tag)
            if (a != null && (a.sak.toInt() and 0xFF) == 0x00) {
                // un tag Type 2: le stesse verifiche del Polpo prima di scrivere
                val (m, problema) = controllaType2(a)
                if (problema != null) return errore("Scrittura rifiutata: $problema.")
                modello = m.nome
            }
            val ndef = Ndef.get(tag) ?: return errore(
                if (NdefFormatable.get(tag) != null) "Scrittura rifiutata: tag non formattato NDEF (l'app non formatta i tag)."
                else "Scrittura rifiutata: questo tag non supporta NDEF.",
            )
            ndef.connect()
            try {
                if (!ndef.isWritable) return errore("Scrittura rifiutata: tag in sola lettura.")
                if (messaggio.size > ndef.maxSize) {
                    return errore("Scrittura rifiutata: contenuto troppo grande per questo tag (${messaggio.size} byte, al massimo ${ndef.maxSize}).")
                }
                val nuovo = NdefMessage(messaggio)
                ndef.writeNdefMessage(nuovo)
                val riletto = ndef.ndefMessage
                if (riletto == null || !riletto.toByteArray().contentEquals(nuovo.toByteArray())) {
                    return errore("Verifica fallita: il tag non contiene quello che è stato scritto.")
                }
                manda(
                    JSONObject().put("tipo", "nfc.scritto").put("bytes", NdefDati.avvolgiTlv(messaggio).size)
                        .put("model", modello ?: nomeTipo(ndef.type)).put("uid", Carta.hex(tag.id)),
                )
            } finally {
                try { ndef.close() } catch (e: IOException) { /* già chiuso */ }
            }
        } catch (e: TagLostException) {
            errore("Il tag si è allontanato: riprova tenendolo fermo.")
        } catch (e: IOException) {
            errore("Errore di scrittura: tieni fermo il tag e riprova.")
        } catch (e: FormatException) {
            errore("Verifica fallita: il tag non contiene un messaggio NDEF valido.")
        } catch (e: SecurityException) {
            errore("Il tag si è allontanato: riprova tenendolo fermo.")
        }
    }

    // modello, pagine 0-3 (UID, blocchi statici, CC) e blocchi dinamici: niente scrittura se qualcosa non va
    private fun controllaType2(a: NfcA): Pair<Carta.Modello, String?> {
        a.connect()
        try {
            a.timeout = TEMPO_COMANDO_MS
            val m = Carta.modello(versione(a))
            val testa = leggi4(a, 0) ?: return m to "tag non leggibile"
            val dinamico = if (m.paginaBloccoDinamico != 0) leggi4(a, m.paginaBloccoDinamico) else null
            return m to Carta.problemaScrittura(m, testa, dinamico)
        } finally {
            try { a.close() } catch (e: IOException) { /* già chiuso */ }
        }
    }

    private fun nomeTipo(tipo: String?): String = when (tipo) {
        Ndef.NFC_FORUM_TYPE_1 -> "NFC Forum Type 1"
        Ndef.NFC_FORUM_TYPE_2 -> "NFC Forum Type 2"
        Ndef.NFC_FORUM_TYPE_3 -> "NFC Forum Type 3"
        Ndef.NFC_FORUM_TYPE_4 -> "NFC Forum Type 4"
        Ndef.MIFARE_CLASSIC -> "MIFARE Classic"
        else -> tipo ?: "tag NDEF"
    }

    private fun errore(messaggio: String) {
        manda(JSONObject().put("tipo", "nfc.errore").put("messaggio", messaggio))
    }

    companion object {
        const val ASSENTE = "Questo telefono non ha l'NFC."
        const val SPENTO = "L'NFC è spento: accendilo nelle impostazioni del telefono."
        private const val ATTESA_SCRITTURA_MS = 20_000L
        private const val TEMPO_COMANDO_MS = 500

        // ISO 14443-A (NTAG, MIFARE, carte), ma anche 14443-B, FeliCa e ISO 15693, solo per riconoscerli
        private const val TECNOLOGIE = NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V
    }
}
