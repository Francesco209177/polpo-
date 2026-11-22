package io.github.francesco209177.polpo

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
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
 * esegue uno script e non chiede nulla a Internet.
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
