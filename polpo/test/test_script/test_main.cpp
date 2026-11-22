// Test di PolpoScript: la raccolta di programmi con il risultato atteso (test/script), i numeri, i limiti di
// memoria, l'esecuzione passo passo e le prove con programmi casuali o rovinati, che non devono mai mettere in
// difficoltà la macchina virtuale (i test girano con AddressSanitizer e UBSan).
//
// Per rigenerare i risultati attesi dopo una modifica voluta:  POLPO_AGGIORNA=1 pio test -e native -f test_script
// (e poi rileggere con attenzione le differenze prima di salvarle).
#include <unity.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "polpo/script/script.h"
#include "polpo/script/transcript.h"

using namespace polpo::script;

void setUp() {}
void tearDown() {}

namespace {

const char* const kCorpus[] = {
    "01_numeri", "02_testi", "03_liste", "04_condizioni", "05_cicli", "06_funzioni",
    "07_schermo", "08_tasti_tempo", "09_errori_esecuzione", "10_errori_scrittura",
};

std::string corpus_path(const std::string& name) {
    for (const char* dir : {"test/script/", "../test/script/", "polpo/test/script/"}) {
        std::ifstream f(std::string(dir) + name);
        if (f) return std::string(dir) + name;
    }
    return "";
}

bool read_file(const std::string& path, std::string& out) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    std::stringstream ss;
    ss << f.rdbuf();
    out = ss.str();
    return true;
}

// Un collegamento con il mondo che non fa niente, con un orologio che avanza da solo.
class QuietHost : public Host {
   public:
    uint32_t now_ms() override { return clock += 7; }
    void draw(const DrawCommand&) override { ++draws; }
    void print(const std::string& line) override { last = line; ++prints; }
    bool key_down(const std::string&) override { return (clock & 8) != 0; }
    bool next_key(std::string& name) override {
        if ((++polls % 3) != 0) return false;
        name = "ok";
        return true;
    }
    void tone(uint32_t, uint32_t) override {}
    bool file_read(const std::string&, std::string& out) override {
        out = "12";
        return true;
    }
    bool file_write(const std::string&, const std::string&) override { return true; }
    uint32_t clock = 0;
    unsigned draws = 0, prints = 0, polls = 0;
    std::string last;
};

// Esegue fino alla fine (o a un massimo di istruzioni) rispondendo a tutte le attese.
State run_all(Vm& vm, uint64_t max_instructions) {
    for (int rounds = 0; rounds < 100000; ++rounds) {
        if (vm.instructions() >= max_instructions) return vm.state();
        const State s = vm.run(2000);
        if (s == State::Done || s == State::Failed) return s;
        if (s == State::WaitText) vm.answer("7");
        if (s == State::Paused) vm.resume();
    }
    return vm.state();
}

// Le prove casuali si possono allungare a piacere:  POLPO_PROVE_CASUALI=200000 POLPO_SEME=5 pio test …
int fuzz_rounds() {
    const char* v = std::getenv("POLPO_PROVE_CASUALI");
    const int n = v ? std::atoi(v) : 0;
    return n > 0 ? n : 6000;
}
uint32_t fuzz_seed(uint32_t standard) {
    const char* v = std::getenv("POLPO_SEME");
    const int n = v ? std::atoi(v) : 0;
    return n > 0 ? static_cast<uint32_t>(n) * 2654435761u + 1 : standard;
}

struct Rng {
    uint32_t s;
    uint32_t next() {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        return s;
    }
    uint32_t below(uint32_t n) { return next() % n; }
};

}  // namespace

// ---------------------------------------------------------------- raccolta di programmi

void test_corpus() {
    const bool update = std::getenv("POLPO_AGGIORNA") != nullptr;
    for (const char* name : kCorpus) {
        const std::string path = corpus_path(std::string(name) + ".polpo");
        TEST_ASSERT_TRUE_MESSAGE(!path.empty(), name);
        std::string source, expected;
        TEST_ASSERT_TRUE(read_file(path, source));
        const std::string got = run_transcript_file(source);
        const std::string expected_path = path.substr(0, path.size() - 6) + ".atteso";
        if (update) {
            std::ofstream out(expected_path, std::ios::binary);
            out << got;
            continue;
        }
        TEST_ASSERT_TRUE_MESSAGE(read_file(expected_path, expected), expected_path.c_str());
        if (got != expected) {
            // si mostra la prima riga diversa: è più utile di due testi lunghissimi
            size_t line = 1, at = 0;
            while (at < got.size() && at < expected.size() && got[at] == expected[at]) {
                if (got[at] == '\n') ++line;
                ++at;
            }
            const size_t from = got.rfind('\n', at == 0 ? 0 : at - 1);
            const size_t start = from == std::string::npos ? 0 : from + 1;
            const std::string message = std::string(name) + ".atteso, riga " + std::to_string(line) + ": ottenuto «" +
                                        got.substr(start, got.find('\n', start) - start) + "»";
            TEST_FAIL_MESSAGE(message.c_str());
        }
    }
}

