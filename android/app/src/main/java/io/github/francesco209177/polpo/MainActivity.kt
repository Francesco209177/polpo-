package io.github.francesco209177.polpo

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
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
 * Cosa può fare la pagina oltre a una pagina web qualsiasi (oggetto «PolpoNativo» in JavaScript): salvare un file
 * dove scegli tu, con il selettore di Android, e parlare con il Polpo collegato con un cavo USB (solo dopo il permesso
 * di Android per quel dispositivo). Niente altro.
 */
class MainActivity : ComponentActivity() {

    internal lateinit var webView: WebView
        private set

    private lateinit var seriale: Seriale

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
        webView.addJavascriptInterface(Ponte(), "PolpoNativo")
        seriale = Seriale(this) { evento -> mandaAllaPagina(evento) }
        seriale.avvia()

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

    override fun onDestroy() {
        seriale.ferma()
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

        /** Le porte seriali USB collegate (JSON): id, nome, vid, pid, polpo, permesso. */
        @JavascriptInterface
        fun serialeElenco(): String = seriale.elenco()

        /** Apre la porta (chiedendo il permesso di Android se serve); l'esito arriva come evento. */
        @JavascriptInterface
        fun serialeApri(id: String) {
            runOnUiThread { seriale.apri(id) }
        }

        /** Scrive byte (base64) sulla porta aperta. */
        @JavascriptInterface
        fun serialeScrivi(base64: String): Boolean = seriale.scrivi(base64)

        @JavascriptInterface
        fun serialeChiudi() {
            seriale.chiudi("porta chiusa")
        }

        /** Salva una copia di un file del sito incluso nell'app (per esempio sd-polpo.zip). */
        @JavascriptInterface
        fun salvaRisorsa(percorso: String, nome: String) {
            val file = Risorse.file(percorso.trimStart('/')) ?: return
            val sicuro = Risorse.nomeFile(nome.ifEmpty { file })
            runOnUiThread { chiediDove(sicuro, Risorse.tipo(file), null, file) }
        }
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
