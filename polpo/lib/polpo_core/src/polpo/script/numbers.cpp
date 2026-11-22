// PolpoScript — numeri: scrittura, lettura e funzioni trigonometriche.
//
// Tutto è fatto con le sole quattro operazioni (più radice, resto e arrotondamenti, che lo standard IEEE 754
// definisce in modo esatto): così un programma dà gli stessi identici risultati su Cardputer, PC e browser.
// Non si usano printf, strtod, sin o cos della libreria, che possono differire nell'ultima cifra.
#include <cmath>

#include "polpo/script/script.h"
#include "polpo/util/utf8.h"

namespace polpo {
namespace script {
namespace {

const double kPow10[] = {1e0, 1e1, 1e2,  1e3,  1e4,  1e5,  1e6,  1e7,  1e8,  1e9,  1e10, 1e11,
                         1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22};

void append_uint(std::string& out, uint64_t v) {
    char buf[24];
    size_t n = 0;
    do {
        buf[n++] = static_cast<char>('0' + v % 10);
        v /= 10;
    } while (v != 0);
    while (n > 0) out += buf[--n];
}

// Parte intera, poi fino a `decimals` cifre dopo il punto (senza zeri finali).
void append_fixed(std::string& out, uint64_t scaled, unsigned decimals) {
    uint64_t unit = 1;
    for (unsigned i = 0; i < decimals; ++i) unit *= 10;
    append_uint(out, scaled / unit);
    uint64_t frac = scaled % unit;
    if (frac == 0) return;
    out += '.';
    for (unsigned i = 0; i < decimals && frac != 0; ++i) {
        unit /= 10;
        out += static_cast<char>('0' + frac / unit);
        frac %= unit;
    }
}

// Seno e coseno per angoli piccoli (|x| <= pi/4), in radianti: sviluppo in serie, errore sotto 1e-16.
double sin_small(double x) {
    const double x2 = x * x;
    return x * (1.0 + x2 * (-1.0 / 6.0 + x2 * (1.0 / 120.0 + x2 * (-1.0 / 5040.0 + x2 * (1.0 / 362880.0 +
               x2 * (-1.0 / 39916800.0 + x2 * (1.0 / 6227020800.0 + x2 * (-1.0 / 1307674368000.0))))))));
}
double cos_small(double x) {
    const double x2 = x * x;
    return 1.0 + x2 * (-1.0 / 2.0 + x2 * (1.0 / 24.0 + x2 * (-1.0 / 720.0 + x2 * (1.0 / 40320.0 +
           x2 * (-1.0 / 3628800.0 + x2 * (1.0 / 479001600.0 + x2 * (-1.0 / 87178291200.0 +
           x2 * (1.0 / 20922789888000.0))))))));
}

}  // namespace

std::string Error::text() const {
    if (message.empty()) return "";
    if (line == 0) return message;
    std::string out = "Riga ";
    append_uint(out, line);
    out += ": ";
    out += message;
    return out;
}

std::string format_number(double v) {
    if (!(v == v)) return "?";  // non dovrebbe mai capitare: la macchina virtuale rifiuta i numeri non validi
    const bool negative = v < 0;
    const double a = negative ? -v : v;
    std::string body;
    if (a < 1e19 && std::floor(a) == a) {
        append_uint(body, static_cast<uint64_t>(a));  // i numeri interi si scrivono per intero, cifra per cifra
    } else if (a < 1e9) {
        // sei cifre dopo il punto
        append_fixed(body, static_cast<uint64_t>(std::floor(a * 1e6 + 0.5)), 6);
    } else if (a < 1e12) {
        append_fixed(body, static_cast<uint64_t>(std::floor(a * 1e3 + 0.5)), 3);
    } else if (a < 1e15) {
        append_uint(body, static_cast<uint64_t>(std::floor(a + 0.5)));
    } else if (a > 1.7e308) {
        body = "infinito";
    } else {
        // numeri enormi: sei cifre e la potenza di dieci, es. 1.5e+20
        double m = a;
        int exp = 0;
        while (m >= 1e10) {
            m /= 1e10;
            exp += 10;
        }
        while (m >= 10.0) {
            m /= 10.0;
            exp += 1;
        }
        auto digits = static_cast<uint64_t>(std::floor(m * 1e5 + 0.5));
        if (digits >= 1000000) {
            digits /= 10;
            exp += 1;
        }
        append_fixed(body, digits, 5);
        body += "e+";
        append_uint(body, static_cast<uint64_t>(exp));
    }
    if (body == "0") return body;  // anche -0 e i numeri più piccoli di mezzo milionesimo
    return negative ? "-" + body : body;
}

bool number_add_digit(uint64_t& mantissa, unsigned digit) {
    constexpr uint64_t kExact = 9007199254740992ull;  // 2^53: fin qui ogni numero intero è rappresentato esattamente
    if (mantissa > (kExact - digit) / 10) return false;
    mantissa = mantissa * 10 + digit;
    return true;
}

double number_from_digits(uint64_t mantissa, unsigned decimals) {
    // Mantissa fino a 2^53 e potenza di dieci fino a 10^22 sono esatte: una sola divisione, arrotondata bene.
    if (decimals > 22) decimals = 22;
    return static_cast<double>(mantissa) / kPow10[decimals];
}

bool parse_number(const std::string& s, bool allow_comma, double& out) {
    size_t i = 0;
    const size_t n = s.size();
    while (i < n && (s[i] == ' ' || s[i] == '\t')) ++i;
    bool negative = false;
    if (i < n && (s[i] == '-' || s[i] == '+')) {
        negative = s[i] == '-';
        ++i;
    }
    uint64_t mantissa = 0;
    unsigned decimals = 0;
    bool seen_point = false, any = false;
    for (; i < n; ++i) {
        const char c = s[i];
        if (c >= '0' && c <= '9') {
            any = true;
            if (!number_add_digit(mantissa, static_cast<unsigned>(c - '0'))) return false;  // troppe cifre per essere esatto
            if (seen_point && ++decimals > 22) return false;
        } else if ((c == '.' || (allow_comma && c == ',')) && !seen_point) {
            seen_point = true;
        } else {
            break;
        }
    }
    while (i < n && (s[i] == ' ' || s[i] == '\t')) ++i;
    if (!any || i != n) return false;
    const double v = number_from_digits(mantissa, decimals);
    out = negative ? -v : v;
    if (out == 0) out = 0;  // niente zero negativo
    return true;
}

double sin_degrees(double degrees) {
    double d = std::fmod(degrees, 360.0);  // esatto
    if (d < 0) d += 360.0;
    double sign = 1.0;
    if (d >= 180.0) {
        d -= 180.0;
        sign = -1.0;
    }
    if (d > 90.0) d = 180.0 - d;
    const double k = 0.017453292519943295;  // pi / 180
    const double r = d <= 45.0 ? sin_small(d * k) : cos_small((90.0 - d) * k);
    return r == 0 ? 0.0 : sign * r;
}

double cos_degrees(double degrees) {
    return sin_degrees(std::fmod(degrees, 360.0) + 90.0);
}

bool normalize_name(const std::string& in, std::string& out) {
    out.clear();
    size_t i = 0;
    while (i < in.size()) {
        uint32_t cp = 0;
        if (!utf8_next(in, i, cp)) return false;
        char c;
        if (cp < 0x80) {
            c = static_cast<char>(cp);
        } else {
            c = ascii_fallback(cp);  // à -> a, È -> E
            if (c == 0) return false;
        }
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        const bool letter = (c >= 'a' && c <= 'z') || c == '_';
        const bool digit = c >= '0' && c <= '9';
        if (!letter && !(digit && !out.empty())) return false;
        out += c;
    }
    return !out.empty();
}

}  // namespace script
}  // namespace polpo