// Le mini-app di esempio che finiscono sulla microSD (sd_template/polpo/script): devono funzionare davvero.
void test_examples() {
    std::string answers = "#! risposte:";
    for (int i = 1; i <= 100; ++i) answers += (i == 1 ? " " : " | ") + std::to_string(i);
    struct Example {
        const char* name;
        std::string setup;
    };
    const Example examples[] = {
        {"pallina", "#! tasti: destra destra su giu sinistra\n#! limite: 6000\n"},
        {"indovina", answers + "\n#! seme: 3\n"},
        {"dado", "#! tasti: ok a ok\n#! seme: 5\n"},
        {"serpente", "#! tasti: su sinistra giu destra su\n#! limite: 12000\n#! seme: 9\n"},
    };
    const bool update = std::getenv("POLPO_AGGIORNA") != nullptr;
    for (const Example& ex : examples) {
        std::string source, expected;
        bool found = false;
        for (const char* dir : {"sd_template/polpo/script/", "../sd_template/polpo/script/", "polpo/sd_template/polpo/script/"})
            if (!found) found = read_file(std::string(dir) + ex.name + ".polpo", source);
        TEST_ASSERT_TRUE_MESSAGE(found, ex.name);
        Program p;
        Error e;
        TEST_ASSERT_TRUE_MESSAGE(compile(source, Limits(), p, e), (std::string(ex.name) + ": " + e.text()).c_str());
        const std::string got = run_transcript(ex.setup + source);
        TEST_ASSERT_TRUE_MESSAGE(got.find("errore") == std::string::npos, (std::string(ex.name) + ":\n" + got.substr(got.size() > 300 ? got.size() - 300 : 0)).c_str());
        const std::string expected_path = corpus_path("01_numeri.polpo").substr(0, corpus_path("01_numeri.polpo").size() - 15) + "esempio_" + ex.name + ".atteso";
        if (update) {
            std::ofstream out(expected_path, std::ios::binary);
            out << got;
            continue;
        }
        TEST_ASSERT_TRUE_MESSAGE(read_file(expected_path, expected), expected_path.c_str());
        TEST_ASSERT_TRUE_MESSAGE(got == expected, (std::string("esempio_") + ex.name + ".atteso non corrisponde").c_str());
    }
}

// Gli esempi del manuale del linguaggio devono essere programmi validi: il manuale non può restare indietro.
void test_manual_examples() {
    std::string manual;
    bool found = false;
    for (const char* path : {"docs/POLPOSCRIPT.md", "../docs/POLPOSCRIPT.md", "polpo/docs/POLPOSCRIPT.md"})
        if (!found) found = read_file(path, manual);
    TEST_ASSERT_TRUE_MESSAGE(found, "docs/POLPOSCRIPT.md non trovato");
    int examples = 0;
    size_t at = 0;
    for (;;) {
        const size_t open = manual.find("```\n", at);
        if (open == std::string::npos) break;
        const size_t close = manual.find("\n```", open + 4);
        TEST_ASSERT_TRUE(close != std::string::npos);
        const std::string code = manual.substr(open + 4, close - open - 3);
        at = close + 4;
        if (code.compare(0, 5, "Riga ") == 0) continue;  // l'elenco dei messaggi d'errore
        Program p;
        Error e;
        const std::string message = e.text() + " in:\n" + code;
        TEST_ASSERT_TRUE_MESSAGE(compile(code, Limits(), p, e), (e.text() + " nell'esempio:\n" + code).c_str());
        ++examples;
    }
    TEST_ASSERT_TRUE(examples >= 7);
    // la tabella dei limiti del manuale corrisponde ai limiti veri
    const Limits limits;
    TEST_ASSERT_EQUAL(16 * 1024, limits.max_source);
    TEST_ASSERT_EQUAL(128, limits.max_globals);
    TEST_ASSERT_EQUAL(2048, limits.max_text);
    TEST_ASSERT_EQUAL(1024, limits.max_list);
    TEST_ASSERT_EQUAL(32 * 1024, limits.max_heap);
    TEST_ASSERT_EQUAL(32, limits.max_frames);  // il programma principale più 31 funzioni una dentro l'altra
    // ogni funzione pronta è spiegata nel manuale
    size_t count = 0;
    const NativeInfo* table = native_table(count);
    for (size_t i = 0; i < count; ++i)
        TEST_ASSERT_TRUE_MESSAGE(manual.find(std::string("`") + table[i].name + "(") != std::string::npos, table[i].name);
}

// Lo stesso programma, eseguito due volte, fa esattamente le stesse cose con lo stesso numero di istruzioni.
void test_deterministic() {
    for (const char* name : kCorpus) {
        std::string source;
        TEST_ASSERT_TRUE(read_file(corpus_path(std::string(name) + ".polpo"), source));
        TEST_ASSERT_EQUAL_STRING(run_transcript_file(source).c_str(), run_transcript_file(source).c_str());
    }
    const std::string source = "l = []\nripeti 300 volte\n aggiungi(l, \"n\" + casuale(1, 99))\n se lunghezza(l) > 20 allora l = []\nfine\n";
    Program p;
    Error e;
    TEST_ASSERT_TRUE(compile(source, Limits(), p, e));
    uint64_t counts[2] = {0, 0};
    size_t heaps[2] = {0, 0};
    for (int i = 0; i < 2; ++i) {
        QuietHost host;
        Vm vm(p, host);
        vm.start(5);
        TEST_ASSERT_EQUAL(static_cast<int>(State::Done), static_cast<int>(run_all(vm, 1000000)));
        counts[i] = vm.instructions();
        heaps[i] = vm.heap_used();
    }
    TEST_ASSERT_TRUE(counts[0] == counts[1] && heaps[0] == heaps[1]);
}

// ---------------------------------------------------------------- numeri

void test_format_number() {
    struct Case {
        double v;
        const char* text;
    };
    const Case cases[] = {
        {0, "0"},          {-0.0, "0"},           {1, "1"},              {-1, "-1"},
        {0.5, "0.5"},      {-0.25, "-0.25"},      {1e-7, "0"},           {-1e-7, "0"},
        {0.1 + 0.2, "0.3"}, {1.0 / 3, "0.333333"}, {2.0 / 3, "0.666667"}, {123456.789, "123456.789"},
        {1e9, "1000000000"}, {1e15, "1000000000000000"}, {9007199254740992.0, "9007199254740992"},
        {1e18, "1000000000000000000"}, {1e19, "1e+19"}, {1.5e20, "1.5e+20"}, {1.23456789e30, "1.23457e+30"},
        {1234567890.125, "1234567890.125"}, {999999999.9999999, "1000000000"}, {0.999999999, "1"},
        {4294967296.0, "4294967296"},
    };
    for (const Case& c : cases) TEST_ASSERT_EQUAL_STRING(c.text, format_number(c.v).c_str());
}

