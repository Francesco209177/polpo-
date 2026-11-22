// Polpo — simulatore: realizzazione della finta piattaforma (vedi le intestazioni in questa cartella e nucleo.h).
#include <Arduino.h>
#include <M5Cardputer.h>
#include <MFRC522_I2C.h>
#include <Preferences.h>
#include <SD.h>
#include <USB.h>
#include <USBHIDKeyboard.h>
#include <WiFi.h>
#include <Wire.h>

#include <deque>
#include <map>
#include <set>

#include "mondo.h"
#include "nucleo.h"

// =====================================================================================================
// nucleo: tempo, eventi, piedini, RMT, seriale
// =====================================================================================================
namespace sim {
namespace {

uint64_t g_ora = 0;
uint64_t g_numero = 0;
std::map<std::pair<uint64_t, uint64_t>, std::function<void()>> g_programmati;
std::deque<std::string> g_eventi;

constexpr int kPin = 64;
bool g_livello[kPin] = {};
struct Interrupt {
    void (*funzione)() = nullptr;
    int modo = 0;
} g_interrupt[kPin];
OsservatoreUscita g_oss_uscite;
RicevitoreRmt g_oss_rmt;

struct CanaleRmt {
    bool attivo = false;
    rmt_ch_dir_t direzione = RMT_TX_MODE;
    uint32_t portante_hz = 0;
    rmt_data_t* rx_dati = nullptr;
    size_t* rx_n = nullptr;
    size_t rx_capienza = 0;
    bool rx_in_corso = false;
    bool rx_completa = false;
} g_rmt[kPin];

std::deque<uint8_t> g_seriale_in, g_seriale_out;

bool pin_valido(int pin) { return pin >= 0 && pin < kPin; }

}  // namespace

uint64_t ora_us() { return g_ora; }

void avanza_us(uint64_t us) {
    const uint64_t fine = g_ora + us;
    while (!g_programmati.empty() && g_programmati.begin()->first.first <= fine) {
        auto it = g_programmati.begin();
        if (it->first.first > g_ora) g_ora = it->first.first;
        auto fn = std::move(it->second);
        g_programmati.erase(it);
        fn();
    }
    if (fine > g_ora) g_ora = fine;
}

void tra(uint64_t us, std::function<void()> fn) { g_programmati[{g_ora + us, g_numero++}] = std::move(fn); }

void evento(const std::string& json) {
    if (g_eventi.size() >= 4000) g_eventi.pop_front();  // se nessuno li legge non crescono all'infinito
    g_eventi.push_back(json);
}

bool prossimo_evento(std::string& out) {
    if (g_eventi.empty()) return false;
    out = std::move(g_eventi.front());
    g_eventi.pop_front();
    return true;
}

std::string json_testo(const std::string& s) {
    std::string o = "\"";
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') {
            o += '\\';
            o += static_cast<char>(c);
        } else if (c < 0x20) {
            char b[8];
            std::snprintf(b, sizeof b, "\\u%04x", c);
            o += b;
        } else {
            o += static_cast<char>(c);
        }
    }
    return o + "\"";
}

void pin_imposta(int pin, bool livello) {
    if (!pin_valido(pin) || g_livello[pin] == livello) return;
    g_livello[pin] = livello;
    const Interrupt& i = g_interrupt[pin];
    if (i.funzione && (i.modo == CHANGE || (i.modo == RISING && livello) || (i.modo == FALLING && !livello))) i.funzione();
}

bool pin_livello(int pin) { return pin_valido(pin) && g_livello[pin]; }

uint32_t pin_registro() {
    uint32_t r = 0;
    for (int p = 0; p < 32; ++p)
        if (g_livello[p]) r |= 1u << p;
    return r;
}

void osserva_uscite(OsservatoreUscita f) { g_oss_uscite = std::move(f); }
void osserva_rmt(RicevitoreRmt f) { g_oss_rmt = std::move(f); }

bool rmt_in_ascolto(int pin) {
    return pin_valido(pin) && g_rmt[pin].attivo && g_rmt[pin].direzione == RMT_RX_MODE && g_rmt[pin].rx_in_corso;
}

