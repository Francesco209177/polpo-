package io.github.francesco209177.polpo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class CartaTest {
    private fun byte(vararg b: Int) = ByteArray(b.size) { b[it].toByte() }

    private val uid = byte(0x04, 0x51, 0x3A, 0x7C, 0x22, 0x6B, 0x80)
    private val versioneNtag213 = byte(0x00, 0x04, 0x04, 0x02, 0x01, 0x00, 0x0F, 0x03)

    // la memoria di un NTAG213 come quella del Polpo virtuale (polpo/sim/mondo.cpp): UID, BCC, CC, TLV vuoto
    private fun memoriaNtag213(): ByteArray {
        val m = ByteArray(45 * 4)
        m[0] = uid[0]; m[1] = uid[1]; m[2] = uid[2]
        m[3] = (0x88 xor uid[0].toInt() xor uid[1].toInt() xor uid[2].toInt()).toByte()
        m[4] = uid[3]; m[5] = uid[4]; m[6] = uid[5]; m[7] = uid[6]
        m[8] = (uid[3].toInt() xor uid[4].toInt() xor uid[5].toInt() xor uid[6].toInt()).toByte()
        m[9] = 0x48
        byte(0xE1, 0x10, 0x12, 0x00).copyInto(m, 12)
        byte(0x03, 0x00, 0xFE).copyInto(m, 16)
        return m
    }

    @Test
    fun modelliDaGetVersion() {
        assertEquals("NTAG213", Carta.modello(versioneNtag213).nome)
        assertEquals(39, Carta.modello(versioneNtag213).ultimaUtente)
        assertEquals("NTAG215", Carta.modello(byte(0x00, 0x04, 0x04, 0x02, 0x01, 0x00, 0x11, 0x03)).nome)
        assertEquals("NTAG216", Carta.modello(byte(0x00, 0x04, 0x04, 0x02, 0x01, 0x00, 0x13, 0x03)).nome)
        assertEquals("MIFARE Ultralight EV1 (MF0UL21)", Carta.modello(byte(0x00, 0x04, 0x03, 0x01, 0x01, 0x00, 0x0E, 0x03)).nome)
        assertSame(Carta.ULTRALIGHT, Carta.modello(null)) // l'Ultralight originale non risponde a GET_VERSION
        assertSame(Carta.SCONOSCIUTO, Carta.modello(byte(0x00, 0x05, 0x04, 0x02, 0x01, 0x00, 0x0F, 0x03))) // non NXP
        assertSame(Carta.SCONOSCIUTO, Carta.modello(byte(0x00, 0x04, 0x04, 0x02, 0x01, 0x00, 0x99, 0x03)))
        assertSame(Carta.SCONOSCIUTO, Carta.modello(byte(0x00, 0x04)))
    }

    @Test
    fun famiglieEAtqa() {
        assertEquals("NFC Type 2 (NTAG / MIFARE Ultralight)", Carta.famiglia(0x00, 0x0044))
        assertEquals("MIFARE Classic 1K (o compatibile)", Carta.famiglia(0x08, 0x0004))
        assertEquals("MIFARE DESFire", Carta.famiglia(0x20, 0x0344))
        assertTrue(Carta.famiglia(0x20, 0x0004).startsWith("Smart card ISO 14443-4"))
        assertEquals("Carta ISO 14443-A non riconosciuta", Carta.famiglia(0x7F, 0))
        // NfcA.getAtqa() dà i byte nell'ordine di arrivo: il primo è il meno significativo, come nel firmware
        assertEquals(0x0044, Carta.atqa(byte(0x44, 0x00)))
        assertEquals(0x0344, Carta.atqa(byte(0x44, 0x03)))
        assertEquals(0, Carta.atqa(ByteArray(0)))
        assertEquals("FeliCa (NFC-F)", Carta.famigliaAltra(listOf("NfcF", "Ndef")))
        assertEquals("Tag ISO 15693 (NFC-V)", Carta.famigliaAltra(listOf("NfcV")))
        assertEquals("04513A7C226B80", Carta.hex(uid))
        assertEquals("00FF", Carta.hex(byte(0x00, 0xFF)))
    }

    @Test
    fun letturaATreBlocchiDiQuattroPagine() {
        val memoria = memoriaNtag213()
        val chieste = mutableListOf<Int>()
        val pagine = Carta.leggiPagine(40) { p -> chieste += p; memoria.copyOfRange(p * 4, p * 4 + 16) }!!
        assertEquals((0 until 40 step 4).toList(), chieste)
        assertEquals(160, pagine.size)
        assertTrue(memoria.copyOf(160).contentEquals(pagine))
        // 130 pagine (NTAG215): l'ultima lettura ne dà 4, se ne tengono 2
        assertEquals(520, Carta.leggiPagine(130) { ByteArray(16) }!!.size)
        assertNull(Carta.leggiPagine(40) { p -> if (p == 8) null else ByteArray(16) })
        assertNull(Carta.leggiPagine(40) { ByteArray(1) }) // un NAK di 4 bit arriva come un byte
    }

    @Test
    fun cartaNtag213ComeNfcRead() {
        val c = Carta.carta(uid, listOf("NfcA", "MifareUltralight", "Ndef"), byte(0x44, 0x00), 0, versioneNtag213, memoriaNtag213())
        assertTrue(c.getBoolean("present"))
        assertEquals("04513A7C226B80", c.getString("uid"))
        assertEquals(0x44, c.getInt("atqa"))
        assertEquals(0, c.getInt("sak"))
        assertEquals("NFC Type 2 (NTAG / MIFARE Ultralight)", c.getString("family"))
        assertEquals("NTAG213", c.getString("model"))
        assertEquals("0004040201000F03", c.getString("version"))
        val pagine = c.getString("pages")
        assertEquals(160 * 2, pagine.length) // pagine 0-39, senza spazi
        assertTrue(pagine, pagine.startsWith("04513AE77C226B80B5480000")) // UID con i byte di controllo, blocchi a zero
        assertEquals("E1101200", pagine.substring(24, 32))
        assertEquals("0300FE", pagine.substring(32, 38))
        assertEquals(pagine.uppercase(), pagine)
        assertFalse(c.has("read_error"))
        assertEquals(listOf("NfcA", "MifareUltralight", "Ndef"), (0 until c.getJSONArray("tecnologie").length()).map { c.getJSONArray("tecnologie").getString(it) })
    }

    @Test
    fun ultralightProtettiEAltreCarte() {
        // senza GET_VERSION: MIFARE Ultralight, 16 pagine
        val u = Carta.carta(uid, listOf("NfcA"), byte(0x44, 0x00), 0, null, ByteArray(64))
        assertEquals("MIFARE Ultralight", u.getString("model"))
        assertFalse(u.has("version"))
        assertEquals(128, u.getString("pages").length)
        // memoria protetta: come il Polpo, niente pagine e un errore
        val p = Carta.carta(uid, listOf("NfcA"), byte(0x44, 0x00), 0, versioneNtag213, null)
        assertEquals(Carta.ERRORE_LETTURA, p.getString("read_error"))
        assertFalse(p.has("pages"))
        assertEquals("NTAG213", p.getString("model"))
        // lettura troppo corta per il modello: anche questo è un errore
        assertTrue(Carta.carta(uid, listOf("NfcA"), byte(0x44, 0x00), 0, versioneNtag213, ByteArray(64)).has("read_error"))
        // MIFARE Classic: solo UID e famiglia, nessuna lettura
        val classic = Carta.carta(byte(0xDE, 0xAD, 0xBE, 0xEF), listOf("NfcA", "MifareClassic"), byte(0x04, 0x00), 0x08, null, null)
        assertEquals("DEADBEEF", classic.getString("uid"))
        assertEquals(0x0004, classic.getInt("atqa"))
        assertEquals(8, classic.getInt("sak"))
        assertEquals("MIFARE Classic 1K (o compatibile)", classic.getString("family"))
        assertFalse(classic.has("model") || classic.has("pages") || classic.has("read_error"))
        // non ISO 14443-A: atqa e sak a -1
        val v = Carta.carta(byte(0xE0, 0x04, 0x01), listOf("NfcV"), null, 0, null, null)
        assertEquals(-1, v.getInt("atqa"))
        assertEquals(-1, v.getInt("sak"))
        assertEquals("Tag ISO 15693 (NFC-V)", v.getString("family"))
        assertFalse(v.has("model"))
    }

    @Test
    fun quandoNonSiScrive() {
        val ntag213 = Carta.modello(versioneNtag213)
        val testa = memoriaNtag213().copyOf(16)
        val libero = ByteArray(4)
        assertNull(Carta.problemaScrittura(ntag213, testa, libero))
        assertNull(Carta.problemaScrittura(Carta.ULTRALIGHT, testa, null)) // nessun blocco dinamico da controllare
        assertEquals("modello di tag non riconosciuto", Carta.problemaScrittura(Carta.SCONOSCIUTO, testa, libero))
        assertEquals("impossibile verificare i blocchi del tag", Carta.problemaScrittura(ntag213, testa, null))
        assertEquals("tag con blocchi dinamici attivi", Carta.problemaScrittura(ntag213, testa, byte(0x00, 0x01, 0x00, 0xBD)))
        assertNull(Carta.problemaScrittura(ntag213, testa, byte(0x00, 0x00, 0x00, 0xBD))) // il quarto byte è riservato
        assertEquals("tag non formattato NDEF", Carta.problemaScrittura(ntag213, testa.copyOf().also { it[12] = 0 }, libero))
        assertEquals("tag in sola lettura", Carta.problemaScrittura(ntag213, testa.copyOf().also { it[15] = 0x0F }, libero))
        assertEquals("tag con pagine bloccate", Carta.problemaScrittura(ntag213, testa.copyOf().also { it[10] = 0x08 }, libero))
        assertEquals("tag non leggibile", Carta.problemaScrittura(ntag213, ByteArray(4), libero))
    }
}