void test_parse_number() {
    double v = 0;
    TEST_ASSERT_TRUE(parse_number("42", false, v));
    TEST_ASSERT_TRUE(v == 42);
    TEST_ASSERT_TRUE(parse_number("  -3.25 ", false, v));
    TEST_ASSERT_TRUE(v == -3.25);
    TEST_ASSERT_TRUE(parse_number("0.1", false, v));
    TEST_ASSERT_TRUE(v == 0.1);  // arrotondato come farebbe il compilatore C++
    TEST_ASSERT_TRUE(parse_number("123456.789", false, v));
    TEST_ASSERT_TRUE(v == 123456.789);
    TEST_ASSERT_TRUE(parse_number("3,5", true, v));
    TEST_ASSERT_TRUE(v == 3.5);
    TEST_ASSERT_FALSE(parse_number("3,5", false, v));
    TEST_ASSERT_TRUE(parse_number("000012", false, v));
    TEST_ASSERT_TRUE(v == 12);
    TEST_ASSERT_TRUE(parse_number("9007199254740992", false, v));  // 2^53: l'ultimo numero intero sempre esatto
    TEST_ASSERT_TRUE(v == 9007199254740992.0);
    TEST_ASSERT_TRUE(parse_number("1000000000000000", false, v));
    TEST_ASSERT_TRUE(v == 1e15);
    TEST_ASSERT_TRUE(parse_number("0.000001", false, v));
    TEST_ASSERT_TRUE(v == 0.000001);
    TEST_ASSERT_TRUE(parse_number("-0", false, v));
    TEST_ASSERT_TRUE(v == 0 && !std::signbit(v));
    for (const char* bad : {"", " ", "-", ".", "1.2.3", "12a", "a12", "1e5", "1 2", "--1", "12345678901234567", "9007199254740993", "+", "0x10",
                            "0.00000000000000000000001"})
        TEST_ASSERT_FALSE_MESSAGE(parse_number(bad, true, v), bad);
}

void test_trigonometry() {
    TEST_ASSERT_TRUE(sin_degrees(0) == 0);
    TEST_ASSERT_TRUE(sin_degrees(90) == 1);
    TEST_ASSERT_TRUE(sin_degrees(180) == 0);
    TEST_ASSERT_TRUE(sin_degrees(270) == -1);
    TEST_ASSERT_TRUE(cos_degrees(0) == 1);
    TEST_ASSERT_TRUE(cos_degrees(90) == 0);
    TEST_ASSERT_TRUE(cos_degrees(180) == -1);
    TEST_ASSERT_TRUE(sin_degrees(-90) == -1);
    TEST_ASSERT_TRUE(sin_degrees(360 * 1000.0 + 90) == 1);
    // contro i valori veri, su tutto il giro
    const double pi = 3.14159265358979323846;
    for (int tenth = -7200; tenth <= 7200; tenth += 7) {
        const double d = tenth / 10.0;
        TEST_ASSERT_TRUE(std::fabs(std::sin(d * pi / 180) - sin_degrees(d)) < 1e-13);
        TEST_ASSERT_TRUE(std::fabs(std::cos(d * pi / 180) - cos_degrees(d)) < 1e-13);
    }
}

void test_names() {
    std::string out;
    TEST_ASSERT_TRUE(normalize_name("Velocità", out));
    TEST_ASSERT_EQUAL_STRING("velocita", out.c_str());
    TEST_ASSERT_TRUE(normalize_name("FINCHÉ", out));
    TEST_ASSERT_EQUAL_STRING("finche", out.c_str());
    TEST_ASSERT_TRUE(normalize_name("punti_2", out));
    TEST_ASSERT_FALSE(normalize_name("2punti", out));
    TEST_ASSERT_FALSE(normalize_name("a-b", out));
    TEST_ASSERT_FALSE(normalize_name("", out));
    TEST_ASSERT_FALSE(normalize_name("\xff", out));
}

// ---------------------------------------------------------------- sicurezza: cosa può fare uno script

// L'elenco delle funzioni pronte è questo e basta. Aggiungerne una vuol dire cambiare questo test: è il momento
// di chiedersi se è una funzione che uno script può avere. Niente che trasmetta, niente tastiera USB, niente rete.
void test_native_allow_list() {
    const char* const allowed[] = {
        "pulisci", "punto", "linea", "rettangolo", "cornice", "cerchio", "anello", "scritta", "mostra", "colore", "scrivi",
        "tasto", "premuto", "aspetta_tasto", "chiedi", "suona", "aspetta", "tempo",
        "casuale", "seme", "intero", "arrotonda", "assoluto", "minimo", "massimo", "radice", "seno", "coseno",
        "numero", "testo", "tipo", "lunghezza", "parte", "trova", "maiuscolo", "minuscolo",
        "aggiungi", "togli", "inserisci", "lista", "unisci", "dividi", "ordina", "salva", "carica", "termina",
    };
    size_t count = 0;
    const NativeInfo* table = native_table(count);
    TEST_ASSERT_EQUAL(sizeof(allowed) / sizeof(allowed[0]), count);
    for (size_t i = 0; i < count; ++i) TEST_ASSERT_EQUAL_STRING(allowed[i], table[i].name);
    for (const char* forbidden : {"trasmetti", "invia", "ir", "infrarossi", "radio", "rf", "nfc", "usb", "tastiera", "digita",
                                  "wifi", "bluetooth", "ble", "rete", "http", "esegui", "sistema", "gpio", "pin"})
        TEST_ASSERT_EQUAL_MESSAGE(-1, find_native(forbidden), forbidden);
}

