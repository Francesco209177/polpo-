// PolpoScript — dal testo del programma alle "parole" (token).
#pragma once

#include <cstdint>
#include <string>

namespace polpo {
namespace script {

enum class Tok : uint8_t {
    End,
    Newline,
    Number,
    Text,
    Name,
    // parole riservate
    Se,
    Allora,
    Altrimenti,
    Fine,
    Ripeti,
    Sempre,
    Volte,
    Finche,
    Per,
    Ogni,
    Passo,
    Funzione,
    Ritorna,
    Esci,
    Continua,
    Locale,
    Vero,
    Falso,
    Niente,
    Non,
    Oppure,
    // simboli
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    LParen,
    RParen,
    LBracket,
    RBracket,
    Comma,
    Assign,
    PlusAssign,
    MinusAssign,
    StarAssign,
    SlashAssign,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Invalid,  // text = spiegazione dell'errore
};

struct Token {
    Tok type = Tok::End;
    uint16_t line = 1;
    double number = 0;
    std::string text;  // Name: nome normalizzato; Text: contenuto; Invalid: messaggio
};

class Lexer {
   public:
    Lexer(const std::string& source, size_t max_text) : src_(source), max_text_(max_text) {}
    Token next();
    void reset() {
        pos_ = 0;
        line_ = 1;
    }

   private:
    Token make(Tok type) const;
    Token invalid(const std::string& message) const;
    Token read_number();
    Token read_text(bool double_quotes);
    Token read_name();

    const std::string& src_;
    size_t max_text_;
    size_t pos_ = 0;
    uint16_t line_ = 1;
};

// Nome italiano di un token, per i messaggi d'errore ("«allora»", "un numero", "la fine della riga").
std::string token_description(const Token& t);
// La parola riservata con questo nome normalizzato, o Tok::Name.
Tok keyword(const std::string& name);
const char* keyword_spelling(Tok t);

}  // namespace script
}  // namespace polpo
