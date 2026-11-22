// PolpoScript — compilatore: dal testo del programma alle istruzioni della macchina virtuale.
//
// Una sola passata, senza costruire strutture intermedie (sul dispositivo la memoria è poca). Prima una
// scorsa veloce raccoglie i nomi delle funzioni, così si possono usare anche prima di averle definite.
// La profondità di espressioni e blocchi è limitata: il compilatore usa poca pila anche con programmi assurdi.
#include <utility>

#include "polpo/script/lexer.h"
#include "polpo/script/script.h"
#include "polpo/util/utf8.h"

namespace polpo {
namespace script {
namespace {

constexpr int kMaxExprDepth = 12;
constexpr int kMaxBlockDepth = 10;
constexpr unsigned kMaxArgs = 16;
constexpr unsigned kMaxLocals = 48;
constexpr size_t kMaxFunctions = 64;
constexpr size_t kNoPatch = static_cast<size_t>(-1);

enum Prec { kPrecOr = 1, kPrecAnd = 2, kPrecCompare = 3, kPrecAdd = 4, kPrecMul = 5 };

std::string number_text(unsigned v) { return format_number(static_cast<double>(v)); }

// Distanza tra due nomi, per suggerire «forse volevi…»: quante lettere aggiungere, togliere o cambiare;
// due lettere vicine scambiate di posto («fien» per «fine») contano come un solo errore.
unsigned edit_distance(const std::string& a, const std::string& b) {
    constexpr size_t kMax = 40;
    if (a.size() >= kMax || b.size() >= kMax) return 99;
    unsigned before[kMax + 1], prev[kMax + 1], cur[kMax + 1];
    for (size_t j = 0; j <= b.size(); ++j) before[j] = prev[j] = static_cast<unsigned>(j);
    for (size_t i = 1; i <= a.size(); ++i) {
        cur[0] = static_cast<unsigned>(i);
        for (size_t j = 1; j <= b.size(); ++j) {
            unsigned best = prev[j - 1] + (a[i - 1] == b[j - 1] ? 0u : 1u);
            if (prev[j] + 1 < best) best = prev[j] + 1;
            if (cur[j - 1] + 1 < best) best = cur[j - 1] + 1;
            if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] && before[j - 2] + 1 < best)
                best = before[j - 2] + 1;
            cur[j] = best;
        }
        for (size_t j = 0; j <= b.size(); ++j) {
            before[j] = prev[j];
            prev[j] = cur[j];
        }
    }
    return prev[b.size()];
}

class Compiler {
   public:
    Compiler(const std::string& source, const Limits& limits, Program& out)
        : source_(source), limits_(limits), out_(out), lex_(source, limits.max_text) {}

    bool run(Error& error) {
        collect_functions();
        next_ = lex_.next();
        advance();
        scope_ = &top_;
        emit(Op::Reserve);
        const size_t reserve_at = out_.code.size();
        byte(0);
        block();
        if (!failed_ && cur_.type == Tok::Fine) fail("questo «fine» è di troppo: non chiude niente");
        if (!failed_ && cur_.type == Tok::Altrimenti) fail("questo «altrimenti» non ha un «se» a cui riferirsi");
        if (!failed_ && cur_.type != Tok::End) fail("non capisco " + token_description(cur_));
        emit(Op::Halt);
        if (!failed_) {
            out_.code[reserve_at] = top_.max_slot;
            out_.lines = cur_.line;
        }
        error = error_;
        return !failed_;
    }

   private:
    struct Local {
        std::string name;  // vuoto = variabile interna di un ciclo
        uint8_t slot = 0;
        uint8_t depth = 0;
        uint16_t from_pc = 0;
    };
    struct Scope {  // una funzione, oppure il programma principale
        uint8_t function = kTopLevel;
        std::vector<Local> locals;
        uint8_t next_slot = 0;
        uint8_t max_slot = 0;
        uint8_t depth = 0;
        size_t loop_base = 0;
    };
    struct Loop {
        std::vector<size_t> breaks;
        std::vector<size_t> continues;
        bool has_target = false;
        uint16_t target = 0;
    };

    // ------------------------------------------------------------ errori e parole

    void fail_at(uint16_t line, const std::string& message) {
        if (failed_) return;
        failed_ = true;
        error_.line = line;
        error_.message = message;
        cur_ = Token();
        next_ = Token();
    }
    void fail(const std::string& message) { fail_at(cur_.line, message); }

