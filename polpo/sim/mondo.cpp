// Polpo — simulatore: il mondo inventato intorno al Polpo e i comandi con cui l'ospite lo cambia.
// Qui si "vedono" anche le trasmissioni del firmware (infrarossi, 433 MHz): vengono decodificate e raccontate
// con un evento, ma nessuna onda viene emessa.
#include "mondo.h"

#include <ArduinoJson.h>

#include <cstdio>
#include <cstring>

#include "nucleo.h"
#include "polpo/ir/ir_codec.h"
#include "polpo/ir/ir_signal.h"
#include "polpo/nfc/ndef.h"

namespace sim {
namespace {

// Creato al primo uso: così non dipende dall'ordine in cui il programma prepara le variabili globali.
Mondo& mondo_unico() {
    static Mondo m;
    return m;
}
#define g_mondo (mondo_unico())

// Piedini del Cardputer (vedi polpo/include/board_pins.h).
constexpr int kPinIrTx = 44;
constexpr int kPinGroveBianco = 1;  // ricevitore 433 e IR Unit
constexpr int kPinGroveGiallo = 2;  // trasmettitore 433

// ---------------- trasmissioni viste dal mondo ----------------

void vista_ir(const std::vector<Impulso>& impulsi, uint32_t portante) {
    // impulsi alti = luce accesa (la portante modula il livello alto)
    std::vector<uint32_t> durate;
    for (const Impulso& i : impulsi) {
        const bool acceso = i.alto;
        if (durate.empty() && !acceso) continue;
        if ((durate.size() % 2 == 1) == acceso) durate.back() += i.us;  // stesso livello di prima: si somma
        else durate.push_back(i.us);
    }
    if (!durate.empty() && durate.size() % 2 == 0) durate.pop_back();
    polpo::IrSignal s;
    std::string j = "{\"tipo\":\"ir.tx\",\"portante\":" + std::to_string(portante) + ",\"impulsi\":" + std::to_string(durate.size());
    if (polpo::ir_decode(durate, s) && !s.raw) {
        j += ",\"protocollo\":" + json_testo(polpo::ir_protocol_info(s.protocol).name) + ",\"indirizzo\":" + std::to_string(s.address) + ",\"comando\":" + std::to_string(s.command);
    }
    evento(j + ",\"nota\":\"SIMULATO: nessuna luce infrarossa emessa\"}");
}

// Decodifica un codice fisso in stile PT2262/EV1527 (protocollo 1 di rc-switch): 0 = 1:3, 1 = 3:1, pausa lunga 1:31.
bool decodifica_433(const std::vector<int32_t>& d, uint32_t& valore, int& bit, int& impulso) {
    for (size_t inizio = 0; inizio + 1 < d.size(); ++inizio) {
        if (d[inizio] <= 0) continue;
        uint32_t v = 0;
        int n = 0;
        long somma = 0;
        size_t i = inizio;
        for (; i + 1 < d.size() && d[i] > 0 && d[i + 1] < 0; i += 2) {
            const int su = d[i], giu = -d[i + 1];
            if (giu > su * 12) break;  // pausa di sincronismo: il codice è finito
            if (giu > su * 2 && giu < su * 5) v = v << 1;
            else if (su > giu * 2 && su < giu * 5) v = (v << 1) | 1u;
            else { n = -1; break; }
            somma += su + giu;
            if (++n > 32) { n = -1; break; }
        }
        if (n >= 8 && i + 1 < d.size() && d[i] > 0 && -d[i + 1] > d[i] * 12) {
            valore = v;
            bit = n;
            impulso = static_cast<int>(somma / (4L * n));
            return true;
        }
    }
    return false;
}

void vista_433(const std::vector<int32_t>& durate) {
    if (durate.empty()) return;
    uint64_t totale = 0;
    for (int32_t v : durate) totale += static_cast<uint64_t>(v < 0 ? -v : v);
    std::string j = "{\"tipo\":\"rf.tx\",\"impulsi\":" + std::to_string(durate.size()) + ",\"ms\":" + std::to_string(totale / 1000);
    uint32_t valore = 0;
    int bit = 0, impulso = 0;
    if (decodifica_433(durate, valore, bit, impulso)) j += ",\"valore\":" + std::to_string(valore) + ",\"bit\":" + std::to_string(bit) + ",\"impulso\":" + std::to_string(impulso);
    evento(j + ",\"nota\":\"SIMULATO: nessuna onda radio emessa\"}");
}

// Il trasmettitore 433 pilotato a mano (rc-switch): si raccolgono i fronti finché non c'è una pausa di 40 ms.
struct Tx433 {
    bool livello = false;
    uint64_t ultimo = 0;
    uint64_t generazione = 0;
    std::vector<int32_t> durate;
};
Tx433& tx433_unico() {
    static Tx433 t;
    return t;
}
#define g_tx433 (tx433_unico())

void fronte_433(bool livello) {
    if (g_mondo.modulo != Modulo::Rf433) return;  // nessun trasmettitore collegato: il piedino si muove a vuoto
    if (livello == g_tx433.livello) return;
    const uint64_t ora = ora_us();
    if (!g_tx433.durate.empty() || g_tx433.livello) {
        const int32_t d = static_cast<int32_t>(std::min<uint64_t>(ora - g_tx433.ultimo, 2000000));
        g_tx433.durate.push_back(g_tx433.livello ? d : -d);
    }
    g_tx433.livello = livello;
    g_tx433.ultimo = ora;
    const uint64_t g = ++g_tx433.generazione;
    tra(40000, [g] {
        if (g != g_tx433.generazione) return;
        std::vector<int32_t> d;
        d.swap(g_tx433.durate);
        vista_433(d);
    });
}

// ---------------- oggetti del mondo che "parlano" al Polpo ----------------

// Protocolli del telecomando finto a 433 MHz, nello stile di rc-switch: {impulso µs, sincronismo, zero, uno} in multipli dell'impulso.
struct Proto433 {
    int impulso, sync_su, sync_giu, zero_su, zero_giu, uno_su, uno_giu;
};
const Proto433 kProto433[] = {{350, 1, 31, 1, 3, 3, 1}, {650, 1, 10, 1, 2, 2, 1}};

std::string premi_433(uint32_t valore, int bit, int protocollo, int impulso, int ripetizioni) {
    if (g_mondo.modulo != Modulo::Rf433) return "{\"ok\":false,\"errore\":\"nessun ricevitore 433 collegato alla porta Grove\"}";
    if (protocollo < 1 || protocollo > 2 || bit < 1 || bit > 32) return "{\"ok\":false,\"errore\":\"il telecomando finto conosce solo i protocolli 1 e 2, fino a 32 bit\"}";
    Proto433 p = kProto433[protocollo - 1];
    if (impulso > 0) p.impulso = impulso;
    uint64_t t = 1000;
    auto fronte = [&t](bool livello, uint64_t dopo) {
        tra(t, [livello] { pin_imposta(kPinGroveBianco, livello); });
        t += dopo;
    };
    for (int r = 0; r < ripetizioni; ++r) {
        for (int b = bit - 1; b >= 0; --b) {
            const bool uno = (valore >> b) & 1u;
            fronte(true, static_cast<uint64_t>(uno ? p.uno_su : p.zero_su) * p.impulso);
            fronte(false, static_cast<uint64_t>(uno ? p.uno_giu : p.zero_giu) * p.impulso);
        }
        fronte(true, static_cast<uint64_t>(p.sync_su) * p.impulso);
        fronte(false, static_cast<uint64_t>(p.sync_giu) * p.impulso);
    }
    return "{\"ok\":true,\"ms\":" + std::to_string(t / 1000) + "}";
}

std::string premi_ir(const std::vector<uint32_t>& durate) {
    if (g_mondo.modulo != Modulo::IrUnit) return "{\"ok\":false,\"errore\":\"nessuna IR Unit collegata alla porta Grove\"}";
    if (!rmt_in_ascolto(kPinGroveBianco)) return "{\"ok\":false,\"errore\":\"il Polpo non sta ascoltando gli infrarossi\"}";
    // Il ricevitore della IR Unit è attivo basso: livello 0 = luce presente.
    std::vector<Impulso> impulsi;
    uint64_t totale = 0;
    for (size_t i = 0; i < durate.size(); ++i) {
        impulsi.push_back({i % 2 == 1, durate[i]});
        totale += durate[i];
    }
    impulsi.push_back({true, 15000});  // silenzio finale: è ciò che fa chiudere la ricezione
    tra(totale + 15000, [impulsi] { rmt_consegna(kPinGroveBianco, impulsi); });
    return "{\"ok\":true,\"ms\":" + std::to_string(totale / 1000) + "}";
}

const char* nome_modulo(Modulo m) {
    switch (m) {
        case Modulo::Rfid2: return "rfid2";
        case Modulo::Rf433: return "rf433";
        case Modulo::IrUnit: return "ir";
        default: return "nessuno";
    }
}

std::string stato_json() {
    char b[320];
    std::snprintf(b, sizeof b,
                  "{\"ok\":true,\"modulo\":\"%s\",\"sd\":%s,\"batteria\":%d,\"in_carica\":%s,\"pc\":%s,\"telefono\":%s,\"tag\":%s,\"tipo_tag\":\"%s\",\"luminosita\":%u}",
                  nome_modulo(g_mondo.modulo), g_mondo.sd_presente ? "true" : "false", g_mondo.batteria, g_mondo.in_carica ? "true" : "false",
                  g_mondo.pc_collegato ? "true" : "false", g_mondo.telefono_vicino ? "true" : "false", g_mondo.tag_vicino ? "true" : "false",
                  g_mondo.tag.tipo.c_str(), g_mondo.luminosita);
    return b;
}

}  // namespace

Mondo& mondo() { return g_mondo; }

Tag crea_tag(const std::string& tipo) {
    Tag t;
    t.tipo = tipo;
    if (tipo == "classic") {  // MIFARE Classic 1K: il Polpo la riconosce ma non la legge
        t.uid = {0xDE, 0xAD, 0xBE, 0xEF};
        t.sak = 0x08;
        t.atqa = 0x0004;
        t.ha_versione = false;
        return t;
    }
    t.uid = {0x04, 0x51, 0x3A, 0x7C, 0x22, 0x6B, 0x80};
    size_t pagine = 45;
    uint8_t cc2 = 0x12, v6 = 0x0F;
    if (tipo == "ntag215") {
        pagine = 135;
        cc2 = 0x3E;
        v6 = 0x11;
    } else if (tipo == "ultralight") {
        pagine = 16;
        cc2 = 0x06;
        t.ha_versione = false;  // l'Ultralight originale non risponde a GET_VERSION
    } else {
        t.tipo = "ntag213";
    }
    const uint8_t versione[8] = {0x00, 0x04, 0x04, 0x02, 0x01, 0x00, v6, 0x03};
    std::memcpy(t.versione, versione, 8);
    t.memoria.assign(pagine * 4, 0);
    uint8_t* m = t.memoria.data();
    m[0] = t.uid[0]; m[1] = t.uid[1]; m[2] = t.uid[2];
    m[3] = static_cast<uint8_t>(0x88 ^ m[0] ^ m[1] ^ m[2]);
    m[4] = t.uid[3]; m[5] = t.uid[4]; m[6] = t.uid[5]; m[7] = t.uid[6];
    m[8] = static_cast<uint8_t>(m[4] ^ m[5] ^ m[6] ^ m[7]);
    m[9] = 0x48;
    m[12] = 0xE1; m[13] = 0x10; m[14] = cc2; m[15] = 0x00;  // capability container: tag NDEF scrivibile
    m[16] = 0x03; m[17] = 0x00; m[18] = 0xFE;                // messaggio NDEF vuoto
    return t;
}

void mondo_inizia() {
    g_mondo = Mondo{};
    g_mondo.tag = crea_tag("ntag213");
    g_mondo.reti = {
        {"Casa-Bianchi", "A4:91:B1:2C:10:5E", -48, 6, 3},
        {"FRITZ!Box 7530 QK", "3C:A6:2F:90:11:02", -61, 1, 7},
        {"Vodafone-A7F3", "D8:0D:17:5B:A7:F3", -67, 11, 3},
        {"TP-Link_Ospiti", "50:C7:BF:31:9A:40", -72, 6, 0},
        {"Stampante-HP", "F4:39:09:6D:22:B8", -79, 1, 4},
        {"", "9C:53:22:0E:71:AC", -84, 11, 3},
    };
    g_mondo.vicini = {
        {"Cuffie di Marta", "6A:14:9F:20:3B:11", -52, true, 0x004C, true, 1},
        {"Mi Smart Band 7", "D1:7E:44:A0:19:C3", -66, true, 0x0157, true, 2},
        {"TV Soggiorno", "8C:79:F5:12:66:0A", -71, true, 0x0075, false, 0},
        {"", "42:9B:E0:55:D2:7F", -83, false, 0, false, 0},
    };
    g_tx433 = Tx433{};
    osserva_uscite([](int pin, bool livello) {
        if (pin == kPinGroveGiallo) fronte_433(livello);
    });
    osserva_rmt([](int pin, const std::vector<Impulso>& impulsi, uint32_t portante) {
        if (pin == kPinIrTx) {
            vista_ir(impulsi, portante);
        } else if (pin == kPinGroveGiallo && g_mondo.modulo == Modulo::Rf433) {
            std::vector<int32_t> d;
            for (const Impulso& i : impulsi) {
                const int32_t v = i.alto ? static_cast<int32_t>(i.us) : -static_cast<int32_t>(i.us);
                if (d.empty() && v < 0) continue;
                if (!d.empty() && (d.back() > 0) == (v > 0)) d.back() += v;
                else d.push_back(v);
            }
            vista_433(d);
        }
    });
}

std::string comando(const std::string& json) {
    JsonDocument doc;
    if (deserializeJson(doc, json)) return "{\"ok\":false,\"errore\":\"comando non valido\"}";
    const std::string cmd = doc["cmd"] | "";
    if (cmd == "stato") return stato_json();
    if (cmd == "modulo") {
        const std::string v = doc["valore"] | "nessuno";
        g_mondo.modulo = v == "rfid2" ? Modulo::Rfid2 : v == "rf433" ? Modulo::Rf433 : v == "ir" ? Modulo::IrUnit : Modulo::Nessuno;
        pin_imposta(kPinGroveBianco, g_mondo.modulo == Modulo::IrUnit);  // la IR Unit a riposo tiene la linea alta
        return stato_json();
    }
    if (cmd == "sd") {
        g_mondo.sd_presente = doc["presente"] | true;
        return stato_json();
    }
    if (cmd == "batteria") {
        g_mondo.batteria = std::max(0, std::min(100, doc["livello"] | g_mondo.batteria));
        g_mondo.in_carica = doc["in_carica"] | g_mondo.in_carica;
        return stato_json();
    }
    if (cmd == "pc") {
        g_mondo.pc_collegato = doc["collegato"] | true;
        return stato_json();
    }
    if (cmd == "telefono") {
        g_mondo.telefono_vicino = doc["vicino"] | true;
        return stato_json();
    }
    if (cmd == "tag") {
        if (doc["tipo"].is<const char*>()) g_mondo.tag = crea_tag(doc["tipo"].as<const char*>());
        const std::string url = doc["url"] | "", testo = doc["testo"] | "";
        if ((!url.empty() || !testo.empty()) && g_mondo.tag.memoria.size() > 16) {
            const auto tlv = polpo::ndef_wrap_tlv(url.empty() ? polpo::ndef_text_message(testo) : polpo::ndef_uri_message(url));
            if (tlv.size() + 16 <= g_mondo.tag.memoria.size()) std::copy(tlv.begin(), tlv.end(), g_mondo.tag.memoria.begin() + 16);
        }
        g_mondo.tag_vicino = doc["vicino"] | g_mondo.tag_vicino;
        return stato_json();
    }
    if (cmd == "gpio") {
        const int pin = doc["pin"] | -1;
        if (pin != kPinGroveBianco && pin != kPinGroveGiallo) return "{\"ok\":false,\"errore\":\"sulla porta Grove ci sono solo i piedini 1 e 2\"}";
        pin_imposta(pin, doc["livello"] | false);
        return stato_json();
    }
    if (cmd == "radiocomando") return premi_433(doc["valore"] | 0u, doc["bit"] | 24, doc["protocollo"] | 1, doc["impulso"] | 0, doc["ripetizioni"] | 8);
    if (cmd == "telecomando") {
        std::vector<uint32_t> durate;
        if (doc["grezzo"].is<JsonArray>()) {
            for (JsonVariant v : doc["grezzo"].as<JsonArray>()) durate.push_back(v.as<uint32_t>());
        } else {
            polpo::IrSignal s;
            s.protocol = polpo::ir_protocol_from_name(doc["protocollo"] | "NEC");
            s.address = doc["indirizzo"] | 0u;
            s.command = doc["comando"] | 0u;
            polpo::IrTimings t;
            if (s.protocol == polpo::IrProtocol::Unknown || !polpo::ir_encode(s, t)) return "{\"ok\":false,\"errore\":\"protocollo infrarosso sconosciuto\"}";
            durate = t.durations;
        }
        if (durate.size() < 7) return "{\"ok\":false,\"errore\":\"segnale troppo corto\"}";
        return premi_ir(durate);
    }
    return "{\"ok\":false,\"errore\":\"comando sconosciuto\"}";
}

}  // namespace sim
