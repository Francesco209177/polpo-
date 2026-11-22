// Polpo — simulatore: il "mondo" intorno al Polpo. Tutto ciò che sta qui è INVENTATO:
// moduli collegati alla porta Grove, un tag NFC, un telecomando, una presa a 433 MHz, un PC, reti e dispositivi vicini.
// Nessuna onda viene emessa o ricevuta davvero.
#pragma once

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace sim {

enum class Modulo : uint8_t { Nessuno, Rfid2, Rf433, IrUnit };

struct Tag {
    std::string tipo = "ntag213";
    std::vector<uint8_t> uid;
    uint8_t sak = 0;
    uint16_t atqa = 0x0044;
    bool ha_versione = true;
    uint8_t versione[8] = {};
    std::vector<uint8_t> memoria;  // pagine da 4 byte (solo tag Type 2)
};

struct ReteWifi {
    std::string ssid, bssid;
    int rssi, canale, auth;
};

struct VicinoBle {
    std::string nome, indirizzo;
    int rssi;
    bool ha_produttore;
    uint16_t produttore;
    bool collegabile;
    uint8_t servizi;
};

struct Mondo {
    Modulo modulo = Modulo::Nessuno;
    bool sd_presente = true;
    int batteria = 82;
    bool in_carica = false;
    bool pc_collegato = true;
    bool telefono_vicino = true;  // un telefono finto pronto ad abbinare il telecomando Bluetooth
    bool tag_vicino = false;
    Tag tag;
    std::vector<ReteWifi> reti;
    std::vector<VicinoBle> vicini;
    std::vector<std::pair<int, int>> tasti;  // (fila, colonna) dei tasti premuti
    bool g0 = false;                         // tasto laterale premuto dall'ultima lettura
    uint8_t luminosita = 0;
};

Mondo& mondo();
void mondo_inizia();                           // stato iniziale e collegamenti con il nucleo
std::string comando(const std::string& json);  // comandi dell'ospite al mondo; risponde in JSON
Tag crea_tag(const std::string& tipo);

}  // namespace sim
