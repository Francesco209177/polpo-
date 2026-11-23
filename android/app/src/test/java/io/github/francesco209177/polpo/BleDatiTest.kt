package io.github.francesco209177.polpo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class BleDatiTest {
    private fun byte(vararg b: Int) = ByteArray(b.size) { b[it].toByte() }

    @Test
    fun produttoreDallAnnuncio() {
        // flag, poi dati del produttore Apple (0x004C, little-endian), poi zeri di riempimento come in Android
        assertEquals(0x004C, BleDati.produttore(byte(0x02, 0x01, 0x06, 0x05, 0xFF, 0x4C, 0x00, 0x10, 0x05, 0x00, 0x00)))
        // il primo dato del produttore, anche se ce n'è un altro dopo
        assertEquals(0x0157, BleDati.produttore(byte(0x04, 0xFF, 0x57, 0x01, 0xAA, 0x03, 0xFF, 0x4C, 0x00)))
        // nome e servizi ma nessun produttore
        assertEquals(-1, BleDati.produttore(byte(0x05, 0x09, 0x50, 0x6F, 0x6C, 0x70, 0x03, 0x03, 0x0F, 0x18)))
        assertEquals(-1, BleDati.produttore(null))
        assertEquals(-1, BleDati.produttore(ByteArray(0)))
        assertEquals(-1, BleDati.produttore(byte(0x02, 0xFF, 0x4C))) // troppo corto per l'identificativo
        assertEquals(-1, BleDati.produttore(byte(0x09, 0xFF, 0x4C, 0x00))) // lunghezza oltre la fine
        assertEquals(-1, BleDati.produttore(byte(0x00, 0x05, 0xFF, 0x4C, 0x00, 0x01, 0x02))) // dopo uno zero non si legge più
    }

    @Test
    fun risultatoComeBleScan() {
        val trovati = (1..50).map { BleDati.Trovato("d$it", "AA:BB:CC:DD:EE:" + it.toString().padStart(2, '0'), -100 + it, -1, it % 2 == 0) }
        val r = BleDati.risultato(trovati)
        assertEquals("ble.risultato", r.getString("tipo"))
        val d = r.getJSONArray("devices")
        assertEquals(40, d.length())
        assertEquals("d50", d.getJSONObject(0).getString("name")) // il più vicino per primo
        assertEquals(-50, d.getJSONObject(0).getInt("rssi"))
        assertEquals(-1, d.getJSONObject(0).getInt("mfr_id"))
        assertTrue(d.getJSONObject(0).getBoolean("connectable"))
        assertEquals(setOf("name", "addr", "rssi", "mfr_id", "connectable"), d.getJSONObject(0).keys().asSequence().toSet())
    }

    @Test
    fun annunciDelloStessoDispositivo() {
        val primo = BleDati.Trovato("Cuffie", "6A:14:9F:20:3B:11", -60, 0x004C, true)
        val risposta = BleDati.Trovato("", "6A:14:9F:20:3B:11", -55, -1, false)
        val u = primo.unisci(risposta)
        assertEquals("Cuffie", u.name) // un annuncio senza nome non lo cancella
        assertEquals(-55, u.rssi)
        assertEquals(0x004C, u.mfrId)
        assertTrue(u.connectable)
        assertEquals("Nuovo", u.unisci(BleDati.Trovato("Nuovo", u.addr, -50, 0x0075, false)).name)
    }

    @Test
    fun proprietaEServizi() {
        assertEquals(listOf("read", "notify"), BleDati.proprieta(0x12))
        assertEquals(listOf("read", "write_no_response", "write", "indicate"), BleDati.proprieta(0x2E))
        assertEquals(emptyList<String>(), BleDati.proprieta(0))
        val batteria = BleDati.uuid("180F")
        val s = BleDati.servizio(batteria, listOf(BleDati.uuid("2a19") to 0x12))
        assertEquals("0000180f-0000-1000-8000-00805f9b34fb", s.getString("uuid"))
        val c = s.getJSONArray("caratteristiche").getJSONObject(0)
        assertEquals("00002a19-0000-1000-8000-00805f9b34fb", c.getString("uuid"))
        assertEquals("read", c.getJSONArray("proprieta").getString(0))
        assertEquals("notify", c.getJSONArray("proprieta").getString(1))
    }

    @Test
    fun uuidCortiELunghi() {
        val atteso = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")
        assertEquals(atteso, BleDati.uuid("2a19"))
        assertEquals(atteso, BleDati.uuid("0x2A19"))
        assertEquals(atteso, BleDati.uuid(" 00002A19 "))
        assertEquals(atteso, BleDati.uuid("00002A19-0000-1000-8000-00805F9B34FB"))
        assertEquals(UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e"), BleDati.uuid("6E400001-B5A3-F393-E0A9-E50E24DCCA9E"))
        for (cattivo in listOf(null, "", "2a1", "zzzz", "2a19-0000", "1-2-3-4-5", "00002a19-0000-1000-8000-00805f9b34fbx")) {
            assertThrows("uuid: $cattivo", Rifiutato::class.java) { BleDati.uuid(cattivo) }
        }
    }

    @Test
    fun durateMotiviEErrori() {
        assertEquals(10_000L, BleDati.durata(60_000))
        assertEquals(500L, BleDati.durata(0))
        assertEquals(3000L, BleDati.durata(3000))
        assertEquals("dispositivo", BleDati.motivo(19))
        assertEquals("fuori portata", BleDati.motivo(8))
        assertEquals("richiesta", BleDati.motivo(0))
        assertEquals("errore 133", BleDati.motivo(133))
        assertTrue(BleDati.erroreOperazione("Lettura", 5).contains("abbinamento"))
        assertEquals("Lettura non riuscita (codice 133).", BleDati.erroreOperazione("Lettura", 133))
    }

    @Test
    fun cinqueRicercheOgniTrentaSecondi() {
        val l = BleDati.LimiteScansioni()
        repeat(5) { assertTrue(l.permetti(1000L + it)) }
        assertFalse(l.permetti(2000))
        assertFalse(l.permetti(30_999))
        assertTrue(l.permetti(31_000)) // la prima è uscita dalla finestra
        assertFalse(l.permetti(31_000))
    }
}