void rmt_consegna(int pin, const std::vector<Impulso>& impulsi) {
    if (!rmt_in_ascolto(pin)) return;
    CanaleRmt& c = g_rmt[pin];
    size_t n = 0;
    for (size_t i = 0; i < impulsi.size() && n < c.rx_capienza; i += 2, ++n) {
        rmt_data_t d;
        d.val = 0;
        d.level0 = impulsi[i].alto ? 1 : 0;
        d.duration0 = impulsi[i].us > 32767 ? 32767 : impulsi[i].us;
        if (i + 1 < impulsi.size()) {
            d.level1 = impulsi[i + 1].alto ? 1 : 0;
            d.duration1 = impulsi[i + 1].us > 32767 ? 32767 : impulsi[i + 1].us;
        }
        c.rx_dati[n] = d;
    }
    *c.rx_n = n;
    c.rx_in_corso = false;
    c.rx_completa = true;
}

void seriale_verso_firmware(const uint8_t* dati, size_t n) { g_seriale_in.insert(g_seriale_in.end(), dati, dati + n); }

size_t seriale_dal_firmware(uint8_t* dati, size_t max) {
    size_t n = 0;
    while (n < max && !g_seriale_out.empty()) {
        dati[n++] = g_seriale_out.front();
        g_seriale_out.pop_front();
    }
    return n;
}

}  // namespace sim

// =====================================================================================================
// Arduino: tempo, piedini, RMT, seriale
// =====================================================================================================
uint32_t millis() { return static_cast<uint32_t>(sim::g_ora / 1000); }
uint32_t micros() { return static_cast<uint32_t>(sim::g_ora); }
void delay(uint32_t ms) { sim::avanza_us(static_cast<uint64_t>(ms) * 1000); }
void delayMicroseconds(uint32_t us) { sim::avanza_us(us); }

void pinMode(uint8_t, uint8_t) {}

void digitalWrite(uint8_t pin, uint8_t livello) {
    if (!sim::pin_valido(pin)) return;
    sim::g_livello[pin] = livello != 0;
    if (sim::g_oss_uscite) sim::g_oss_uscite(pin, livello != 0);
}

int digitalRead(uint8_t pin) { return sim::pin_livello(pin) ? HIGH : LOW; }

void attachInterrupt(uint8_t pin, void (*funzione)(), int modo) {
    if (sim::pin_valido(pin)) sim::g_interrupt[pin] = {funzione, modo};
}

void detachInterrupt(uint8_t pin) {
    if (sim::pin_valido(pin)) sim::g_interrupt[pin] = {};
}

bool rmtInit(int pin, rmt_ch_dir_t direzione, rmt_reserve_memsize_t, uint32_t) {
    if (!sim::pin_valido(pin)) return false;
    sim::g_rmt[pin] = {};
    sim::g_rmt[pin].attivo = true;
    sim::g_rmt[pin].direzione = direzione;
    return true;
}

bool rmtDeinit(int pin) {
    if (!sim::pin_valido(pin)) return false;
    sim::g_rmt[pin] = {};
    return true;
}

bool rmtSetEOT(int pin, uint8_t) { return sim::pin_valido(pin) && sim::g_rmt[pin].attivo; }

bool rmtSetCarrier(int pin, bool attiva, bool, uint32_t frequenza_hz, float) {
    if (!sim::pin_valido(pin) || !sim::g_rmt[pin].attivo) return false;
    sim::g_rmt[pin].portante_hz = attiva ? frequenza_hz : 0;
    return true;
}

bool rmtWrite(int pin, rmt_data_t* dati, size_t n, uint32_t) {
    if (!sim::pin_valido(pin) || !sim::g_rmt[pin].attivo || sim::g_rmt[pin].direzione != RMT_TX_MODE) return false;
    std::vector<sim::Impulso> impulsi;
    uint64_t totale = 0;
    for (size_t i = 0; i < n; ++i) {
        if (dati[i].duration0 == 0) break;
        impulsi.push_back({dati[i].level0 != 0, dati[i].duration0});
        totale += dati[i].duration0;
        if (dati[i].duration1 == 0) break;
        impulsi.push_back({dati[i].level1 != 0, dati[i].duration1});
        totale += dati[i].duration1;
    }
    sim::avanza_us(totale);  // la scrittura è bloccante, come sul dispositivo
    if (sim::g_oss_rmt) sim::g_oss_rmt(pin, impulsi, sim::g_rmt[pin].portante_hz);
    return true;
}