    void advance() {
        if (failed_) return;
        cur_ = std::move(next_);
        next_ = lex_.next();
        if (cur_.type == Tok::Invalid) fail_at(cur_.line, cur_.text);
    }
    bool expect(Tok type, const std::string& message) {
        if (failed_) return false;
        if (cur_.type != type) {
            fail(message + " (ho trovato " + token_description(cur_) + ")");
            return false;
        }
        advance();
        return !failed_;
    }
    bool expect_word(const char* word, const std::string& message) {  // parole non riservate: da, a, in
        if (failed_) return false;
        if (cur_.type != Tok::Name || cur_.text != word) {
            fail(message + " (ho trovato " + token_description(cur_) + ")");
            return false;
        }
        advance();
        return !failed_;
    }
    bool expect_line_end(const std::string& message) {
        if (failed_) return false;
        if (cur_.type != Tok::Newline && cur_.type != Tok::End) {
            fail(message + " (ho trovato " + token_description(cur_) + ")");
            return false;
        }
        return true;
    }
    bool expect_fine(uint16_t open_line, const char* what) {
        if (failed_) return false;
        if (cur_.type != Tok::Fine) {
            fail(std::string("manca «fine» per chiudere «") + what + "» della riga " + number_text(open_line));
            return false;
        }
        advance();
        return !failed_;
    }

    std::string suggestion(const std::string& name, bool functions, bool keywords) const {
        std::string best;
        unsigned best_distance = name.size() <= 4 ? 1u : 2u;
        auto consider = [&](const std::string& candidate) {
            const unsigned d = edit_distance(name, candidate);
            if (d != 0 && d <= best_distance && (best.empty() || d < best_distance)) {
                best = candidate;
                best_distance = d;
            }
        };
        if (functions) {
            size_t count = 0;
            const NativeInfo* natives = native_table(count);
            for (size_t i = 0; i < count; ++i) consider(natives[i].name);
            for (const FunctionInfo& f : out_.functions) consider(f.name);
        }
        if (keywords) {
            for (Tok t : {Tok::Se, Tok::Allora, Tok::Altrimenti, Tok::Fine, Tok::Ripeti, Tok::Sempre, Tok::Volte,
                          Tok::Finche, Tok::Per, Tok::Ogni, Tok::Passo, Tok::Funzione, Tok::Ritorna, Tok::Esci,
                          Tok::Continua, Tok::Locale, Tok::Oppure})
                consider(keyword_spelling(t));
        }
        return best.empty() ? "" : ". Forse volevi «" + best + "»?";
    }

    // ------------------------------------------------------------ istruzioni in uscita

    uint16_t here() const { return static_cast<uint16_t>(out_.code.size()); }
    void byte(uint8_t b) {
        if (failed_) return;
        if (out_.code.size() >= limits_.max_code || out_.code.size() >= 65000) {
            fail("il programma è troppo lungo per la memoria del Polpo");
            return;
        }
        out_.code.push_back(b);
    }
    void emit(Op op) { byte(static_cast<uint8_t>(op)); }
    void u16(uint16_t v) {
        byte(static_cast<uint8_t>(v & 0xFF));
        byte(static_cast<uint8_t>(v >> 8));
    }
    size_t emit_jump(Op op) {
        emit(op);
        const size_t at = out_.code.size();
        u16(0xFFFF);
        return at;
    }
    void jump_to(uint16_t target) {
        emit(Op::Jump);
        u16(target);
    }
    void patch_to(size_t at, uint16_t target) {
        if (failed_ || at == kNoPatch || at + 1 >= out_.code.size()) return;
        out_.code[at] = static_cast<uint8_t>(target & 0xFF);
        out_.code[at + 1] = static_cast<uint8_t>(target >> 8);
    }
    void patch(size_t at) { patch_to(at, here()); }
    void line_marker(uint16_t line) {
        emit(Op::Line);
        u16(line);
    }

    void number_const(double v) {
        if (v >= -128 && v <= 127 && static_cast<double>(static_cast<int>(v)) == v) {
            emit(Op::Int8);
            byte(static_cast<uint8_t>(static_cast<int8_t>(static_cast<int>(v))));
            return;
        }
        for (size_t i = 0; i < out_.constants.size(); ++i) {
            if (!out_.constants[i].is_text && out_.constants[i].number == v) {
                emit(Op::Const);
                u16(static_cast<uint16_t>(i));
                return;
            }
        }
        Constant c;
        c.number = v;
        add_constant(std::move(c));
    }
    void text_const(const std::string& s) {
        for (size_t i = 0; i < out_.constants.size(); ++i) {
            if (out_.constants[i].is_text && out_.constants[i].text == s) {
                emit(Op::Const);
                u16(static_cast<uint16_t>(i));
                return;
            }
        }
        Constant c;
        c.is_text = true;
        c.text = s;
        add_constant(std::move(c));
    }
    void add_constant(Constant c) {
        if (failed_) return;
        if (out_.constants.size() >= limits_.max_constants || out_.constants.size() >= 65535) {
            fail("il programma contiene troppi numeri e testi diversi");
            return;
        }
        out_.constants.push_back(std::move(c));
        emit(Op::Const);
        u16(static_cast<uint16_t>(out_.constants.size() - 1));
    }

    // ------------------------------------------------------------ nomi

