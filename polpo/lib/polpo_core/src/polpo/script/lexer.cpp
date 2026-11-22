#include "polpo/script/lexer.h"

#include "polpo/script/script.h"
#include "polpo/util/utf8.h"

namespace polpo {
namespace script {
namespace {

struct Keyword {
    const char* name;
    Tok tok;
};
const Keyword kKeywords[] = {
    {"se", Tok::Se},         {"allora", Tok::Allora},     {"altrimenti", Tok::Altrimenti}, {"fine", Tok::Fine},
    {"ripeti", Tok::Ripeti}, {"sempre", Tok::Sempre},     {"volte", Tok::Volte},           {"finche", Tok::Finche},
    {"per", Tok::Per},       {"ogni", Tok::Ogni},         {"passo", Tok::Passo},           {"funzione", Tok::Funzione},
    {"ritorna", Tok::Ritorna}, {"esci", Tok::Esci},       {"continua", Tok::Continua},     {"locale", Tok::Locale},
    {"vero", Tok::Vero},     {"falso", Tok::Falso},       {"niente", Tok::Niente},         {"non", Tok::Non},
    {"oppure", Tok::Oppure},
};

bool is_name_start(uint32_t cp) {
    if (cp < 0x80) return (cp >= 'a' && cp <= 'z') || (cp >= 'A' && cp <= 'Z') || cp == '_';
    return ascii_fallback(cp) != 0;
}
bool is_name_part(uint32_t cp) { return is_name_start(cp) || (cp >= '0' && cp <= '9'); }

}  // namespace

Tok keyword(const std::string& name) {
    for (const Keyword& k : kKeywords)
        if (name == k.name) return k.tok;
    return Tok::Name;
}

const char* keyword_spelling(Tok t) {
    for (const Keyword& k : kKeywords)
        if (k.tok == t) return k.name;
    return "";
}

std::string token_description(const Token& t) {
    switch (t.type) {
        case Tok::End: return "la fine del programma";
        case Tok::Newline: return "la fine della riga";
        case Tok::Number: return "un numero";
        case Tok::Text: return "un testo";
        case Tok::Name: return "«" + t.text + "»";
        case Tok::Plus: return "«+»";
        case Tok::Minus: return "«-»";
        case Tok::Star: return "«*»";
        case Tok::Slash: return "«/»";
        case Tok::Percent: return "«%»";
        case Tok::LParen: return "«(»";
        case Tok::RParen: return "«)»";
        case Tok::LBracket: return "«[»";
        case Tok::RBracket: return "«]»";
        case Tok::Comma: return "una virgola";
        case Tok::Assign: return "«=»";
        case Tok::PlusAssign: return "«+=»";
        case Tok::MinusAssign: return "«-=»";
        case Tok::StarAssign: return "«*=»";
        case Tok::SlashAssign: return "«/=»";
        case Tok::Eq: return "«==»";
        case Tok::Ne: return "«!=»";
        case Tok::Lt: return "«<»";
        case Tok::Le: return "«<=»";
        case Tok::Gt: return "«>»";
        case Tok::Ge: return "«>=»";
        case Tok::Invalid: return "qualcosa che non capisco";
        default: return std::string("«") + keyword_spelling(t.type) + "»";
    }
}

Token Lexer::make(Tok type) const {
    Token t;
    t.type = type;
    t.line = line_;
    return t;
}

Token Lexer::invalid(const std::string& message) const {
    Token t = make(Tok::Invalid);
    t.text = message;
    return t;
}

Token Lexer::next() {
    // spazi e commenti
    for (;;) {
        if (pos_ >= src_.size()) return make(Tok::End);
        const char c = src_[pos_];
        if (c == ' ' || c == '\t' || c == '\r') {
            ++pos_;
        } else if (c == '#') {
            while (pos_ < src_.size() && src_[pos_] != '\n') ++pos_;
        } else {
            break;
        }
    }
    const char c = src_[pos_];
    if (c == '\n') {
        Token t = make(Tok::Newline);
        ++pos_;
        if (line_ < 65535) ++line_;
        return t;
    }
    if (c >= '0' && c <= '9') return read_number();
    if (c == '"' || c == '\'') {
        ++pos_;
        return read_text(c == '"');
    }

    size_t after = pos_;
    uint32_t cp = 0;
    if (!utf8_next(src_, after, cp)) return invalid("c'è un carattere rovinato");
    // virgolette "tipografiche", che i telefoni mettono da soli
    if (cp == 0x201C || cp == 0x201D || cp == 0x201E || cp == 0x2018 || cp == 0x2019) {
        pos_ = after;
        return read_text(cp != 0x2018 && cp != 0x2019);
    }
    if (is_name_start(cp)) return read_name();

    auto two = [&](char second) { return pos_ + 1 < src_.size() && src_[pos_ + 1] == second; };
    auto take = [&](Tok type, size_t length) {
        Token t = make(type);
        pos_ += length;
        return t;
    };
    switch (c) {
        case '+': return two('=') ? take(Tok::PlusAssign, 2) : take(Tok::Plus, 1);
        case '-': return two('=') ? take(Tok::MinusAssign, 2) : take(Tok::Minus, 1);
        case '*': return two('=') ? take(Tok::StarAssign, 2) : take(Tok::Star, 1);
        case '/': return two('=') ? take(Tok::SlashAssign, 2) : take(Tok::Slash, 1);
        case '%': return take(Tok::Percent, 1);
        case '(': return take(Tok::LParen, 1);
        case ')': return take(Tok::RParen, 1);
        case '[': return take(Tok::LBracket, 1);
        case ']': return take(Tok::RBracket, 1);
        case ',': return take(Tok::Comma, 1);
        case '=': return two('=') ? take(Tok::Eq, 2) : take(Tok::Assign, 1);
        case '!':
            if (two('=')) return take(Tok::Ne, 2);
            break;
        case '<':
            if (two('=')) return take(Tok::Le, 2);
            if (two('>')) return take(Tok::Ne, 2);
            return take(Tok::Lt, 1);
        case '>': return two('=') ? take(Tok::Ge, 2) : take(Tok::Gt, 1);
        default: break;
    }
    Token bad = invalid("non conosco il carattere «" + src_.substr(pos_, after - pos_) + "»");
    pos_ = after;
    return bad;
}

Token Lexer::read_number() {
    uint64_t mantissa = 0;
    unsigned decimals = 0;
    bool seen_point = false, too_long = false;
    while (pos_ < src_.size()) {
        const char c = src_[pos_];
        if (c >= '0' && c <= '9') {
            if (too_long || !number_add_digit(mantissa, static_cast<unsigned>(c - '0'))) too_long = true;
            else if (seen_point && ++decimals > 22) too_long = true;
            ++pos_;
        } else if (c == '.' && !seen_point && pos_ + 1 < src_.size() && src_[pos_ + 1] >= '0' && src_[pos_ + 1] <= '9') {
            seen_point = true;
            ++pos_;
        } else {
            break;
        }
    }
    if (too_long) return invalid("questo numero ha troppe cifre (al massimo 15)");
    if (pos_ < src_.size()) {
        size_t after = pos_;
        uint32_t cp = 0;
        if (utf8_next(src_, after, cp) && is_name_start(cp))
            return invalid("dopo un numero non può esserci subito una lettera: manca uno spazio o un segno?");
    }
    Token t = make(Tok::Number);
    t.number = number_from_digits(mantissa, decimals);
    return t;
}

Token Lexer::read_text(bool double_quotes) {
    // Un testo aperto con le virgolette doppie si chiude con le doppie (dritte o tipografiche), e così le semplici:
    // "l'albero" funziona anche se il telefono trasforma virgolette e apostrofi.
    Token t = make(Tok::Text);
    for (;;) {
        if (pos_ >= src_.size() || src_[pos_] == '\n')
            return invalid("questo testo non è chiuso: manca la virgoletta in fondo");
        uint32_t cp = 0;
        if (!utf8_next(src_, pos_, cp)) return invalid("c'è un carattere rovinato dentro un testo");
        const bool closes = double_quotes ? (cp == '"' || cp == 0x201C || cp == 0x201D) : (cp == '\'' || cp == 0x2018 || cp == 0x2019);
        if (closes) break;
        if (cp == '\\') {
            if (pos_ >= src_.size() || src_[pos_] == '\n')
                return invalid("questo testo non è chiuso: manca la virgoletta in fondo");
            const char e = src_[pos_++];
            if (e == 'n') {
                t.text += '\n';
            } else if (e == '\\' || e == '"' || e == '\'') {
                t.text += e;
            } else {
                return invalid(std::string("dentro un testo «\\") + e + "» non vuol dire niente: si possono usare \\n, \\\" e \\\\");
            }
        } else if (cp < 0x20) {
            return invalid("dentro un testo c'è un carattere che non si può scrivere");
        } else {
            utf8_append(t.text, cp);
        }
        if (t.text.size() > max_text_) return invalid("questo testo è troppo lungo");
    }
    return t;
}

Token Lexer::read_name() {
    const size_t start = pos_;
    size_t after = pos_;
    uint32_t cp = 0;
    while (after < src_.size()) {
        const size_t before = after;
        if (!utf8_next(src_, after, cp) || !is_name_part(cp)) {
            after = before;
            break;
        }
    }
    pos_ = after;
    Token t = make(Tok::Name);
    if (after - start > 64 || !normalize_name(src_.substr(start, after - start), t.text))
        return invalid("questo nome è troppo lungo o contiene caratteri non ammessi");
    if (t.text.size() > 32) return invalid("questo nome è troppo lungo (al massimo 32 caratteri)");
    t.type = keyword(t.text);
    return t;
}

}  // namespace script
}  // namespace polpo
