#include "polpo/script/transcript.h"

#include <map>
#include <utility>
#include <vector>

namespace polpo {
namespace script {
namespace {

std::string trim(const std::string& s) {
    size_t a = 0, b = s.size();
    while (a < b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\r')) ++a;
    while (b > a && (s[b - 1] == ' ' || s[b - 1] == '\t' || s[b - 1] == '\r')) --b;
    return s.substr(a, b - a);
}

std::vector<std::string> split(const std::string& s, char separator) {
    std::vector<std::string> out;
    size_t at = 0;
    for (;;) {
        const size_t end = s.find(separator, at);
        const std::string piece = trim(s.substr(at, end == std::string::npos ? std::string::npos : end - at));
        if (!piece.empty()) out.push_back(piece);
        if (end == std::string::npos) break;
        at = end + 1;
    }
    return out;
}

std::string num(double v) { return format_number(v); }

std::string hex4(uint16_t v) {
    const char* digits = "0123456789abcdef";
    std::string out;
    for (int shift = 12; shift >= 0; shift -= 4) out += digits[(v >> shift) & 15];
    return out;
}

// I caratteri che romperebbero il verbale (a capo) diventano visibili.
std::string visible(const std::string& s) {
    std::string out;
    for (char c : s) {
        if (c == '\n') out += "\\n";
        else out += c;
    }
    return out;
}

struct Setup {
    std::vector<std::string> keys;
    std::vector<std::string> held;
    std::vector<std::string> answers;
    std::map<std::string, std::string> files;
    uint32_t seed = 1;
    uint64_t budget = 2000000;
    Limits limits;
};

class TranscriptHost : public Host {
   public:
    TranscriptHost(Setup& setup, std::string& out) : setup_(setup), out_(out) {}

    uint32_t now_ms() override { return clock_; }
    void advance(uint32_t ms) { clock_ += ms; }

    void draw(const DrawCommand& d) override {
        static const char* const names[] = {"pulisci", "punto", "linea", "rettangolo", "cornice", "cerchio", "anello", "scritta", "mostra"};
        std::string line = std::string("disegna: ") + names[static_cast<int>(d.op)];
        switch (d.op) {
            case DrawOp::Clear: line += " " + hex4(d.color); break;
            case DrawOp::Pixel: line += " " + num(d.a) + " " + num(d.b) + " " + hex4(d.color); break;
            case DrawOp::Line:
            case DrawOp::Rect:
            case DrawOp::Frame: line += " " + num(d.a) + " " + num(d.b) + " " + num(d.c) + " " + num(d.d) + " " + hex4(d.color); break;
            case DrawOp::Circle:
            case DrawOp::Ring: line += " " + num(d.a) + " " + num(d.b) + " " + num(d.c) + " " + hex4(d.color); break;
            case DrawOp::Text:
                line += " " + num(d.a) + " " + num(d.b) + " " + hex4(d.color) + " x" + num(d.size) + " «" + visible(d.text ? *d.text : "") + "»";
                break;
            case DrawOp::Show: break;
        }
        out_ += line + "\n";
    }
    void print(const std::string& line) override { out_ += "scrivi: " + visible(line) + "\n"; }
    bool key_down(const std::string& name) override {
        for (const std::string& k : setup_.held)
            if (k == name) return true;
        return false;
    }
    bool keys_left() const { return next_key_ < setup_.keys.size(); }
    bool next_key(std::string& name) override {
        if (next_key_ >= setup_.keys.size()) return false;
        name = setup_.keys[next_key_++];
        return true;
    }
    void tone(uint32_t hz, uint32_t ms) override { out_ += "suona: " + num(hz) + " " + num(ms) + "\n"; }
    bool file_read(const std::string& name, std::string& data) override {
        const auto it = setup_.files.find(name);
        if (it == setup_.files.end()) return false;
        data = it->second;
        return true;
    }
    bool file_write(const std::string& name, const std::string& data) override {
        setup_.files[name] = data;
        out_ += "salva: " + name + " = " + visible(data) + "\n";
        return true;
    }

   private:
    Setup& setup_;
    std::string& out_;
    uint32_t clock_ = 0;
    size_t next_key_ = 0;
};

void read_setup(const std::string& source, Setup& setup) {
    size_t at = 0;
    while (at < source.size()) {
        size_t end = source.find('\n', at);
        if (end == std::string::npos) end = source.size();
        const std::string line = trim(source.substr(at, end - at));
        at = end + 1;
        if (line.compare(0, 2, "#!") != 0) continue;
        const size_t colon = line.find(':');
        if (colon == std::string::npos) continue;
        const std::string key = trim(line.substr(2, colon - 2));
        const std::string value = trim(line.substr(colon + 1));
        double n = 0;
        if (key == "tasti") {
            setup.keys = split(value, ' ');
        } else if (key == "premuti") {
            setup.held = split(value, ' ');
        } else if (key == "risposte") {
            setup.answers = split(value, '|');
        } else if (key == "file") {
            const size_t eq = value.find('=');
            if (eq != std::string::npos) setup.files[trim(value.substr(0, eq))] = trim(value.substr(eq + 1));
        } else if (parse_number(value, false, n) && n >= 0 && n < 1e9) {
            if (key == "seme") setup.seed = static_cast<uint32_t>(n);
            else if (key == "limite") setup.budget = static_cast<uint64_t>(n);
            else if (key == "memoria") setup.limits.max_heap = static_cast<size_t>(n);
            else if (key == "pila") setup.limits.max_stack = static_cast<size_t>(n);
        }
    }
}

}  // namespace

std::string run_transcript(const std::string& source, const Limits& limits) {
    std::string out;
    Setup setup;
    setup.limits = limits;
    read_setup(source, setup);
    Program program;
    Error error;
    if (!compile(source, setup.limits, program, error)) return "errore nel programma: " + error.text() + "\n";
    TranscriptHost host(setup, out);
    Vm vm(program, host, setup.limits);
    vm.start(setup.seed);
    size_t next_answer = 0;
    for (;;) {
        const uint64_t done = vm.instructions();
        if (done >= setup.budget) {
            out += "fermato dopo " + num(static_cast<double>(setup.budget)) + " istruzioni\n";
            return out;
        }
        const uint64_t left = setup.budget - done;
        const State state = vm.run(left > 100000 ? 100000u : static_cast<uint32_t>(left));
        if (state == State::Sleeping) {
            const uint32_t ms = vm.sleep_left_ms();
            out += "aspetta: " + num(ms) + "\n";
            host.advance(ms);
        } else if (state == State::WaitKey) {
            if (host.keys_left()) continue;                  // al prossimo giro lo riceve
            out += "aspetta un tasto: nessuno in arrivo\n";  // i tasti della prova sono finiti
            return out;
        } else if (state == State::WaitText) {
            const std::string answer = next_answer < setup.answers.size() ? setup.answers[next_answer++] : std::string();
            out += "chiedi: «" + visible(vm.question()) + "» -> «" + answer + "»\n";
            vm.answer(answer);
        } else if (state == State::Done) {
            out += "fine\n";
            return out;
        } else if (state == State::Failed) {
            out += "errore: " + vm.error().text() + "\n";
            return out;
        } else if (state == State::Paused) {
            vm.resume();
        }
    }
}

std::string run_transcript_file(const std::string& content, const Limits& limits) {
    std::string out, name, source;
    bool any = false;
    auto flush = [&]() {
        if (name.empty() && trim(source).empty()) return;
        if (any || !name.empty()) out += "== " + (name.empty() ? std::string("(senza nome)") : name) + "\n";
        out += run_transcript(source, limits);
        any = true;
    };
    size_t at = 0;
    while (at <= content.size()) {
        size_t end = content.find('\n', at);
        if (end == std::string::npos) end = content.size();
        const std::string line = content.substr(at, end - at);
        if (line.compare(0, 4, "#---") == 0) {
            flush();
            name = trim(line.substr(4));
            source.clear();
            if (name.empty()) name = "(senza nome)";
        } else {
            source += line;
            source += '\n';
        }
        if (end >= content.size()) break;
        at = end + 1;
    }
    flush();
    return out;
}

}  // namespace script
}  // namespace polpo
