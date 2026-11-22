// Polpo — PolpoScript: un piccolo linguaggio in italiano per scrivere mini-app.
//
// Un programma viene compilato in istruzioni per una macchina virtuale a pila. La macchina:
//  * usa memoria limitata e decisa in anticipo (Limits): un programma non può esaurire quella del dispositivo;
//  * non blocca mai chi la ospita: esegue al massimo un certo numero di istruzioni per volta, e le attese
//    (aspetta, aspetta_tasto, chiedi) sono stati da cui viene fatta ripartire;
//  * controlla ogni accesso: istruzioni rovinate o programmi malevoli producono un errore, mai un guasto;
//  * parla con il mondo solo attraverso Host: schermo, tasti, suoni, orologio e file di testo nella propria
//    cartella. Non esistono, per scelta, funzioni per radio, infrarossi, NFC, tastiera USB, Bluetooth o Wi-Fi;
//  * dà gli stessi risultati su dispositivo, PC e browser: numeri e testi non dipendono dalla piattaforma.
//
// Il linguaggio è descritto in docs/POLPOSCRIPT.md.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace polpo {
namespace script {

constexpr int kScreenWidth = 240;
constexpr int kScreenHeight = 135;

// Limiti di un programma. I valori predefiniti sono quelli usati sul dispositivo.
struct Limits {
    size_t max_source = 16 * 1024;      // byte del testo del programma
    size_t max_code = 24 * 1024;        // byte di istruzioni
    size_t max_constants = 512;
    size_t max_globals = 128;
    size_t max_stack = 256;             // valori sulla pila (variabili locali comprese)
    size_t max_frames = 32;             // chiamate di funzione una dentro l'altra
    size_t max_heap = 32 * 1024;        // byte per testi e liste creati dal programma
    size_t max_text = 2048;             // byte di un singolo testo
    size_t max_list = 1024;             // elementi di una singola lista
};

struct Error {
    uint16_t line = 0;  // 0 = nessuna riga in particolare
    std::string message;
    bool ok() const { return message.empty(); }
    std::string text() const;  // "Riga 7: …"
};

// ---------------------------------------------------------------- programma compilato

enum class Op : uint8_t {
    Halt,
    Line,         // u16 riga: inizio di un'istruzione del programma
    Const,        // u16 indice
    Nil,
    True,
    False,
    Int8,         // i8
    Pop,
    Dup2,
    LoadGlobal,   // u16
    StoreGlobal,  // u16
    LoadLocal,    // u8
    StoreLocal,   // u8
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Neg,
    Not,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Jump,         // u16 indirizzo
    JumpIfFalse,  // u16: toglie la condizione (dev'essere vero/falso)
    AndJump,      // u16: se falso salta lasciandolo, altrimenti lo toglie
    OrJump,       // u16: se vero salta lasciandolo, altrimenti lo toglie
    CheckBool,    // il secondo valore di «e» / «oppure» dev'essere vero o falso
    Call,         // u8 funzione, u8 argomenti
    Native,       // u8 funzione, u8 argomenti
    Return,
    Reserve,      // u8: posto per le altre variabili locali
    List,         // u8 elementi
    IndexGet,
    IndexSet,
    ToCount,      // «ripeti N volte»: controlla N
    RepeatTest,   // u8 variabile, u16 fine
    ToNumber,     // «per»: controlla il limite
    ToStep,       // «per»: controlla il passo
    ForTest,      // u8 variabile del limite (il passo è la successiva), u16 fine
    ToSequence,   // «per ogni»: controlla lista o testo
    EachNext,     // u8 variabile della sequenza (l'indice è la successiva), u16 fine
    Count_,
};

struct Constant {
    bool is_text = false;
    double number = 0;
    std::string text;
};

struct FunctionInfo {
    std::string name;
    uint16_t entry = 0;
    uint8_t params = 0;
    uint16_t line = 0;
};

// Nomi delle variabili locali, per mostrarle durante l'esecuzione passo passo.
struct LocalInfo {
    uint8_t function = 0;  // kTopLevel = fuori dalle funzioni
    uint8_t slot = 0;
    uint16_t from_pc = 0;
    uint16_t to_pc = 0;
    std::string name;
};
constexpr uint8_t kTopLevel = 255;

struct Program {
    std::vector<uint8_t> code;
    std::vector<Constant> constants;
    std::vector<std::string> globals;
    std::vector<FunctionInfo> functions;
    std::vector<LocalInfo> locals;
    uint16_t lines = 0;
};

// Compila `source`. Con un errore restituisce false e riempie `error` (un solo errore: il primo).
bool compile(const std::string& source, const Limits& limits, Program& out, Error& error);

// ---------------------------------------------------------------- collegamento con il mondo

enum class DrawOp : uint8_t { Clear, Pixel, Line, Rect, Frame, Circle, Ring, Text, Show };

struct DrawCommand {
    DrawOp op = DrawOp::Clear;
    int16_t a = 0, b = 0, c = 0, d = 0;  // coordinate e misure, a seconda del comando
    uint16_t color = 0;                  // RGB565
    uint8_t size = 1;                    // solo Text
    const std::string* text = nullptr;   // solo Text
};

class Host {
   public:
    virtual ~Host() = default;
    virtual uint32_t now_ms() = 0;
    virtual void draw(const DrawCommand& command) = 0;
    virtual void print(const std::string& line) = 0;
    // Nomi dei tasti: un carattere ("a", "7") oppure su, giu, sinistra, destra, ok, indietro, spazio, canc, tab.
    virtual bool key_down(const std::string& name) = 0;
    virtual bool next_key(std::string& name) = 0;  // prossimo tasto premuto in coda, se c'è
    virtual void tone(uint32_t hz, uint32_t ms) = 0;
    // File di testo nella cartella dei dati degli script. Il nome è già stato controllato ([a-z0-9_.-]).
    virtual bool file_read(const std::string& name, std::string& out) = 0;
    virtual bool file_write(const std::string& name, const std::string& data) = 0;
};

// ---------------------------------------------------------------- macchina virtuale

enum class Type : uint8_t { Unset, Nil, Bool, Number, Text, List };

struct Value {
    Type type = Type::Nil;
    bool b = false;
    uint32_t ref = 0;  // Text, List: indice dell'oggetto
    double n = 0;
};

enum class State : uint8_t {
    Running,   // può proseguire: chiamare ancora run()
    Sleeping,  // aspetta(ms): riprende da solo quando è passato il tempo
    WaitKey,   // aspetta_tasto(): riprende quando Host::next_key dà un tasto
    WaitText,  // chiedi(domanda): riprende con answer()
    Paused,    // fermo su una riga (passo passo o punto di sosta): riprende con run()
    Done,
    Failed,
};

enum class StepMode : uint8_t { Into, Over, Out };

struct Variable {
    std::string name;
    std::string value;  // come lo mostrerebbe scrivi(), con i testi tra virgolette
    bool local = false;
};

struct StackEntry {
    std::string function;  // vuoto = programma principale
    uint16_t line = 0;
};

class Vm {
   public:
    Vm(const Program& program, Host& host, const Limits& limits = Limits());

