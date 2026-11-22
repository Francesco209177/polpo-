package io.github.francesco209177.polpo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RisorseTest {
    @Test
    fun cartelleDiventanoIndex() {
        assertEquals("index.html", Risorse.file("/"))
        assertEquals("index.html", Risorse.file(""))
        assertEquals("simulatore/index.html", Risorse.file("/simulatore/"))
        assertEquals("documentazione/manuale-polpo.html", Risorse.file("/documentazione/manuale-polpo.html"))
        assertEquals("simulatore/polpo-sim.wasm", Risorse.file("/simulatore/polpo-sim.wasm"))
    }

    @Test
    fun percorsiCodificati() {
        assertEquals("a b/c.html", Risorse.file("/a%20b/c.html"))
        assertEquals("a+b.txt", Risorse.file("/a+b.txt")) // nel percorso «+» resta «+»
        assertEquals("doppio/barra.html", Risorse.file("//doppio//barra.html"))
    }

    @Test
    fun niente_uscite_dalla_cartella() {
        assertNull(Risorse.file("/../segreto"))
        assertNull(Risorse.file("/a/%2E%2E/b"))
        assertNull(Risorse.file("/a/./b"))
        assertNull(Risorse.file("/a%5Cb"))
        assertNull(Risorse.file("/a%00b"))
        assertNull(Risorse.file("/%zz"))
    }

    @Test
    fun tipi() {
        assertEquals("text/html", Risorse.tipo("index.html"))
        assertEquals("text/javascript", Risorse.tipo("assets/js/onde/ui.js"))
        assertEquals("application/wasm", Risorse.tipo("simulatore/polpo-sim.wasm"))
        assertEquals("image/svg+xml", Risorse.tipo("assets/img/polpo.svg"))
        assertEquals("application/zip", Risorse.tipo("installa/sd-polpo.zip"))
        assertEquals("application/octet-stream", Risorse.tipo("senza-estensione"))
        assertTrue(Risorse.testo("text/css"))
        assertTrue(Risorse.testo("image/svg+xml"))
        assertTrue(!Risorse.testo("application/wasm"))
    }

    @Test
    fun nomiDeiFile() {
        assertEquals("polpo-onde-registrazione.wav", Risorse.nomeFile("polpo-onde-registrazione.wav"))
        assertEquals("sd-polpo.zip", Risorse.nomeFile("installa/sd-polpo.zip"))
        assertEquals("passwd", Risorse.nomeFile("../../etc/passwd"))
        assertEquals("polpo", Risorse.nomeFile("..."))
        assertEquals("a_b.txt", Risorse.nomeFile("a:b.txt"))
        assertEquals(80, Risorse.nomeFile("x".repeat(200)).length)
    }
}