// I file che uno script può toccare: solo nomi semplici, mai percorsi.
void test_file_names() {
    for (const char* bad : {"../x", "/x", "a/b", "a\\\\b", ".nascosto", "", "nome con spazi", "abcdefghijklmnopqrstuvwxy", "è.txt", "a:b"}) {
        const std::string source = std::string("salva(\"") + bad + "\", 1)\n";
        const std::string out = run_transcript(source);
        TEST_ASSERT_TRUE_MESSAGE(out.find("salva:") == std::string::npos, bad);
        TEST_ASSERT_TRUE_MESSAGE(out.find("errore") != std::string::npos, bad);
    }
    TEST_ASSERT_TRUE(run_transcript("salva(\"Record-1_a.txt\", 1)\n").find("salva: record-1_a.txt = 1") != std::string::npos);
}

// ---------------------------------------------------------------- limiti

void test_never_blocks() {
    Program p;
    Error e;
    TEST_ASSERT_TRUE(compile("ripeti sempre\nfine\n", Limits(), p, e));
    QuietHost host;
    Vm vm(p, host);
    vm.start();
    TEST_ASSERT_EQUAL(static_cast<int>(State::Running), static_cast<int>(vm.run(1000)));
    TEST_ASSERT_TRUE(vm.instructions() <= 1000);
    TEST_ASSERT_EQUAL(static_cast<int>(State::Running), static_cast<int>(vm.run(1000)));
    vm.stop();
    TEST_ASSERT_EQUAL(static_cast<int>(State::Done), static_cast<int>(vm.run(1000)));
    TEST_ASSERT_TRUE(vm.stopped());
    // ripartire da capo funziona
    vm.start();
    TEST_ASSERT_EQUAL(static_cast<int>(State::Running), static_cast<int>(vm.run(10)));
}

void test_waiting_states() {
    Program p;
    Error e;
    TEST_ASSERT_TRUE(compile("aspetta(50)\nt = aspetta_tasto()\nn = chiedi(\"quanti?\")\nscrivi(t, n)\nmostra()\nscrivi(\"dopo\")\n", Limits(), p, e));
    QuietHost host;
    Vm vm(p, host);
    vm.start();
    TEST_ASSERT_EQUAL(static_cast<int>(State::Sleeping), static_cast<int>(vm.run(1000)));
    TEST_ASSERT_TRUE(vm.sleep_left_ms() <= 50);
    int guard = 0;
    while (vm.run(1000) == State::Sleeping) TEST_ASSERT_TRUE(++guard < 100);
    guard = 0;
    while (vm.state() == State::WaitKey) {
        vm.run(1000);
        TEST_ASSERT_TRUE(++guard < 100);
    }
    TEST_ASSERT_EQUAL(static_cast<int>(State::WaitText), static_cast<int>(vm.state()));
    TEST_ASSERT_EQUAL_STRING("quanti?", vm.question().c_str());
    TEST_ASSERT_EQUAL(static_cast<int>(State::WaitText), static_cast<int>(vm.run(1000)));  // senza risposta resta lì
    vm.answer("tre");
    // mostra() chiude il giro: «dopo» arriva solo al giro successivo
    TEST_ASSERT_EQUAL(static_cast<int>(State::Running), static_cast<int>(vm.run(1000)));
    TEST_ASSERT_EQUAL_STRING("ok tre", host.last.c_str());
    TEST_ASSERT_EQUAL(static_cast<int>(State::Done), static_cast<int>(vm.run(1000)));
    TEST_ASSERT_EQUAL_STRING("dopo", host.last.c_str());
    // una risposta lunghissima o rovinata non fa danni
    vm.start();
    while (vm.state() != State::WaitText) vm.run(1000);
    vm.answer(std::string(5000, 'x') + "\xc3");
    TEST_ASSERT_EQUAL(static_cast<int>(State::Running), static_cast<int>(vm.run(1000)));
    TEST_ASSERT_EQUAL_STRING("ok ", host.last.c_str());
}

void test_tiny_limits() {
    // Con limiti minuscoli ogni programma della raccolta finisce bene o con un errore, mai con un guasto.
    for (size_t heap : {0u, 64u, 400u, 3000u}) {
        for (size_t stack : {0u, 20u, 64u}) {
            Limits limits;
            limits.max_heap = heap;
            limits.max_stack = stack;
            limits.max_frames = 4;
            limits.max_text = 40;
            limits.max_list = 8;
            for (const char* name : kCorpus) {
                std::string source;
                TEST_ASSERT_TRUE(read_file(corpus_path(std::string(name) + ".polpo"), source));
                const std::string out = run_transcript_file(source, limits);
                TEST_ASSERT_TRUE(!out.empty());
            }
        }
    }
    Limits limits;
    limits.max_code = 20;
    Program p;
    Error e;
    TEST_ASSERT_FALSE(compile("x = 1\ny = 2\nz = 3\nscrivi(x + y + z)\n", limits, p, e));
    TEST_ASSERT_TRUE(e.message.find("troppo lungo") != std::string::npos);
    limits = Limits();
    limits.max_source = 10;
    TEST_ASSERT_FALSE(compile("scrivi(\"ciao a tutti\")\n", limits, p, e));
    limits = Limits();
    limits.max_globals = 2;
    TEST_ASSERT_FALSE(compile("a = 1\nb = 2\nc = 3\n", limits, p, e));
    TEST_ASSERT_EQUAL(3, e.line);
    limits = Limits();
    limits.max_constants = 1;
    TEST_ASSERT_FALSE(compile("a = 1000\nb = 2000\n", limits, p, e));
}