    static bool named_constant(const std::string& name, double& value) {
        size_t count = 0;
        const NamedConstant* table = constant_table(count);
        for (size_t i = 0; i < count; ++i) {
            if (name == table[i].name) {
                value = table[i].value;
                return true;
            }
        }
        return false;
    }
    int find_function(const std::string& name) const {
        for (size_t i = 0; i < out_.functions.size(); ++i)
            if (out_.functions[i].name == name) return static_cast<int>(i);
        return -1;
    }
    const Local* find_local(const std::string& name) const {
        for (size_t i = scope_->locals.size(); i > 0; --i)
            if (scope_->locals[i - 1].name == name) return &scope_->locals[i - 1];
        return nullptr;
    }
    int global_slot(const std::string& name) {
        for (size_t i = 0; i < out_.globals.size(); ++i)
            if (out_.globals[i] == name) return static_cast<int>(i);
        if (out_.globals.size() >= limits_.max_globals || out_.globals.size() >= 65535) {
            fail("il programma usa troppe variabili (al massimo " + number_text(static_cast<unsigned>(limits_.max_globals)) + ")");
            return -1;
        }
        out_.globals.push_back(name);
        return static_cast<int>(out_.globals.size() - 1);
    }
    int add_local(const std::string& name) {
        if (failed_) return -1;
        if (scope_->next_slot >= kMaxLocals) {
            fail("qui ci sono troppe variabili locali e cicli uno dentro l'altro");
            return -1;
        }
        Local l;
        l.name = name;
        l.slot = scope_->next_slot++;
        l.depth = scope_->depth;
        l.from_pc = here();
        scope_->locals.push_back(l);
        if (scope_->next_slot > scope_->max_slot) scope_->max_slot = scope_->next_slot;
        return l.slot;
    }
    void begin_scope() { ++scope_->depth; }
    void end_scope() {  // le variabili locali nate nel blocco finiscono qui
        close_locals(scope_->depth);
        --scope_->depth;
    }
    void close_locals(uint8_t depth) {
        while (!scope_->locals.empty() && scope_->locals.back().depth >= depth) {
            const Local& l = scope_->locals.back();
            if (!l.name.empty() && !failed_) {
                LocalInfo info;
                info.function = scope_->function;
                info.slot = l.slot;
                info.from_pc = l.from_pc;
                info.to_pc = here();
                info.name = l.name;
                out_.locals.push_back(info);
            }
            scope_->next_slot = l.slot;
            scope_->locals.pop_back();
        }
    }
    bool enter_block() {
        if (failed_) return false;
        if (++block_depth_ > kMaxBlockDepth) {
            fail("troppi blocchi uno dentro l'altro (al massimo " + number_text(kMaxBlockDepth) + "): sposta una parte in una funzione");
            return false;
        }
        return true;
    }
    void leave_block() { --block_depth_; }

    void load_variable(const std::string& name) {
        double value = 0;
        if (named_constant(name, value)) {
            number_const(value);
            return;
        }
        if (const Local* l = find_local(name)) {
            emit(Op::LoadLocal);
            byte(l->slot);
            return;
        }
        const int g = global_slot(name);
        if (g < 0) return;
        emit(Op::LoadGlobal);
        u16(static_cast<uint16_t>(g));
    }
    bool can_assign(const std::string& name, uint16_t line) {
        double value = 0;
        if (named_constant(name, value)) {
            fail_at(line, "«" + name + "» è un valore già pronto e non si può cambiare: scegli un altro nome");
            return false;
        }
        return true;
    }
    void store_variable(const std::string& name) {
        if (const Local* l = find_local(name)) {
            emit(Op::StoreLocal);
            byte(l->slot);
            return;
        }
        const int g = global_slot(name);
        if (g < 0) return;
        emit(Op::StoreGlobal);
        u16(static_cast<uint16_t>(g));
    }

    // ------------------------------------------------------------ funzioni: scorsa preliminare

    void collect_functions() {
        Lexer scan(source_, limits_.max_text);
        Token t = scan.next();
        bool at_start = true;
        while (t.type != Tok::End) {
            if (t.type == Tok::Newline) {
                at_start = true;
                t = scan.next();
                continue;
            }
            if (at_start && t.type == Tok::Funzione) {
                t = scan.next();
                if (t.type == Tok::Name) {
                    FunctionInfo f;
                    f.name = t.text;
                    f.line = t.line;
                    f.entry = 0xFFFF;
                    unsigned params = 0;
                    t = scan.next();
                    if (t.type == Tok::LParen) {
                        t = scan.next();
                        while (t.type == Tok::Name || t.type == Tok::Comma) {
                            if (t.type == Tok::Name) ++params;
                            t = scan.next();
                        }
                    }
                    f.params = static_cast<uint8_t>(params > 255 ? 255 : params);
                    if (out_.functions.size() < kMaxFunctions) out_.functions.push_back(f);
                    else too_many_functions_ = f.line;
                }
                at_start = false;
                continue;
            }
            at_start = false;
            t = scan.next();
        }
    }

    // ------------------------------------------------------------ istruzioni

