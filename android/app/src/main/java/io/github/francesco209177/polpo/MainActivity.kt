package io.github.francesco209177.polpo

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.FileNotFoundException
import java.io.IOException

/**
 * L'app Polpo: il sito del Polpo (simulatore con il firmware vero, Script, Onde, manuali) dentro il telefono,
 * senza Internet. Le pagine sono quelle di site/, costruite con «site/build.py --app».
 *
 * Cosa può fare la pagina oltre a una pagina web qualsiasi (oggetto «PolpoNativo» in JavaScript, descritto in
 * android/PONTE.md): salvare un file dove scegli tu, con il selettore di Android; parlare con i dispositivi USB
 * collegati con un cavo OTG; leggere i tag NFC e scrivere link o testi sui propri; cercare dispositivi Bluetooth LE e
 * leggerne le caratteristiche; trasmettere con l'emettitore infrarosso, se il telefono ne ha uno. Ogni accesso
 * chiede prima il permesso di Android. Niente rete, niente emulazione di carte, niente annunci né scritture Bluetooth.
 */
class MainActivity : ComponentActivity() {

    internal lateinit var webView: WebView
        private set

    private lateinit var seriale: Seriale
    private lateinit var nfc: NfcTelefono
    private lateinit var ble: BleTelefono
    private lateinit var ir: Infrarossi

    // file da salvare in attesa che si scelga dove (uno per volta)
    private var daSalvare: ByteArray? = null
    private var leggiRisorsa: String? = null
    private var permessoInAttesa: PermissionRequest? = null
    private var sceltaFile: ValueCallback<Array<Uri>>? = null

    // «Salva con nome» di Android: nome proposto e tipo del file
    private class CreaDocumento : ActivityResultContract<Pair<String, String>, Uri?>() {
        override fun createIntent(context: Context, input: Pair<String, String>): Intent =
            Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(input.second).putExtra(Intent.EXTRA_TITLE, input.first)

        override fun parseResult(resultCode: Int, intent: Intent?): Uri? =
            if (resultCode == Activity.RESULT_OK) intent?.data else null
    }

    private val salva = registerForActivityResult(CreaDocumento()) { uri ->
        val dati = daSalvare
        val risorsa = leggiRisorsa
        daSalvare = null
        leggiRisorsa = null
        if (uri == null) return@registerForActivityResult
        val fatto = try {
            contentResolver.openOutputStream(uri, "wt")?.use { out ->
                if (risorsa != null) assets.open(risorsa).use { it.copyTo(out) } else out.write(dati ?: ByteArray(0))
                true
            } ?: false
        } catch (e: IOException) {
            false
        } catch (e: SecurityException) {
            false
        }
        Toast.makeText(this, if (fatto) R.string.salvato else R.string.non_salvato, Toast.LENGTH_SHORT).show()
    }

    private val microfono = registerForActivityResult(ActivityResultContracts.RequestPermission()) { concesso ->
        val richiesta = permessoInAttesa ?: return@registerForActivityResult
        permessoInAttesa = null
        if (concesso) {
            richiesta.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            richiesta.deny()
            Toast.makeText(this, R.string.microfono_negato, Toast.LENGTH_LONG).show()
        }
    }

