package io.github.francesco209177.polpo

import java.net.URLDecoder

/**
 * Le pagine del Polpo stanno dentro l'app (cartella assets) e la WebView le chiede a un indirizzo https finto,
 * [ORIGINE], riservato da Android proprio a questo uso: così valgono le stesse regole del sito pubblicato
 * (moduli JavaScript, WebAssembly, microfono) senza alcun accesso a Internet.
 *
 * Qui solo la parte pura, provata senza Android: da un percorso dell'indirizzo al file dentro l'APK.
 */
object Risorse {
    const val HOST = "appassets.androidplatform.net"
    const val ORIGINE = "https://$HOST"
    const val INIZIO = "$ORIGINE/"

    /**
     * Il file dentro assets per il percorso [percorso] dell'indirizzo (già senza «?…» e «#…»), oppure null se
     * il percorso non è accettabile. Le cartelle diventano il loro «index.html», come su GitHub Pages.
     */
    fun file(percorso: String): String? {
        val decodificato = try {
            URLDecoder.decode(percorso.replace("+", "%2B"), "UTF-8")
        } catch (e: IllegalArgumentException) {
            return null
        }
        if (decodificato.contains('\u0000') || decodificato.contains('\\')) return null
        val parti = decodificato.split('/').filter { it.isNotEmpty() }
        if (parti.any { it == "." || it == ".." }) return null
        val cartella = decodificato.isEmpty() || decodificato.endsWith("/")
        return if (cartella) (parti + "index.html").joinToString("/") else parti.joinToString("/")
    }

    /** Tipo MIME dal nome del file: quelli usati dal sito, il resto come dati generici. */
    fun tipo(nome: String): String = when (nome.substringAfterLast('.', "").lowercase()) {
        "html", "htm" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json" -> "application/json"
        "webmanifest" -> "application/manifest+json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "ico" -> "image/x-icon"
        "wasm" -> "application/wasm"
        "txt", "md", "polpo" -> "text/plain"
        "xml" -> "application/xml"
        "wav" -> "audio/wav"
        "zip" -> "application/zip"
        "woff2" -> "font/woff2"
        else -> "application/octet-stream"
    }

    /** I tipi di testo vanno dichiarati in UTF-8, come li scrive il sito. */
    fun testo(tipo: String): Boolean =
        tipo.startsWith("text/") || tipo == "application/json" || tipo == "application/xml" ||
            tipo == "image/svg+xml" || tipo == "application/manifest+json"

    /** Un nome di file sicuro da proporre nel selettore di Android. */
    fun nomeFile(nome: String): String {
        val pulito = nome.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._ -]"), "_").trim().trimStart('.')
        return pulito.take(80).ifEmpty { "polpo" }
    }
}