    void start(uint32_t seed = 1);       // (ri)parte dall'inizio
    State run(uint32_t max_instructions);
    State state() const { return state_; }
    const Error& error() const { return error_; }
    void stop();                          // interruzione dall'esterno (tasto G0): stato Done
    bool stopped() const { return stopped_; }

    uint32_t sleep_left_ms();             // Sleeping: quanto manca
    const std::string& question() const { return question_; }  // WaitText
    void answer(const std::string& text);                      // WaitText: la risposta

    // Passo passo.
    uint16_t line() const { return line_; }
    void step(StepMode mode);             // da Paused: riparte e si ferma alla prossima riga
    void resume();                        // da Paused: riparte fino alla fine o al prossimo punto di sosta
    void pause() { pause_requested_ = true; }  // si ferma alla prossima riga
    void set_breakpoints(const std::vector<uint16_t>& lines) { breakpoints_ = lines; }
    std::vector<Variable> variables() const;
    std::vector<StackEntry> stack_trace() const;

    uint64_t instructions() const { return instructions_; }
    size_t heap_used() const { return heap_used_; }
    size_t stack_used() const { return sp_; }

   private:
    struct Frame {
        uint16_t return_pc = 0;
        uint16_t base = 0;
        uint16_t line = 0;
        uint8_t function = kTopLevel;
    };
    struct Object {
        uint8_t kind = 0;  // 0 libero, 1 testo, 2 lista
        bool mark = false;
        bool pinned = false;
        std::string text;
        std::vector<Value> items;
    };