    private val apriFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        sceltaFile?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        sceltaFile = null
    }

    // permessi di Android chiesti al momento (Bluetooth): chi aspetta controlla da sé cosa è stato concesso
    private val attesePermessi = mutableListOf<() -> Unit>()
    private val permessi = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { rispondiPermessi() }

    /** Chiede a Android i [richiesti] (dal thread principale), dopo una [spiegazione]; poi chiama [poi]. */
    private fun chiediPermessi(richiesti: Array<String>, spiegazione: String, poi: () -> Unit) {
        if (richiesti.all { ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED }) return poi()
        attesePermessi += poi
        if (attesePermessi.size > 1) return // una richiesta è già in corso: la risposta vale per tutti
        AlertDialog.Builder(this)
            .setMessage(spiegazione)
            .setPositiveButton(android.R.string.ok) { _, _ -> permessi.launch(richiesti) }
            .setNegativeButton(android.R.string.cancel) { _, _ -> rispondiPermessi() }
            .setOnCancelListener { rispondiPermessi() }
            .show()
    }

    private fun rispondiPermessi() {
        val attese = attesePermessi.toList()
        attesePermessi.clear()
        attese.forEach { it() }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        webView = WebView(this)
        val contenitore = FrameLayout(this)
        contenitore.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(contenitore)
        // la pagina non va sotto la barra di stato, la barra di navigazione, la fotocamera o la tastiera
        ViewCompat.setOnApplyWindowInsetsListener(contenitore) { v, insets ->
            val bordi = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
            )
            v.updatePadding(left = bordi.left, top = bordi.top, right = bordi.right, bottom = bordi.bottom)
            WindowInsetsCompat.CONSUMED
        }

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true // la bozza dello script e la microSD del Polpo simulato
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = true
            cacheMode = WebSettings.LOAD_NO_CACHE
            builtInZoomControls = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        webView.webViewClient = Client()
        webView.webChromeClient = Chrome()
        seriale = Seriale(this) { evento -> mandaAllaPagina(evento) }
        seriale.avvia()
        nfc = NfcTelefono(this) { evento -> mandaAllaPagina(evento) }
        nfc.avvia()
        ble = BleTelefono(this, ::chiediPermessi) { evento -> mandaAllaPagina(evento) }
        ble.avvia()
        ir = Infrarossi(this)
        webView.addJavascriptInterface(Ponte(), "PolpoNativo")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(Risorse.INIZIO)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    /** Un evento per la pagina: window.__polpoNativo({...}). Si può chiamare da qualsiasi thread. */
    private fun mandaAllaPagina(evento: JSONObject) {
        val js = "window.__polpoNativo&&window.__polpoNativo(" + evento.toString() + ")"
        runOnUiThread { if (!isDestroyed) webView.evaluateJavascript(js, null) }
    }

    override fun onResume() {
        super.onResume()
        nfc.riprendi()
        ble.riprendi()
    }

    // in pausa: niente lettura NFC né ricerca Bluetooth (riprendono da sé al ritorno, se la pagina le aveva chieste)
    override fun onPause() {
        nfc.pausa()
        ble.pausa()
        super.onPause()
    }

    override fun onDestroy() {
        seriale.ferma()
        nfc.ferma()
        ble.ferma()
        attesePermessi.clear() // la pagina non c'è più: nessuno aspetta la risposta
        permessoInAttesa?.deny()
        sceltaFile?.onReceiveValue(null)
        webView.destroy()
        super.onDestroy()
    }

    private fun apriFuori(uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.nessun_browser, Toast.LENGTH_SHORT).show()
        }
    }

    private inner class Client : WebViewClient() {
        // Le pagine del Polpo restano nell'app; ogni altro indirizzo si apre nel browser del telefono.
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (uri.scheme == "https" && uri.host == Risorse.HOST) return false
            if (request.isForMainFrame && (uri.scheme == "https" || uri.scheme == "http" || uri.scheme == "mailto")) apriFuori(uri)
            return true
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
            val uri = request.url
            if (uri.scheme != "https" || uri.host != Risorse.HOST) {
                // niente rete: l'app non ha nemmeno il permesso Internet, e così non ci prova
                return risposta(403, "Vietato", "text/plain", ByteArray(0))
            }
            val file = Risorse.file(uri.encodedPath ?: "/")
                ?: return risposta(400, "Richiesta non valida", "text/plain", ByteArray(0))
            return try {
                val tipo = Risorse.tipo(file)
                WebResourceResponse(tipo, if (Risorse.testo(tipo)) "utf-8" else null, 200, "OK", intestazioni(), assets.open(file))
            } catch (e: FileNotFoundException) {
                val pagina = try { assets.open("404.html").use { it.readBytes() } } catch (e: IOException) { ByteArray(0) }
                risposta(404, "Non trovato", "text/html", pagina)
            } catch (e: IOException) {
                risposta(500, "Errore", "text/plain", ByteArray(0))
            }
        }

        private fun intestazioni() = mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")

        private fun risposta(codice: Int, motivo: String, tipo: String, corpo: ByteArray) =
            WebResourceResponse(tipo, "utf-8", codice, motivo, intestazioni(), ByteArrayInputStream(corpo))
    }

    private inner class Chrome : WebChromeClient() {
        // Il microfono, solo per Polpo Onde: Android lo chiede la prima volta che premi «Ascolta».
        override fun onPermissionRequest(request: PermissionRequest) {
            val nostra = request.origin.host == Risorse.HOST
            if (!nostra || request.resources.toList() != listOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                request.deny()
                return
            }
            if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            } else {
                permessoInAttesa?.deny()
                permessoInAttesa = request
                microfono.launch(Manifest.permission.RECORD_AUDIO)
            }
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (permessoInAttesa === request) permessoInAttesa = null
        }

        // <input type="file">: il selettore di Android
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            sceltaFile?.onReceiveValue(null)
            sceltaFile = callback
            val tipi = params.acceptTypes.filter { it.contains('/') }.ifEmpty { listOf("*/*") }
            return try {
                apriFile.launch(tipi.toTypedArray())
                true
            } catch (e: ActivityNotFoundException) {
                sceltaFile = null
                false
            }
        }
    }

    /** Quello che la pagina può chiedere all'app. I metodi arrivano da un thread della WebView. */
    private inner class Ponte {
        @JavascriptInterface
        fun versione(): String = BuildConfig.VERSION_NAME

        /** Salva un file creato dalla pagina (per esempio una registrazione di Onde), dati in base64. */
        @JavascriptInterface
        fun salvaFile(nome: String, base64: String) {
            val dati = try { Base64.decode(base64, Base64.DEFAULT) } catch (e: IllegalArgumentException) { return }
            val sicuro = Risorse.nomeFile(nome)
            runOnUiThread { chiediDove(sicuro, Risorse.tipo(sicuro), dati, null) }
        }

        /** Cosa ha il telefono (JSON): nfc e bluetooth «assente», «spento» o «pronto»; ir e usbHost sì o no. */
        @JavascriptInterface
        fun telefono(): String = JSONObject()
            .put("nfc", nfc.stato())
            .put("bluetooth", ble.stato())
            .put("ir", ir.presente())
            .put("usbHost", packageManager.hasSystemFeature(PackageManager.FEATURE_USB_HOST))
            .toString()

        /** Un file del sito incluso nell'app (percorso dalla radice), in base64; "" se non c'è. */
        @JavascriptInterface
        fun risorsaBase64(percorso: String?): String {
            val file = Risorse.file(percorso.orEmpty().trimStart('/')) ?: return ""
            return try {
                assets.open(file).use { ingresso ->
                    val dati = ingresso.readBytes()
                    if (dati.size > RISORSA_MAX) "" else Base64.encodeToString(dati, Base64.NO_WRAP)
                }
            } catch (e: IOException) {
                ""
            }
        }

        /** Tutti i dispositivi USB collegati (JSON): id, nome, produttore, vid, pid, classi, seriale, polpo, permesso. */
        @JavascriptInterface
        fun usbElenco(): String = seriale.elenco(soloSeriali = false)

        /** Le porte seriali USB collegate: come [usbElenco], solo quelle con un driver. */
        @JavascriptInterface
        fun serialeElenco(): String = seriale.elenco(soloSeriali = true)

        /** Apre la porta con le regole del Polpo (115200 baud, DTR attivo, RTS basso); l'esito arriva come evento. */
        @JavascriptInterface
        fun serialeApri(id: String?) = serialeApri(id, null)

        /** Apre la porta con le [opzioni] JSON `{baud, dtr, rts}` (1200 baud rifiutato); l'esito arriva come evento. */
        @JavascriptInterface
        fun serialeApri(id: String?, opzioni: String?) {
            runOnUiThread { seriale.apri(id.orEmpty(), opzioni) }
        }

        /** Scrive byte (base64) sulla porta aperta. */
        @JavascriptInterface
        fun serialeScrivi(base64: String?): Boolean = base64 != null && seriale.scrivi(base64)

        @JavascriptInterface
        fun serialeLinee(dtr: Boolean, rts: Boolean): Boolean = seriale.linee(dtr, rts)

        @JavascriptInterface
        fun serialeBaud(baud: Int): Boolean = seriale.baud(baud)

        /** Il tocco a 1200 baud che porta l'ESP32-S3 nel bootloader, solo per l'aggiornamento del firmware. */
        @JavascriptInterface
        fun serialeToccoBootloader(id: String?) {
            runOnUiThread { seriale.toccoBootloader(id.orEmpty()) }
        }

        @JavascriptInterface
        fun serialeChiudi() {
            seriale.chiudi("porta chiusa")
        }

        /** Legge i tag NFC appoggiati al telefono finché la pagina non chiama [nfcFerma]; eventi «nfc.tag». */
        @JavascriptInterface
        fun nfcAvvia(): Boolean = nfc.leggi()

        @JavascriptInterface
        fun nfcFerma() = nfc.smetti()

        /** Scrive `{kind, value, lang}` (link o testo NDEF) sul prossimo tag entro 20 s; false se rifiutato subito. */
        @JavascriptInterface
        fun nfcScrivi(json: String?): Boolean = nfc.scrivi(json)

        /** Cerca i dispositivi Bluetooth LE vicini per [ms] millisecondi (al massimo 10 s); evento «ble.risultato». */
        @JavascriptInterface
        fun bleScansiona(ms: Int) = ble.scansiona(ms)

        @JavascriptInterface
        fun bleCollega(addr: String?) = ble.collega(addr)

        @JavascriptInterface
        fun bleLeggi(servizio: String?, caratteristica: String?) = ble.leggi(servizio, caratteristica)

        @JavascriptInterface
        fun bleNotifiche(servizio: String?, caratteristica: String?, attive: Boolean) = ble.notifiche(servizio, caratteristica, attive)

        @JavascriptInterface
        fun bleScollega() = ble.scollega()

        /** Trasmette con l'emettitore infrarosso: [tempi] = JSON di durate in µs, impulso per primo. */
        @JavascriptInterface
        fun irTrasmetti(frequenza: Int, tempi: String?): Boolean = ir.trasmetti(frequenza, tempi)

        /** Salva una copia di un file del sito incluso nell'app (per esempio sd-polpo.zip). */
        @JavascriptInterface
        fun salvaRisorsa(percorso: String, nome: String) {
            val file = Risorse.file(percorso.trimStart('/')) ?: return
            val sicuro = Risorse.nomeFile(nome.ifEmpty { file })
            runOnUiThread { chiediDove(sicuro, Risorse.tipo(file), null, file) }
        }
    }

    companion object {
        // una risorsa più grande non passa bene per il ponte (in base64 diventa un terzo più lunga)
        private const val RISORSA_MAX = 16 * 1024 * 1024
    }

    private fun chiediDove(nome: String, tipo: String, dati: ByteArray?, risorsa: String?) {
        if (risorsa != null) {
            try { assets.open(risorsa).close() } catch (e: IOException) { return }
        }
        daSalvare = dati
        leggiRisorsa = risorsa
        try {
            salva.launch(nome to tipo)
        } catch (e: ActivityNotFoundException) {
            daSalvare = null
            leggiRisorsa = null
            Toast.makeText(this, R.string.non_salvato, Toast.LENGTH_SHORT).show()
        }
    }
}
