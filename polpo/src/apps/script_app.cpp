// Polpo — app «Script»: mini-app scritte in PolpoScript (vedi docs/POLPOSCRIPT.md).
//
// Un programma può disegnare, leggere i tasti, suonare e tenere piccoli file nella sua cartella.
// Non può trasmettere niente e non può scrivere come una tastiera USB: il linguaggio non ha funzioni per farlo
// e questo file non include nessuno dei moduli che lo fanno (lo controlla un test).
// Il tasto laterale G0 ferma sempre il programma.
#include <M5Cardputer.h>

#include <deque>
#include <memory>

#include "apps/apps.h"
#include "apps/script_runner.h"
#include "core/gfx.h"
#include "core/settings.h"
#include "core/sound.h"
#include "core/storage.h"
#include "core/widgets.h"

namespace {

using polpo::script::DrawCommand;
using polpo::script::DrawOp;
using polpo::script::State;

constexpr size_t kMaxSource = 16 * 1024;
constexpr uint32_t kSliceInstructions = 500;   // quante istruzioni prima di ricontrollare l'orologio
constexpr uint32_t kTickInstructions = 4000;   // al massimo per ogni giro del ciclo principale
constexpr uint32_t kTickMs = 8;                // e al massimo per questo tempo
constexpr int kConsoleRows = 9;                // righe da 15 punti su 135

script_runner::Listener g_listeners[2];

void notify(const char* event, const std::string& text, uint16_t line) {
    for (const auto& listener : g_listeners)
        if (listener) listener(event, text, line);
}

// Il carattere dello schermo non ha le virgolette «a caporale» usate nei messaggi: sul Polpo diventano dritte.
std::string for_screen(std::string text) {
    for (const char* quote : {"\xC2\xAB", "\xC2\xBB"}) {
        for (size_t at = text.find(quote); at != std::string::npos; at = text.find(quote, at)) text.replace(at, 2, "\"");
    }
    return text;
}

// Nome di un tasto come lo vede un programma.
std::string key_name(Key key, char ch) {
    switch (key) {
        case Key::Up: return "su";
        case Key::Down: return "giu";
        case Key::Left: return "sinistra";
        case Key::Right: return "destra";
        case Key::Ok: return "ok";
        case Key::Back: return "indietro";
        case Key::Backspace: return "canc";
        case Key::Tab: return "tab";
        default: break;
    }
    if (ch == ' ') return "spazio";
    if (ch > ' ' && ch < 0x7F) return std::string(1, ch);
    return "";
}

std::string held_key_name(uint8_t code) {
    switch (code) {
        case KEY_ENTER: return "ok";
        case KEY_BACKSPACE: return "canc";
        case KEY_TAB: return "tab";
        case '`': return "indietro";
        case ';': return "su";
        case '.': return "giu";
        case ',': return "sinistra";
        case '/': return "destra";
        case ' ': return "spazio";
        default: break;
    }
    if (code > ' ' && code < 0x7F) return std::string(1, static_cast<char>(code));
    return "";
}

// Il collegamento tra il programma e il Polpo: solo schermo, tasti, suoni, orologio e la cartella dei dati.
class DeviceHost : public polpo::script::Host {
public:
    uint32_t now_ms() override { return millis(); }

    void draw(const DrawCommand& d) override {
        auto& g = ui::c();
        switch (d.op) {
            case DrawOp::Clear: g.fillScreen(d.color); break;
            case DrawOp::Pixel: g.drawPixel(d.a, d.b, d.color); break;
            case DrawOp::Line: g.drawLine(d.a, d.b, d.c, d.d, d.color); break;
            case DrawOp::Rect: g.fillRect(d.a, d.b, d.c, d.d, d.color); break;
            case DrawOp::Frame: g.drawRect(d.a, d.b, d.c, d.d, d.color); break;
            case DrawOp::Circle: g.fillCircle(d.a, d.b, d.c, d.color); break;
            case DrawOp::Ring: g.drawCircle(d.a, d.b, d.c, d.color); break;
            case DrawOp::Text:
                if (d.text) {
                    g.setTextSize(d.size);
                    g.setTextColor(d.color);
                    g.drawString(d.text->c_str(), d.a, d.b);
                    g.setTextSize(1);
                }
                break;
            case DrawOp::Show: ui::present(); break;
        }
        console_on_screen = false;
    }

