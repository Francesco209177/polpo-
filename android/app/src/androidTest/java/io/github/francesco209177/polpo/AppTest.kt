package io.github.francesco209177.polpo

import android.util.Base64
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Sull'emulatore (in CI): l'app si apre, mostra il sito, accende il Polpo simulato con il firmware vero,
 * esegue uno script e non chiede nulla a Internet; il ponte con il telefono risponde anche senza NFC né infrarossi.
 */
@RunWith(AndroidJUnit4::class)
class AppTest {

    private fun js(scenario: ActivityScenario<MainActivity>, codice: String): String {
        val risultato = AtomicReference<String>()
        val fatto = CountDownLatch(1)
        scenario.onActivity { a ->
            a.webView.evaluateJavascript(codice) { risultato.set(it); fatto.countDown() }
        }
        assertTrue("JavaScript senza risposta: $codice", fatto.await(10, TimeUnit.SECONDS))
        return risultato.get()
    }

    private fun aspetta(scenario: ActivityScenario<MainActivity>, condizione: String, secondi: Int = 60) {
        val fine = System.currentTimeMillis() + secondi * 1000L
        while (System.currentTimeMillis() < fine) {
            if (js(scenario, "(function(){try{return !!($condizione)}catch(e){return false}})()") == "true") return
            Thread.sleep(250)
        }
        fail("non succede entro $secondi s: $condizione — pagina: " + js(scenario, "location.href + ' ' + document.title"))
    }

    // il risultato di evaluateJavascript per una stringa è la stringa in JSON
    private fun stringa(json: String): String = JSONArray("[$json]").getString(0)

    private fun vai(scenario: ActivityScenario<MainActivity>, percorso: String) {
        scenario.onActivity { it.webView.loadUrl(Risorse.INIZIO + percorso) }
    }

    @Test
    fun siApreConLaPaginaIniziale() {
        ActivityScenario.launch(MainActivity::class.java).use { s ->
            aspetta(s, "document.readyState === 'complete' && document.querySelector('.brand')")
            assertTrue(js(s, "document.title").contains("Polpo"))
            assertEquals("\"${BuildConfig.VERSION_NAME}\"", js(s, "PolpoNativo.versione()"))
            // nell'app non c'è l'installazione via Web Serial: la pagina «Installa» è quella per il telefono
            vai(s, "installa/")
            aspetta(s, "document.readyState === 'complete' && document.querySelector('[data-app-installa]')")
            assertEquals("null", js(s, "document.querySelector('esp-web-install-button')"))
        }
    }

    @Test
    fun ilSimulatoreAccendeIlFirmwareVeroEdEsegueUnoScript() {
        ActivityScenario.launch(MainActivity::class.java).use { s ->
            vai(s, "simulatore/")
            aspetta(s, "window.__sim && window.__sim.pronto", 90)
            assertTrue(js(s, "document.getElementById('sim-stato').textContent").contains("Polpo acceso"))
            js(s, "document.getElementById('script-testo').value = 'scrivi(\"ciao dal telefono\")'; document.getElementById('script-esegui').click(); 1")
            aspetta(s, "document.getElementById('script-uscita').value.indexOf('ciao dal telefono') >= 0", 30)
        }
    }

    @Test
    fun studioSiCollegaAlPolpoVirtualeConLaConfermaSulSuoSchermo() {
        ActivityScenario.launch(MainActivity::class.java).use { s ->
            vai(s, "studio/")
            aspetta(s, "document.readyState === 'complete' && window.__studio")
            // sull'emulatore non c'è nessun dispositivo USB
            assertEquals("\"[]\"", js(s, "PolpoNativo.serialeElenco()"))
            js(s, "document.getElementById('st-collega').click(); document.getElementById('st-virtuale').click(); 1")
            aspetta(s, "document.getElementById('st-stato').dataset.stato === 'attesa_conferma'", 90)
            Thread.sleep(500)
            js(s, "document.querySelector('[data-tasto=destra]').click(); 1")
            Thread.sleep(400)
            js(s, "document.querySelector('[data-tasto=ok]').click(); 1")
            aspetta(s, "document.getElementById('st-stato').dataset.stato === 'collegato'", 20)
            assertTrue(js(s, "document.getElementById('st-stato').textContent").contains("SIMULATO"))
        }
    }