// La memoria contata non supera mai il limite, e i valori buttati via vengono davvero recuperati.
void test_memory_is_bounded() {
    const std::string source =
        "tutte = []\n"
        "ripeti 400 volte\n"
        "  riga = []\n"
        "  ripeti 10 volte\n"
        "    aggiungi(riga, \"casella \" + casuale(1, 1000))\n"
        "  fine\n"
        "  aggiungi(tutte, riga)\n"
        "  se lunghezza(tutte) > 5 allora togli(tutte, 1)\n"
        "fine\n"
        "scrivi(lunghezza(tutte))\n";
    Limits limits;
    limits.max_heap = 8000;
    Program p;
    Error e;
    TEST_ASSERT_TRUE(compile(source, limits, p, e));
    QuietHost host;
    Vm vm(p, host, limits);
    vm.start();
    size_t worst = 0;
    while (vm.run(50) == State::Running)
        if (vm.heap_used() > worst) worst = vm.heap_used();
    TEST_ASSERT_EQUAL_MESSAGE(static_cast<int>(State::Done), static_cast<int>(vm.state()), vm.error().text().c_str());
    TEST_ASSERT_EQUAL_STRING("5", host.last.c_str());
    TEST_ASSERT_TRUE(worst <= limits.max_heap);
    TEST_ASSERT_TRUE(worst > 2000);  // la prova ha davvero riempito e svuotato la memoria
}

// ---------------------------------------------------------------- passo passo

void test_stepping() {
    const std::string source =
        "funzione doppio(n)\n"      // 1
        "  locale r = n * 2\n"      // 2
        "  ritorna r\n"             // 3
        "fine\n"                    // 4
        "x = 1\n"                   // 5
        "y = doppio(x)\n"           // 6
        "ripeti 3 volte\n"          // 7
        "  x = x + 1\n"             // 8
        "fine\n"                    // 9
        "scrivi(x + y)\n";          // 10
    Program p;
    Error e;
    TEST_ASSERT_TRUE_MESSAGE(compile(source, Limits(), p, e), e.text().c_str());
    QuietHost host;
    Vm vm(p, host);
    auto run_to_pause = [&]() {
        for (int i = 0; i < 1000 && vm.run(100) == State::Running; ++i) {}
        return vm.state();
    };

    // passo dopo passo, entrando nelle funzioni
    vm.start();
    vm.pause();
    TEST_ASSERT_EQUAL(static_cast<int>(State::Paused), static_cast<int>(run_to_pause()));
    const uint16_t into[] = {1, 5, 6, 2, 3, 7, 8, 8, 8, 10};  // dopo «ritorna» si prosegue dalla riga successiva
    for (size_t i = 0; i < sizeof(into) / sizeof(into[0]); ++i) {
        TEST_ASSERT_EQUAL_MESSAGE(into[i], vm.line(), "passo (entra)");
        if (vm.line() == 3) {
            const std::vector<Variable> vars = vm.variables();
            TEST_ASSERT_TRUE(vars.size() >= 3);
            TEST_ASSERT_EQUAL_STRING("n", vars[0].name.c_str());
            TEST_ASSERT_EQUAL_STRING("1", vars[0].value.c_str());
            TEST_ASSERT_TRUE(vars[0].local);
            TEST_ASSERT_EQUAL_STRING("r", vars[1].name.c_str());
            TEST_ASSERT_EQUAL_STRING("2", vars[1].value.c_str());
            TEST_ASSERT_EQUAL_STRING("x", vars[2].name.c_str());
            TEST_ASSERT_FALSE(vars[2].local);
            const std::vector<StackEntry> trace = vm.stack_trace();
            TEST_ASSERT_EQUAL(2, trace.size());
            TEST_ASSERT_EQUAL_STRING("doppio", trace[0].function.c_str());
            TEST_ASSERT_EQUAL(3, trace[0].line);
            TEST_ASSERT_EQUAL_STRING("", trace[1].function.c_str());
            TEST_ASSERT_EQUAL(6, trace[1].line);
        }
        vm.step(StepMode::Into);
        run_to_pause();
    }
    TEST_ASSERT_EQUAL(static_cast<int>(State::Done), static_cast<int>(vm.state()));
    TEST_ASSERT_EQUAL_STRING("6", host.last.c_str());

    // passo dopo passo, senza entrare nelle funzioni
    vm.start();
    vm.pause();
    run_to_pause();
    const uint16_t over[] = {1, 5, 6, 7, 8, 8, 8, 10};
    for (size_t i = 0; i < sizeof(over) / sizeof(over[0]); ++i) {
        TEST_ASSERT_EQUAL_MESSAGE(over[i], vm.line(), "passo (scavalca)");
        vm.step(StepMode::Over);
        run_to_pause();
    }
    TEST_ASSERT_EQUAL(static_cast<int>(State::Done), static_cast<int>(vm.state()));

    // punti di sosta e «esci dalla funzione»
    vm.start();
    vm.set_breakpoints({2, 8});
    TEST_ASSERT_EQUAL(static_cast<int>(State::Paused), static_cast<int>(run_to_pause()));
    TEST_ASSERT_EQUAL(2, vm.line());
    vm.step(StepMode::Out);
    run_to_pause();
    TEST_ASSERT_EQUAL(7, vm.line());  // la riga dopo quella che aveva chiamato la funzione
    vm.resume();
    int stops = 0;
    while (run_to_pause() == State::Paused) {
        TEST_ASSERT_EQUAL(8, vm.line());
        ++stops;
        vm.resume();
    }
    TEST_ASSERT_EQUAL(3, stops);
    TEST_ASSERT_EQUAL(static_cast<int>(State::Done), static_cast<int>(vm.state()));
    vm.set_breakpoints({});

    // in pausa run() non va avanti da solo
    vm.start();
    vm.pause();
    run_to_pause();
    const uint64_t before = vm.instructions();
    TEST_ASSERT_EQUAL(static_cast<int>(State::Paused), static_cast<int>(vm.run(1000)));
    TEST_ASSERT_TRUE(vm.instructions() == before);
}

// ---------------------------------------------------------------- programmi casuali e rovinati