    void block() {  // fino a «fine», «altrimenti» o alla fine del programma
        for (;;) {
            while (!failed_ && cur_.type == Tok::Newline) advance();
            if (failed_ || cur_.type == Tok::End) return;
            if (reserved_as_name()) return;
            if (cur_.type == Tok::Fine || cur_.type == Tok::Altrimenti) return;
            statement();
            if (failed_) return;
            if (cur_.type != Tok::Newline && cur_.type != Tok::End) {
                fail("non capisco " + token_description(cur_) + " in fondo alla riga: ogni istruzione sta su una riga sua");
                return;
            }
        }
    }

    // «fine = 3», «passo += 1»: una parola del linguaggio usata come nome di variabile.
    bool reserved_as_name() {
        Op op = Op::Add;
        if (cur_.type < Tok::Se || cur_.type > Tok::Oppure) return false;
        if (next_.type != Tok::Assign && !compound_op(next_.type, op)) return false;
        fail(std::string("«") + keyword_spelling(cur_.type) + "» è una parola del linguaggio e non può essere il nome di una variabile: scegline un altro");
        return true;
    }

    void statement() {
        line_marker(cur_.line);
        switch (cur_.type) {
            case Tok::Se: if_statement(); break;
            case Tok::Ripeti: repeat_statement(); break;
            case Tok::Per: for_statement(); break;
            case Tok::Funzione: function_statement(); break;
            default: simple_statement(); break;
        }
    }

    void simple_statement() {  // quelle che stanno su una riga sola
        const uint16_t line = cur_.line;
        switch (cur_.type) {
            case Tok::Ritorna:
                if (scope_->function == kTopLevel) {
                    fail("«ritorna» si usa solo dentro una funzione (per fermare il programma c'è termina())");
                    return;
                }
                advance();
                if (cur_.type == Tok::Newline || cur_.type == Tok::End) emit(Op::Nil);
                else expression();
                emit(Op::Return);
                break;
            case Tok::Esci:
            case Tok::Continua: {
                const bool is_break = cur_.type == Tok::Esci;
                if (loops_.size() <= scope_->loop_base) {
                    fail(std::string("«") + (is_break ? "esci" : "continua") + "» si usa solo dentro un ciclo («ripeti» o «per»)");
                    return;
                }
                advance();
                Loop& loop = loops_.back();
                if (is_break) loop.breaks.push_back(emit_jump(Op::Jump));
                else if (loop.has_target) jump_to(loop.target);
                else loop.continues.push_back(emit_jump(Op::Jump));
                break;
            }
            case Tok::Locale: {
                if (scope_->function == kTopLevel) {
                    fail("«locale» si usa solo dentro una funzione: fuori dalle funzioni le variabili valgono già dappertutto");
                    return;
                }
                advance();
                if (cur_.type != Tok::Name) {
                    fail("dopo «locale» ci vuole il nome della variabile (ho trovato " + token_description(cur_) + ")");
                    return;
                }
                const std::string name = cur_.text;
                if (!can_assign(name, line)) return;
                advance();
                if (cur_.type == Tok::Assign) {
                    advance();
                    expression();
                } else {
                    emit(Op::Nil);
                }
                const int slot = add_local(name);
                if (slot < 0) return;
                emit(Op::StoreLocal);
                byte(static_cast<uint8_t>(slot));
                break;
            }
            case Tok::Name: assignment_or_call(); break;
            case Tok::Altrimenti: fail("questo «altrimenti» non ha un «se» a cui riferirsi"); break;
            default:
                fail("una riga non può cominciare con " + token_description(cur_));
                break;
        }
    }

    static bool compound_op(Tok t, Op& op) {
        switch (t) {
            case Tok::PlusAssign: op = Op::Add; return true;
            case Tok::MinusAssign: op = Op::Sub; return true;
            case Tok::StarAssign: op = Op::Mul; return true;
            case Tok::SlashAssign: op = Op::Div; return true;
            default: return false;
        }
    }

    void assignment_or_call() {
        const std::string name = cur_.text;
        const uint16_t line = cur_.line;
        Op op = Op::Add;
        if (next_.type == Tok::LParen) {
            call();
            emit(Op::Pop);
        } else if (next_.type == Tok::Assign) {
            if (!can_assign(name, line)) return;
            advance();
            advance();
            expression();
            store_variable(name);
        } else if (compound_op(next_.type, op)) {
            if (!can_assign(name, line)) return;
            advance();
            advance();
            load_variable(name);
            expression();
            emit(op);
            store_variable(name);
        } else if (next_.type == Tok::LBracket) {
            advance();
            load_variable(name);
            for (;;) {
                advance();  // [
                expression();
                if (!expect(Tok::RBracket, "manca «]»")) return;
                if (cur_.type != Tok::LBracket) break;
                emit(Op::IndexGet);
            }
            if (cur_.type == Tok::Assign) {
                advance();
                expression();
            } else if (compound_op(cur_.type, op)) {
                advance();
                emit(Op::Dup2);
                emit(Op::IndexGet);
                expression();
                emit(op);
            } else {
                fail("dopo «" + name + "[…]» ci vuole «=» e il nuovo valore: da sola questa riga non fa niente");
                return;
            }
            emit(Op::IndexSet);
        } else if (next_.type == Tok::Newline || next_.type == Tok::End) {
            if (find_function(name) >= 0 || find_native(name) >= 0)
                fail("per usare la funzione «" + name + "» ci vogliono le parentesi: " + name + "()");
            else
                fail("«" + name + "» da solo non fa niente: per dargli un valore scrivi «" + name + " = …»" + suggestion(name, true, true));
        } else {
            fail("non capisco «" + name + "» seguito da " + token_description(next_) + suggestion(name, true, true));
        }
    }

