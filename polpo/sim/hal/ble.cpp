// Polpo — simulatore: Bluetooth Low Energy SIMULATO (stessa interfaccia di src/hal/ble.h).
// È l'unico modulo hardware del firmware sostituito per intero: la pila Bluetooth vera (NimBLE) non esiste qui.
// I dispositivi "vicini" sono inventati dal mondo simulato; nessun dispositivo vero viene cercato o contattato.
#include "hal/ble.h"

#include <Arduino.h>

#include <algorithm>

#include "mondo.h"
#include "nucleo.h"

namespace ble {
namespace {
uint64_t scansione_inizio = 0, scansione_fine = 0;
bool telecomando = false;
uint64_t collegato_da = 0;
}  // namespace

bool scan_start(uint32_t duration_ms) {
    scansione_inizio = sim::ora_us();
    scansione_fine = scansione_inizio + static_cast<uint64_t>(duration_ms) * 1000;
    return true;
}

bool scanning() { return sim::ora_us() < scansione_fine; }

std::vector<Device> scan_results() {
    std::vector<Device> out;
    if (scansione_fine == 0) return out;
    // I dispositivi compaiono uno alla volta mentre la scansione procede, i più vicini per primi.
    const auto& vicini = sim::mondo().vicini;
    const uint64_t ora = std::min(sim::ora_us(), scansione_fine);
    const uint64_t durata = std::max<uint64_t>(1, scansione_fine - scansione_inizio);
    const size_t visibili = std::min(vicini.size(), static_cast<size_t>(1 + (ora - scansione_inizio) * vicini.size() / durata));
    for (size_t i = 0; i < visibili; ++i) {
        Device d;
        d.name = vicini[i].nome;
        d.addr = vicini[i].indirizzo;
        d.rssi = vicini[i].rssi;
        d.has_mfr = vicini[i].ha_produttore;
        d.mfr_id = vicini[i].produttore;
        d.connectable = vicini[i].collegabile;
        d.services = vicini[i].servizi;
        out.push_back(d);
    }
    std::sort(out.begin(), out.end(), [](const Device& a, const Device& b) { return a.rssi > b.rssi; });
    return out;
}

bool remote_begin(const char* name) {
    if (telecomando) return true;
    telecomando = true;
    collegato_da = sim::ora_us() + 2500000;  // il telefono finto impiega un paio di secondi ad abbinarsi
    sim::evento("{\"tipo\":\"ble.annuncio\",\"nome\":" + sim::json_testo(name ? name : "") + ",\"nota\":\"SIMULATO: nessun segnale Bluetooth emesso\"}");
    return true;
}

bool remote_connected() { return telecomando && sim::mondo().telefono_vicino && sim::ora_us() >= collegato_da; }

void remote_press(uint16_t usage) {
    if (!remote_connected()) return;
    sim::evento("{\"tipo\":\"ble.tasto\",\"uso\":" + std::to_string(usage) + "}");
    delay(30);
}

void end() {
    telecomando = false;
    scansione_fine = 0;
}

}  // namespace ble
