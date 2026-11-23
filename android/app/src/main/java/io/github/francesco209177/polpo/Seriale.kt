package io.github.francesco209177.polpo

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Base64
import androidx.core.content.ContextCompat
import com.hoho.android.usbserial.driver.CdcAcmSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import com.hoho.android.usbserial.util.SerialInputOutputManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import kotlin.concurrent.thread

/**
 * La porta seriale USB (cavo OTG): il Polpo per Polpo Link, ma anche altre schede. Per il Polpo valgono le regole di
 * Polpo Studio per l'ESP32-S3: 115200 baud, DTR attivo e RTS basso ([OpzioniSeriale]); mai 1200 baud, tranne nel
 * «tocco» per il bootloader dell'aggiornamento del firmware ([toccoBootloader]).
 * Una porta per volta. Gli eventi vanno alla pagina con [manda]: «seriale.aperta», «seriale.dati» (base64),
 * «seriale.chiusa», «seriale.errore», «seriale.tocco», «usb.cambiati».
 */
class Seriale(private val contesto: Context, private val manda: (JSONObject) -> Unit) {

    private val usb = contesto.getSystemService(Context.USB_SERVICE) as UsbManager
    @Volatile private var porta: UsbSerialPort? = null
    private var lettore: SerialInputOutputManager? = null
    private var dtr = true
    private var rts = false

    // un dispositivo in attesa del permesso di Android, con cosa fare dopo
    private class Attesa(val dispositivo: UsbDevice, val poi: (UsbDevice) -> Unit, val negato: () -> Unit)
    private var inAttesa: Attesa? = null