    // scrivi(): lo schermo diventa un foglio su cui le righe scorrono.
    void print(const std::string& line) override {
        notify("print", line, 0);
        size_t at = 0;
        for (;;) {  // un testo con degli «a capo» diventa più righe
            const size_t end = line.find('\n', at);
            console.push_back(line.substr(at, end == std::string::npos ? std::string::npos : end - at));
            if (end == std::string::npos) break;
            at = end + 1;
        }
        while (console.size() > 24) console.pop_front();
        console_dirty = true;
    }

    // Ridisegna il foglio (senza mostrarlo ancora): le ultime righe che stanno in `max_rows`.
    void draw_console(int max_rows = kConsoleRows) {
        auto& g = ui::c();
        g.fillScreen(ui::kBg);
        g.setTextSize(1);
        // dal fondo, quante righe ci stanno (quelle lunghe vanno a capo)
        int rows = 0;
        size_t first = console.size();
        while (first > 0) {
            const int need = ui::wrap_count(ui::kW - 8, console[first - 1]);
            if (rows + (need < 1 ? 1 : need) > max_rows) break;
            rows += need < 1 ? 1 : need;
            --first;
        }
        if (first == console.size() && !console.empty()) first = console.size() - 1;  // una riga lunghissima: si vede l'inizio
        int y = 0;
        for (size_t i = first; i < console.size() && y < max_rows * 15; ++i) {
            const int used = ui::wrap(4, y, ui::kW - 8, console[i], ui::kFg, 15, max_rows - y / 15);
            y += 15 * (used < 1 ? 1 : used);
        }
        console_dirty = false;
        console_on_screen = true;
    }

    bool key_down(const std::string& name) override {
        auto& kb = M5Cardputer.Keyboard;
        for (const auto& p : kb.keyList()) {
            const std::string held = held_key_name(static_cast<uint8_t>(kb.getKeyValue(p).value_first));
            if (!held.empty() && held == name) return true;
        }
        return false;
    }

    bool next_key(std::string& name) override {
        if (keys.empty()) return false;
        name = keys.front();
        keys.pop_front();
        return true;
    }

    void tone(uint32_t hz, uint32_t ms) override {
        if (!settings::get().sound || ms == 0) return;
        if (hz < 20) M5Cardputer.Speaker.stop();
        else M5Cardputer.Speaker.tone(static_cast<float>(hz), ms);
    }

    // Il nome è già stato controllato dal linguaggio: solo lettere, cifre, _ - e punto, mai un percorso.
    bool file_read(const std::string& name, std::string& out) override {
        return storage::read_text(storage::join(storage::kScriptDataDir, name), out, 4096);
    }
    bool file_write(const std::string& name, const std::string& data) override {
        if (!storage::ok()) return false;
        storage::mkdirs(storage::kScriptDataDir);
        return storage::write_text(storage::join(storage::kScriptDataDir, name), data);
    }

    std::deque<std::string> keys;
    std::deque<std::string> console;
    bool console_dirty = false;
    bool console_on_screen = false;
};

class ScriptScreen;
ScriptScreen* g_running = nullptr;

class ScriptScreen : public Screen {
public:
    ScriptScreen(std::string path, bool paused) : path_(std::move(path)), start_paused_(paused) {}
    ~ScriptScreen() override {
        if (g_running == this) g_running = nullptr;
    }

    bool owns_canvas() const override { return true; }
    void draw() override {}

    void on_enter() override {
        g_running = this;
        std::string source;
        polpo::script::Error error;
        if (!storage::read_text(path_, source, kMaxSource)) {
            error.message = "non riesco a leggere il file (o è più lungo di 16.000 caratteri)";
        } else {
            polpo::script::compile(source, limits_, program_, error);
        }
        if (!error.ok()) {
            fail(error);
            return;
        }
        vm_.reset(new polpo::script::Vm(program_, host_, limits_));
        vm_->start(static_cast<uint32_t>(micros()) | 1u);
        if (start_paused_) vm_->pause();
        ui::c().fillScreen(0);
        ui::present();
    }