    // vm.cpp
    void fail(const std::string& message);
    bool push(const Value& v);
    bool need(size_t values);
    bool fetch8(uint8_t& out);
    bool fetch16(uint16_t& out);
    bool jump_to(uint16_t target);
    bool resume_from_wait();
    void do_line(uint16_t line);
    void do_binary(Op op);
    void do_compare(Op op);
    void do_index_get();
    void do_index_set();
    void do_call(uint8_t function, uint8_t argc);
    void do_return();
    bool condition(const Value& v, bool& out);
    bool local_slot(uint8_t slot, size_t& index);

    // oggetti (vm.cpp)
    bool new_text(std::string s, Value& out);
    bool new_list(size_t n, Value& out);
    bool list_append(uint32_t ref, const Value& v);
    uint32_t alloc_object(uint8_t kind);
    bool reserve_heap(size_t bytes);
    void release_heap(size_t bytes);
    void collect();
    const std::string& text_of(const Value& v) const;
    bool equal(const Value& a, const Value& b, int depth) const;
    std::string to_text(const Value& v, bool quoted, int depth) const;
    static const char* type_name(const Value& v);  // "un numero", "un testo", …

    // natives.cpp
    void do_native(uint8_t id, uint8_t argc);
    void native(uint8_t id, uint8_t argc, const Value* args, Value& result);
    void native_fail(const std::string& message);
    bool arg_number(const Value& v, const char* what, double& out);
    bool arg_int(const Value& v, const char* what, double lo, double hi, int32_t& out);
    bool arg_coord(const Value& v, int16_t& out);
    bool arg_color(const Value& v, uint16_t& out);
    bool arg_text(const Value& v, const char* what, std::string& out);
    bool arg_list(const Value& v, const char* what, uint32_t& ref);
    bool arg_position(const Value& v, size_t count, bool one_past, size_t& index);
    uint32_t random_u32();

    const Program& program_;
    Host& host_;
    Limits limits_;

    State state_ = State::Done;
    Error error_;
    bool stopped_ = false;
    bool yield_ = false;

    std::vector<Value> stack_;
    size_t sp_ = 0;
    std::vector<Value> globals_;
    std::vector<Frame> frames_;
    uint16_t pc_ = 0;
    uint16_t line_ = 0;
    uint64_t instructions_ = 0;

    std::vector<Object> objects_;
    std::vector<uint32_t> free_objects_;
    std::vector<Value> temp_roots_;
    std::vector<uint32_t> constant_refs_;
    size_t heap_used_ = 0;
    size_t gc_threshold_ = 0;

    uint32_t rng_ = 1;
    uint32_t start_ms_ = 0;
    uint32_t sleep_start_ = 0;
    uint32_t sleep_ms_ = 0;
    std::string question_;

    const char* native_name_ = "";
    bool stepping_ = false;
    StepMode step_mode_ = StepMode::Into;
    uint16_t step_line_ = 0;
    size_t step_depth_ = 0;
    bool step_jumped_ = false;
    bool pause_requested_ = false;
    std::vector<uint16_t> breakpoints_;
};

// ---------------------------------------------------------------- funzioni e costanti già pronte

struct NativeInfo {
    const char* name;
    uint8_t min_args;
    uint8_t max_args;
};
const NativeInfo* native_table(size_t& count);
int find_native(const std::string& name);  // -1 se non esiste

struct NamedConstant {
    const char* name;
    double value;
};
const NamedConstant* constant_table(size_t& count);

// ---------------------------------------------------------------- numeri (uguali su ogni piattaforma)

std::string format_number(double v);
// Legge un numero scritto in cifre ("12", "-3.5", "3,5" se allow_comma). Tutto il testo dev'essere il numero.
bool parse_number(const std::string& s, bool allow_comma, double& out);
// Numero da cifre già separate: mantissa / 10^decimals, arrotondato correttamente.
double number_from_digits(uint64_t mantissa, unsigned decimals);
// Aggiunge una cifra alla mantissa; false se il numero non sarebbe più esatto (oltre 2^53: 15 cifre ci stanno sempre).
bool number_add_digit(uint64_t& mantissa, unsigned digit);
double sin_degrees(double degrees);
double cos_degrees(double degrees);

// Nome normalizzato: minuscole e vocali senza accento ("Velocità" -> "velocita").
// Restituisce false se contiene caratteri non ammessi in un nome.
bool normalize_name(const std::string& in, std::string& out);

}  // namespace script
}  // namespace polpo