    private val ricevitore = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            when (intent.action) {
                AZIONE_PERMESSO -> {
                    val a = inAttesa ?: return
                    if (dispositivo(intent)?.deviceId?.let { it != a.dispositivo.deviceId } == true) return
                    inAttesa = null
                    if (usb.hasPermission(a.dispositivo)) a.poi(a.dispositivo) else a.negato()
                }
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> manda(JSONObject().put("tipo", "usb.cambiati"))
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    manda(JSONObject().put("tipo", "usb.cambiati"))
                    if (porta != null && porta?.device?.deviceId == dispositivo(intent)?.deviceId) chiudi("scollegato")
                }
            }
        }
    }

    fun avvia() {
        val filtro = IntentFilter().apply {
            addAction(AZIONE_PERMESSO)
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        ContextCompat.registerReceiver(contesto, ricevitore, filtro, ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    fun ferma() {
        chiudi("porta chiusa")
        try { contesto.unregisterReceiver(ricevitore) } catch (e: IllegalArgumentException) { /* non registrato */ }
    }

    /** I dispositivi USB collegati (JSON), il Polpo (Espressif) per primo; con [soloSeriali] solo le porte seriali. */
    fun elenco(soloSeriali: Boolean): String {
        val lista = JSONArray()
        for (d in usb.deviceList.values.sortedBy { if (it.vendorId == UsbDati.VID_ESPRESSIF) 0 else 1 }) {
            val seriale = driver(d) != null
            if (soloSeriali && !seriale) continue
            val classi = UsbDati.classi(d.deviceClass, (0 until d.interfaceCount).map { d.getInterface(it).interfaceClass })
            lista.put(
                UsbDati.voce(
                    d.deviceId, d.productName ?: d.deviceName, d.manufacturerName ?: "", d.vendorId, d.productId,
                    classi, seriale, usb.hasPermission(d),
                ),
            )
        }
        return lista.toString()
    }

    /** Apre la porta con le [opzioni] (JSON, facoltativo), chiedendo il permesso di Android se serve. */
    fun apri(id: String, opzioni: String?) {
        val o = try { OpzioniSeriale.da(opzioni) } catch (e: Rifiutato) { return errore(e.message.orEmpty()) }
        if (porta != null) chiudi("porta chiusa")
        val d = trova(id) ?: return errore("Il dispositivo USB non c'è più: è stato scollegato?")
        conPermesso(d, { apriOra(it, o) }) {
            errore("Permesso USB negato: senza il permesso l'app non può parlare con il dispositivo.")
        }
    }

    private fun apriOra(d: UsbDevice, o: OpzioniSeriale) {
        val drv = driver(d) ?: return errore("Questo dispositivo USB non è una porta seriale.")
        val connessione = usb.openDevice(d) ?: return errore("Impossibile aprire il dispositivo USB.")
        val p = drv.ports.firstOrNull() ?: return errore("Nessuna porta seriale sul dispositivo.")
        try {
            p.open(connessione)
            p.setParameters(o.baud, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
        } catch (e: IOException) {
            try { p.close() } catch (_: IOException) { }
            return errore("Impossibile aprire la porta USB: ${e.message}")
        } catch (e: UnsupportedOperationException) {
            // alcuni driver non cambiano la velocità: si va avanti con la loro
        }
        try {
            p.rts = o.rts
            p.dtr = o.dtr // senza DTR il Polpo non trasmette
        } catch (e: IOException) {
            // si va avanti lo stesso: se le linee non servono, la porta funziona
        } catch (e: UnsupportedOperationException) {
            // alcune schede non hanno le linee DTR/RTS
        }
        dtr = o.dtr
        rts = o.rts
        porta = p
        lettore = SerialInputOutputManager(p, object : SerialInputOutputManager.Listener {
            override fun onNewData(dati: ByteArray) {
                manda(JSONObject().put("tipo", "seriale.dati").put("dati", Base64.encodeToString(dati, Base64.NO_WRAP)))
            }

            override fun onRunError(e: Exception) {
                chiudi("scollegato")
            }
        }).also { it.start() }
        manda(JSONObject().put("tipo", "seriale.aperta").put("nome", d.productName ?: d.deviceName))
    }

    fun scrivi(base64: String): Boolean {
        val p = porta ?: return false
        return try {
            p.write(Base64.decode(base64, Base64.DEFAULT), 2000)
            true
        } catch (e: IOException) {
            false
        } catch (e: IllegalArgumentException) {
            false
        }
    }

    /** Imposta DTR e RTS sulla porta aperta. Cambia solo le linee diverse da prima, DTR per prima. */
    @Synchronized
    fun linee(nuovoDtr: Boolean, nuovoRts: Boolean): Boolean {
        val p = porta ?: return false
        return try {
            if (nuovoDtr != dtr) p.dtr = nuovoDtr
            dtr = nuovoDtr
            if (nuovoRts != rts) p.rts = nuovoRts
            rts = nuovoRts
            true
        } catch (e: IOException) {
            false
        } catch (e: UnsupportedOperationException) {
            false
        }
    }

    /** Cambia la velocità della porta aperta (mai 1200 baud). */
    @Synchronized
    fun baud(baud: Int): Boolean {
        val p = porta ?: return false
        try { OpzioniSeriale.controllaBaud(baud) } catch (e: Rifiutato) { return false }
        return try {
            p.setParameters(baud, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
            true
        } catch (e: IOException) {
            false
        } catch (e: UnsupportedOperationException) {
            false
        }
    }

    /**
     * Il «tocco» a 1200 baud per l'aggiornamento del firmware: apre il dispositivo a 1200 baud, porta DTR in basso
     * (RTS resta basso), aspetta 100 ms e chiude. L'ESP32-S3 con l'USB nativa riparte nel bootloader e si ripresenta
     * come un altro dispositivo («usb.cambiati»). L'esito arriva con «seriale.tocco {ok, messaggio}».
     */
    fun toccoBootloader(id: String) {
        val d = trova(id) ?: return tocco(false, "Il dispositivo USB non c'è più: è stato scollegato?")
        if (porta?.device?.deviceId == d.deviceId) chiudi("porta chiusa")
        conPermesso(d, { thread(name = "polpo-tocco") { toccaOra(it) } }) {
            tocco(false, "Permesso USB negato: senza il permesso l'app non può parlare con il dispositivo.")
        }
    }

    private fun toccaOra(d: UsbDevice) {
        val drv = driver(d) ?: return tocco(false, "Questo dispositivo USB non è una porta seriale.")
        val connessione = usb.openDevice(d) ?: return tocco(false, "Impossibile aprire il dispositivo USB.")
        val p = drv.ports.firstOrNull() ?: return tocco(false, "Nessuna porta seriale sul dispositivo.")
        try {
            p.open(connessione)
        } catch (e: IOException) {
            try { p.close() } catch (_: IOException) { }
            return tocco(false, "Impossibile aprire la porta USB: ${e.message}")
        }
        try {
            p.rts = false
            p.dtr = true
            p.setParameters(OpzioniSeriale.BAUD_BOOTLOADER, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
            p.dtr = false
            Thread.sleep(100)
        } catch (e: IOException) {
            // il dispositivo può staccarsi già qui, mentre riparte: va bene così
        } catch (e: UnsupportedOperationException) {
            try { p.close() } catch (_: IOException) { }
            return tocco(false, "Questo dispositivo non permette di cambiare velocità o linee: niente tocco per il bootloader.")
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        try { p.close() } catch (_: IOException) { }
        tocco(true, "Segnale mandato: un ESP32-S3 con l'USB nativa ora riparte nel bootloader.")
    }

    @Synchronized
    fun chiudi(motivo: String) {
        val p = porta ?: return
        porta = null
        lettore?.stop()
        lettore = null
        try { p.close() } catch (_: IOException) { }
        manda(JSONObject().put("tipo", "seriale.chiusa").put("motivo", motivo))
    }

    private fun trova(id: String): UsbDevice? = usb.deviceList.values.firstOrNull { it.deviceId.toString() == id }

    private fun conPermesso(d: UsbDevice, poi: (UsbDevice) -> Unit, negato: () -> Unit) {
        if (usb.hasPermission(d)) return poi(d)
        inAttesa?.negato?.invoke() // una richiesta per volta: la precedente resta senza permesso
        inAttesa = Attesa(d, poi, negato)
        val intento = Intent(AZIONE_PERMESSO).setPackage(contesto.packageName)
        val segni = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        usb.requestPermission(d, PendingIntent.getBroadcast(contesto, 0, intento, segni))
    }

    private fun errore(messaggio: String) {
        manda(JSONObject().put("tipo", "seriale.errore").put("messaggio", messaggio))
    }

    private fun tocco(ok: Boolean, messaggio: String) {
        manda(JSONObject().put("tipo", "seriale.tocco").put("ok", ok).put("messaggio", messaggio))
    }

    private fun driver(d: UsbDevice): UsbSerialDriver? {
        UsbSerialProber.getDefaultProber().probeDevice(d)?.let { return it }
        // l'USB nativa dell'ESP32-S3 è una porta CDC-ACM standard
        for (i in 0 until d.interfaceCount) {
            if (d.getInterface(i).interfaceClass == UsbConstants.USB_CLASS_CDC_DATA) return CdcAcmSerialDriver(d)
        }
        return null
    }

    @Suppress("DEPRECATION")
    private fun dispositivo(intent: Intent): UsbDevice? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        else intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)

    companion object {
        private const val AZIONE_PERMESSO = "io.github.francesco209177.polpo.PERMESSO_USB"
    }
}