    void if_statement() {
        const uint16_t open_line = cur_.line;
        advance();
        expression();
        if (!expect(Tok::Allora, "dopo la condizione di «se» ci vuole «allora»")) return;
        if (cur_.type != Tok::Newline) {  // forma corta: se … allora istruzione
            if (cur_.type == Tok::End) {
                fail("dopo «allora» manca che cosa fare");
                return;
            }
            if (cur_.type == Tok::Se || cur_.type == Tok::Ripeti || cur_.type == Tok::Per || cur_.type == Tok::Funzione) {
                fail("sulla stessa riga di «allora» può stare solo un'istruzione semplice: per le altre vai a capo e chiudi con «fine»");
                return;
            }
            const size_t skip = emit_jump(Op::JumpIfFalse);
            simple_statement();
            patch(skip);
            return;
        }
        if (!enter_block()) return;
        std::vector<size_t> ends;
        size_t next_case = emit_jump(Op::JumpIfFalse);
        begin_scope();
        block();
        end_scope();
        while (!failed_ && cur_.type == Tok::Altrimenti) {
            advance();
            ends.push_back(emit_jump(Op::Jump));
            patch(next_case);
            next_case = kNoPatch;
            if (cur_.type == Tok::Se) {
                line_marker(cur_.line);
                advance();
                expression();
                if (!expect(Tok::Allora, "dopo la condizione di «altrimenti se» ci vuole «allora»")) return;
                if (!expect_line_end("dopo «allora» qui si va a capo")) return;
                next_case = emit_jump(Op::JumpIfFalse);
                begin_scope();
                block();
                end_scope();
                continue;
            }
            if (!expect_line_end("dopo «altrimenti» si va a capo (oppure si scrive «altrimenti se … allora»)")) return;
            begin_scope();
            block();
            end_scope();
            if (!failed_ && cur_.type == Tok::Altrimenti) {
                fail("dopo un «altrimenti» non ce ne può essere un altro: per più casi usa «altrimenti se … allora»");
                return;
            }
            break;
        }
        if (!expect_fine(open_line, "se")) return;
        patch(next_case);
        for (size_t at : ends) patch(at);
        leave_block();
    }

    void close_loop() {
        if (failed_ || loops_.empty()) return;
        for (size_t at : loops_.back().breaks) patch(at);
        loops_.pop_back();
    }

    void repeat_statement() {
        const uint16_t open_line = cur_.line;
        advance();
        if (!enter_block()) return;
        begin_scope();
        size_t exit_at = kNoPatch;
        Loop loop;
        loop.has_target = true;
        if (cur_.type == Tok::Sempre) {
            advance();
            if (!expect_line_end("dopo «ripeti sempre» si va a capo")) return;
            loop.target = here();
        } else if (cur_.type == Tok::Finche) {
            advance();
            loop.target = here();
            line_marker(open_line);  // la condizione si ricalcola a ogni giro
            expression();
            if (!expect_line_end("dopo la condizione di «ripeti finché» si va a capo")) return;
            exit_at = emit_jump(Op::JumpIfFalse);
        } else {
            if (cur_.type == Tok::Newline || cur_.type == Tok::End) {
                fail("dopo «ripeti» ci vuole «sempre», «finché …» oppure un numero seguito da «volte»");
                return;
            }
            expression();
            if (!expect(Tok::Volte, "dopo «ripeti» ci vuole «sempre», «finché …» oppure un numero seguito da «volte»")) return;
            if (!expect_line_end("dopo «volte» si va a capo")) return;
            const int counter = add_local("");
            if (counter < 0) return;
            emit(Op::ToCount);
            emit(Op::StoreLocal);
            byte(static_cast<uint8_t>(counter));
            loop.target = here();
            emit(Op::RepeatTest);
            byte(static_cast<uint8_t>(counter));
            exit_at = out_.code.size();
            u16(0xFFFF);
        }
        if (failed_) return;
        loops_.push_back(loop);
        block();
        jump_to(loop.target);
        if (!expect_fine(open_line, "ripeti")) return;
        patch(exit_at);
        close_loop();
        end_scope();
        leave_block();
    }

