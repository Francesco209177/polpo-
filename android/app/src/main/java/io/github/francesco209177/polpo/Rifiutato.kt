package io.github.francesco209177.polpo

/** Una richiesta della pagina fuori dalle regole del ponte (android/PONTE.md); il messaggio è per chi usa l'app. */
class Rifiutato(messaggio: String) : Exception(messaggio)
