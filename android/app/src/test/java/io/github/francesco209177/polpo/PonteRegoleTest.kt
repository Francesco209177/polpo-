package io.github.francesco209177.polpo

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** I limiti del ponte (android/PONTE.md) per la porta seriale, l'USB e gli infrarossi. */
class PonteRegoleTest {

    @Test
    fun opzioniPredefiniteDelPolpo() {
        val polpo = OpzioniSeriale(115200, dtr = true, rts = false)
        for (vuota in listOf(null, "", "  ", "undefined", "null", "{}")) assertEquals("opzioni: $vuota", polpo, OpzioniSeriale.da(vuota))
        assertEquals(OpzioniSeriale(9600, dtr = false, rts = false), OpzioniSeriale.da("""{"baud":9600,"dtr":false}"""))
        assertEquals(OpzioniSeriale(921600, dtr = true, rts = true), OpzioniSeriale.da("""{"baud":921600.0,"rts":true,"altro":1}"""))
    }

    @Test
    fun maiMilleduecentoBaud() {
        val e = assertThrows(Rifiutato::class.java) { OpzioniSeriale.da("""{"baud":1200}""") }
        assertTrue(e.message!!.contains("bootloader"))
        assertThrows(Rifiutato::class.java) { OpzioniSeriale.controllaBaud(1200) }
        for (cattiva in listOf("""{"baud":0}""", """{"baud":-9600}""", """{"baud":5000000}""", """{"baud":"9600"}""",
            """{"baud":9600.5}""", """{"dtr":"si"}""", """{"rts":1}""", "[1]", "non json")) {
            assertThrows("opzioni: $cattiva", Rifiutato::class.java) { OpzioniSeriale.da(cattiva) }
        }
        OpzioniSeriale.controllaBaud(300)
        OpzioniSeriale.controllaBaud(2_000_000)
    }

    @Test
    fun vociUsb() {
        assertEquals(listOf(2, 10, 255), UsbDati.classi(0xEF, listOf(2, 10, 255, 2)))
        assertEquals(listOf(255), UsbDati.classi(255, emptyList()))
        val ch340 = UsbDati.voce(1003, "USB Serial", "QinHeng", 0x1A86, 0x7523, listOf(255), seriale = true, permesso = false)
        assertEquals("1003", ch340.getString("id"))
        assertFalse(ch340.getBoolean("polpo"))
        assertTrue(ch340.getBoolean("seriale"))
        assertEquals(0x1A86, ch340.getInt("vid"))
        assertEquals(255, ch340.getJSONArray("classi").getInt(0))
        assertEquals(setOf("id", "nome", "produttore", "vid", "pid", "classi", "seriale", "polpo", "permesso"), ch340.keys().asSequence().toSet())
        assertTrue(UsbDati.voce(1, "Polpo", "Espressif", 0x303A, 0x1001, listOf(2, 10), seriale = true, permesso = true).getBoolean("polpo"))
    }

    @Test
    fun infrarossiEntroILimiti() {
        val nec = Infrarossi.durate("[9000, 4500, 560, 560, 560]")
        assertArrayEquals(intArrayOf(9000, 4500, 560, 560, 560), nec)
        Infrarossi.controlla(38_000, nec)
        Infrarossi.controlla(20_000, nec)
        Infrarossi.controlla(60_000, nec)
        Infrarossi.controlla(38_000, IntArray(1024) { 1000 }) // 1024 durate, 1,024 s
        Infrarossi.controlla(38_000, intArrayOf(1_000_000, 1_000_000)) // proprio 2 s
        assertEquals(2, Infrarossi.durate("[1, 2.0]").size)
    }

    @Test
    fun infrarossiOltreILimiti() {
        val nec = intArrayOf(9000, 4500, 560)
        for (f in listOf(19_999, 60_001, 0, 38)) assertThrows("frequenza $f", Rifiutato::class.java) { Infrarossi.controlla(f, nec) }
        assertThrows(Rifiutato::class.java) { Infrarossi.controlla(38_000, IntArray(1025) { 100 }) }
        assertThrows(Rifiutato::class.java) { Infrarossi.controlla(38_000, intArrayOf(1_000_000, 1_000_001)) }
        assertThrows(Rifiutato::class.java) { Infrarossi.controlla(38_000, IntArray(0)) }
        assertThrows(Rifiutato::class.java) { Infrarossi.controlla(38_000, intArrayOf(100, 0)) }
        for (cattivi in listOf(null, "", "{}", "[]", "[1, -1]", "[1, 0]", "[1.5]", "[\"100\"]", "[3000000]",
            "[" + List(1025) { "1" }.joinToString(",") + "]")) {
            assertThrows("tempi: $cattivi", Rifiutato::class.java) { Infrarossi.durate(cattivi) }
        }
    }
}