    void for_statement() {
        const uint16_t open_line = cur_.line;
        advance();
        if (!enter_block()) return;
        begin_scope();
        size_t exit_at = kNoPatch;
        Loop loop;
        if (cur_.type == Tok::Ogni) {
            advance();
            if (cur_.type != Tok::Name) {
                fail("dopo «per ogni» ci vuole il nome di una variabile, per esempio: per ogni x in lista");
                return;
            }
            const std::string name = cur_.text;
            if (!can_assign(name, cur_.line)) return;
            advance();
            if (!expect_word("in", "dopo il nome ci vuole «in», per esempio: per ogni x in lista")) return;
            expression();
            if (!expect_line_end("dopo la lista di «per ogni» si va a capo")) return;
            const int sequence = add_local("");
            const int index = add_local("");
            if (sequence < 0 || index < 0) return;
            emit(Op::ToSequence);
            emit(Op::StoreLocal);
            byte(static_cast<uint8_t>(sequence));
            emit(Op::Int8);
            byte(0);
            emit(Op::StoreLocal);
            byte(static_cast<uint8_t>(index));
            loop.has_target = true;
            loop.target = here();
            line_marker(open_line);
            emit(Op::EachNext);
            byte(static_cast<uint8_t>(sequence));
            exit_at = out_.code.size();
            u16(0xFFFF);
            store_variable(name);
            if (failed_) return;
            loops_.push_back(loop);
            block();
            jump_to(loop.target);
        } else {
            if (cur_.type != Tok::Name) {
                fail("dopo «per» ci vuole il nome di una variabile (per i da 1 a 10) oppure «ogni» (per ogni x in lista)");
                return;
            }
            const std::string name = cur_.text;
            if (!can_assign(name, cur_.line)) return;
            advance();
            if (!expect_word("da", "dopo il nome ci vuole «da», per esempio: per i da 1 a 10")) return;
            expression();
            emit(Op::ToNumber);
            store_variable(name);
            if (!expect_word("a", "dopo il primo numero ci vuole «a», per esempio: per i da 1 a 10")) return;
            expression();
            emit(Op::ToNumber);
            const int limit = add_local("");
            if (limit < 0) return;
            emit(Op::StoreLocal);
            byte(static_cast<uint8_t>(limit));
            if (cur_.type == Tok::Passo) {
                advance();
                expression();
            } else {
                emit(Op::Int8);
                byte(1);
            }
            emit(Op::ToStep);
            const int step = add_local("");
            if (step < 0) return;
            emit(Op::StoreLocal);
            byte(static_cast<uint8_t>(step));
            if (!expect_line_end("dopo i numeri di «per» si va a capo")) return;
            const uint16_t start = here();
            line_marker(open_line);
            load_variable(name);
            emit(Op::ForTest);
            byte(static_cast<uint8_t>(limit));
            exit_at = out_.code.size();
            u16(0xFFFF);
            if (failed_) return;
            loops_.push_back(loop);
            block();
            if (failed_) return;
            for (size_t at : loops_.back().continues) patch(at);
            load_variable(name);
            emit(Op::LoadLocal);
            byte(static_cast<uint8_t>(step));
            emit(Op::Add);
            store_variable(name);
            jump_to(start);
        }
        if (!expect_fine(open_line, "per")) return;
        patch(exit_at);
        close_loop();
        end_scope();
        leave_block();
    }

    void function_statement() {
        const uint16_t open_line = cur_.line;
        advance();
        if (scope_->function != kTopLevel || block_depth_ > 0) {
            fail_at(open_line, "una funzione si definisce fuori da tutto il resto, non dentro un blocco o un'altra funzione");
            return;
        }
        if (cur_.type != Tok::Name) {
            fail("dopo «funzione» ci vuole il suo nome, per esempio: funzione saluta()");
            return;
        }
        const std::string name = cur_.text;
        const uint16_t name_line = cur_.line;
        double ignored = 0;
        if (find_native(name) >= 0 || named_constant(name, ignored)) {
            fail("«" + name + "» esiste già nel linguaggio: scegli un altro nome per la tua funzione");
            return;
        }
        if (too_many_functions_ != 0) {
            fail_at(too_many_functions_, "troppe funzioni (al massimo " + number_text(static_cast<unsigned>(kMaxFunctions)) + ")");
            return;
        }
        int index = -1;
        for (size_t i = 0; i < out_.functions.size(); ++i) {
            if (out_.functions[i].name != name) continue;
            if (out_.functions[i].line != name_line) {
                fail("la funzione «" + name + "» è già definita alla riga " + number_text(out_.functions[i].line));
                return;
            }
            index = static_cast<int>(i);
            break;
        }
        if (index < 0) {
            fail("non riesco a leggere la definizione di questa funzione");
            return;
        }
        advance();
        if (!expect(Tok::LParen, "dopo il nome della funzione ci vogliono le parentesi, per esempio: funzione " + name + "()")) return;

        Scope function_scope;
        function_scope.function = static_cast<uint8_t>(index);
        function_scope.loop_base = loops_.size();
        Scope* const saved = scope_;
        scope_ = &function_scope;
        unsigned params = 0;
        while (!failed_ && cur_.type == Tok::Name) {
            if (find_local(cur_.text)) {
                fail("il nome «" + cur_.text + "» compare due volte tra le parentesi");
                break;
            }
            if (!can_assign(cur_.text, cur_.line)) break;
            if (++params > kMaxArgs) {
                fail("troppi valori tra le parentesi (al massimo " + number_text(kMaxArgs) + ")");
                break;
            }
            add_local(cur_.text);
            advance();
            if (cur_.type != Tok::Comma) break;
            advance();
        }
        if (!failed_ && expect(Tok::RParen, "manca «)» dopo i nomi tra le parentesi") &&
            expect_line_end("dopo «)» si va a capo") && enter_block()) {
            const size_t skip = emit_jump(Op::Jump);
            out_.functions[static_cast<size_t>(index)].entry = here();
            out_.functions[static_cast<size_t>(index)].params = static_cast<uint8_t>(params);
            emit(Op::Reserve);
            const size_t reserve_at = out_.code.size();
            byte(0);
            block();
            if (expect_fine(open_line, "funzione")) {
                emit(Op::Nil);
                emit(Op::Return);
                close_locals(0);
                if (!failed_) out_.code[reserve_at] = static_cast<uint8_t>(function_scope.max_slot - params);
                patch(skip);
            }
            leave_block();
        }
        scope_ = saved;
    }

