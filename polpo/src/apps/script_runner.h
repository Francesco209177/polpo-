// Polpo — esecuzione di un programma PolpoScript: una sola per volta, in una schermata tutta sua.
// Queste funzioni servono all'app «Script», a Polpo Link (comandi script.*) e al simulatore.
#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "polpo/script/script.h"

namespace script_runner {

// Controlla un programma senza eseguirlo. true = è scritto bene; altrimenti `error` dice che cosa non va.
bool check(const std::string& path, polpo::script::Error& error);

// Apre la schermata ed esegue il programma. Con `paused` si ferma sulla prima riga (passo passo).
void open(const std::string& path, bool paused = false);

bool active();  // c'è un programma aperto (anche se finito o fermo su una riga)
void stop();    // come il tasto G0
void pause();
void resume();
void step(polpo::script::StepMode mode);
void set_breakpoints(const std::vector<uint16_t>& lines);

struct Snapshot {
    const char* state = "none";  // none, running, waiting, paused, done, failed
    uint16_t line = 0;
    std::string file;
    std::string error;
    std::vector<polpo::script::Variable> variables;
    std::vector<polpo::script::StackEntry> stack;
};
Snapshot snapshot(bool with_variables);

// Chi vuole sapere che cosa succede: "print" con il testo scritto, "paused" e "end" con la riga (per "end" il
// testo è l'eventuale errore). Due posti: uno per Polpo Link e uno per il simulatore; nullptr per smettere.
using Listener = std::function<void(const char* event, const std::string& text, uint16_t line)>;
enum ListenerSlot { kLinkListener = 0, kSimulatorListener = 1 };
void set_listener(ListenerSlot slot, Listener listener);

}  // namespace script_runner