bool rmtSetRxMaxThreshold(int pin, uint16_t) { return sim::pin_valido(pin) && sim::g_rmt[pin].attivo; }
bool rmtSetRxMinThreshold(int pin, uint8_t) { return sim::pin_valido(pin) && sim::g_rmt[pin].attivo; }

bool rmtReadAsync(int pin, rmt_data_t* dati, size_t* n) {
    if (!sim::pin_valido(pin) || !sim::g_rmt[pin].attivo || sim::g_rmt[pin].direzione != RMT_RX_MODE || !dati || !n) return false;
    auto& c = sim::g_rmt[pin];
    c.rx_dati = dati;
    c.rx_n = n;
    c.rx_capienza = *n;
    c.rx_in_corso = true;
    c.rx_completa = false;
    return true;
}

bool rmtReceiveCompleted(int pin) { return sim::pin_valido(pin) && sim::g_rmt[pin].rx_completa; }

SimSerial Serial;
int SimSerial::available() { return static_cast<int>(sim::g_seriale_in.size()); }
int SimSerial::read() {
    if (sim::g_seriale_in.empty()) return -1;
    const uint8_t b = sim::g_seriale_in.front();
    sim::g_seriale_in.pop_front();
    return b;
}
size_t SimSerial::write(uint8_t b) { return write(&b, 1); }
size_t SimSerial::write(const uint8_t* dati, size_t n) {
    if (sim::g_seriale_out.size() + n > (1u << 20)) sim::g_seriale_out.clear();  // nessuno legge: non si accumula
    sim::g_seriale_out.insert(sim::g_seriale_out.end(), dati, dati + n);
    return n;
}

SimEsp ESP;
SPIClass SPI;

// =====================================================================================================
// impostazioni (NVS) e microSD, entrambe in memoria
// =====================================================================================================
namespace {
std::map<std::string, std::map<std::string, uint32_t>> g_nvs;
std::map<std::string, std::string> g_file;  // percorso assoluto -> contenuto
std::set<std::string> g_cartelle;           // percorsi assoluti, senza barra finale ("" = radice)
bool g_sd_montata = false;

std::string pulisci(const char* p) {
    std::string s = p ? p : "";
    while (s.size() > 1 && s.back() == '/') s.pop_back();
    if (s == "/") s.clear();
    if (!s.empty() && s[0] != '/') s = "/" + s;
    return s;
}
std::string genitore(const std::string& p) {
    const size_t i = p.find_last_of('/');
    return i == std::string::npos ? "" : p.substr(0, i);
}
std::string nome_di(const std::string& p) {
    const size_t i = p.find_last_of('/');
    return i == std::string::npos ? p : p.substr(i + 1);
}
bool sd_ok() { return g_sd_montata && sim::mondo().sd_presente; }
bool cartella_esiste(const std::string& p) { return p.empty() || g_cartelle.count(p) > 0; }
}  // namespace

bool Preferences::begin(const char* spazio, bool sola_lettura) {
    spazio_ = spazio ? spazio : "";
    sola_lettura_ = sola_lettura;
    return true;
}
uint32_t Preferences::getUInt(const char* chiave, uint32_t predefinito) {
    const auto s = g_nvs.find(spazio_);
    if (s == g_nvs.end()) return predefinito;
    const auto v = s->second.find(chiave);
    return v == s->second.end() ? predefinito : v->second;
}
uint8_t Preferences::getUChar(const char* chiave, uint8_t predefinito) { return static_cast<uint8_t>(getUInt(chiave, predefinito)); }
bool Preferences::getBool(const char* chiave, bool predefinito) { return getUInt(chiave, predefinito ? 1 : 0) != 0; }
size_t Preferences::putUInt(const char* chiave, uint32_t v) {
    if (sola_lettura_) return 0;
    g_nvs[spazio_][chiave] = v;
    return 4;
}
size_t Preferences::putUChar(const char* chiave, uint8_t v) { return putUInt(chiave, v) ? 1 : 0; }
size_t Preferences::putBool(const char* chiave, bool v) { return putUInt(chiave, v ? 1 : 0) ? 1 : 0; }