// Pezzi con cui costruire programmi senza senso ma quasi giusti.
const char* const kPieces[] = {
    "se", "allora", "altrimenti", "fine", "ripeti", "sempre", "volte", "finché", "per", "ogni", "passo", "funzione",
    "ritorna", "esci", "continua", "locale", "vero", "falso", "niente", "non", "oppure", "e", "o", "da", "a", "in",
    "x", "y", "lista_mia", "f", "g", "scrivi", "aggiungi", "togli", "lunghezza", "casuale", "testo", "numero", "lista",
    "cerchio", "aspetta", "tasto", "chiedi", "mostra", "parte", "dividi", "unisci", "ordina", "inserisci", "trova",
    "salva", "carica", "ROSSO", "0", "1", "2", "3.5", "1000000", "\"a\"", "\"ciao, mondo\"", "\"\"", "[", "]", "(", ")",
    ",", "+", "-", "*", "/", "%", "=", "==", "!=", "<", "<=", ">", ">=", "+=", "-=", "\n", "\n", "\n", "\n", " ",
    "#", "\"", "'", "@", "\xc3\xa8", "\xff", "[1, 2, 3]", "x = x + 1\n", "f(x)\n", "fine\n", "x[1]", "()",
};

// Programmi scritti bene ma senza senso: valori di ogni tipo mescolati a caso, cicli, funzioni, liste.
struct Generator {
    Rng& rng;
    std::string out;
    int depth = 0;

    const char* var() {
        static const char* const names[] = {"a", "b", "c", "l", "t", "m"};
        return names[rng.below(6)];
    }
    // Quasi sempre un valore del tipo giusto (così i programmi vanno avanti), ogni tanto uno qualsiasi.
    void number(int level) {
        if (level == 0 && rng.below(15) == 0) {
            expr(level + 1);
            return;
        }
        switch (rng.below(level > 3 ? 4 : 9)) {
            case 0: out += std::to_string(rng.below(20)); break;
            case 1: out += std::to_string(rng.below(100)) + "." + std::to_string(rng.below(100)); break;
            case 2:
            case 3: out += "abc"[rng.below(3)]; break;
            case 4:
            case 5: {
                static const char* const ops[] = {" + ", " - ", " * ", " / (1 + ", " % 7 + "};
                const uint32_t op = rng.below(5);
                out += "(";
                number(level + 1);
                out += ops[op];
                number(level + 1);
                out += op == 3 ? "))" : ")";
                break;
            }
            case 6: {
                static const char* const one[] = {"intero", "assoluto", "arrotonda", "seno", "coseno", "lunghezza(l) + ", "casuale(1, 6) + "};
                const uint32_t f = rng.below(7);
                out += one[f];
                out += f < 5 ? "(" : "";
                number(level + 1);
                out += f < 5 ? ")" : "";
                break;
            }
            case 7: out += "lunghezza(t)"; break;
            default: out += "doppia(" + std::to_string(rng.below(9)) + ", " + std::to_string(rng.below(4)) + ")"; break;
        }
    }
    void condition(int level) {
        if (level <= 1 && rng.below(15) == 0) {
            expr(level + 1);
            return;
        }
        static const char* const ops[] = {" < ", " <= ", " > ", " >= ", " == ", " != "};
        switch (rng.below(level > 2 ? 2 : 5)) {
            case 0:
            case 1:
                number(level + 1);
                out += ops[rng.below(6)];
                number(level + 1);
                break;
            case 2:
                out += "(";
                condition(level + 1);
                out += rng.below(2) ? " e " : " oppure ";
                condition(level + 1);
                out += ")";
                break;
            case 3:
                out += "non ";
                out += "(";
                condition(level + 1);
                out += ")";
                break;
            default: out += rng.below(2) ? "trova(l, a) > 0" : "t != \"\""; break;
        }
    }
    void expr(int level) {
        const uint32_t pick = rng.below(level > 3 ? 6 : 16);
        switch (pick) {
            case 0: out += std::to_string(rng.below(20)); break;
            case 1: out += std::to_string(rng.below(1000)) + "." + std::to_string(rng.below(100)); break;
            case 2: out += rng.below(2) ? "\"ab\"" : "\"città, 3\""; break;
            case 3:
            case 4: out += var(); break;
            case 5: out += rng.below(3) == 0 ? "niente" : rng.below(2) ? "vero" : "falso"; break;
            case 6:
            case 7:
            case 8: {
                static const char* const ops[] = {" + ", " - ", " * ", " / ", " % ", " == ", " != ", " < ", " >= ", " e ", " oppure "};
                out += "(";
                expr(level + 1);
                out += ops[rng.below(11)];
                expr(level + 1);
                out += ")";
                break;
            }
            case 9: {
                out += "[";
                const uint32_t n = rng.below(4);
                for (uint32_t i = 0; i < n; ++i) {
                    if (i) out += ", ";
                    expr(level + 1);
                }
                out += "]";
                break;
            }
            case 10:
                out += var();
                out += "[";
                expr(level + 1);
                out += "]";
                break;
            case 11:
                out += rng.below(2) ? "-" : "non ";
                expr(level + 1);
                break;
            case 12: {
                static const char* const one[] = {"lunghezza", "testo", "numero", "intero", "assoluto", "radice", "seno", "tipo",
                                                  "maiuscolo", "arrotonda", "minimo", "togli", "unisci", "casuale", "carica"};
                out += one[rng.below(15)];
                out += "(";
                expr(level + 1);
                out += ")";
                break;
            }
            case 13: {
                static const char* const two[] = {"trova", "parte", "dividi", "casuale", "massimo", "lista", "unisci", "doppia"};
                out += two[rng.below(8)];
                out += "(";
                expr(level + 1);
                out += ", ";
                expr(level + 1);
                out += ")";
                break;
            }
            case 14: out += rng.below(2) ? "tasto()" : "tempo()"; break;
            default: out += "doppia(" + std::string(var()) + ", " + std::to_string(rng.below(5)) + ")"; break;
        }
    }
    void indent() { out.append(static_cast<size_t>(depth) * 2, ' '); }
    void block(int statements) {
        ++depth;
        for (int i = 0; i < statements; ++i) statement();
        --depth;
    }
    void statement() {
        indent();
        const uint32_t pick = rng.below(depth > 3 ? 8 : 16);
        switch (pick) {
            case 0:
            case 1:
            case 2:
                if (rng.below(5) == 0) {  // «m» può diventare qualsiasi cosa; a, b, c restano numeri
                    out += rng.below(4) == 0 ? "m += " : "m = ";
                    expr(0);
                } else {
                    out += "abc"[rng.below(3)];
                    out += rng.below(4) == 0 ? " += " : " = ";
                    number(0);
                }
                out += "\n";
                break;
            case 3:
                out += "scrivi(";
                expr(0);
                out += ")\n";
                break;
            case 4:
                out += std::string(rng.below(2) ? "aggiungi(l, " : "inserisci(l, 1, ");
                expr(0);
                out += ")\n";
                break;
            case 5:
                out += "l[1 + intero(assoluto(";
                number(1);
                out += ")) % lunghezza(l)] = ";
                expr(0);
                out += "\n";
                break;
            case 6: {
                static const char* const calls[] = {"cerchio(a, b, 3, ROSSO)", "scritta(1, 2, t, BIANCO)", "mostra()", "aspetta(a)",
                                                    "ordina(l)", "salva(\"f.txt\", l)", "suona(a, 10)", "pulisci()", "se a == 3 allora esci_mai()"};
                out += calls[rng.below(9)];
                out += "\n";
                break;
            }
            case 7:
                out += "se ";
                condition(1);
                out += " allora c = c + 1\n";
                break;
            case 8:
            case 9:
                out += "se ";
                condition(1);
                out += " allora\n";
                block(1 + static_cast<int>(rng.below(3)));
                if (rng.below(2)) {
                    indent();
                    out += "altrimenti\n";
                    block(1 + static_cast<int>(rng.below(2)));
                }
                indent();
                out += "fine\n";
                break;
            case 10:
            case 11:
                out += "ripeti " + std::to_string(rng.below(6)) + " volte\n";
                block(1 + static_cast<int>(rng.below(3)));
                indent();
                out += "fine\n";
                break;
            case 12:
                out += "per i da " + std::to_string(rng.below(4)) + " a " + std::to_string(rng.below(8)) + (rng.below(4) == 0 ? " passo 2\n" : "\n");
                block(1 + static_cast<int>(rng.below(3)));
                indent();
                out += "fine\n";
                break;
            case 13:
                out += "per ogni v in ";
                out += rng.below(2) ? "l" : "t";
                out += "\n";
                block(1 + static_cast<int>(rng.below(2)));
                indent();
                out += "fine\n";
                break;
            case 14:
                out += "ripeti finché a < " + std::to_string(rng.below(30)) + "\n";
                block(1 + static_cast<int>(rng.below(2)));
                ++depth;
                indent();
                --depth;
                out += "a = a + 1\n";
                indent();
                out += "fine\n";
                break;
            default:
                out += "c = doppia(c, " + std::to_string(rng.below(4)) + ")\n";
                break;
        }
    }
    std::string program() {
        out = "funzione esci_mai()\n  ritorna niente\nfine\n"
              "funzione doppia(x, quante)\n  se quante <= 0 allora ritorna x\n  locale y = doppia(x, quante - 1)\n  ritorna y + y\nfine\n"
              "a = 1\nb = 2.5\nc = 0\nl = [3, 1, 2]\nt = \"polpo\"\nm = [[1, 2], \"x\"]\n";
        depth = -1;
        block(3 + static_cast<int>(rng.below(12)));
        return out;
    }
};

