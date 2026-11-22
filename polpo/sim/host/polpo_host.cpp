// Polpo — simulatore: il firmware vero eseguito sul PC, comandato da un copione di testo.
// Serve alle prove automatiche dell'interfaccia: tasti in ingresso, schermate e messaggi in uscita.
//
//   polpo_host copione.txt [cartella per le immagini]
//
// Righe del copione:
//   attendi <ms>            fa passare il tempo
//   tasto <nome>            preme e rilascia: ok indietro su giu sinistra destra tab canc spazio g0, oppure un carattere
//   tieni <nome> <ms>       tiene premuto
//   scrivi <testo>          batte il testo un tasto alla volta
//   mondo <json>            comando al mondo simulato (vedi sim/mondo.cpp); stampa la risposta
//   seriale <riga>          manda una riga sulla porta USB (Polpo Link) e stampa le risposte
//   schermo <nome>          stampa l'impronta dello schermo e, se c'è la cartella, salva <nome>.ppm
//   eventi                  stampa gli eventi accumulati (trasmissioni simulate, suoni...)
//   conta                   li toglie dalla coda stampando solo quanti erano, per tipo
//   stato <file>            salva microSD e impostazioni;   carica <file> le rilegge (solo prima di «avvia»)
//   avvia                   accende il Polpo (se manca, viene fatto alla prima riga che lo richiede)
//   ripeti <n> <riga>       esegue <n> volte la riga che segue (es. «ripeti 20 tasto ok»)
//   # commento
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include "host/sim.h"