namespace fs {
struct StatoFile {
    std::string percorso, nome;
    bool cartella = false;
    bool scrive = false;
    size_t pos = 0;
    std::vector<std::string> figli;
    size_t indice = 0;
    bool aperto = true;
};
File::operator bool() const { return s_ && s_->aperto; }
bool File::isDirectory() { return s_ && s_->cartella; }
const char* File::name() const { return s_ ? s_->nome.c_str() : ""; }
const char* File::path() const { return s_ ? s_->percorso.c_str() : ""; }
size_t File::size() const {
    if (!s_ || s_->cartella) return 0;
    const auto f = g_file.find(s_->percorso);
    return f == g_file.end() ? 0 : f->second.size();
}
size_t File::position() const { return s_ ? s_->pos : 0; }
bool File::seek(uint32_t pos) {
    if (!s_ || s_->cartella || pos > size()) return false;
    s_->pos = pos;
    return true;
}
size_t File::read(uint8_t* buf, size_t n) {
    if (!s_ || !s_->aperto || s_->cartella || !sd_ok()) return 0;
    const auto f = g_file.find(s_->percorso);
    if (f == g_file.end() || s_->pos >= f->second.size()) return 0;
    const size_t k = std::min(n, f->second.size() - s_->pos);
    std::memcpy(buf, f->second.data() + s_->pos, k);
    s_->pos += k;
    return k;
}
int File::read() {
    uint8_t b;
    return read(&b, 1) == 1 ? b : -1;
}
int File::available() { return static_cast<int>(size() - position()); }
size_t File::write(const uint8_t* buf, size_t n) {
    if (!s_ || !s_->aperto || !s_->scrive || !sd_ok()) return 0;
    g_file[s_->percorso].append(reinterpret_cast<const char*>(buf), n);
    s_->pos = g_file[s_->percorso].size();
    return n;
}
void File::close() {
    if (s_) s_->aperto = false;
}
File File::openNextFile(const char*) {
    if (!s_ || !s_->cartella || !sd_ok()) return File();
    while (s_->indice < s_->figli.size()) {
        const std::string p = s_->figli[s_->indice++];
        File f = SD.open(p.c_str(), FILE_READ);
        if (f) return f;
    }
    return File();
}
}  // namespace fs

SimSD SD;
bool SimSD::begin(int, SPIClass&, uint32_t) {
    g_sd_montata = sim::mondo().sd_presente;
    return g_sd_montata;
}
void SimSD::end() { g_sd_montata = false; }
File SimSD::open(const char* percorso, const char* modo) {
    if (!sd_ok()) return File();
    const std::string p = pulisci(percorso);
    const char m = modo && *modo ? *modo : 'r';
    auto s = std::make_shared<fs::StatoFile>();
    s->percorso = p;
    s->nome = nome_di(p);
    if (m == 'r') {
        if (cartella_esiste(p)) {
            s->cartella = true;
            const std::string prefisso = p + "/";
            for (const auto& c : g_cartelle)
                if (c.size() > prefisso.size() && c.compare(0, prefisso.size(), prefisso) == 0 && c.find('/', prefisso.size()) == std::string::npos) s->figli.push_back(c);
            for (const auto& f : g_file)
                if (f.first.size() > prefisso.size() && f.first.compare(0, prefisso.size(), prefisso) == 0 && f.first.find('/', prefisso.size()) == std::string::npos) s->figli.push_back(f.first);
            return File(s);
        }
        return g_file.count(p) ? File(s) : File();
    }
    if (p.empty() || cartella_esiste(p) || !cartella_esiste(genitore(p))) return File();
    if (m == 'w') g_file[p].clear();  // "w" crea o svuota
    s->scrive = true;
    s->pos = g_file[p].size();
    return File(s);
}
bool SimSD::exists(const char* percorso) {
    if (!sd_ok()) return false;
    const std::string p = pulisci(percorso);
    return cartella_esiste(p) || g_file.count(p) > 0;
}
bool SimSD::remove(const char* percorso) { return sd_ok() && g_file.erase(pulisci(percorso)) > 0; }
bool SimSD::rename(const char* da, const char* a) {
    if (!sd_ok()) return false;
    const std::string d = pulisci(da), x = pulisci(a);
    const auto f = g_file.find(d);
    if (f == g_file.end() || x.empty() || cartella_esiste(x) || !cartella_esiste(genitore(x))) return false;
    g_file[x] = std::move(f->second);
    g_file.erase(d);
    return true;
}
bool SimSD::mkdir(const char* percorso) {
    if (!sd_ok()) return false;
    const std::string p = pulisci(percorso);
    if (p.empty() || g_file.count(p) || !cartella_esiste(genitore(p))) return false;
    g_cartelle.insert(p);
    return true;
}
bool SimSD::rmdir(const char* percorso) {
    if (!sd_ok()) return false;
    const std::string p = pulisci(percorso), prefisso = p + "/";
    if (p.empty() || !g_cartelle.count(p)) return false;
    for (const auto& c : g_cartelle)
        if (c.compare(0, prefisso.size(), prefisso) == 0) return false;
    for (const auto& f : g_file)
        if (f.first.compare(0, prefisso.size(), prefisso) == 0) return false;
    g_cartelle.erase(p);
    return true;
}
uint64_t SimSD::totalBytes() { return 8ull << 30; }  // una scheda finta da 8 GB
uint64_t SimSD::usedBytes() {
    uint64_t n = 0;
    for (const auto& f : g_file) n += (f.second.size() + 32767) / 32768 * 32768;  // a blocchi da 32 KB, come FAT32
    return n;
}

