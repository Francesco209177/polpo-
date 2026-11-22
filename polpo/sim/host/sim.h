/* Polpo — simulatore: le poche funzioni con cui chi lo ospita (pagina web, prove, Polpo Studio) lo comanda.
 * Tutto il resto è il firmware vero. Interfaccia in C, così è la stessa da JavaScript, Python e C++. */
#ifndef POLPO_SIM_H
#define POLPO_SIM_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SIM_LARGHEZZA 240
#define SIM_ALTEZZA 135

/* Avvia il firmware (la sua setup()). Lo stato salvato, se c'è, va caricato prima con sim_stato_importa. */
void sim_avvia(void);
/* Fa passare `ms` millisecondi: il firmware esegue il suo ciclo finché l'orologio virtuale non li ha consumati.
 * Se il firmware si è bloccato in un'attesa lunga, l'orologio è già avanti e la chiamata non fa nulla: come sul
 * dispositivo vero, per quel tempo non risponde. */
void sim_avanza(uint32_t ms);
/* Millisecondi dell'orologio virtuale. */
uint32_t sim_ora(void);
/* Per quanti millisecondi ancora il firmware è occupato in un'operazione bloccante (0 = sta rispondendo). */
uint32_t sim_occupato(void);

/* Tastiera del Cardputer: fila 0-3, colonna 0-13. */
void sim_tasto(int fila, int colonna, int premuto);
/* Tasto laterale G0. */
void sim_g0(void);

/* Lo schermo: 240x135 punti a 16 bit (RGB565, byte più significativo per primo). */
const uint8_t* sim_schermo(void);
/* Un numero che cambia quando cambia ciò che c'è sullo schermo. */
uint32_t sim_impronta_schermo(void);

/* Comandi al mondo simulato (JSON) e relativa risposta (JSON). La risposta vale fino alla chiamata successiva. */
const char* sim_mondo(const char* json);
/* Prossimo evento in attesa (JSON) oppure NULL. Vale fino alla chiamata successiva. */
const char* sim_evento(void);

/* Porta seriale USB del Polpo (protocollo Polpo Link). */
void sim_seriale_scrivi(const uint8_t* dati, size_t n);
size_t sim_seriale_leggi(uint8_t* dati, size_t max);

/* Stato permanente (microSD e impostazioni) da salvare fuori dal simulatore. */
const uint8_t* sim_stato_esporta(size_t* n);
int sim_stato_importa(const uint8_t* dati, size_t n);

/* Memoria per passare dati dall'ospite (serve in WebAssembly). */
void* sim_alloca(size_t n);
void sim_libera(void* p);

#ifdef __cplusplus
}
#endif
#endif