    void on_exit() override {
        M5Cardputer.Speaker.stop();
        if (vm_ && !finished_) notify("stopped", "", vm_->line());
        if (g_running == this) g_running = nullptr;
    }

    void on_event(const InputEvent& ev) override {
        if (ev.repeat && ev.key == Key::Back) return;
        if (finished_) {  // a programma finito qualsiasi tasto chiude
            if (!ev.repeat) nav.pop();
            return;
        }
        if (ev.key == Key::Back && ev.ch == 0) {  // tasto laterale G0: ferma sempre
            stop();
            return;
        }
        if (asking_) {  // chiedi(): si scrive la risposta nella riga in fondo
            if (ev.key == Key::Ok || ev.key == Key::Back) {
                const std::string given = ev.key == Key::Ok ? answer_ : std::string();  // «indietro»: nessuna risposta
                const std::string question = vm_->question();
                host_.print(question.empty() || given.empty() ? question + given : question + " " + given);
                asking_ = false;
                vm_->answer(given);
                return;
            }
            if (ev.key == Key::Backspace) {
                if (!answer_.empty()) answer_.pop_back();
            } else if (!ev.fn && ev.ch >= ' ' && ev.ch < 0x7F && ev.ch != '`' && answer_.size() < 60) {
                answer_.push_back(ev.ch);
            }
            draw_question();
            return;
        }
        const std::string name = key_name(ev.key, ev.ch);
        if (name.empty()) return;
        if (host_.keys.size() >= 16) host_.keys.pop_front();
        host_.keys.push_back(name);
    }

    void tick(uint32_t /*now*/) override {
        if (!vm_ || finished_ || asking_) return;
        const uint32_t started = millis();
        uint32_t left = kTickInstructions;
        State state = vm_->state();
        while (left > 0) {
            const uint32_t slice = left < kSliceInstructions ? left : kSliceInstructions;
            const uint64_t before = vm_->instructions();
            state = vm_->run(slice);
            const uint32_t used = static_cast<uint32_t>(vm_->instructions() - before);
            left -= used < left ? used : left;
            if (state != State::Running || vm_->yielded() || used == 0) break;
            if (millis() - started >= kTickMs) break;
        }
        if (host_.console_dirty && state != State::WaitText && state != State::Done) {
            host_.draw_console();
            ui::present();
        }
        switch (state) {
            case State::WaitText:
                asking_ = true;
                answer_.clear();
                draw_question();
                break;
            case State::Paused:
                if (!pause_reported_) {
                    pause_reported_ = true;
                    notify("paused", "", vm_->line());
                }
                break;
            case State::Done: finish(); break;
            case State::Failed: fail(vm_->error()); break;
            default: pause_reported_ = false; break;
        }
    }

    void stop() {
        if (vm_ && !finished_) {
            vm_->stop();
            notify("stopped", "", vm_->line());
        }
        finished_ = true;
        nav.pop();
    }

    // ---- per Polpo Link e per il simulatore
    polpo::script::Vm* vm() { return finished_ ? nullptr : vm_.get(); }
    void clear_pause_report() { pause_reported_ = false; }
    script_runner::Snapshot snapshot(bool with_variables) {
        script_runner::Snapshot s;
        s.file = path_;
        if (!vm_) {
            s.state = "failed";
            s.line = error_.line;
            s.error = error_.message;
            return s;
        }
        switch (vm_->state()) {
            case State::Running: s.state = "running"; break;
            case State::Sleeping:
            case State::WaitKey:
            case State::WaitText: s.state = "waiting"; break;
            case State::Paused: s.state = "paused"; break;
            case State::Done: s.state = "done"; break;
            case State::Failed: s.state = "failed"; break;
        }
        s.line = vm_->state() == State::Failed ? vm_->error().line : vm_->line();
        s.error = vm_->error().message;
        if (with_variables && vm_->state() == State::Paused) {
            s.variables = vm_->variables();
            s.stack = vm_->stack_trace();
        }
        return s;
    }

private:
    // Una riga in fondo allo schermo, sopra ciò che il programma ha disegnato (o sotto ciò che ha scritto).
    void bottom_bar(const std::string& text, uint16_t color) {
        if (host_.console_on_screen || host_.console_dirty) host_.draw_console(kConsoleRows - 1);
        auto& g = ui::c();
        g.fillRect(0, ui::kH - 15, ui::kW, 15, ui::kPanel);
        g.setTextSize(1);
        ui::text(4, ui::kH - 14, text, color);
        ui::present();
    }

