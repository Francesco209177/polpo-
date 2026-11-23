package io.github.francesco209177.polpo

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Il Bluetooth LE del telefono: scansione passiva e, per un dispositivo scelto, solo lettura delle caratteristiche e
 * notifiche. Niente annunci, niente scritture, niente abbinamento. Eventi per la pagina con [manda]: «ble.risultato»,
 * «ble.collegato», «ble.letto», «ble.notifica», «ble.scollegato», «ble.errore».
 *
 * Tutto lo stato vive nel thread principale: i metodi della pagina e i richiami di Android ci arrivano con [principale].
 */
@SuppressLint("MissingPermission") // ogni uso del Bluetooth passa prima da [conPermesso]
class BleTelefono(
    private val contesto: Context,
    private val chiediPermessi: (permessi: Array<String>, spiegazione: String, poi: () -> Unit) -> Unit,
    private val manda: (JSONObject) -> Unit,
) {
    private val adattatore: BluetoothAdapter? =
        if (contesto.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            (contesto.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?)?.adapter
        } else {
            null
        }
    private val principale = Handler(Looper.getMainLooper())
    private val limite = BleDati.LimiteScansioni()
    private var inPrimoPiano = false

    private var scansione: ScanCallback? = null
    private val trovati = LinkedHashMap<String, BleDati.Trovato>()
    private val fineScansione = Runnable { finisciScansione() }

    private var gatt: BluetoothGatt? = null
    private var indirizzo = ""
    private var collegato = false // «ble.collegato» già mandato
    private var scollegaRichiesto = false

    // le operazioni GATT vanno fatte una per volta
    private class Operazione(val cosa: String, val avvia: (BluetoothGatt) -> Boolean)
    private val coda = ArrayDeque<Operazione>()
    private var operazione: Operazione? = null

    private val scadutoCollegamento = Runnable {
        if (gatt != null && !collegato) {
            chiudiGatt(null)
            errore("Il dispositivo non risponde: è acceso e vicino?")
        }
    }
    private val scadutaOperazione = Runnable {
        operazione?.let { errore("${it.cosa} non riuscita: il dispositivo non risponde.") }
        finita()
    }
    private val scollegaForzato = Runnable { if (gatt != null && scollegaRichiesto) chiudiGatt("richiesta") }

    private val ricevitore = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            val s = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.STATE_OFF)
            if (s != BluetoothAdapter.STATE_TURNING_OFF && s != BluetoothAdapter.STATE_OFF) return
            if (scansione != null) {
                fermaScansione()
                errore("Il Bluetooth è stato spento.")
            }
            chiudiGatt("bluetooth spento")
        }
    }

    fun avvia() {
        if (adattatore == null) return
        // un annuncio protetto, che solo il sistema può mandare (vedi NfcTelefono.avvia)
        ContextCompat.registerReceiver(contesto, ricevitore, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED)
    }

    fun ferma() {
        fermaScansione()
        chiudiGatt(null)
        if (adattatore != null) {
            try { contesto.unregisterReceiver(ricevitore) } catch (e: IllegalArgumentException) { /* non registrato */ }
        }
    }

    fun riprendi() {
        inPrimoPiano = true
    }

    /** In pausa la scansione finisce subito, con i dispositivi trovati fin lì; il collegamento resta. */
    fun pausa() {
        inPrimoPiano = false
        finisciScansione()
    }

    fun stato(): String = when {
        adattatore == null -> "assente"
        !adattatore.isEnabled -> "spento"
        else -> "pronto"
    }

    // ---------------- scansione ----------------

    fun scansiona(ms: Int) {
        principale.post {
            if (scansione != null) return@post errore("C'è già una ricerca in corso.")
            if (!pronto()) return@post
            conPermesso(permessoScansione()) { avviaScansione(BleDati.durata(ms)) }
        }
    }

    private fun avviaScansione(durata: Long) {
        if (!pronto()) return
        if (scansione != null) return errore("C'è già una ricerca in corso.")
        if (!inPrimoPiano) return errore("La ricerca Bluetooth funziona solo con l'app in primo piano.")
        if (Build.VERSION.SDK_INT < 31) {
            val posizione = contesto.getSystemService(Context.LOCATION_SERVICE) as LocationManager?
            if (posizione != null && !LocationManagerCompat.isLocationEnabled(posizione)) {
                return errore("Su questa versione di Android la ricerca Bluetooth funziona solo con la posizione attiva: accendila nelle impostazioni (l'app non la usa).")
            }
        }
        if (!limite.permetti(SystemClock.elapsedRealtime())) {
            return errore("Troppe ricerche ravvicinate: Android ne permette 5 ogni 30 secondi. Aspetta un poco e riprova.")
        }
        val scanner = adattatore?.bluetoothLeScanner ?: return errore(SPENTO)
        val richiamo = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val t = trovato(result)
                principale.post { if (scansione === this) aggiungi(t) }
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>) {
                val lista = results.map { trovato(it) }
                principale.post { if (scansione === this) lista.forEach { aggiungi(it) } }
            }

            override fun onScanFailed(errorCode: Int) {
                principale.post {
                    if (scansione !== this) return@post
                    scansione = null
                    principale.removeCallbacks(fineScansione)
                    errore("Ricerca non riuscita (codice $errorCode).")
                }
            }
        }
        trovati.clear()
        try {
            // passiva e a consumo medio: il telefono ascolta gli annunci, non chiede niente ai dispositivi
            scanner.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_BALANCED).build(), richiamo)
        } catch (e: SecurityException) {
            return errore(negato())
        } catch (e: IllegalStateException) {
            return errore(SPENTO)
        }
        scansione = richiamo
        principale.postDelayed(fineScansione, durata)
    }

    private fun trovato(r: ScanResult): BleDati.Trovato {
        val annuncio = r.scanRecord
        // il nome dall'annuncio, non dal dispositivo: così non serve il permesso di collegamento
        return BleDati.Trovato(annuncio?.deviceName.orEmpty(), r.device.address, r.rssi, BleDati.produttore(annuncio?.bytes), r.isConnectable)
    }

    private fun aggiungi(t: BleDati.Trovato) {
        val prima = trovati[t.addr]
        if (prima == null && trovati.size >= TROVATI_MAX) return
        trovati[t.addr] = prima?.unisci(t) ?: t
    }

    private fun finisciScansione() {
        if (scansione == null) return
        fermaScansione()
        manda(BleDati.risultato(trovati.values))
        trovati.clear()
    }

    private fun fermaScansione() {
        val r = scansione ?: return
        scansione = null
        principale.removeCallbacks(fineScansione)
        try {
            adattatore?.takeIf { it.isEnabled }?.bluetoothLeScanner?.stopScan(r)
        } catch (e: SecurityException) {
            // permesso tolto nel frattempo: la scansione si ferma comunque con l'app
        } catch (e: IllegalStateException) {
            // Bluetooth spento
        }
    }

    // ---------------- collegamento GATT ----------------

    fun collega(addr: String?) {
        principale.post {
            val a = addr?.trim()?.uppercase().orEmpty()
            if (!BluetoothAdapter.checkBluetoothAddress(a)) return@post errore("Indirizzo Bluetooth non valido.")
            if (!pronto()) return@post
            conPermesso(permessoCollegamento()) { collegaOra(a) }
        }
    }

    private fun collegaOra(addr: String) {
        val a = adattatore ?: return
        if (!pronto()) return
        finisciScansione() // Android collega meglio senza una scansione in corso
        chiudiGatt("nuovo collegamento")
        indirizzo = addr
        collegato = false
        scollegaRichiesto = false
        val g = try {
            a.getRemoteDevice(addr).connectGatt(contesto, false, richiami, BluetoothDevice.TRANSPORT_LE)
        } catch (e: SecurityException) {
            return errore(negato())
        } catch (e: IllegalArgumentException) {
            return errore("Indirizzo Bluetooth non valido.")
        }
        if (g == null) return errore("Collegamento non riuscito.")
        gatt = g
        principale.postDelayed(scadutoCollegamento, ATTESA_COLLEGAMENTO_MS)
    }

    fun leggi(servizio: String?, caratteristica: String?) {
        principale.post {
            val c = caratteristica(servizio, caratteristica) ?: return@post
            if (c.properties and BluetoothGattCharacteristic.PROPERTY_READ == 0) return@post errore("La caratteristica non si può leggere.")
            accoda("Lettura") { it.readCharacteristic(c) }
        }
    }

    fun notifiche(servizio: String?, caratteristica: String?, attive: Boolean) {
        principale.post {
            val c = caratteristica(servizio, caratteristica) ?: return@post
            val g = gatt ?: return@post
            val notifica = c.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0
            val indicazione = c.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0
            if (!notifica && !indicazione) return@post errore("La caratteristica non manda notifiche.")
            val cosa = if (attive) "Attivazione delle notifiche" else "Disattivazione delle notifiche"
            if (!g.setCharacteristicNotification(c, attive)) return@post errore("$cosa non riuscita.")
            // il descrittore CCCD dice al dispositivo di mandarle; senza, basta l'impostazione nel telefono
            val cccd = c.getDescriptor(CCCD) ?: return@post
            val valore = when {
                !attive -> BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
                notifica -> BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                else -> BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
            }
            accoda(cosa) { scriviCccd(it, cccd, valore) }
        }
    }

    fun scollega() {
        principale.post {
            val g = gatt
            if (g == null || !collegato) {
                val a = indirizzo
                chiudiGatt(null)
                return@post manda(scollegato(a, "richiesta"))
            }
            scollegaRichiesto = true
            try {
                g.disconnect()
                principale.postDelayed(scollegaForzato, ATTESA_SCOLLEGAMENTO_MS) // se Android non risponde
            } catch (e: SecurityException) {
                chiudiGatt("richiesta")
            }
        }
    }

    private fun caratteristica(servizio: String?, caratteristica: String?): BluetoothGattCharacteristic? {
        val g = gatt
        if (g == null || !collegato) {
            errore("Nessun dispositivo collegato.")
            return null
        }
        val (s, c) = try {
            BleDati.uuid(servizio) to BleDati.uuid(caratteristica)
        } catch (e: Rifiutato) {
            errore(e.message.orEmpty())
            return null
        }
        return g.getService(s)?.getCharacteristic(c) ?: run {
            errore("Servizio o caratteristica non trovati sul dispositivo.")
            null
        }
    }

    // lo stato passa a «scollegato»: con [motivo] (e se era collegato) la pagina riceve «ble.scollegato»
    private fun chiudiGatt(motivo: String?) {
        val g = gatt ?: return
        gatt = null
        principale.removeCallbacks(scadutoCollegamento)
        principale.removeCallbacks(scadutaOperazione)
        principale.removeCallbacks(scollegaForzato)
        coda.clear()
        operazione = null
        try {
            g.disconnect()
            g.close()
        } catch (e: SecurityException) {
            // permesso tolto: Android chiude comunque il collegamento dell'app
        }
        val eraCollegato = collegato
        collegato = false
        if (motivo != null && eraCollegato) manda(scollegato(indirizzo, motivo))
    }

    private fun accoda(cosa: String, avvia: (BluetoothGatt) -> Boolean) {
        coda.addLast(Operazione(cosa, avvia))
        prossima()
    }

    private fun prossima() {
        if (operazione != null) return
        val g = gatt ?: return
        while (true) {
            val op = coda.removeFirstOrNull() ?: return
            val partita = try { op.avvia(g) } catch (e: SecurityException) { false }
            if (partita) {
                operazione = op
                principale.postDelayed(scadutaOperazione, ATTESA_OPERAZIONE_MS)
                return
            }
            errore("${op.cosa} non riuscita.")
        }
    }

    private fun finita() {
        operazione = null
        principale.removeCallbacks(scadutaOperazione)
        prossima()
    }

    @Suppress("DEPRECATION")
    private fun scriviCccd(g: BluetoothGatt, d: BluetoothGattDescriptor, valore: ByteArray): Boolean =
        if (Build.VERSION.SDK_INT >= 33) {
            g.writeDescriptor(d, valore) == BluetoothStatusCodes.SUCCESS
        } else {
            d.value = valore
            g.writeDescriptor(d)
        }

    private val richiami = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            principale.post {
                if (g !== gatt) return@post
                if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                    val ok = try { g.discoverServices() } catch (e: SecurityException) { false }
                    if (!ok) {
                        chiudiGatt(null)
                        errore("Servizi del dispositivo non letti.")
                    }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    when {
                        collegato -> chiudiGatt(if (scollegaRichiesto) "richiesta" else BleDati.motivo(status))
                        scollegaRichiesto -> {
                            chiudiGatt(null)
                            manda(scollegato(indirizzo, "richiesta"))
                        }
                        else -> {
                            chiudiGatt(null)
                            errore("Collegamento non riuscito (codice $status): il dispositivo è acceso e vicino?")
                        }
                    }
                }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            principale.post {
                if (g !== gatt) return@post
                principale.removeCallbacks(scadutoCollegamento)
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    chiudiGatt(null)
                    return@post errore("Servizi del dispositivo non letti (codice $status).")
                }
                collegato = true
                val servizi = JSONArray()
                for (s in g.services) servizi.put(BleDati.servizio(s.uuid, s.characteristics.map { it.uuid to it.properties }))
                manda(JSONObject().put("tipo", "ble.collegato").put("addr", indirizzo).put("servizi", servizi))
            }
        }

        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
            letta(g, c, value.copyOf(), status)
        }

        @Deprecated("Android 12 e precedenti")
        @Suppress("DEPRECATION")
        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            if (Build.VERSION.SDK_INT < 33) letta(g, c, c.value?.copyOf() ?: ByteArray(0), status)
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
            notificata(g, c, value.copyOf())
        }

        @Deprecated("Android 12 e precedenti")
        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            if (Build.VERSION.SDK_INT < 33) notificata(g, c, c.value?.copyOf() ?: ByteArray(0))
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            principale.post {
                if (g !== gatt) return@post
                if (status != BluetoothGatt.GATT_SUCCESS) errore(BleDati.erroreOperazione(operazione?.cosa ?: "Impostazione delle notifiche", status))
                finita()
            }
        }
    }

    private fun letta(g: BluetoothGatt, c: BluetoothGattCharacteristic, valore: ByteArray, stato: Int) {
        principale.post {
            if (g !== gatt) return@post
            if (stato == BluetoothGatt.GATT_SUCCESS) manda(dati("ble.letto", c, valore)) else errore(BleDati.erroreOperazione("Lettura", stato))
            finita()
        }
    }

    private fun notificata(g: BluetoothGatt, c: BluetoothGattCharacteristic, valore: ByteArray) {
        principale.post { if (g === gatt && collegato) manda(dati("ble.notifica", c, valore)) }
    }

    private fun dati(tipo: String, c: BluetoothGattCharacteristic, valore: ByteArray) = JSONObject()
        .put("tipo", tipo)
        .put("servizio", c.service?.uuid?.toString() ?: "")
        .put("caratteristica", c.uuid.toString())
        .put("dati", Base64.encodeToString(valore, Base64.NO_WRAP))

    private fun scollegato(addr: String, motivo: String) =
        JSONObject().put("tipo", "ble.scollegato").put("addr", addr).put("motivo", motivo)

    // ---------------- permessi ----------------

    private fun permessoScansione(): String =
        if (Build.VERSION.SDK_INT >= 31) Manifest.permission.BLUETOOTH_SCAN else Manifest.permission.ACCESS_FINE_LOCATION

    private fun permessoCollegamento(): String? =
        if (Build.VERSION.SDK_INT >= 31) Manifest.permission.BLUETOOTH_CONNECT else null // BLUETOOTH è già concesso

    // un solo dialogo per ricerca e collegamento: su Android 12+ sono lo stesso permesso «Dispositivi nelle vicinanze»
    private fun conPermesso(permesso: String?, poi: () -> Unit) {
        if (permesso == null || concesso(permesso)) return poi()
        val (tutti, spiegazione) = if (Build.VERSION.SDK_INT >= 31) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT) to
                "Per cercare i dispositivi Bluetooth vicini e leggerne i dati, Android chiede il permesso «Dispositivi nelle vicinanze». " +
                "L'app non usa la posizione e non manda niente in rete."
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION) to
                "Su questa versione di Android, per cercare i dispositivi Bluetooth vicini serve il permesso di posizione. " +
                "L'app non usa la posizione e non manda niente in rete."
        }
        chiediPermessi(tutti, spiegazione) { if (concesso(permesso)) poi() else errore(negato()) }
    }

    private fun concesso(p: String) = ContextCompat.checkSelfPermission(contesto, p) == PackageManager.PERMISSION_GRANTED

    private fun negato(): String = if (Build.VERSION.SDK_INT >= 31) {
        "Permesso negato: senza «Dispositivi nelle vicinanze» l'app non può usare il Bluetooth. Puoi concederlo nelle impostazioni dell'app."
    } else {
        "Permesso negato: su questa versione di Android la ricerca Bluetooth richiede il permesso di posizione. Puoi concederlo nelle impostazioni dell'app."
    }

    private fun pronto(): Boolean {
        when (stato()) {
            "assente" -> errore(ASSENTE)
            "spento" -> errore(SPENTO)
            else -> return true
        }
        return false
    }

    private fun errore(messaggio: String) {
        manda(JSONObject().put("tipo", "ble.errore").put("messaggio", messaggio))
    }

    companion object {
        const val ASSENTE = "Questo telefono non ha il Bluetooth LE."
        const val SPENTO = "Il Bluetooth è spento: accendilo nelle impostazioni del telefono."
        private const val TROVATI_MAX = 200
        private const val ATTESA_COLLEGAMENTO_MS = 15_000L
        private const val ATTESA_OPERAZIONE_MS = 10_000L
        private const val ATTESA_SCOLLEGAMENTO_MS = 3_000L
        private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }
}