    // ------------------------------------------------------------ espressioni

    static bool binary_operator(const Token& t, int& prec, Op& op) {
        switch (t.type) {
            case Tok::Oppure: prec = kPrecOr; op = Op::OrJump; return true;
            case Tok::Name:
                if (t.text == "o") {
                    prec = kPrecOr;
                    op = Op::OrJump;
                    return true;
                }
                if (t.text == "e") {
                    prec = kPrecAnd;
                    op = Op::AndJump;
                    return true;
                }
                return false;
            case Tok::Eq:
            case Tok::Assign: prec = kPrecCompare; op = Op::Eq; return true;  // dentro un'espressione «=» confronta
            case Tok::Ne: prec = kPrecCompare; op = Op::Ne; return true;
            case Tok::Lt: prec = kPrecCompare; op = Op::Lt; return true;
            case Tok::Le: prec = kPrecCompare; op = Op::Le; return true;
            case Tok::Gt: prec = kPrecCompare; op = Op::Gt; return true;
            case Tok::Ge: prec = kPrecCompare; op = Op::Ge; return true;
            case Tok::Plus: prec = kPrecAdd; op = Op::Add; return true;
            case Tok::Minus: prec = kPrecAdd; op = Op::Sub; return true;
            case Tok::Star: prec = kPrecMul; op = Op::Mul; return true;
            case Tok::Slash: prec = kPrecMul; op = Op::Div; return true;
            case Tok::Percent: prec = kPrecMul; op = Op::Mod; return true;
            default: return false;
        }
    }

    bool deeper() {
        if (failed_) return false;
        if (++expr_depth_ > kMaxExprDepth) {
            fail("questa espressione è troppo complicata: spezzala su più righe usando delle variabili");
            return false;
        }
        return true;
    }

    void expression(int min_prec = kPrecOr) {  // lascia un valore sulla pila
        if (!deeper()) return;
        unary();
        for (;;) {
            int prec = 0;
            Op op = Op::Add;
            if (failed_ || !binary_operator(cur_, prec, op) || prec < min_prec) break;
            advance();
            if (op == Op::AndJump || op == Op::OrJump) {
                const size_t skip = emit_jump(op);
                expression(prec + 1);
                emit(Op::CheckBool);
                patch(skip);
            } else {
                expression(prec + 1);
                emit(op);
                int next_prec = 0;
                Op next_op = Op::Add;
                if (prec == kPrecCompare && !failed_ && binary_operator(cur_, next_prec, next_op) && next_prec == kPrecCompare) {
                    fail("due confronti di fila non si possono scrivere: usa «e», per esempio «a < b e b < c»");
                    break;
                }
            }
        }
        --expr_depth_;
    }

    void unary() {
        if (cur_.type == Tok::Minus) {
            advance();
            if (cur_.type == Tok::Number && next_.type != Tok::LBracket) {
                number_const(cur_.number == 0 ? 0.0 : -cur_.number);
                advance();
                return;
            }
            if (!deeper()) return;
            unary();
            --expr_depth_;
            emit(Op::Neg);
        } else if (cur_.type == Tok::Non) {
            advance();
            expression(kPrecCompare);
            emit(Op::Not);
        } else {
            primary();
            while (!failed_ && cur_.type == Tok::LBracket) {
                advance();
                expression();
                if (!expect(Tok::RBracket, "manca «]»")) return;
                emit(Op::IndexGet);
            }
        }
    }