std::string random_program(Rng& rng, const std::vector<std::string>& corpus) {
    std::string out;
    const uint32_t kind = rng.below(7);
    if (kind >= 4) {  // scritto bene, ma senza senso
        Generator g{rng, std::string()};
        return g.program();
    }
    if (kind == 0) {  // zuppa di parole
        const uint32_t n = 1 + rng.below(120);
        for (uint32_t i = 0; i < n; ++i) {
            out += kPieces[rng.below(sizeof(kPieces) / sizeof(kPieces[0]))];
            if (rng.below(3) != 0) out += ' ';
        }
    } else if (kind == 1) {  // byte a caso
        const uint32_t n = rng.below(200);
        for (uint32_t i = 0; i < n; ++i) out += static_cast<char>(rng.below(256));
    } else {  // un programma vero con qualche pezzo cambiato, tolto o raddoppiato
        out = corpus[rng.below(static_cast<uint32_t>(corpus.size()))];
        const uint32_t edits = 1 + rng.below(6);
        for (uint32_t i = 0; i < edits && !out.empty(); ++i) {
            const size_t at = rng.below(static_cast<uint32_t>(out.size()));
            switch (rng.below(4)) {
                case 0: out.erase(at, 1 + rng.below(12)); break;
                case 1: out.insert(at, kPieces[rng.below(sizeof(kPieces) / sizeof(kPieces[0]))]); break;
                case 2: out[at] = static_cast<char>(rng.below(256)); break;
                default: out.insert(at, out.substr(at, 1 + rng.below(40))); break;
            }
        }
    }
    return out;
}

std::vector<std::string> corpus_cases() {
    std::vector<std::string> cases;
    for (const char* name : kCorpus) {
        std::string source;
        if (!read_file(corpus_path(std::string(name) + ".polpo"), source)) continue;
        size_t at = 0;
        while (at < source.size()) {
            size_t end = source.find("#---", at + 1);
            if (end == std::string::npos) end = source.size();
            cases.push_back(source.substr(at, end - at));
            at = end;
        }
    }
    return cases;
}