namespace {

struct Posto {
    int fila, colonna;
    bool maiuscolo;
};

const char* const kFile[4] = {"`1234567890-=\b", "\tqwertyuiop[]\\", "\x01\x02" "asdfghjkl;'\n", "\x03\x04\x05zxcvbnm,./ "};
const char* const kFileMaiusc[4] = {"~!@#$%^&*()_+\b", "\tQWERTYUIOP{}|", "\x01\x02" "ASDFGHJKL:\"\n", "\x03\x04\x05ZXCVBNM<>? "};

bool trova(char c, Posto& p) {
    for (int f = 0; f < 4; ++f)
        for (int k = 0; k < 14; ++k) {
            if (kFile[f][k] == c) return p = {f, k, false}, true;
            if (kFileMaiusc[f][k] == c && c != ' ' && c != '\b' && c != '\t' && c != '\n' && c > 5) return p = {f, k, true}, true;
        }
    return false;
}

bool posto_di(const std::string& nome, Posto& p) {
    if (nome == "ok") return trova('\n', p);
    if (nome == "indietro") return trova('`', p);
    if (nome == "su") return trova(';', p);
    if (nome == "giu") return trova('.', p);
    if (nome == "sinistra") return trova(',', p);
    if (nome == "destra") return trova('/', p);
    if (nome == "tab") return trova('\t', p);
    if (nome == "canc") return trova('\b', p);
    if (nome == "spazio") return trova(' ', p);
    return nome.size() == 1 && trova(nome[0], p);
}

void premi(const Posto& p, uint32_t ms) {
    sim_avanza(sim_occupato());  // come una persona: si aspetta che il Polpo abbia finito prima di premere
    if (p.maiuscolo) sim_tasto(2, 1, 1);  // Maiusc
    sim_tasto(p.fila, p.colonna, 1);
    sim_avanza(ms);
    sim_tasto(p.fila, p.colonna, 0);
    if (p.maiuscolo) sim_tasto(2, 1, 0);
    sim_avanza(sim_occupato() + 60);  // il rilascio va visto dal firmware, altrimenti la pressione successiva non conta
}

void stampa_eventi() {
    while (const char* e = sim_evento()) std::printf("evento %s\n", e);
}

void conta_eventi() {
    std::map<std::string, int> quanti;
    while (const char* e = sim_evento()) {
        const std::string j = e;
        const size_t a = j.find("\"tipo\":\""), b = a == std::string::npos ? a : j.find('"', a + 8);
        ++quanti[b == std::string::npos ? "?" : j.substr(a + 8, b - a - 8)];
    }
    std::string riga = "conta";
    for (const auto& q : quanti) riga += " " + q.first + "=" + std::to_string(q.second);
    std::printf("%s\n", riga.c_str());
}

void stampa_seriale() {
    uint8_t b[4096];
    std::string resto;
    size_t n;
    while ((n = sim_seriale_leggi(b, sizeof b)) > 0) resto.append(reinterpret_cast<char*>(b), n);
    std::istringstream righe(resto);
    for (std::string r; std::getline(righe, r);) std::printf("< %s\n", r.c_str());
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "uso: polpo_host copione.txt [cartella per le immagini]\n");
        return 2;
    }
    std::ifstream copione(argv[1]);
    if (!copione) {
        std::fprintf(stderr, "non riesco ad aprire %s\n", argv[1]);
        return 2;
    }
    const std::string cartella = argc > 2 ? argv[2] : "";
    bool acceso = false;
    auto accendi = [&acceso] {
        if (!acceso) sim_avvia();
        acceso = true;
    };
    int numero = 0, errori = 0, volte = 0;
    std::string riga, ripetuta;
    for (;;) {
        if (volte > 0) {
            --volte;
            riga = ripetuta;
        } else {
            if (!std::getline(copione, riga)) break;
            ++numero;
        }
        if (riga.empty() || riga[0] == '#') continue;
        if (riga.compare(0, 7, "ripeti ") == 0) {
            const size_t fine = riga.find(' ', 7);
            volte = fine == std::string::npos ? 0 : std::atoi(riga.substr(7, fine - 7).c_str());
            ripetuta = fine == std::string::npos ? "" : riga.substr(fine + 1);
            if (volte <= 0 || ripetuta.empty() || ripetuta.compare(0, 7, "ripeti ") == 0) std::printf("riga %d: «ripeti» va scritto come: ripeti <n> <riga>\n", numero), ++errori, volte = 0;
            continue;
        }
        const size_t sp = riga.find(' ');
        const std::string cmd = riga.substr(0, sp);
        const std::string resto = sp == std::string::npos ? "" : riga.substr(sp + 1);
        if (cmd == "carica") {
            std::ifstream f(resto, std::ios::binary);
            const std::vector<char> dati((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
            std::printf("carica %s\n", !acceso && sim_stato_importa(reinterpret_cast<const uint8_t*>(dati.data()), dati.size()) ? "ok" : "ERRORE");
            continue;
        }
        if (cmd == "mondo") {  // il mondo si può preparare anche prima di accendere (es. microSD assente)
            std::printf("mondo %s\n", sim_mondo(resto.c_str()));
            continue;
        }
        accendi();
        Posto p;
        if (cmd == "avvia") {
        } else if (cmd == "attendi") {
            sim_avanza(static_cast<uint32_t>(std::atoi(resto.c_str())));
        } else if (cmd == "tasto") {
            if (resto == "g0") {
                sim_g0();
                sim_avanza(120);
            } else if (posto_di(resto, p)) {
                premi(p, 60);
            } else {
                std::printf("riga %d: tasto sconosciuto «%s»\n", numero, resto.c_str()), ++errori;
            }
        } else if (cmd == "tieni") {
            std::istringstream s(resto);
            std::string nome;
            int ms = 0;
            s >> nome >> ms;
            if (posto_di(nome, p)) premi(p, static_cast<uint32_t>(ms));
            else std::printf("riga %d: tasto sconosciuto «%s»\n", numero, nome.c_str()), ++errori;
        } else if (cmd == "scrivi") {
            for (char c : resto) {
                if (trova(c, p)) premi(p, 60);
                else std::printf("riga %d: carattere non presente sulla tastiera «%c»\n", numero, c), ++errori;
            }
        } else if (cmd == "seriale") {
            const std::string r = resto + "\n";
            sim_seriale_scrivi(reinterpret_cast<const uint8_t*>(r.data()), r.size());
            sim_avanza(100);
            stampa_seriale();
        } else if (cmd == "schermo") {
            std::printf("schermo %s %08x\n", resto.c_str(), sim_impronta_schermo());
            if (!cartella.empty()) {
                const std::string file = cartella + "/" + resto + ".ppm";
                if (FILE* f = std::fopen(file.c_str(), "wb")) {
                    const uint8_t* b = sim_schermo();
                    std::fprintf(f, "P6\n%d %d\n255\n", SIM_LARGHEZZA, SIM_ALTEZZA);
                    for (int i = 0; i < SIM_LARGHEZZA * SIM_ALTEZZA; ++i) {
                        const unsigned v = (b[2 * i] << 8) | b[2 * i + 1];
                        const unsigned char rgb[3] = {static_cast<unsigned char>((v >> 11) * 255 / 31), static_cast<unsigned char>(((v >> 5) & 63) * 255 / 63), static_cast<unsigned char>((v & 31) * 255 / 31)};
                        std::fwrite(rgb, 1, 3, f);
                    }
                    std::fclose(f);
                }
            }
        } else if (cmd == "eventi") {
            stampa_eventi();
        } else if (cmd == "conta") {
            conta_eventi();
        } else if (cmd == "stato") {
            size_t n = 0;
            const uint8_t* d = sim_stato_esporta(&n);
            std::ofstream(resto, std::ios::binary).write(reinterpret_cast<const char*>(d), static_cast<std::streamsize>(n));
            std::printf("stato %zu byte\n", n);
        } else {
            std::printf("riga %d: comando sconosciuto «%s»\n", numero, cmd.c_str()), ++errori;
        }
    }
    return errori ? 1 : 0;
}
