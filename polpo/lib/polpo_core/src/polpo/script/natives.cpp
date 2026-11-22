// PolpoScript — le funzioni già pronte.
//
// Sono tutte qui e sono le uniche porte verso l'esterno: schermo, tasti, suoni, orologio e file di testo nella
// cartella dei dati degli script. Non c'è, e non deve esserci, niente che trasmetta (radio, infrarossi, NFC),
// che scriva come una tastiera USB o che usi Bluetooth e Wi-Fi: un programma che trasmette in un ciclo sarebbe
// uno strumento per tentare codici a raffica.
#include <algorithm>
#include <cmath>
#include <utility>

#include "polpo/script/script.h"
#include "polpo/script/vm_internal.h"
#include "polpo/util/utf8.h"

namespace polpo {
namespace script {
namespace {

enum Native : uint8_t {
    kPulisci, kPunto, kLinea, kRettangolo, kCornice, kCerchio, kAnello, kScritta, kMostra, kColore, kScrivi,
    kTasto, kPremuto, kAspettaTasto, kChiedi,
    kSuona, kAspetta, kTempo,
    kCasuale, kSeme, kIntero, kArrotonda, kAssoluto, kMinimo, kMassimo, kRadice, kSeno, kCoseno,
    kNumero, kTesto, kTipo,
    kLunghezza, kParte, kTrova, kMaiuscolo, kMinuscolo,
    kAggiungi, kTogli, kInserisci, kLista, kUnisci, kDividi, kOrdina,
    kSalva, kCarica, kTermina,
    kNativeCount,
};

const NativeInfo kNatives[kNativeCount] = {
    {"pulisci", 0, 1},   {"punto", 3, 3},     {"linea", 5, 5},       {"rettangolo", 5, 5}, {"cornice", 5, 5},
    {"cerchio", 4, 4},   {"anello", 4, 4},    {"scritta", 4, 5},     {"mostra", 0, 0},     {"colore", 3, 3},
    {"scrivi", 0, 16},   {"tasto", 0, 0},     {"premuto", 1, 1},     {"aspetta_tasto", 0, 0}, {"chiedi", 0, 1},
    {"suona", 2, 2},     {"aspetta", 1, 1},   {"tempo", 0, 0},       {"casuale", 0, 2},    {"seme", 1, 1},
    {"intero", 1, 1},    {"arrotonda", 1, 1}, {"assoluto", 1, 1},    {"minimo", 1, 16},    {"massimo", 1, 16},
    {"radice", 1, 1},    {"seno", 1, 1},      {"coseno", 1, 1},      {"numero", 1, 1},     {"testo", 1, 1},
    {"tipo", 1, 1},      {"lunghezza", 1, 1}, {"parte", 2, 3},       {"trova", 2, 2},      {"maiuscolo", 1, 1},
    {"minuscolo", 1, 1}, {"aggiungi", 2, 2},  {"togli", 1, 2},       {"inserisci", 3, 3},  {"lista", 1, 2},
    {"unisci", 1, 2},    {"dividi", 2, 2},    {"ordina", 1, 1},      {"salva", 2, 2},      {"carica", 1, 1},
    {"termina", 0, 0},
};

uint16_t rgb565(int r, int g, int b) {
    return static_cast<uint16_t>(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
}

const NamedConstant kConstants[] = {
    // Nomi che difficilmente servono per una variabile propria («larghezza» e «altezza» da sole restano libere).
    {"larghezza_schermo", kScreenWidth},
    {"altezza_schermo", kScreenHeight},
    {"nero", 0x0000},
    {"bianco", 0xFFFF},
    {"rosso", 0xF800},
    {"verde", 0x07E0},
    {"blu", 0x001F},
    {"giallo", 0xFFE0},
    {"arancio", 0xFD20},
    {"azzurro", 0x05FF},
    {"viola", 0x901F},
    {"rosa", 0xFC18},
    {"grigio", 0x8410},
    {"marrone", 0x9240},
    {"pi_greco", 3.141592653589793},
};

// Lettere maiuscole e minuscole, comprese quelle accentate dell'italiano e delle lingue vicine.
uint32_t to_upper(uint32_t cp) {
    if (cp >= 'a' && cp <= 'z') return cp - 32;
    if (cp >= 0xE0 && cp <= 0xFE && cp != 0xF7) return cp - 32;
    return cp;
}
uint32_t to_lower(uint32_t cp) {
    if (cp >= 'A' && cp <= 'Z') return cp + 32;
    if (cp >= 0xC0 && cp <= 0xDE && cp != 0xD7) return cp + 32;
    return cp;
}

// Nome di un file dei dati: lettere minuscole, cifre, _ - e punto; da 1 a 24 caratteri, non comincia con un punto.
bool data_file_name(const std::string& in, std::string& out) {
    out.clear();
    if (in.empty() || in.size() > 24 || in[0] == '.') return false;
    for (char c : in) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        const bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.';
        if (!ok) return false;
        out += c;
    }
    return true;
}

}  // namespace

const NativeInfo* native_table(size_t& count) {
    count = kNativeCount;
    return kNatives;
}

int find_native(const std::string& name) {
    for (int i = 0; i < kNativeCount; ++i)
        if (name == kNatives[i].name) return i;
    return -1;
}

const NamedConstant* constant_table(size_t& count) {
    count = sizeof(kConstants) / sizeof(kConstants[0]);
    return kConstants;
}

// ---------------------------------------------------------------- controllo dei valori ricevuti

void Vm::native_fail(const std::string& message) { fail(std::string("«") + native_name_ + "»: " + message); }

bool Vm::arg_number(const Value& v, const char* what, double& out) {
    if (v.type != Type::Number) {
        native_fail(std::string(what) + " dev'essere un numero, ho trovato " + type_name(v));
        return false;
    }
    out = v.n;
    return true;
}

bool Vm::arg_int(const Value& v, const char* what, double lo, double hi, int32_t& out) {
    double n = 0;
    if (!arg_number(v, what, n)) return false;
    n = n < 0 ? -std::floor(-n + 0.5) : std::floor(n + 0.5);
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    out = static_cast<int32_t>(n);
    return true;
}

bool Vm::arg_coord(const Value& v, int16_t& out) {
    int32_t n = 0;
    if (!arg_int(v, "ogni misura", -32000, 32000, n)) return false;
    out = static_cast<int16_t>(n);
    return true;
}

bool Vm::arg_color(const Value& v, uint16_t& out) {
    if (v.type != Type::Number || v.n < 0 || v.n > 65535 || std::floor(v.n) != v.n) {
        native_fail("il colore non è valido: usa un colore pronto (ROSSO, BLU, …) oppure colore(rosso, verde, blu)");
        return false;
    }
    out = static_cast<uint16_t>(v.n);
    return true;
}

bool Vm::arg_text(const Value& v, const char* what, std::string& out) {
    if (v.type != Type::Text) {
        native_fail(std::string(what) + " dev'essere un testo, ho trovato " + type_name(v));
        return false;
    }
    out = text_of(v);
    return true;
}

bool Vm::arg_list(const Value& v, const char* what, uint32_t& ref) {
    if (v.type != Type::List || v.ref >= objects_.size() || objects_[v.ref].kind != kObjectList) {
        native_fail(std::string(what) + " dev'essere una lista, ho trovato " + type_name(v));
        return false;
    }
    ref = v.ref;
    return true;
}

uint32_t Vm::random_u32() {  // xorshift32: la stessa sequenza dappertutto, dato lo stesso seme
    rng_ ^= rng_ << 13;
    rng_ ^= rng_ >> 17;
    rng_ ^= rng_ << 5;
    return rng_;
}

void Vm::do_native(uint8_t id, uint8_t argc) {
    if (id >= kNativeCount || argc < kNatives[id].min_args || argc > kNatives[id].max_args || !need(argc)) {
        fail(kBroken);
        return;
    }
    native_name_ = kNatives[id].name;
    Value result;
    // Gli argomenti restano sulla pila per tutta la funzione: così la pulizia della memoria non li tocca.
    native(id, argc, stack_.data() + (sp_ - argc), result);
    temp_roots_.clear();
    if (state_ == State::Failed) return;
    sp_ -= argc;
    if (state_ != State::WaitKey && state_ != State::WaitText) push(result);  // quelle due danno il valore alla ripresa
}

void Vm::native(uint8_t id, uint8_t argc, const Value* args, Value& result) {
    switch (id) {
        // -------------------------------------------------------- schermo
        case kPulisci: {
            DrawCommand d;
            d.op = DrawOp::Clear;
            if (argc == 1 && !arg_color(args[0], d.color)) return;
            host_.draw(d);
            return;
        }
        case kPunto: {
            DrawCommand d;
            d.op = DrawOp::Pixel;
            if (arg_coord(args[0], d.a) && arg_coord(args[1], d.b) && arg_color(args[2], d.color)) host_.draw(d);
            return;
        }
        case kLinea:
        case kRettangolo:
        case kCornice: {
            DrawCommand d;
            d.op = id == kLinea ? DrawOp::Line : id == kRettangolo ? DrawOp::Rect : DrawOp::Frame;
            if (arg_coord(args[0], d.a) && arg_coord(args[1], d.b) && arg_coord(args[2], d.c) && arg_coord(args[3], d.d) &&
                arg_color(args[4], d.color))
                host_.draw(d);
            return;
        }
        case kCerchio:
        case kAnello: {
            DrawCommand d;
            d.op = id == kCerchio ? DrawOp::Circle : DrawOp::Ring;
            if (arg_coord(args[0], d.a) && arg_coord(args[1], d.b) && arg_coord(args[2], d.c) && arg_color(args[3], d.color))
                host_.draw(d);
            return;
        }
        case kScritta: {
            DrawCommand d;
            d.op = DrawOp::Text;
            int32_t size = 1;
            if (!arg_coord(args[0], d.a) || !arg_coord(args[1], d.b) || !arg_color(args[3], d.color)) return;
            if (argc == 5 && !arg_int(args[4], "la grandezza", 1, 4, size)) return;
            d.size = static_cast<uint8_t>(size);
            const std::string text = to_text(args[2], false, 0);
            d.text = &text;
            host_.draw(d);
            return;
        }
        case kMostra: {
            DrawCommand d;
            d.op = DrawOp::Show;
            host_.draw(d);
            yield_ = true;  // un fotogramma è pronto: si lascia respirare chi ospita il programma
            return;
        }
        case kColore: {
            int32_t r = 0, g = 0, b = 0;
            if (arg_int(args[0], "il rosso", 0, 255, r) && arg_int(args[1], "il verde", 0, 255, g) &&
                arg_int(args[2], "il blu", 0, 255, b))
                result = make_number(rgb565(r, g, b));
            return;
        }
        case kScrivi: {
            std::string line;
            for (uint8_t i = 0; i < argc; ++i) {
                if (i != 0) line += ' ';
                line += to_text(args[i], false, 0);
                if (line.size() > limits_.max_text) break;
            }
            if (line.size() > limits_.max_text) {
                native_fail("il testo da scrivere è troppo lungo");
                return;
            }
            host_.print(line);
            return;
        }

        // -------------------------------------------------------- tasti
        case kTasto: {
            std::string key;
            if (host_.next_key(key) && !key.empty() && key.size() <= 16 && utf8_valid(key)) new_text(std::move(key), result);
            return;
        }
        case kPremuto: {
            std::string name, plain;
            if (!arg_text(args[0], "il nome del tasto", name)) return;
            if (normalize_name(name, plain)) name = plain;  // "Su", "giù" -> "su", "giu"
            result = make_bool(host_.key_down(name));
            return;
        }
        case kAspettaTasto: state_ = State::WaitKey; return;
        case kChiedi:
            question_ = argc == 1 ? to_text(args[0], false, 0) : std::string();
            state_ = State::WaitText;
            return;

        // -------------------------------------------------------- suoni e tempo
        case kSuona: {
            int32_t hz = 0, ms = 0;
            if (arg_int(args[0], "la nota (in hertz)", 0, 20000, hz) && arg_int(args[1], "la durata", 0, 5000, ms))
                host_.tone(static_cast<uint32_t>(hz), static_cast<uint32_t>(ms));
            return;
        }
        case kAspetta: {
            int32_t ms = 0;
            if (!arg_int(args[0], "il tempo (in millisecondi)", 0, 3600000, ms)) return;
            sleep_start_ = host_.now_ms();
            sleep_ms_ = static_cast<uint32_t>(ms);
            state_ = State::Sleeping;
            return;
        }
        case kTempo: result = make_number(static_cast<double>(static_cast<uint32_t>(host_.now_ms() - start_ms_))); return;

        // -------------------------------------------------------- numeri
        case kCasuale: {
            if (argc == 0) {
                result = make_number(static_cast<double>(random_u32()) / 4294967296.0);
                return;
            }
            double lo = 1, hi = 0;
            if (argc == 1) {
                if (!arg_number(args[0], "il valore", hi)) return;
            } else if (!arg_number(args[0], "il primo valore", lo) || !arg_number(args[1], "il secondo valore", hi)) {
                return;
            }
            lo = std::floor(lo + 0.5);
            hi = std::floor(hi + 0.5);
            if (lo > hi) std::swap(lo, hi);
            const double span = hi - lo + 1;
            if (span > 4294967296.0) {
                native_fail("i due numeri sono troppo lontani tra loro");
                return;
            }
            const auto offset = static_cast<uint64_t>(random_u32()) % static_cast<uint64_t>(span);
            result = make_number(lo + static_cast<double>(offset));
            return;
        }
        case kSeme: {
            double n = 0;
            if (!arg_number(args[0], "il seme", n)) return;
            const double m = std::fmod(std::floor(n < 0 ? -n : n), 4294967296.0);
            rng_ = static_cast<uint32_t>(m);
            if (rng_ == 0) rng_ = 1;
            return;
        }
        case kIntero:
        case kArrotonda:
        case kAssoluto:
        case kRadice:
        case kSeno:
        case kCoseno: {
            double n = 0;
            if (!arg_number(args[0], "il valore", n)) return;
            switch (id) {
                case kIntero: n = std::trunc(n); break;
                case kArrotonda: n = n < 0 ? -std::floor(-n + 0.5) : std::floor(n + 0.5); break;
                case kAssoluto: n = n < 0 ? -n : n; break;
                case kRadice:
                    if (n < 0) {
                        native_fail("non esiste la radice di un numero negativo");
                        return;
                    }
                    n = std::sqrt(n);
                    break;
                case kSeno: n = sin_degrees(n); break;
                default: n = cos_degrees(n); break;
            }
            result = make_number(n);
            return;
        }
        case kMinimo:
        case kMassimo: {
            const Value* values = args;
            size_t count = argc;
            if (argc == 1 && args[0].type == Type::List && args[0].ref < objects_.size()) {
                values = objects_[args[0].ref].items.data();
                count = objects_[args[0].ref].items.size();
                if (count == 0) {
                    native_fail("la lista è vuota");
                    return;
                }
            }
            double best = 0;
            for (size_t i = 0; i < count; ++i) {
                double n = 0;
                if (!arg_number(values[i], "ogni valore", n)) return;
                if (i == 0 || (id == kMinimo ? n < best : n > best)) best = n;
            }
            result = make_number(best);
            return;
        }
        case kNumero: {
            double n = 0;
            if (args[0].type == Type::Number) result = args[0];
            else if (args[0].type == Type::Text && parse_number(text_of(args[0]), true, n)) result = make_number(n);
            return;  // altrimenti: niente
        }
        case kTesto: new_text(to_text(args[0], false, 0), result); return;
        case kTipo: {
            const char* name = "niente";
            switch (args[0].type) {
                case Type::Bool: name = "vero/falso"; break;
                case Type::Number: name = "numero"; break;
                case Type::Text: name = "testo"; break;
                case Type::List: name = "lista"; break;
                default: break;
            }
            new_text(name, result);
            return;
        }

        // -------------------------------------------------------- testi e liste
        case kLunghezza:
            if (args[0].type == Type::Text) result = make_number(static_cast<double>(utf8_length(text_of(args[0]))));
            else if (args[0].type == Type::List && args[0].ref < objects_.size())
                result = make_number(static_cast<double>(objects_[args[0].ref].items.size()));
            else native_fail(std::string("misura testi e liste, non ") + type_name(args[0]));
            return;
        case kParte: {
            std::string text;
            int32_t from = 1, count = 0;
            if (!arg_text(args[0], "il primo valore", text) || !arg_int(args[1], "la posizione", 1, 1000000, from)) return;
            count = static_cast<int32_t>(limits_.max_text);
            if (argc == 3 && !arg_int(args[2], "il numero di lettere", 0, 1000000, count)) return;
            size_t at = 0;
            uint32_t cp = 0;
            for (int32_t i = 1; i < from && at < text.size(); ++i) utf8_next(text, at, cp);
            size_t end = at;
            for (int32_t i = 0; i < count && end < text.size(); ++i) utf8_next(text, end, cp);
            new_text(text.substr(at, end - at), result);
            return;
        }
        case kTrova: {
            if (args[0].type == Type::Text) {
                std::string what;
                if (!arg_text(args[1], "ciò che cerchi in un testo", what)) return;
                const std::string& text = text_of(args[0]);
                const size_t at = what.empty() ? std::string::npos : text.find(what);
                result = make_number(at == std::string::npos ? 0.0 : static_cast<double>(utf8_length(text.substr(0, at)) + 1));
                return;
            }
            uint32_t ref = 0;
            if (!arg_list(args[0], "il primo valore", ref)) return;
            const std::vector<Value>& items = objects_[ref].items;
            double found = 0;
            for (size_t i = 0; i < items.size(); ++i) {
                if (equal(items[i], args[1], 0)) {
                    found = static_cast<double>(i + 1);
                    break;
                }
            }
            result = make_number(found);
            return;
        }
        case kMaiuscolo:
        case kMinuscolo: {
            std::string text, out;
            if (!arg_text(args[0], "il valore", text)) return;
            size_t i = 0;
            uint32_t cp = 0;
            while (i < text.size()) {
                utf8_next(text, i, cp);
                utf8_append(out, id == kMaiuscolo ? to_upper(cp) : to_lower(cp));
            }
            new_text(std::move(out), result);
            return;
        }
        case kAggiungi: {
            uint32_t ref = 0;
            if (arg_list(args[0], "il primo valore", ref)) list_append(ref, args[1]);
            return;
        }
        case kTogli: {
            uint32_t ref = 0;
            if (!arg_list(args[0], "il primo valore", ref)) return;
            std::vector<Value>& items = objects_[ref].items;
            size_t index = items.empty() ? 0 : items.size() - 1;  // senza posizione: l'ultimo
            if (argc == 2 || items.empty()) {
                Value last = make_number(static_cast<double>(items.size()));
                if (!arg_position(argc == 2 ? args[1] : last, items.size(), false, index)) return;
            }
            result = items[index];
            items.erase(items.begin() + static_cast<std::ptrdiff_t>(index));
            release_heap(kValueBytes);
            return;
        }
        case kInserisci: {
            uint32_t ref = 0;
            size_t index = 0;
            if (!arg_list(args[0], "il primo valore", ref) || !arg_position(args[1], objects_[ref].items.size(), true, index)) return;
            if (!list_append(ref, args[2])) return;  // in fondo, poi si sposta al suo posto
            std::vector<Value>& items = objects_[ref].items;
            std::rotate(items.begin() + static_cast<std::ptrdiff_t>(index), items.end() - 1, items.end());
            return;
        }
        case kLista: {
            int32_t count = 0;
            if (!arg_int(args[0], "il numero di elementi", 0, 1000000, count)) return;
            if (!new_list(static_cast<size_t>(count), result)) return;
            if (argc == 2)
                for (Value& item : objects_[result.ref].items) item = args[1];
            return;
        }
        case kUnisci: {
            uint32_t ref = 0;
            std::string separator, out;
            if (!arg_list(args[0], "il primo valore", ref)) return;
            if (argc == 2 && !arg_text(args[1], "il separatore", separator)) return;
            const std::vector<Value>& items = objects_[ref].items;
            for (size_t i = 0; i < items.size(); ++i) {
                if (i != 0) out += separator;
                out += to_text(items[i], false, 0);
                if (out.size() > limits_.max_text) break;
            }
            new_text(std::move(out), result);
            return;
        }
        case kDividi: {
            std::string text, separator;
            if (!arg_text(args[0], "il primo valore", text) || !arg_text(args[1], "il separatore", separator)) return;
            if (!new_list(0, result)) return;
            temp_roots_.push_back(result);
            size_t at = 0;
            for (;;) {
                size_t end = 0;
                if (separator.empty()) {  // senza separatore: una lettera per volta
                    if (at >= text.size()) break;
                    end = at;
                    uint32_t cp = 0;
                    utf8_next(text, end, cp);
                } else {
                    end = text.find(separator, at);
                    if (end == std::string::npos) end = text.size();
                }
                Value piece;
                if (!new_text(text.substr(at, end - at), piece) || !list_append(result.ref, piece)) return;
                if (separator.empty()) {
                    at = end;
                } else {
                    if (end >= text.size()) break;
                    at = end + separator.size();
                }
            }
            return;
        }
        case kOrdina: {
            uint32_t ref = 0;
            if (!arg_list(args[0], "il valore", ref)) return;
            std::vector<Value>& items = objects_[ref].items;
            if (items.empty()) return;
            const Type type = items[0].type;
            for (const Value& v : items) {
                if (v.type != type || (type != Type::Number && type != Type::Text)) {
                    native_fail("si possono mettere in ordine solo liste di soli numeri o di soli testi");
                    return;
                }
            }
            if (type == Type::Number) {
                std::stable_sort(items.begin(), items.end(), [](const Value& a, const Value& b) { return a.n < b.n; });
            } else {
                std::stable_sort(items.begin(), items.end(),
                                 [this](const Value& a, const Value& b) { return text_of(a) < text_of(b); });
            }
            return;
        }

        // -------------------------------------------------------- file e programma
        case kSalva:
        case kCarica: {
            std::string given, name;
            if (!arg_text(args[0], "il nome del file", given)) return;
            if (!data_file_name(given, name)) {
                native_fail("il nome del file può avere solo lettere, cifre, «_», «-» e «.», al massimo 24 caratteri");
                return;
            }
            if (id == kSalva) {
                result = make_bool(host_.file_write(name, to_text(args[1], false, 0)));
                return;
            }
            std::string data;
            if (host_.file_read(name, data) && data.size() <= limits_.max_text && utf8_valid(data) &&
                data.find('\0') == std::string::npos)
                new_text(std::move(data), result);
            return;  // se il file non c'è (o non è un testo): niente
        }
        case kTermina: state_ = State::Done; return;
        default: fail(kBroken); return;
    }
}

}  // namespace script
}  // namespace polpo
