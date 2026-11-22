// Polpo — simulatore: il nucleo. Tempo virtuale, eventi programmati, piedini, messaggi verso chi ospita.
//
// Il firmware vero (polpo/src) viene compilato senza modifiche: al posto delle intestazioni di Arduino e M5Stack
// trova quelle di sim/platform, che poggiano su queste funzioni. Niente qui dentro parla con hardware vero.
#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace sim {

// ---- tempo virtuale: avanza solo quando il firmware "aspetta" (delay) o quando l'ospite lo fa avanzare ----
uint64_t ora_us();
void avanza_us(uint64_t us);                      // fa passare il tempo eseguendo gli eventi che scadono
void tra(uint64_t us, std::function<void()> fn);  // programma un evento tra `us` microsecondi

// ---- messaggi verso l'ospite (pagina web o prove): una riga JSON ciascuno ----
void evento(const std::string& json);
bool prossimo_evento(std::string& out);
std::string json_testo(const std::string& s);  // testo tra virgolette, con i caratteri speciali protetti

// ---- piedini ----
void pin_imposta(int pin, bool livello);  // dal mondo verso il firmware: cambia il livello e chiama gli interrupt
bool pin_livello(int pin);
uint32_t pin_registro();                  // i piedini 0-31 come li mostra il registro GPIO_IN
using OsservatoreUscita = std::function<void(int pin, bool livello)>;
void osserva_uscite(OsservatoreUscita f);  // il mondo vede ciò che il firmware scrive sui piedini

// ---- periferica RMT (impulsi temporizzati) ----
struct Impulso {
    bool alto;
    uint32_t us;
};
using RicevitoreRmt = std::function<void(int pin, const std::vector<Impulso>& impulsi, uint32_t portante_hz)>;
void osserva_rmt(RicevitoreRmt f);                               // il mondo riceve ciò che il firmware trasmette
bool rmt_in_ascolto(int pin);                                    // il firmware ha avviato una ricezione su `pin`?
void rmt_consegna(int pin, const std::vector<Impulso>& impulsi); // il mondo consegna un segnale ricevuto

// ---- seriale USB (Polpo Link) ----
void seriale_verso_firmware(const uint8_t* dati, size_t n);
size_t seriale_dal_firmware(uint8_t* dati, size_t max);

// ---- stato permanente (microSD e impostazioni), per salvarlo fuori dal simulatore ----
// Un file sulla microSD finta, come se la si estraesse per copiarlo dal computer (crea le cartelle che mancano).
bool sd_scrivi(const std::string& percorso, const std::string& dati);
bool sd_leggi(const std::string& percorso, std::string& dati);
std::vector<uint8_t> stato_esporta();
bool stato_importa(const uint8_t* dati, size_t n);


}  // namespace sim