void test_fuzz_source() {
    const std::vector<std::string> corpus = corpus_cases();
    TEST_ASSERT_TRUE(corpus.size() > 100);
    Rng rng{fuzz_seed(20261122)};
    Limits limits;
    limits.max_heap = 6000;
    limits.max_stack = 96;
    limits.max_frames = 12;
    unsigned compiled = 0, finished = 0, failed = 0;
    const int rounds = fuzz_rounds();
    for (int i = 0; i < rounds; ++i) {
        const std::string source = random_program(rng, corpus);
        Program p;
        Error e;
        if (!compile(source, limits, p, e)) {
            TEST_ASSERT_TRUE_MESSAGE(!e.message.empty(), "un errore senza spiegazione");
            TEST_ASSERT_TRUE(p.code.empty());
            continue;
        }
        ++compiled;
        QuietHost host;
        Vm vm(p, host, limits);
        vm.start(rng.next());
        const State s = run_all(vm, 20000);
        TEST_ASSERT_TRUE(vm.heap_used() <= limits.max_heap);
        TEST_ASSERT_TRUE(vm.stack_used() <= limits.max_stack);
        if (s == State::Done) ++finished;
        if (s == State::Failed) {
            ++failed;
            TEST_ASSERT_TRUE_MESSAGE(!vm.error().message.empty(), "un errore senza spiegazione");
            TEST_ASSERT_TRUE(vm.error().message.find("rovinato") == std::string::npos);  // il compilatore non sbaglia istruzioni
        }
        vm.variables();
        vm.stack_trace();
    }
    // la prova ha senso solo se una buona parte dei programmi arriva a essere eseguita
    const std::string summary = "programmi casuali: compilati " + std::to_string(compiled) + ", finiti " + std::to_string(finished) +
                                ", fermati da un errore " + std::to_string(failed);
    TEST_MESSAGE(summary.c_str());
    TEST_ASSERT_TRUE(compiled > static_cast<unsigned>(rounds) / 3);
    TEST_ASSERT_TRUE(finished > static_cast<unsigned>(rounds) / 20);
    TEST_ASSERT_TRUE(failed > static_cast<unsigned>(rounds) / 12);
}

// Istruzioni rovinate: la macchina virtuale deve accorgersene, non uscire dalla sua memoria.
void test_fuzz_bytecode() {
    const std::vector<std::string> corpus = corpus_cases();
    Rng rng{fuzz_seed(777)};
    Limits limits;
    limits.max_heap = 6000;
    limits.max_stack = 64;
    limits.max_frames = 8;
    unsigned ran = 0;
    const int rounds = fuzz_rounds();
    for (int i = 0; i < rounds; ++i) {
        Program p;
        Error e;
        if (rng.below(5) == 0) {  // istruzioni del tutto casuali
            const uint32_t n = 1 + rng.below(80);
            for (uint32_t k = 0; k < n; ++k) p.code.push_back(static_cast<uint8_t>(rng.below(rng.below(2) ? 256 : static_cast<uint32_t>(Op::Count_))));
            p.globals = {"a", "b"};
            Constant c;
            c.is_text = rng.below(2) != 0;
            c.text = "t";
            c.number = 3;
            p.constants.push_back(c);
            FunctionInfo f;
            f.name = "f";
            f.entry = static_cast<uint16_t>(rng.below(n + 4));
            f.params = static_cast<uint8_t>(rng.below(3));
            p.functions.push_back(f);
        } else {  // un programma vero con qualche byte cambiato
            if (!compile(corpus[rng.below(static_cast<uint32_t>(corpus.size()))], limits, p, e) || p.code.empty()) continue;
            const uint32_t edits = 1 + rng.below(4);
            for (uint32_t k = 0; k < edits; ++k) p.code[rng.below(static_cast<uint32_t>(p.code.size()))] = static_cast<uint8_t>(rng.below(256));
            if (rng.below(8) == 0) p.code.resize(rng.below(static_cast<uint32_t>(p.code.size())) + 1);
            if (rng.below(8) == 0 && !p.functions.empty()) p.functions[0].entry = static_cast<uint16_t>(rng.next());
            if (rng.below(16) == 0) p.constants.clear();
            if (rng.below(16) == 0) p.globals.clear();
        }
        ++ran;
        QuietHost host;
        Vm vm(p, host, limits);
        vm.start(rng.next());
        if (rng.below(4) == 0) vm.pause();
        if (rng.below(4) == 0) vm.set_breakpoints({1, 2, 3});
        const State s = run_all(vm, 20000);
        TEST_ASSERT_TRUE(vm.heap_used() <= limits.max_heap);
        TEST_ASSERT_TRUE(vm.stack_used() <= limits.max_stack);
        if (s == State::Failed) TEST_ASSERT_TRUE(!vm.error().message.empty());
        vm.variables();
        vm.stack_trace();
    }
    TEST_ASSERT_TRUE(ran > static_cast<unsigned>(rounds) / 2);
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_corpus);
    RUN_TEST(test_manual_examples);
    RUN_TEST(test_examples);
    RUN_TEST(test_deterministic);
    RUN_TEST(test_format_number);
    RUN_TEST(test_parse_number);
    RUN_TEST(test_trigonometry);
    RUN_TEST(test_names);
    RUN_TEST(test_native_allow_list);
    RUN_TEST(test_file_names);
    RUN_TEST(test_never_blocks);
    RUN_TEST(test_waiting_states);
    RUN_TEST(test_tiny_limits);
    RUN_TEST(test_memory_is_bounded);
    RUN_TEST(test_stepping);
    RUN_TEST(test_fuzz_source);
    RUN_TEST(test_fuzz_bytecode);
    return UNITY_END();
}
