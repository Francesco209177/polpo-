// Polpo — infrarossi: trasmissione dal LED integrato (G44) con la periferica RMT
// (portante e duty cycle esatti) e ricezione dalla IR Unit sulla porta Grove.
#pragma once

#include <cstdint>
#include <vector>

#include "polpo/ir/ir_signal.h"

namespace ir {

bool tx_begin();
void tx_end();
bool send(const polpo::IrTimings& t);
// Codifica + invio. RC5/RC6: il bit «toggle» cambia a ogni pressione, non a ogni ripetizione: chi ripete lo stesso
// tasto passa ultima = false a tutte le ripetizioni tranne l'ultima, così il ricevitore vede una sola pressione.
bool send(const polpo::IrSignal& s, bool ultima = true);

// Ricezione (serve la IR Unit collegata alla porta Grove).
bool rx_begin();
void rx_end();
// Avvia l'ascolto; poi rx_poll() restituisce true quando un segnale è completo.
bool rx_start();
bool rx_poll(std::vector<uint32_t>& durations);

}  // namespace ir