// ---- stato permanente: cartelle, file e impostazioni in un unico blocco di byte ----
namespace sim {
namespace {
const char kFirma[] = "POLPOSIM1";
void metti32(std::vector<uint8_t>& o, uint32_t v) {
    for (int i = 0; i < 4; ++i) o.push_back(static_cast<uint8_t>(v >> (8 * i)));
}
void metti(std::vector<uint8_t>& o, const std::string& s) {
    metti32(o, static_cast<uint32_t>(s.size()));
    o.insert(o.end(), s.begin(), s.end());
}
struct Lettore {
    const uint8_t* p;
    size_t n, i = 0;
    bool ok = true;
    uint32_t u32() {
        if (i + 4 > n) return ok = false, 0;
        const uint32_t v = p[i] | (p[i + 1] << 8) | (p[i + 2] << 16) | (static_cast<uint32_t>(p[i + 3]) << 24);
        i += 4;
        return v;
    }
    std::string testo() {
        const uint32_t k = u32();
        if (!ok || i + k > n) return ok = false, std::string();
        std::string s(reinterpret_cast<const char*>(p + i), k);
        i += k;
        return s;
    }
};
}  // namespace

bool sd_scrivi(const std::string& percorso, const std::string& dati) {
    const std::string p = pulisci(percorso.c_str());
    if (p.empty() || g_cartelle.count(p)) return false;
    for (size_t i = p.find('/', 1); i != std::string::npos; i = p.find('/', i + 1)) g_cartelle.insert(p.substr(0, i));
    g_file[p] = dati;
    return true;
}

bool sd_leggi(const std::string& percorso, std::string& dati) {
    const auto f = g_file.find(pulisci(percorso.c_str()));
    if (f == g_file.end()) return false;
    dati = f->second;
    return true;
}

std::vector<uint8_t> stato_esporta() {
    std::vector<uint8_t> o(kFirma, kFirma + sizeof(kFirma) - 1);
    metti32(o, static_cast<uint32_t>(g_cartelle.size()));
    for (const auto& c : g_cartelle) metti(o, c);
    metti32(o, static_cast<uint32_t>(g_file.size()));
    for (const auto& f : g_file) {
        metti(o, f.first);
        metti(o, f.second);
    }
    metti32(o, static_cast<uint32_t>(g_nvs.size()));
    for (const auto& s : g_nvs) {
        metti(o, s.first);
        metti32(o, static_cast<uint32_t>(s.second.size()));
        for (const auto& v : s.second) {
            metti(o, v.first);
            metti32(o, v.second);
        }
    }
    return o;
}

bool stato_importa(const uint8_t* dati, size_t n) {
    const size_t firma = sizeof(kFirma) - 1;
    if (!dati || n < firma || std::memcmp(dati, kFirma, firma) != 0) return false;
    Lettore r{dati + firma, n - firma};
    std::set<std::string> cartelle;
    std::map<std::string, std::string> file;
    std::map<std::string, std::map<std::string, uint32_t>> nvs;
    for (uint32_t k = r.u32(); r.ok && k > 0; --k) cartelle.insert(r.testo());
    for (uint32_t k = r.u32(); r.ok && k > 0; --k) {
        std::string p = r.testo();
        file[p] = r.testo();
    }
    for (uint32_t k = r.u32(); r.ok && k > 0; --k) {
        std::string spazio = r.testo();
        for (uint32_t j = r.u32(); r.ok && j > 0; --j) {
            std::string chiave = r.testo();
            nvs[spazio][chiave] = r.u32();
        }
    }
    if (!r.ok || r.i != r.n) return false;  // blocco rovinato: non si tocca nulla
    g_cartelle = std::move(cartelle);
    g_file = std::move(file);
    g_nvs = std::move(nvs);
    return true;
}
}  // namespace sim