    void primary() {
        switch (cur_.type) {
            case Tok::Number:
                number_const(cur_.number);
                advance();
                break;
            case Tok::Text:
                text_const(cur_.text);
                advance();
                break;
            case Tok::Vero:
                emit(Op::True);
                advance();
                break;
            case Tok::Falso:
                emit(Op::False);
                advance();
                break;
            case Tok::Niente:
                emit(Op::Nil);
                advance();
                break;
            case Tok::Name:
                if (next_.type == Tok::LParen) {
                    call();
                } else {
                    const std::string name = cur_.text;
                    advance();
                    load_variable(name);
                }
                break;
            case Tok::LParen:
                advance();
                expression();
                expect(Tok::RParen, "manca la parentesi «)»");
                break;
            case Tok::LBracket: {
                advance();
                unsigned count = 0;
                if (cur_.type != Tok::RBracket) {
                    for (;;) {
                        expression();
                        if (failed_) return;
                        if (++count > 255) {
                            fail("una lista scritta tra parentesi quadre può avere al massimo 255 elementi: aggiungi gli altri con aggiungi()");
                            return;
                        }
                        if (cur_.type != Tok::Comma) break;
                        advance();
                    }
                }
                if (!expect(Tok::RBracket, "manca «]» per chiudere la lista")) return;
                emit(Op::List);
                byte(static_cast<uint8_t>(count));
                break;
            }
            default:
                fail("qui mi aspettavo un valore (un numero, un testo, una variabile…), ho trovato " + token_description(cur_));
                break;
        }
    }

    static std::string wants(unsigned lo, unsigned hi) {
        if (lo == hi) return lo == 0 ? "non vuole nessun valore" : lo == 1 ? "vuole 1 valore" : "vuole " + number_text(lo) + " valori";
        return "vuole da " + number_text(lo) + " a " + number_text(hi) + " valori";
    }
    static std::string given(unsigned n) {
        return n == 0 ? "qui non ce n'è nessuno" : n == 1 ? "qui ce n'è 1" : "qui ce ne sono " + number_text(n);
    }

    void call() {  // cur_ = nome, next_ = «(»
        const std::string name = cur_.text;
        const uint16_t line = cur_.line;
        advance();
        advance();
        unsigned argc = 0;
        if (cur_.type != Tok::RParen) {
            for (;;) {
                expression();
                if (failed_) return;
                if (++argc > kMaxArgs) {
                    fail("troppi valori tra le parentesi (al massimo " + number_text(kMaxArgs) + ")");
                    return;
                }
                if (cur_.type != Tok::Comma) break;
                advance();
            }
        }
        if (!expect(Tok::RParen, "manca la parentesi «)» dopo i valori di «" + name + "»")) return;
        const int fn = find_function(name);
        if (fn >= 0) {
            const unsigned params = out_.functions[static_cast<size_t>(fn)].params;
            if (argc != params) {
                fail_at(line, "la funzione «" + name + "» " + wants(params, params) + " tra le parentesi, " + given(argc));
                return;
            }
            emit(Op::Call);
            byte(static_cast<uint8_t>(fn));
            byte(static_cast<uint8_t>(argc));
            return;
        }
        const int native = find_native(name);
        if (native >= 0) {
            size_t count = 0;
            const NativeInfo& info = native_table(count)[native];
            if (argc < info.min_args || argc > info.max_args) {
                fail_at(line, "«" + name + "» " + wants(info.min_args, info.max_args) + " tra le parentesi, " + given(argc));
                return;
            }
            emit(Op::Native);
            byte(static_cast<uint8_t>(native));
            byte(static_cast<uint8_t>(argc));
            return;
        }
        fail_at(line, "non conosco la funzione «" + name + "»" + suggestion(name, true, false));
    }

    const std::string& source_;
    const Limits& limits_;
    Program& out_;
    Lexer lex_;
    Token cur_, next_;
    bool failed_ = false;
    Error error_;
    Scope top_;
    Scope* scope_ = nullptr;
    std::vector<Loop> loops_;
    int expr_depth_ = 0;
    int block_depth_ = 0;
    uint16_t too_many_functions_ = 0;
};

}  // namespace

bool compile(const std::string& source, const Limits& limits, Program& out, Error& error) {
    out = Program();
    error = Error();
    if (source.size() > limits.max_source) {
        error.message = "il programma è troppo lungo (al massimo " + number_text(static_cast<unsigned>(limits.max_source)) + " caratteri)";
        return false;
    }
    // I file salvati da alcuni programmi cominciano con un segno invisibile (BOM): si salta.
    std::string text = source.compare(0, 3, "\xEF\xBB\xBF") == 0 ? source.substr(3) : source;
    size_t i = 0;
    uint16_t line = 1;
    while (i < text.size()) {
        if (text[i] == '\n' && line < 65535) ++line;
        if (text[i] == '\0') {
            error.line = line;
            error.message = "c'è un carattere rovinato";
            return false;
        }
        uint32_t cp = 0;
        if (!utf8_next(text, i, cp)) {
            error.line = line;
            error.message = "c'è un carattere rovinato: il file dev'essere un testo semplice (UTF-8)";
            return false;
        }
    }
    Compiler compiler(text, limits, out);
    if (compiler.run(error)) return true;
    out = Program();
    return false;
}

}  // namespace script
}  // namespace polpo
