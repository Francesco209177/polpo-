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

/**
 * La porta seriale USB del Polpo (cavo OTG), per Polpo Link. Le stesse regole di Polpo Studio per l'ESP32-S3:
 * DTR attivo e RTS basso, 115200 baud, mai 1200 baud (è il segnale per entrare nel bootloader).
 * Una porta per volta. Gli eventi vanno alla pagina con [manda]: «seriale.aperta», «seriale.dati» (base64),
 * «seriale.chiusa», «seriale.errore», «usb.cambiati».
 */
class Seriale(private val contesto: Context, private val manda: (JSONObject) -> Unit) {

    private val usb = contesto.getSystemService(Context.USB_SERVICE) as UsbManager
    private var porta: UsbSerialPort? = null
    private var lettore: SerialInputOutputManager? = null
    private var inAttesa: UsbDevice? = null

    private val ricevitore = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            when (intent.action) {
                AZIONE_PERMESSO -> {
                    val d = inAttesa ?: return
                    inAttesa = null
                    if (usb.hasPermission(d)) apriOra(d) else errore("Permesso USB negato: senza il permesso l'app non può parlare con il Polpo.")
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

    /** I dispositivi USB collegati che sembrano porte seriali, il Polpo (Espressif) per primo. */
    fun elenco(): String {
        val lista = JSONArray()
        for (d in usb.deviceList.values.sortedBy { if (it.vendorId == VID_ESPRESSIF) 0 else 1 }) {
            if (driver(d) == null) continue
            lista.put(
                JSONObject()
                    .put("id", d.deviceId.toString())
                    .put("nome", d.productName ?: d.deviceName)
                    .put("produttore", d.manufacturerName ?: "")
                    .put("vid", d.vendorId)
                    .put("pid", d.productId)
                    .put("polpo", d.vendorId == VID_ESPRESSIF)
                    .put("permesso", usb.hasPermission(d)),
            )
        }
        return lista.toString()
    }

    fun apri(id: String) {
        if (porta != null) chiudi("porta chiusa")
        val d = usb.deviceList.values.firstOrNull { it.deviceId.toString() == id }
            ?: return errore("Il dispositivo USB non c'è più: è stato scollegato?")
        if (usb.hasPermission(d)) {
            apriOra(d)
            return
        }
        inAttesa = d
        val intento = Intent(AZIONE_PERMESSO).setPackage(contesto.packageName)
        val segni = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        usb.requestPermission(d, PendingIntent.getBroadcast(contesto, 0, intento, segni))
    }

    private fun apriOra(d: UsbDevice) {
        val drv = driver(d) ?: return errore("Questo dispositivo USB non è una porta seriale.")
        val connessione = usb.openDevice(d) ?: return errore("Impossibile aprire il dispositivo USB.")
        val p = drv.ports.firstOrNull() ?: return errore("Nessuna porta seriale sul dispositivo.")
        try {
            p.open(connessione)
            p.setParameters(BAUD, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
            p.rts = false
            p.dtr = true // senza DTR il Polpo non trasmette
        } catch (e: IOException) {
            try { p.close() } catch (_: IOException) { }
            return errore("Impossibile aprire la porta USB: ${e.message}")
        } catch (e: UnsupportedOperationException) {
            // alcune schede non hanno le linee DTR/RTS: si va avanti lo stesso
        }
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

    @Synchronized
    fun chiudi(motivo: String) {
        val p = porta ?: return
        porta = null
        lettore?.stop()
        lettore = null
        try { p.close() } catch (_: IOException) { }
        manda(JSONObject().put("tipo", "seriale.chiusa").put("motivo", motivo))
    }

    private fun errore(messaggio: String) {
        manda(JSONObject().put("tipo", "seriale.errore").put("messaggio", messaggio))
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
        const val BAUD = 115200 // mai 1200: riavvierebbe il Polpo nel bootloader
        const val VID_ESPRESSIF = 0x303A
        private const val AZIONE_PERMESSO = "io.github.francesco209177.polpo.PERMESSO_USB"
    }
}