// =====================================================================================================
// Wi-Fi, I2C, USB: rispondono con ciò che c'è nel mondo simulato
// =====================================================================================================
namespace {
bool g_wifi_scansione = false;
uint64_t g_wifi_fine = 0;
}  // namespace
SimWiFi WiFi;
bool SimWiFi::mode(wifi_mode_t m) {
    if (m == WIFI_OFF) g_wifi_scansione = false;
    return true;
}
int16_t SimWiFi::scanNetworks(bool, bool) {
    g_wifi_scansione = true;
    g_wifi_fine = sim::ora_us() + 1800000;  // una scansione vera dura un paio di secondi
    return WIFI_SCAN_RUNNING;
}
int16_t SimWiFi::scanComplete() {
    if (!g_wifi_scansione) return WIFI_SCAN_FAILED;
    if (sim::ora_us() < g_wifi_fine) return WIFI_SCAN_RUNNING;
    return static_cast<int16_t>(sim::mondo().reti.size());
}
void SimWiFi::scanDelete() { g_wifi_scansione = false; }
String SimWiFi::SSID(uint8_t i) { return i < sim::mondo().reti.size() ? String(sim::mondo().reti[i].ssid) : String(); }
String SimWiFi::BSSIDstr(uint8_t i) { return i < sim::mondo().reti.size() ? String(sim::mondo().reti[i].bssid) : String(); }
int32_t SimWiFi::RSSI(uint8_t i) { return i < sim::mondo().reti.size() ? sim::mondo().reti[i].rssi : 0; }
int32_t SimWiFi::channel(uint8_t i) { return i < sim::mondo().reti.size() ? sim::mondo().reti[i].canale : 0; }
wifi_auth_mode_t SimWiFi::encryptionType(uint8_t i) {
    return i < sim::mondo().reti.size() ? static_cast<wifi_auth_mode_t>(sim::mondo().reti[i].auth) : WIFI_AUTH_OPEN;
}

TwoWire Wire;
bool TwoWire::begin(int, int, uint32_t) { return attivo_ = true; }
bool TwoWire::end() {
    attivo_ = false;
    return true;
}
uint8_t TwoWire::endTransmission(bool) {
    // Sulla porta Grove risponde solo il lettore RFID2 (indirizzo 0x28), se è il modulo collegato.
    return attivo_ && indirizzo_ == 0x28 && sim::mondo().modulo == sim::Modulo::Rfid2 ? 0 : 2;
}

SimUsb USB;
SimUsb::operator bool() const { return sim::mondo().pc_collegato; }
void USBHIDKeyboard::sendReport(KeyReport* r) {
    if (!r || !sim::mondo().pc_collegato) return;
    if (r->modifiers == 0 && r->keys[0] == 0) return;  // rilascio di tutti i tasti
    char b[96];
    std::snprintf(b, sizeof b, "{\"tipo\":\"usb.tasto\",\"modificatori\":%u,\"codice\":%u}", r->modifiers, r->keys[0]);
    sim::evento(b);
}