    void draw_question() {
        // domanda e risposta sulla stessa riga; se non ci stanno, della risposta si vede la fine
        std::string line = vm_->question();
        if (!line.empty()) line += ' ';
        line += answer_ + "_";
        while (ui::text_width(line) > ui::kW - 8 && line.size() > 2) {
            size_t n = 1;  // un carattere intero, anche se accentato
            while (n < line.size() && (static_cast<uint8_t>(line[n]) & 0xC0) == 0x80) ++n;
            line.erase(0, n);
        }
        bottom_bar(line, ui::kFg);
    }

    void finish() {
        finished_ = true;
        notify("end", "", vm_->line());
        bottom_bar("Programma finito · premi un tasto", ui::kDim);
    }

    void fail(const polpo::script::Error& error) {
        finished_ = true;
        error_ = error;
        notify("end", error.text(), error.line);
        sound::error();
        const std::string title = error.line ? "Errore alla riga " + std::to_string(error.line) : "Errore";
        std::string body = for_screen(error.message);
        if (!body.empty() && body.back() != '?' && body.back() != '.') body += '.';
        nav.replace(std::unique_ptr<Screen>(new MessageScreen(title, body, ui::kErr)));
    }

    std::string path_;
    bool start_paused_;
    polpo::script::Limits limits_;
    polpo::script::Program program_;
    DeviceHost host_;
    std::unique_ptr<polpo::script::Vm> vm_;
    polpo::script::Error error_;
    bool finished_ = false;
    bool asking_ = false;       // chiedi(): si sta scrivendo la risposta
    std::string answer_;
    bool pause_reported_ = false;
};

}  // namespace

namespace script_runner {

bool check(const std::string& path, polpo::script::Error& error) {
    std::string source;
    if (!storage::read_text(path, source, kMaxSource)) {
        error.line = 0;
        error.message = "non riesco a leggere il file (o è più lungo di 16.000 caratteri)";
        return false;
    }
    polpo::script::Program program;
    return polpo::script::compile(source, polpo::script::Limits(), program, error);
}

void open(const std::string& path, bool paused) {
    if (g_running) return;  // uno per volta
    ::open<ScriptScreen>(path, paused);
}

bool active() { return g_running != nullptr; }

void stop() {
    if (g_running) g_running->stop();
}

void pause() {
    if (g_running && g_running->vm()) g_running->vm()->pause();
}

void resume() {
    if (!g_running || !g_running->vm()) return;
    g_running->clear_pause_report();
    g_running->vm()->resume();
}

void step(polpo::script::StepMode mode) {
    if (!g_running || !g_running->vm()) return;
    g_running->clear_pause_report();
    g_running->vm()->step(mode);
}

void set_breakpoints(const std::vector<uint16_t>& lines) {
    if (g_running && g_running->vm()) g_running->vm()->set_breakpoints(lines);
}

Snapshot snapshot(bool with_variables) { return g_running ? g_running->snapshot(with_variables) : Snapshot(); }

void set_listener(ListenerSlot slot, Listener listener) { g_listeners[slot] = std::move(listener); }

}  // namespace script_runner

void open_script_app() {
    open<FileBrowserScreen>(
        "Script", storage::kScriptDir, ".polpo", [](const std::string& path) { script_runner::open(path); }, false);
}
