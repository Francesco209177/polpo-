// Polpo — simulatore: realizzazione dell'interfaccia di host/sim.h.
#include "host/sim.h"

#include <ArduinoJson.h>
#include <M5Cardputer.h>

#include <algorithm>
#include <string>
#include <vector>

#include "apps/script_runner.h"
#include "mondo.h"
#include "nucleo.h"

void setup();  // quelle del firmware vero (polpo/src/main.cpp)
void loop();

namespace {
bool avviato = false;
uint64_t bersaglio_us = 0;  // fin dove l'ospite ha chiesto di far arrivare l'orologio
std::string risposta, evento_corrente;
std::vector<uint8_t> stato;
// Il mondo simulato viene preparato alla prima chiamata, qualunque essa sia.
void prepara() {
    static bool fatto = false;
    if (fatto) return;
    fatto = true;
    sim::mondo_inizia();
    // ciò che fa un programma PolpoScript diventa un evento, come le trasmissioni simulate
    script_runner::set_listener(script_runner::kSimulatorListener, [](const char* cosa, const std::string& testo, uint16_t riga) {
        JsonDocument e;
        const bool fermato = std::string(cosa) == "stopped";  // fermato con G0 o da fuori, non finito da solo
        e["tipo"] = fermato ? std::string("script.end") : std::string("script.") + cosa;
        e["riga"] = riga;
        e["testo"] = testo;
        if (fermato) e["fermato"] = true;
        std::string json;
        serializeJson(e, json);
        sim::evento(json);
    });
}
}  // namespace

extern "C" {

void sim_avvia(void) {
    prepara();
    if (avviato) return;
    avviato = true;
    setup();
    bersaglio_us = sim::ora_us();
}

void sim_avanza(uint32_t ms) {
    if (!avviato) return;
    bersaglio_us += static_cast<uint64_t>(ms) * 1000;
    while (sim::ora_us() < bersaglio_us) {
        const uint64_t prima = sim::ora_us();
        loop();
        if (sim::ora_us() == prima) sim::avanza_us(1000);  // un ciclo che non aspetta non deve fermare il tempo
    }
}

uint32_t sim_ora(void) { return static_cast<uint32_t>(sim::ora_us() / 1000); }

uint32_t sim_occupato(void) {
    const uint64_t ora = sim::ora_us();
    return ora > bersaglio_us ? static_cast<uint32_t>((ora - bersaglio_us + 999) / 1000) : 0;
}

void sim_tasto(int fila, int colonna, int premuto) {
    prepara();
    if (fila < 0 || fila > 3 || colonna < 0 || colonna > 13) return;
    auto& t = sim::mondo().tasti;
    const std::pair<int, int> k{fila, colonna};
    const auto it = std::find(t.begin(), t.end(), k);
    if (premuto && it == t.end()) t.push_back(k);
    if (!premuto && it != t.end()) t.erase(it);
}

void sim_g0(void) {
    prepara();
    sim::mondo().g0 = true;
}

const uint8_t* sim_schermo(void) { return static_cast<const uint8_t*>(M5Cardputer.Display.getBuffer()); }

uint32_t sim_impronta_schermo(void) {
    const uint8_t* p = sim_schermo();
    uint32_t h = 2166136261u;  // FNV-1a
    if (!p) return 0;
    for (size_t i = 0; i < static_cast<size_t>(SIM_LARGHEZZA) * SIM_ALTEZZA * 2; ++i) h = (h ^ p[i]) * 16777619u;
    return h;
}

const char* sim_mondo(const char* json) {
    prepara();
    risposta = sim::comando(json ? json : "");
    return risposta.c_str();
}

const char* sim_script(const char* json) {
    prepara();
    JsonDocument doc, out;
    const bool letto = !deserializeJson(doc, json ? json : "");
    const std::string cmd = doc["cmd"] | "";
    const std::string file = doc["file"] | "";
    out["ok"] = true;
    if (!letto) {
        out["ok"] = false;
        out["errore"] = "comando non valido";
    } else if (cmd == "scrivi") {
        out["ok"] = sim::sd_scrivi(file, doc["testo"] | "");
    } else if (cmd == "leggi") {
        std::string testo;
        out["ok"] = sim::sd_leggi(file, testo);
        out["testo"] = testo;
    } else if (!avviato) {
        out["ok"] = false;
        out["errore"] = "il Polpo è spento";
    } else if (cmd == "controlla") {
        polpo::script::Error errore;
        out["valido"] = script_runner::check(file, errore);
        out["riga"] = errore.line;
        out["errore"] = errore.message;
    } else if (cmd == "apri") {
        if (script_runner::active()) {
            out["ok"] = false;
            out["errore"] = "c'è già un programma aperto";
        } else {
            script_runner::open(file, doc["passo"] | false);
        }
    } else if (cmd == "ferma") {
        script_runner::stop();
    } else if (cmd == "pausa") {
        script_runner::pause();
    } else if (cmd == "riprendi") {
        script_runner::resume();
    } else if (cmd == "passo") {
        const std::string modo = doc["modo"] | "entra";
        script_runner::step(modo == "scavalca" ? polpo::script::StepMode::Over
                            : modo == "esci"   ? polpo::script::StepMode::Out
                                               : polpo::script::StepMode::Into);
    } else if (cmd == "soste") {
        std::vector<uint16_t> righe;
        for (JsonVariant v : doc["righe"].as<JsonArray>()) righe.push_back(v.as<uint16_t>());
        script_runner::set_breakpoints(righe);
    } else if (cmd == "stato") {
        const script_runner::Snapshot s = script_runner::snapshot(true);
        out["stato"] = s.state;
        out["riga"] = s.line;
        out["file"] = s.file;
        out["errore"] = s.error;
        JsonArray variabili = out["variabili"].to<JsonArray>();
        for (const auto& v : s.variables) {
            JsonObject o = variabili.add<JsonObject>();
            o["nome"] = v.name;
            o["valore"] = v.value;
            o["locale"] = v.local;
        }
        JsonArray pila = out["pila"].to<JsonArray>();
        for (const auto& p : s.stack) {
            JsonObject o = pila.add<JsonObject>();
            o["funzione"] = p.function;
            o["riga"] = p.line;
        }
    } else {
        out["ok"] = false;
        out["errore"] = "comando sconosciuto";
    }
    risposta.clear();
    serializeJson(out, risposta);
    return risposta.c_str();
}

const char* sim_evento(void) { return sim::prossimo_evento(evento_corrente) ? evento_corrente.c_str() : nullptr; }

void sim_seriale_scrivi(const uint8_t* dati, size_t n) { sim::seriale_verso_firmware(dati, n); }
size_t sim_seriale_leggi(uint8_t* dati, size_t max) { return sim::seriale_dal_firmware(dati, max); }

const uint8_t* sim_stato_esporta(size_t* n) {
    stato = sim::stato_esporta();
    if (n) *n = stato.size();
    return stato.data();
}

int sim_stato_importa(const uint8_t* dati, size_t n) { prepara(); return sim::stato_importa(dati, n) ? 1 : 0; }

void* sim_alloca(size_t n) { return std::malloc(n); }
void sim_libera(void* p) { std::free(p); }

}  // extern "C"
