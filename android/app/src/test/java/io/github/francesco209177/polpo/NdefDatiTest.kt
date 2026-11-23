package io.github.francesco209177.polpo

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NdefDatiTest {
    private fun byte(vararg b: Int) = ByteArray(b.size) { b[it].toByte() }

    private fun esa(testo: String) = testo.split(' ').filter { it.isNotEmpty() }.map { it.toInt(16).toByte() }.toByteArray()

    @Test
    fun prefissoPiuLungo() {
        assertEquals(4, NdefDati.prefisso("https://example.org"))
        assertEquals(2, NdefDati.prefisso("https://www.example.org"))
        assertEquals(1, NdefDati.prefisso("http://www.example.org"))
        assertEquals(5, NdefDati.prefisso("tel:+390000000"))
        assertEquals(6, NdefDati.prefisso("mailto:polpo@example.org"))
        assertEquals(30, NdefDati.prefisso("urn:epc:id:sgtin:1"))
        assertEquals(34, NdefDati.prefisso("urn:epc:altro"))
        assertEquals(19, NdefDati.prefisso("urn:isbn:1"))
        assertEquals(0, NdefDati.prefisso("geo:45.0,9.0"))
        assertEquals(0, NdefDati.prefisso("HTTPS://example.org")) // la tabella distingue le maiuscole, come il Polpo
        assertEquals(36, NdefDati.PREFISSI.size)
    }

    @Test
    fun linkComeIlPolpo() {
        // D1 = MB|ME|SR|TNF 1, tipo «U», codice 04 = «https://»
        assertArrayEquals(esa("D1 01 0C 55 04 65 78 61 6D 70 6C 65 2E 6F 72 67"), NdefDati.messaggioUri("https://example.org"))
        assertArrayEquals(esa("D1 01 05 55 00 61 3A 2F 2F"), NdefDati.messaggioUri("a://"))
        assertArrayEquals(
            esa("03 10 D1 01 0C 55 04 65 78 61 6D 70 6C 65 2E 6F 72 67 FE"),
            NdefDati.avvolgiTlv(NdefDati.messaggioUri("https://example.org")),
        )
    }

    @Test
    fun testoConLingua() {
        assertArrayEquals(esa("D1 01 07 54 02 69 74 63 69 61 6F"), NdefDati.messaggioTesto("ciao", "it"))
        assertArrayEquals(esa("D1 01 08 54 05 65 6E 2D 55 53 68 69"), NdefDati.messaggioTesto("hi", "en-US"))
        // UTF-8: «è» occupa due byte
        assertArrayEquals(esa("D1 01 06 54 02 69 74 C3 A8 21"), NdefDati.messaggioTesto("è!"))
    }

    @Test
    fun recordLunghiETlvLunghi() {
        val m = NdefDati.messaggioTesto("x".repeat(300), "it")
        assertEquals(0xC1.toByte(), m[0]) // senza SR: lunghezza su 4 byte
        assertArrayEquals(byte(0x01, 0x00, 0x00, 0x01, 0x2F, 0x54), m.copyOfRange(1, 7)) // 303 byte di contenuto
        assertEquals(1 + 1 + 4 + 1 + 303, m.size)
        val tlv = NdefDati.avvolgiTlv(m)
        assertArrayEquals(byte(0x03, 0xFF, 0x01, 0x36), tlv.copyOfRange(0, 4))
        assertEquals(0xFE.toByte(), tlv.last())
        assertEquals(m.size + 5, tlv.size)
        // fino a 254 byte la lunghezza del TLV sta in un byte
        assertEquals(254 + 3, NdefDati.avvolgiTlv(ByteArray(254)).size)
        assertEquals(255 + 5, NdefDati.avvolgiTlv(ByteArray(255)).size)
    }

    @Test
    fun richiesteDellaPagina() {
        assertArrayEquals(NdefDati.messaggioUri("https://example.org"), NdefDati.richiesta("""{"kind":"uri","value":"https://example.org"}"""))
        assertArrayEquals(NdefDati.messaggioTesto("ciao", "it"), NdefDati.richiesta("""{"kind":"text","value":"ciao"}"""))
        assertArrayEquals(NdefDati.messaggioTesto("hello", "en"), NdefDati.richiesta("""{"kind":"text","value":" hello ","lang":"en"}"""))
        assertArrayEquals(NdefDati.messaggioTesto("ciao", "it"), NdefDati.richiesta("""{"kind":"text","value":"ciao","lang":""}"""))
        val lungo = "è".repeat(200) // 400 byte: va bene
        NdefDati.richiesta("""{"kind":"text","value":"$lungo"}""")
        for (cattiva in listOf(
            null, "", "non json", "[]", """{"kind":"uri"}""", """{"kind":"uri","value":"   "}""",
            """{"kind":"text","value":"${lungo}x"}""", """{"kind":"mime","value":"x"}""",
            """{"kind":"text","value":"x","lang":"it it"}""", """{"kind":"text","value":"x","lang":"${"a".repeat(64)}"}""",
        )) {
            assertThrows("richiesta: $cattiva", Rifiutato::class.java) { NdefDati.richiesta(cattiva) }
        }
    }
}