// =====================================================================================================
// lettore NFC: dall'altra parte c'è il tag del mondo simulato (solo ISO 14443-A, come il lettore vero)
// =====================================================================================================
namespace {
bool tag_raggiungibile() { return sim::mondo().modulo == sim::Modulo::Rfid2 && sim::mondo().tag_vicino; }
}  // namespace
byte MFRC522_I2C::PICC_WakeupA(byte* atqa, byte* dimensione) {
    selezionato_ = false;
    if (!tag_raggiungibile() || !atqa || !dimensione || *dimensione < 2) return STATUS_TIMEOUT;
    atqa[0] = static_cast<byte>(sim::mondo().tag.atqa & 0xFF);
    atqa[1] = static_cast<byte>(sim::mondo().tag.atqa >> 8);
    *dimensione = 2;
    return STATUS_OK;
}
byte MFRC522_I2C::PICC_Select(Uid* u, byte) {
    if (!tag_raggiungibile() || !u) return STATUS_TIMEOUT;
    const sim::Tag& t = sim::mondo().tag;
    u->size = static_cast<byte>(std::min<size_t>(t.uid.size(), 10));
    std::memcpy(u->uidByte, t.uid.data(), u->size);
    u->sak = t.sak;
    selezionato_ = true;
    return STATUS_OK;
}
byte MFRC522_I2C::PICC_HaltA() {
    selezionato_ = false;
    return STATUS_OK;
}
byte MFRC522_I2C::PCD_CalculateCRC(byte* dati, byte n, byte* risultato) {
    uint16_t crc = 0x6363;  // CRC_A di ISO 14443-3
    for (byte i = 0; i < n; ++i) {
        uint8_t b = dati[i] ^ static_cast<uint8_t>(crc & 0xFF);
        b ^= static_cast<uint8_t>(b << 4);
        crc = static_cast<uint16_t>((crc >> 8) ^ (static_cast<uint16_t>(b) << 8) ^ (static_cast<uint16_t>(b) << 3) ^ (b >> 4));
    }
    risultato[0] = static_cast<byte>(crc & 0xFF);
    risultato[1] = static_cast<byte>(crc >> 8);
    return STATUS_OK;
}
byte MFRC522_I2C::PCD_TransceiveData(byte* invio, byte n_invio, byte* risposta, byte* n_risposta, byte*, byte, bool) {
    if (!tag_raggiungibile() || !selezionato_ || n_invio < 1) return STATUS_TIMEOUT;
    const sim::Tag& t = sim::mondo().tag;
    if (invio[0] == 0x60 && t.ha_versione && risposta && n_risposta && *n_risposta >= 10) {  // GET_VERSION
        std::memcpy(risposta, t.versione, 8);
        PCD_CalculateCRC(risposta, 8, risposta + 8);
        *n_risposta = 10;
        return STATUS_OK;
    }
    selezionato_ = false;  // comando non riconosciuto: il tag risponde NAK e torna in attesa
    return STATUS_ERROR;
}
byte MFRC522_I2C::MIFARE_Read(byte pagina, byte* buffer, byte* dimensione) {
    if (!tag_raggiungibile() || !selezionato_ || !buffer || !dimensione || *dimensione < 18) return STATUS_TIMEOUT;
    const sim::Tag& t = sim::mondo().tag;
    const size_t pagine = t.memoria.size() / 4;
    if (t.sak != 0x00 || pagine == 0 || pagina >= pagine) {  // non è un tag Type 2, oppure pagina oltre la fine
        selezionato_ = false;
        return STATUS_MIFARE_NACK;
    }
    for (size_t i = 0; i < 16; ++i) buffer[i] = t.memoria[((pagina * 4u) + i) % t.memoria.size()];  // oltre la fine riparte da zero
    PCD_CalculateCRC(buffer, 16, buffer + 16);
    *dimensione = 18;
    return STATUS_OK;
}
byte MFRC522_I2C::MIFARE_Ultralight_Write(byte pagina, byte* buffer, byte dimensione) {
    if (!tag_raggiungibile() || !selezionato_ || !buffer || dimensione < 4) return STATUS_TIMEOUT;
    sim::Tag& t = sim::mondo().tag;
    const size_t pagine = t.memoria.size() / 4;
    bool bloccata = false;
    if (pagine >= 3 && pagina >= 3 && pagina <= 15) {  // bit di blocco statici (byte 2 e 3 della pagina 2)
        const uint16_t lock = static_cast<uint16_t>(t.memoria[10] | (t.memoria[11] << 8));
        bloccata = (lock >> pagina) & 1u;
    }
    if (t.sak != 0x00 || pagina < 2 || pagina >= pagine || bloccata) {
        selezionato_ = false;
        return STATUS_MIFARE_NACK;
    }
    for (int i = 0; i < 4; ++i) {
        uint8_t& cella = t.memoria[pagina * 4u + i];
        cella = (pagina == 2 || pagina == 3) ? static_cast<uint8_t>(cella | buffer[i]) : buffer[i];  // lock e CC: i bit si possono solo accendere
    }
    char b[80];
    std::snprintf(b, sizeof b, "{\"tipo\":\"nfc.scrittura\",\"pagina\":%u}", pagina);
    sim::evento(b);
    return STATUS_OK;
}