    @Test
    fun ilPonteRispondeAncheSenzaNfcNeInfrarossi() {
        ActivityScenario.launch(MainActivity::class.java).use { s ->
            aspetta(s, "document.readyState === 'complete'")
            val t = JSONObject(stringa(js(s, "PolpoNativo.telefono()")))
            val stati = setOf("assente", "spento", "pronto")
            assertTrue(t.toString(), t.getString("nfc") in stati && t.getString("bluetooth") in stati)
            val ir = t.getBoolean("ir")
            t.getBoolean("usbHost")
            // sull'emulatore non c'è nessun dispositivo USB
            assertEquals("\"[]\"", js(s, "PolpoNativo.usbElenco()"))
            // fuori dai limiti la trasmissione è sempre rifiutata; senza emettitore lo è sempre
            assertEquals("false", js(s, "PolpoNativo.irTrasmetti(10000, '[9000,4500,560]')"))
            assertEquals("false", js(s, "PolpoNativo.irTrasmetti(38000, JSON.stringify(new Array(1025).fill(100)))"))
            assertEquals("false", js(s, "PolpoNativo.irTrasmetti(38000, 'non json')"))
            if (!ir) assertEquals("false", js(s, "PolpoNativo.irTrasmetti(38000, '[9000,4500,560]')"))
            // i file del sito inclusi nell'app, in base64; niente fuori dalla cartella
            val indice = String(Base64.decode(stringa(js(s, "PolpoNativo.risorsaBase64('index.html')")), Base64.DEFAULT))
            assertTrue(indice.contains("<html"))
            assertEquals("\"\"", js(s, "PolpoNativo.risorsaBase64('../segreto')"))
            assertEquals("\"\"", js(s, "PolpoNativo.risorsaBase64('non-esiste.bin')"))
            if (t.getString("nfc") != "pronto") {
                assertEquals("false", js(s, "PolpoNativo.nfcAvvia()"))
                assertEquals("false", js(s, "PolpoNativo.nfcScrivi('{\"kind\":\"text\",\"value\":\"ciao\"}')"))
            }
            // gli esiti arrivano come eventi: 1200 baud rifiutato (con le opzioni), dispositivo assente (senza)
            js(s, "window.__eventi = []; window.__polpoNativo = function (e) { window.__eventi.push(e) }; " +
                "PolpoNativo.serialeApri('1', '{\"baud\":1200}'); PolpoNativo.serialeApri('999999'); 1")
            aspetta(s, "window.__eventi.length >= 2", 10)
            val eventi = JSONArray(stringa(js(s, "JSON.stringify(window.__eventi)")))
            assertEquals("seriale.errore", eventi.getJSONObject(0).getString("tipo"))
            assertTrue(eventi.getJSONObject(0).getString("messaggio").contains("1200"))
            assertEquals("seriale.errore", eventi.getJSONObject(1).getString("tipo"))
            assertTrue(eventi.getJSONObject(1).getString("messaggio").contains("scollegato"))
            assertEquals("false", js(s, "PolpoNativo.serialeLinee(true, false)")) // nessuna porta aperta
            assertEquals("false", js(s, "PolpoNativo.serialeBaud(9600)"))
        }
    }

    @Test
    fun nienteRete() {
        ActivityScenario.launch(MainActivity::class.java).use { s ->
            aspetta(s, "document.readyState === 'complete'")
            // una richiesta verso un altro sito non parte: l'app risponde «vietato» da sé
            js(s, "window.__esito = 'attesa'; var x = new XMLHttpRequest(); x.onload = function(){ window.__esito = 'stato ' + x.status }; " +
                "x.onerror = function(){ window.__esito = 'errore' }; x.open('GET', 'https://example.com/'); x.send(); 1")
            aspetta(s, "window.__esito !== 'attesa'", 20)
            val esito = js(s, "window.__esito")
            assertTrue("esito: $esito", esito == "\"errore\"" || esito == "\"stato 403\"")
        }
    }
}
