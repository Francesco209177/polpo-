// Banco di prova per genera_ir_codifica.py: esegue la codifica infrarossi del firmware (polpo_core, C++ puro) sugli
// ingressi letti da stdin e scrive i risultati su stdout, una riga per richiesta. Non fa parte del firmware.
//
//   I                                   tabella dei protocolli: "info <n> <nome> <bit ind.> <bit com.> <Hz> <duty> <frame> <pausa>"
//   N <nome>                            ir_protocol_from_name: "nome <n>" (n = indice, -1 se sconosciuto)
//   P <nome> <ind.> <com.> <toggle>     ir_encode di un segnale «parsed»
//   R <Hz> <duty> <k> <t1> ... <tk>     ir_encode di un segnale RAW
//   T <k> <t1> ... <tk>                 ir_total_us: "totale <µs>"
//
// <nome> è il nome in esadecimale (byte UTF-8), "-" se vuoto. Risposta di ir_encode: "ok <Hz> <duty> <k> <d1> ... <dk>"
// oppure "no". Il duty si legge come double e si converte in float, come fa il firmware con il JSON di Polpo Link.
#include <cinttypes>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "polpo/ir/ir_codec.h"
#include "polpo/ir/ir_signal.h"

using namespace polpo;

static std::string da_esa(const std::string& h) {
    if (h == "-") return "";
    std::string out;
    for (size_t i = 0; i + 1 < h.size(); i += 2) out.push_back(static_cast<char>(std::strtoul(h.substr(i, 2).c_str(), nullptr, 16)));
    return out;
}

static void stampa(bool ok, const IrTimings& t) {
    if (!ok) {
        std::printf("no\n");
        return;
    }
    std::printf("ok %" PRIu32 " %.17g %zu", t.frequency, static_cast<double>(t.duty), t.durations.size());
    for (uint32_t d : t.durations) std::printf(" %" PRIu32, d);
    std::printf("\n");
}

int main() {
    std::string riga;
    while (std::getline(std::cin, riga)) {
        std::istringstream in(riga);
        std::string op;
        in >> op;
        if (op == "I") {
            for (int i = 0; i <= kIrProtocolCount; ++i) {
                const IrProtocolInfo& p = ir_protocol_info(static_cast<IrProtocol>(i));
                std::printf("info %d %s %u %u %" PRIu32 " %.17g %u %" PRIu32 "\n", i, p.name, p.address_bits, p.command_bits, p.frequency,
                            static_cast<double>(p.duty), p.min_frames, p.frame_gap_us);
            }
        } else if (op == "N") {
            std::string h;
            in >> h;
            const IrProtocol p = ir_protocol_from_name(da_esa(h));
            std::printf("nome %d\n", p == IrProtocol::Unknown ? -1 : static_cast<int>(p));
        } else if (op == "P") {
            std::string h;
            unsigned long long a = 0, c = 0;
            int toggle = 0;
            in >> h >> a >> c >> toggle;
            IrSignal s;
            s.name = "prova";
            s.raw = false;
            s.protocol = ir_protocol_from_name(da_esa(h));
            s.address = static_cast<uint32_t>(a);
            s.command = static_cast<uint32_t>(c);
            IrTimings t;
            const bool ok = ir_encode(s, t, toggle != 0);
            stampa(ok, t);
        } else if (op == "R") {
            unsigned long long f = 0;
            double duty = 0;
            size_t k = 0;
            in >> f >> duty >> k;
            IrSignal s;
            s.name = "prova";
            s.raw = true;
            s.frequency = static_cast<uint32_t>(f);
            s.duty = static_cast<float>(duty);
            for (size_t i = 0; i < k; ++i) {
                unsigned long long x = 0;
                in >> x;
                s.timings.push_back(static_cast<uint32_t>(x));
            }
            IrTimings t;
            const bool ok = ir_encode(s, t, false);
            stampa(ok, t);
        } else if (op == "T") {
            size_t k = 0;
            in >> k;
            std::vector<uint32_t> d;
            for (size_t i = 0; i < k; ++i) {
                unsigned long long x = 0;
                in >> x;
                d.push_back(static_cast<uint32_t>(x));
            }
            std::printf("totale %" PRIu64 "\n", ir_total_us(d));
        } else if (!op.empty()) {
            std::fprintf(stderr, "richiesta sconosciuta: %s\n", op.c_str());
            return 2;
        }
    }
    return 0;
}