// =====================================================================================================
// M5Cardputer: display in memoria, tastiera, altoparlante, batteria
// =====================================================================================================
M5Cardputer_Class M5Cardputer;
M5Unified_Sim M5;

void M5Cardputer_Class::begin(m5::config_t, bool) {
    Display.setColorDepth(16);
    Display.createSprite(240, 135);
    Display.fillScreen(0);
}

void SimDisplay::setBrightness(uint8_t livello) {
    if (sim::mondo().luminosita == livello) return;
    sim::mondo().luminosita = livello;
    char b[64];
    std::snprintf(b, sizeof b, "{\"tipo\":\"luminosita\",\"valore\":%u}", livello);
    sim::evento(b);
}
uint8_t SimDisplay::getBrightness() const { return sim::mondo().luminosita; }

namespace {
// Disposizione dei tasti del Cardputer: (senza Maiusc, con Maiusc).
const KeyValue_t kTasti[4][14] = {
    {{'`', '~'}, {'1', '!'}, {'2', '@'}, {'3', '#'}, {'4', '$'}, {'5', '%'}, {'6', '^'}, {'7', '&'}, {'8', '*'}, {'9', '('}, {'0', ')'}, {'-', '_'}, {'=', '+'}, {KEY_BACKSPACE, KEY_BACKSPACE}},
    {{KEY_TAB, KEY_TAB}, {'q', 'Q'}, {'w', 'W'}, {'e', 'E'}, {'r', 'R'}, {'t', 'T'}, {'y', 'Y'}, {'u', 'U'}, {'i', 'I'}, {'o', 'O'}, {'p', 'P'}, {'[', '{'}, {']', '}'}, {'\\', '|'}},
    {{static_cast<char>(KEY_FN), static_cast<char>(KEY_FN)}, {static_cast<char>(KEY_LEFT_SHIFT), static_cast<char>(KEY_LEFT_SHIFT)}, {'a', 'A'}, {'s', 'S'}, {'d', 'D'}, {'f', 'F'}, {'g', 'G'}, {'h', 'H'}, {'j', 'J'}, {'k', 'K'}, {'l', 'L'}, {';', ':'}, {'\'', '"'}, {KEY_ENTER, KEY_ENTER}},
    {{static_cast<char>(KEY_LEFT_CTRL), static_cast<char>(KEY_LEFT_CTRL)}, {KEY_OPT, KEY_OPT}, {static_cast<char>(KEY_LEFT_ALT), static_cast<char>(KEY_LEFT_ALT)}, {'z', 'Z'}, {'x', 'X'}, {'c', 'C'}, {'v', 'V'}, {'b', 'B'}, {'n', 'N'}, {'m', 'M'}, {',', '<'}, {'.', '>'}, {'/', '?'}, {' ', ' '}},
};
std::vector<Point2D_t> g_premuti;
}  // namespace

const std::vector<Point2D_t>& Keyboard_Class::keyList() {
    g_premuti.clear();
    for (const auto& t : sim::mondo().tasti) g_premuti.push_back({t.second, t.first});
    return g_premuti;
}
KeyValue_t Keyboard_Class::getKeyValue(const Point2D_t& t) {
    if (t.y < 0 || t.y > 3 || t.x < 0 || t.x > 13) return {0, 0};
    return kTasti[t.y][t.x];
}

int32_t m5::Power_Class::getBatteryLevel() { return sim::mondo().batteria; }
m5::Power_Class::is_charging_t m5::Power_Class::isCharging() {
    return sim::mondo().in_carica ? is_charging_t::is_charging : is_charging_t::is_discharging;
}
bool m5::Speaker_Class::tone(float hz, uint32_t ms, int, bool) {
    char b[80];
    std::snprintf(b, sizeof b, "{\"tipo\":\"suono\",\"hz\":%d,\"ms\":%u}", static_cast<int>(hz), static_cast<unsigned>(ms));
    sim::evento(b);
    return true;
}
bool m5::Button_Class::wasPressed() {
    const bool p = sim::mondo().g0;
    sim::mondo().g0 = false;
    return p;
}
