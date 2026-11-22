// PolpoScript — macchina virtuale.
//
// Ogni istruzione controlla ciò che tocca (pila, variabili, indirizzi): un programma compilato male o
// rovinato si ferma con un errore, non esce mai dalla memoria che gli è stata assegnata.
#include <cmath>
#include <utility>

#include "polpo/script/script.h"
#include "polpo/script/vm_internal.h"
#include "polpo/util/utf8.h"

namespace polpo {
namespace script {

const char* const kBroken = "il programma è rovinato (istruzione non valida)";

namespace {

const std::string kEmptyText;

std::string count_text(size_t n) { return format_number(static_cast<double>(n)); }

}  // namespace

Vm::Vm(const Program& program, Host& host, const Limits& limits) : program_(program), host_(host), limits_(limits) {}

void Vm::start(uint32_t seed) {
    if (limits_.max_stack < 16) limits_.max_stack = 16;
    if (limits_.max_stack > 60000) limits_.max_stack = 60000;
    if (limits_.max_frames < 2) limits_.max_frames = 2;
    state_ = State::Running;
    error_ = Error();
    stopped_ = false;
    yield_ = false;
    stack_.assign(limits_.max_stack, Value());
    sp_ = 0;
    Value unset;
    unset.type = Type::Unset;
    globals_.assign(program_.globals.size(), unset);
    frames_.clear();
    frames_.push_back(Frame());
    pc_ = 0;
    line_ = 0;
    instructions_ = 0;
    objects_.clear();
    free_objects_.clear();
    temp_roots_.clear();
    heap_used_ = 0;
    gc_threshold_ = limits_.max_heap < 4096 ? limits_.max_heap : 4096;
    constant_refs_.assign(program_.constants.size(), 0);
    for (size_t i = 0; i < program_.constants.size(); ++i) {
        if (!program_.constants[i].is_text) continue;
        const uint32_t ref = alloc_object(kObjectText);
        objects_[ref].pinned = true;
        objects_[ref].text = program_.constants[i].text;
        constant_refs_[i] = ref;
    }
    rng_ = seed != 0 ? seed : 1;
    start_ms_ = host_.now_ms();
    sleep_start_ = 0;
    sleep_ms_ = 0;
    question_.clear();
    stepping_ = false;
    step_jumped_ = false;
    pause_requested_ = false;
    if (program_.code.empty()) state_ = State::Done;
    if (program_.code.size() > 65535) fail(kBroken);
}

void Vm::fail(const std::string& message) {
    if (state_ == State::Failed) return;
    state_ = State::Failed;
    error_.line = line_;
    error_.message = message;
}

void Vm::stop() {
    if (state_ == State::Done || state_ == State::Failed) return;
    state_ = State::Done;
    stopped_ = true;
}

bool Vm::push(const Value& v) {
    if (sp_ >= stack_.size()) {
        fail("il programma usa troppa memoria tutta insieme (troppi valori in sospeso o funzioni una dentro l'altra)");
        return false;
    }
    stack_[sp_++] = v;
    return true;
}

bool Vm::need(size_t values) {
    if (sp_ < values || sp_ - values < frames_.back().base) {
        fail(kBroken);
        return false;
    }
    return true;
}

bool Vm::fetch8(uint8_t& out) {
    if (pc_ >= program_.code.size()) {
        fail(kBroken);
        return false;
    }
    out = program_.code[pc_++];
    return true;
}

bool Vm::fetch16(uint16_t& out) {
    uint8_t lo = 0, hi = 0;
    if (!fetch8(lo) || !fetch8(hi)) return false;
    out = static_cast<uint16_t>(lo | (hi << 8));
    return true;
}

bool Vm::jump_to(uint16_t target) {
    if (target >= program_.code.size()) {
        fail(kBroken);
        return false;
    }
    if (stepping_ && target < pc_ && frames_.size() <= step_depth_) step_jumped_ = true;  // un nuovo giro del ciclo
    pc_ = target;
    return true;
}

bool Vm::local_slot(uint8_t slot, size_t& index) {
    index = static_cast<size_t>(frames_.back().base) + slot;
    if (index >= sp_) {
        fail(kBroken);
        return false;
    }
    return true;
}

bool Vm::condition(const Value& v, bool& out) {
    if (v.type != Type::Bool) {
        fail(std::string("qui serve una condizione, cioè qualcosa che sia vero o falso: ho trovato ") + type_name(v));
        return false;
    }
    out = v.b;
    return true;
}

const char* Vm::type_name(const Value& v) {
    switch (v.type) {
        case Type::Nil: return "niente";
        case Type::Bool: return "un vero/falso";
        case Type::Number: return "un numero";
        case Type::Text: return "un testo";
        case Type::List: return "una lista";
        default: return "una variabile senza valore";
    }
}

// ---------------------------------------------------------------- esecuzione

bool Vm::resume_from_wait() {
    switch (state_) {
        case State::Running: return true;
        case State::Sleeping:
            if (static_cast<uint32_t>(host_.now_ms() - sleep_start_) < sleep_ms_) return false;
            state_ = State::Running;
            return true;
        case State::WaitKey: {
            std::string key;
            if (!host_.next_key(key)) return false;
            if (key.empty() || key.size() > 16 || !utf8_valid(key)) key = "?";
            Value v;
            state_ = State::Running;
            return new_text(std::move(key), v) && push(v);
        }
        default: return false;  // WaitText, Paused, Done, Failed
    }
}

uint32_t Vm::sleep_left_ms() {
    if (state_ != State::Sleeping) return 0;
    const uint32_t elapsed = host_.now_ms() - sleep_start_;
    return elapsed >= sleep_ms_ ? 0 : sleep_ms_ - elapsed;
}

void Vm::answer(const std::string& text) {
    if (state_ != State::WaitText) return;
    std::string s = utf8_valid(text) ? text : std::string();
    if (s.size() > 256) {  // si taglia su un carattere intero
        size_t i = 0, last = 0;
        uint32_t cp = 0;
        while (i < s.size() && i <= 256) {
            last = i;
            utf8_next(s, i, cp);
        }
        s.resize(i <= 256 ? i : last);
    }
    state_ = State::Running;
    Value v;
    if (new_text(std::move(s), v)) push(v);
}

void Vm::step(StepMode mode) {
    if (state_ != State::Paused && state_ != State::Running) return;
    stepping_ = true;
    step_mode_ = mode;
    step_line_ = line_;
    step_depth_ = frames_.size();
    step_jumped_ = false;
    state_ = State::Running;
}

void Vm::resume() {
    if (state_ == State::Paused) state_ = State::Running;
}

void Vm::do_line(uint16_t line) {
    line_ = line;
    bool stop = false;
    if (pause_requested_) {
        pause_requested_ = false;
        stop = true;
    } else if (stepping_) {
        const size_t depth = frames_.size();
        const bool moved = line != step_line_ || step_jumped_;
        switch (step_mode_) {
            case StepMode::Into: stop = depth != step_depth_ || moved; break;
            case StepMode::Over: stop = depth < step_depth_ || (depth == step_depth_ && moved); break;
            case StepMode::Out: stop = depth < step_depth_; break;
        }
    }
    if (!stop) {
        for (uint16_t b : breakpoints_) {
            if (b == line) {
                stop = true;
                break;
            }
        }
    }
    if (stop) {
        stepping_ = false;
        state_ = State::Paused;
    }
}

State Vm::run(uint32_t max_instructions) {
    if (!resume_from_wait()) return state_;
    yield_ = false;
    while (max_instructions-- > 0 && state_ == State::Running && !yield_) {
        uint8_t opcode = 0;
        if (!fetch8(opcode)) break;
        ++instructions_;
        switch (static_cast<Op>(opcode)) {
            case Op::Halt: state_ = State::Done; break;
            case Op::Line: {
                uint16_t line = 0;
                if (fetch16(line)) do_line(line);
                break;
            }
            case Op::Const: {
                uint16_t index = 0;
                if (!fetch16(index)) break;
                if (index >= program_.constants.size()) {
                    fail(kBroken);
                    break;
                }
                const Constant& c = program_.constants[index];
                push(c.is_text ? make_ref(Type::Text, constant_refs_[index]) : make_number(c.number));
                break;
            }
            case Op::Nil: push(Value()); break;
            case Op::True: push(make_bool(true)); break;
            case Op::False: push(make_bool(false)); break;
            case Op::Int8: {
                uint8_t raw = 0;
                if (fetch8(raw)) push(make_number(static_cast<double>(static_cast<int8_t>(raw))));
                break;
            }
            case Op::Pop:
                if (need(1)) --sp_;
                break;
            case Op::Dup2:
                if (need(2)) {
                    const Value a = stack_[sp_ - 2], b = stack_[sp_ - 1];
                    if (push(a)) push(b);
                }
                break;
            case Op::LoadGlobal: {
                uint16_t index = 0;
                if (!fetch16(index)) break;
                if (index >= globals_.size()) {
                    fail(kBroken);
                    break;
                }
                if (globals_[index].type == Type::Unset) {
                    fail("la variabile «" + program_.globals[index] + "» non ha ancora un valore: dagliene uno prima di usarla");
                    break;
                }
                push(globals_[index]);
                break;
            }
            case Op::StoreGlobal: {
                uint16_t index = 0;
                if (!fetch16(index) || !need(1)) break;
                if (index >= globals_.size()) {
                    fail(kBroken);
                    break;
                }
                globals_[index] = stack_[--sp_];
                break;
            }
            case Op::LoadLocal: {
                uint8_t slot = 0;
                size_t index = 0;
                if (fetch8(slot) && local_slot(slot, index)) push(stack_[index]);
                break;
            }
            case Op::StoreLocal: {
                uint8_t slot = 0;
                size_t index = 0;
                if (fetch8(slot) && need(1) && local_slot(slot, index) && index < sp_ - 1) {
                    stack_[index] = stack_[sp_ - 1];
                    --sp_;
                } else {
                    fail(kBroken);
                }
                break;
            }
            case Op::Add:
            case Op::Sub:
            case Op::Mul:
            case Op::Div:
            case Op::Mod: do_binary(static_cast<Op>(opcode)); break;
            case Op::Neg:
                if (!need(1)) break;
                if (stack_[sp_ - 1].type != Type::Number) {
                    fail(std::string("il segno meno si mette davanti a un numero, non a ") + type_name(stack_[sp_ - 1]));
                    break;
                }
                stack_[sp_ - 1] = make_number(-stack_[sp_ - 1].n);
                break;
            case Op::Not: {
                bool b = false;
                if (need(1) && condition(stack_[sp_ - 1], b)) stack_[sp_ - 1] = make_bool(!b);
                break;
            }
            case Op::Eq:
            case Op::Ne:
                if (need(2)) {
                    const bool same = equal(stack_[sp_ - 2], stack_[sp_ - 1], 0);
                    sp_ -= 2;
                    push(make_bool(static_cast<Op>(opcode) == Op::Eq ? same : !same));
                }
                break;
            case Op::Lt:
            case Op::Le:
            case Op::Gt:
            case Op::Ge: do_compare(static_cast<Op>(opcode)); break;
            case Op::Jump: {
                uint16_t target = 0;
                if (fetch16(target)) jump_to(target);
                break;
            }
            case Op::JumpIfFalse: {
                uint16_t target = 0;
                bool b = false;
                if (!fetch16(target) || !need(1) || !condition(stack_[sp_ - 1], b)) break;
                --sp_;
                if (!b) jump_to(target);
                break;
            }
            case Op::AndJump:
            case Op::OrJump: {
                uint16_t target = 0;
                bool b = false;
                if (!fetch16(target) || !need(1) || !condition(stack_[sp_ - 1], b)) break;
                if (b == (static_cast<Op>(opcode) == Op::OrJump)) jump_to(target);
                else --sp_;
                break;
            }
            case Op::CheckBool: {
                bool b = false;
                if (need(1)) condition(stack_[sp_ - 1], b);
                break;
            }
            case Op::Call: {
                uint8_t function = 0, argc = 0;
                if (fetch8(function) && fetch8(argc)) do_call(function, argc);
                break;
            }
            case Op::Native: {
                uint8_t id = 0, argc = 0;
                if (fetch8(id) && fetch8(argc)) do_native(id, argc);
                break;
            }
            case Op::Return: do_return(); break;
            case Op::Reserve: {
                uint8_t count = 0;
                if (!fetch8(count)) break;
                for (uint8_t i = 0; i < count; ++i)
                    if (!push(Value())) break;
                break;
            }
            case Op::List: {
                uint8_t count = 0;
                Value list;
                if (!fetch8(count) || !need(count) || !new_list(count, list)) break;
                for (size_t i = 0; i < count; ++i) objects_[list.ref].items[i] = stack_[sp_ - count + i];
                sp_ -= count;
                push(list);
                break;
            }
            case Op::IndexGet: do_index_get(); break;
            case Op::IndexSet: do_index_set(); break;
            case Op::ToCount: {
                if (!need(1)) break;
                Value& v = stack_[sp_ - 1];
                if (v.type != Type::Number) {
                    fail(std::string("dopo «ripeti» ci vuole un numero di volte, ho trovato ") + type_name(v));
                    break;
                }
                v = make_number(v.n < 1 ? 0.0 : std::trunc(v.n));
                break;
            }
            case Op::RepeatTest: {
                uint8_t slot = 0;
                uint16_t target = 0;
                size_t index = 0;
                if (!fetch8(slot) || !fetch16(target) || !local_slot(slot, index)) break;
                if (stack_[index].type != Type::Number) {
                    fail(kBroken);
                    break;
                }
                if (stack_[index].n < 1) jump_to(target);
                else stack_[index].n -= 1;
                break;
            }
            case Op::ToNumber:
                if (need(1) && stack_[sp_ - 1].type != Type::Number)
                    fail(std::string("«per» conta con i numeri: ho trovato ") + type_name(stack_[sp_ - 1]));
                break;
            case Op::ToStep:
                if (!need(1)) break;
                if (stack_[sp_ - 1].type != Type::Number)
                    fail(std::string("il passo di «per» dev'essere un numero, ho trovato ") + type_name(stack_[sp_ - 1]));
                else if (stack_[sp_ - 1].n == 0)
                    fail("il passo di «per» non può essere zero: il ciclo non finirebbe mai");
                break;
            case Op::ForTest: {
                uint8_t slot = 0;
                uint16_t target = 0;
                size_t index = 0;
                if (!fetch8(slot) || !fetch16(target) || !need(1) || !local_slot(slot, index)) break;
                if (index + 1 >= sp_ - 1 || stack_[index].type != Type::Number || stack_[index + 1].type != Type::Number) {
                    fail(kBroken);
                    break;
                }
                const Value v = stack_[--sp_];
                if (v.type != Type::Number) {
                    fail(std::string("la variabile di «per» dev'essere un numero, ma dentro il ciclo è diventata ") + type_name(v));
                    break;
                }
                const double limit = stack_[index].n, step = stack_[index + 1].n;
                if (step > 0 ? v.n > limit : v.n < limit) jump_to(target);
                break;
            }
            case Op::ToSequence:
                if (need(1) && stack_[sp_ - 1].type != Type::List && stack_[sp_ - 1].type != Type::Text)
                    fail(std::string("dopo «per ogni … in» ci vuole una lista o un testo, ho trovato ") + type_name(stack_[sp_ - 1]));
                break;
            case Op::EachNext: {
                uint8_t slot = 0;
                uint16_t target = 0;
                size_t index = 0;
                if (!fetch8(slot) || !fetch16(target) || !local_slot(slot, index)) break;
                if (index + 1 >= sp_ || stack_[index + 1].type != Type::Number || stack_[index + 1].n < 0) {
                    fail(kBroken);
                    break;
                }
                const Value sequence = stack_[index];
                const auto position = static_cast<size_t>(stack_[index + 1].n);
                if (sequence.type == Type::List && sequence.ref < objects_.size()) {
                    const std::vector<Value>& items = objects_[sequence.ref].items;
                    if (position >= items.size()) {
                        jump_to(target);
                    } else {
                        const Value item = items[position];
                        stack_[index + 1].n += 1;
                        push(item);
                    }
                } else if (sequence.type == Type::Text) {
                    const std::string& text = text_of(sequence);
                    if (position >= text.size()) {
                        jump_to(target);
                    } else {
                        size_t after = position;
                        uint32_t cp = 0;
                        utf8_next(text, after, cp);
                        std::string one = text.substr(position, after - position);
                        stack_[index + 1].n = static_cast<double>(after);
                        Value v;
                        if (new_text(std::move(one), v)) push(v);
                    }
                } else {
                    fail(kBroken);
                }
                break;
            }
            default: fail(kBroken); break;
        }
    }
    return state_;
}

void Vm::do_binary(Op op) {
    if (!need(2)) return;
    const Value a = stack_[sp_ - 2], b = stack_[sp_ - 1];  // restano sulla pila finché il risultato non è pronto
    Value result;
    if (a.type == Type::Number && b.type == Type::Number) {
        double z = 0;
        switch (op) {
            case Op::Add: z = a.n + b.n; break;
            case Op::Sub: z = a.n - b.n; break;
            case Op::Mul: z = a.n * b.n; break;
            default:
                if (b.n == 0) {
                    fail("non si può dividere per zero");
                    return;
                }
                if (op == Op::Div) {
                    z = a.n / b.n;
                } else {  // resto con il segno del divisore: -1 % 5 fa 4
                    z = std::fmod(a.n, b.n);
                    if (z != 0 && ((z < 0) != (b.n < 0))) z += b.n;
                }
                break;
        }
        if (!std::isfinite(z)) {
            fail("il risultato è un numero troppo grande");
            return;
        }
        result = make_number(z);
    } else if (op == Op::Add && (a.type == Type::Text || b.type == Type::Text)) {
        std::string joined = to_text(a, false, 0);
        joined += to_text(b, false, 0);
        if (!new_text(std::move(joined), result)) return;
    } else if (op == Op::Add && a.type == Type::List && b.type == Type::List && a.ref < objects_.size() &&
               b.ref < objects_.size()) {
        const size_t na = objects_[a.ref].items.size(), nb = objects_[b.ref].items.size();
        if (!new_list(na + nb, result)) return;
        std::vector<Value>& out = objects_[result.ref].items;
        for (size_t i = 0; i < na; ++i) out[i] = objects_[a.ref].items[i];
        for (size_t i = 0; i < nb; ++i) out[na + i] = objects_[b.ref].items[i];
    } else {
        const char* verb = op == Op::Add ? "sommare" : op == Op::Sub ? "sottrarre" : op == Op::Mul ? "moltiplicare"
                         : op == Op::Div ? "dividere" : "calcolare il resto tra";
        fail(std::string("non posso ") + verb + " " + type_name(a) + " e " + type_name(b));
        return;
    }
    sp_ -= 2;
    push(result);
}

void Vm::do_compare(Op op) {
    if (!need(2)) return;
    const Value& a = stack_[sp_ - 2];
    const Value& b = stack_[sp_ - 1];
    int order = 0;
    if (a.type == Type::Number && b.type == Type::Number) {
        order = a.n < b.n ? -1 : a.n > b.n ? 1 : 0;
    } else if (a.type == Type::Text && b.type == Type::Text) {
        const int c = text_of(a).compare(text_of(b));
        order = c < 0 ? -1 : c > 0 ? 1 : 0;
    } else {
        fail(std::string("«<» e «>» confrontano due numeri o due testi: qui ci sono ") + type_name(a) + " e " + type_name(b));
        return;
    }
    const bool result = op == Op::Lt ? order < 0 : op == Op::Le ? order <= 0 : op == Op::Gt ? order > 0 : order >= 0;
    sp_ -= 2;
    push(make_bool(result));
}

bool Vm::arg_position(const Value& v, size_t count, bool one_past, size_t& index) {
    if (v.type != Type::Number || std::floor(v.n) != v.n) {
        fail(std::string("la posizione dev'essere un numero intero (1 è il primo), ho trovato ") +
             (v.type == Type::Number ? "un numero con la virgola" : type_name(v)));
        return false;
    }
    const size_t last = count + (one_past ? 1 : 0);
    if (v.n < 1 || v.n > static_cast<double>(last)) {
        if (count == 0 && !one_past) fail("qui non c'è nessun elemento da prendere: è vuoto");
        else fail("la posizione " + format_number(v.n) + " non esiste: qui gli elementi vanno da 1 a " + count_text(count));
        return false;
    }
    index = static_cast<size_t>(v.n) - 1;
    return true;
}

void Vm::do_index_get() {
    if (!need(2)) return;
    const Value container = stack_[sp_ - 2], position = stack_[sp_ - 1];
    Value result;
    if (container.type == Type::List && container.ref < objects_.size()) {
        size_t index = 0;
        if (!arg_position(position, objects_[container.ref].items.size(), false, index)) return;
        result = objects_[container.ref].items[index];
    } else if (container.type == Type::Text) {
        const std::string& text = text_of(container);
        size_t index = 0;
        if (!arg_position(position, utf8_length(text), false, index)) return;
        size_t at = 0;
        uint32_t cp = 0;
        for (size_t i = 0; i < index; ++i) utf8_next(text, at, cp);
        size_t after = at;
        utf8_next(text, after, cp);
        if (!new_text(text.substr(at, after - at), result)) return;
    } else {
        fail(std::string("le parentesi quadre si usano con le liste e con i testi, non con ") + type_name(container));
        return;
    }
    sp_ -= 2;
    push(result);
}

void Vm::do_index_set() {
    if (!need(3)) return;
    const Value container = stack_[sp_ - 3], position = stack_[sp_ - 2], value = stack_[sp_ - 1];
    if (container.type == Type::Text) {
        fail("le lettere di un testo non si possono cambiare una per volta: costruisci un testo nuovo");
        return;
    }
    if (container.type != Type::List || container.ref >= objects_.size()) {
        fail(std::string("le parentesi quadre si usano con le liste, non con ") + type_name(container));
        return;
    }
    size_t index = 0;
    const size_t count = objects_[container.ref].items.size();
    if (!arg_position(position, count, true, index)) return;  // la posizione dopo l'ultima aggiunge un elemento
    if (index == count) {
        if (!list_append(container.ref, value)) return;
    } else {
        objects_[container.ref].items[index] = value;
    }
    sp_ -= 3;
}

void Vm::do_call(uint8_t function, uint8_t argc) {
    if (function >= program_.functions.size() || program_.functions[function].params != argc || !need(argc)) {
        fail(kBroken);
        return;
    }
    if (frames_.size() >= limits_.max_frames) {
        fail("troppe funzioni una dentro l'altra: «" + program_.functions[function].name + "» richiama sé stessa senza mai fermarsi?");
        return;
    }
    Frame frame;
    frame.return_pc = pc_;
    frame.base = static_cast<uint16_t>(sp_ - argc);
    frame.line = line_;
    frame.function = function;
    if (!jump_to(program_.functions[function].entry)) return;
    frames_.push_back(frame);
}

void Vm::do_return() {
    if (frames_.size() <= 1 || sp_ <= frames_.back().base) {
        fail(kBroken);
        return;
    }
    const Value result = stack_[sp_ - 1];
    const Frame frame = frames_.back();
    frames_.pop_back();
    sp_ = frame.base;
    pc_ = frame.return_pc;
    line_ = frame.line;
    push(result);
}

// ---------------------------------------------------------------- testi e liste

uint32_t Vm::alloc_object(uint8_t kind) {
    uint32_t index = 0;
    if (!free_objects_.empty()) {
        index = free_objects_.back();
        free_objects_.pop_back();
    } else {
        index = static_cast<uint32_t>(objects_.size());
        objects_.emplace_back();
    }
    Object& o = objects_[index];
    o.kind = kind;
    o.mark = false;
    o.pinned = false;
    return index;
}

bool Vm::reserve_heap(size_t bytes) {
    // Quando fare pulizia dipende solo dai byte contati, quindi è uguale su ogni piattaforma.
    if (heap_used_ + bytes > gc_threshold_) {
        collect();
        gc_threshold_ = heap_used_ * 2 + 1024;
        if (gc_threshold_ > limits_.max_heap) gc_threshold_ = limits_.max_heap;
    }
    if (heap_used_ + bytes > limits_.max_heap) {
        fail("memoria esaurita: il programma tiene insieme troppi testi e liste");
        return false;
    }
    heap_used_ += bytes;
    return true;
}

void Vm::release_heap(size_t bytes) { heap_used_ = heap_used_ >= bytes ? heap_used_ - bytes : 0; }

bool Vm::new_text(std::string s, Value& out) {
    if (s.size() > limits_.max_text) {
        fail("il testo è diventato troppo lungo (al massimo " + count_text(limits_.max_text) + " caratteri)");
        return false;
    }
    if (!reserve_heap(kObjectOverhead + s.size())) return false;
    const uint32_t ref = alloc_object(kObjectText);
    objects_[ref].text = std::move(s);
    out = make_ref(Type::Text, ref);
    return true;
}

bool Vm::new_list(size_t n, Value& out) {
    if (n > limits_.max_list) {
        fail("la lista è troppo lunga (al massimo " + count_text(limits_.max_list) + " elementi)");
        return false;
    }
    if (!reserve_heap(kObjectOverhead + n * kValueBytes)) return false;
    const uint32_t ref = alloc_object(kObjectList);
    objects_[ref].items.assign(n, Value());
    out = make_ref(Type::List, ref);
    return true;
}

bool Vm::list_append(uint32_t ref, const Value& v) {
    if (ref >= objects_.size() || objects_[ref].kind != kObjectList) {
        fail(kBroken);
        return false;
    }
    if (objects_[ref].items.size() >= limits_.max_list) {
        fail("la lista è diventata troppo lunga (al massimo " + count_text(limits_.max_list) + " elementi)");
        return false;
    }
    const Value copy = v;
    temp_roots_.push_back(copy);  // durante la pulizia il valore nuovo non deve sparire
    const bool ok = reserve_heap(kValueBytes);
    temp_roots_.pop_back();
    if (!ok) return false;
    objects_[ref].items.push_back(copy);
    return true;
}

void Vm::collect() {
    std::vector<uint32_t> work;
    auto mark = [&](const Value& v) {
        if ((v.type != Type::Text && v.type != Type::List) || v.ref >= objects_.size()) return;
        Object& o = objects_[v.ref];
        if (o.kind == 0 || o.mark) return;
        o.mark = true;
        if (o.kind == kObjectList) work.push_back(v.ref);
    };
    for (size_t i = 0; i < sp_; ++i) mark(stack_[i]);
    for (const Value& v : globals_) mark(v);
    for (const Value& v : temp_roots_) mark(v);
    while (!work.empty()) {
        const uint32_t ref = work.back();
        work.pop_back();
        for (const Value& v : objects_[ref].items) mark(v);
    }
    for (uint32_t i = 0; i < objects_.size(); ++i) {
        Object& o = objects_[i];
        if (o.kind == 0) continue;
        if (o.mark || o.pinned) {
            o.mark = false;
            continue;
        }
        release_heap(kObjectOverhead + (o.kind == kObjectText ? o.text.size() : o.items.size() * kValueBytes));
        o.kind = 0;
        std::string().swap(o.text);
        std::vector<Value>().swap(o.items);
        free_objects_.push_back(i);
    }
}

const std::string& Vm::text_of(const Value& v) const {
    if (v.type != Type::Text || v.ref >= objects_.size() || objects_[v.ref].kind != kObjectText) return kEmptyText;
    return objects_[v.ref].text;
}

bool Vm::equal(const Value& a, const Value& b, int depth) const {
    if (a.type != b.type) return false;
    switch (a.type) {
        case Type::Bool: return a.b == b.b;
        case Type::Number: return a.n == b.n;
        case Type::Text: return a.ref == b.ref || text_of(a) == text_of(b);
        case Type::List: {
            if (a.ref == b.ref) return true;
            if (depth >= 8 || a.ref >= objects_.size() || b.ref >= objects_.size()) return false;
            const std::vector<Value>& x = objects_[a.ref].items;
            const std::vector<Value>& y = objects_[b.ref].items;
            if (x.size() != y.size()) return false;
            for (size_t i = 0; i < x.size(); ++i)
                if (!equal(x[i], y[i], depth + 1)) return false;
            return true;
        }
        default: return true;  // niente è uguale a niente
    }
}

std::string Vm::to_text(const Value& v, bool quoted, int depth) const {
    switch (v.type) {
        case Type::Nil: return "niente";
        case Type::Bool: return v.b ? "vero" : "falso";
        case Type::Number: return format_number(v.n);
        case Type::Text: return quoted ? "\"" + text_of(v) + "\"" : text_of(v);
        case Type::List: {
            if (depth >= 3 || v.ref >= objects_.size()) return "[...]";
            std::string out = "[";
            const std::vector<Value>& items = objects_[v.ref].items;
            for (size_t i = 0; i < items.size(); ++i) {
                if (i != 0) out += ", ";
                if (out.size() > limits_.max_text) {  // inutile andare avanti: è già troppo lungo
                    out += "...";
                    break;
                }
                out += to_text(items[i], true, depth + 1);
            }
            return out + "]";
        }
        default: return "?";
    }
}

// ---------------------------------------------------------------- passo passo

std::vector<Variable> Vm::variables() const {
    std::vector<Variable> out;
    auto shown = [&](const Value& v) {
        std::string s = to_text(v, true, 0);
        if (s.size() > 96) {
            size_t i = 0, cut = 0;
            uint32_t cp = 0;
            while (i < s.size() && i <= 90) {
                cut = i;
                utf8_next(s, i, cp);
            }
            s.resize(cut);
            s += "...";
        }
        return s;
    };
    if (frames_.empty()) return out;
    const Frame& frame = frames_.back();
    std::vector<uint8_t> slots;
    for (const LocalInfo& info : program_.locals) {
        if (info.function != frame.function || pc_ < info.from_pc || pc_ >= info.to_pc) continue;
        const size_t index = static_cast<size_t>(frame.base) + info.slot;
        if (index >= sp_) continue;
        Variable var;
        var.name = info.name;
        var.value = shown(stack_[index]);
        var.local = true;
        // nell'ordine in cui sono nate (i valori tra parentesi per primi)
        size_t at = out.size();
        while (at > 0 && slots[at - 1] > info.slot) --at;
        out.insert(out.begin() + static_cast<std::ptrdiff_t>(at), var);
        slots.insert(slots.begin() + static_cast<std::ptrdiff_t>(at), info.slot);
    }
    for (size_t i = 0; i < globals_.size() && i < program_.globals.size(); ++i) {
        if (globals_[i].type == Type::Unset) continue;
        Variable var;
        var.name = program_.globals[i];
        var.value = shown(globals_[i]);
        out.push_back(var);
    }
    return out;
}

std::vector<StackEntry> Vm::stack_trace() const {
    std::vector<StackEntry> out;
    for (size_t i = frames_.size(); i > 0; --i) {
        const Frame& frame = frames_[i - 1];
        StackEntry entry;
        if (frame.function < program_.functions.size()) entry.function = program_.functions[frame.function].name;
        entry.line = i == frames_.size() ? line_ : frames_[i].line;
        out.push_back(entry);
    }
    return out;
}

}  // namespace script
}  // namespace polpo
