// PolpoScript — esecuzione "a verbale": esegue un programma senza schermo né tasti veri e scrive, riga per riga,
// tutto ciò che il programma fa (testi scritti, disegni, suoni, attese, file) e come finisce.
//
// Serve alle prove automatiche: lo stesso programma deve produrre lo stesso identico verbale su PC, nel
// browser e (un giorno) sul Cardputer. Il tempo è finto: avanza solo quando il programma aspetta.
//
// Il programma può cominciare con righe di istruzioni per la prova:
//   #! tasti: su ok a          tasti premuti, nell'ordine in cui il programma li chiede
//   #! premuti: sinistra       tasti che risultano tenuti premuti
//   #! risposte: Mario | 12    risposte a chiedi(), nell'ordine
//   #! file: record.txt = 42   un file già presente
//   #! seme: 7                 seme dei numeri casuali (predefinito 1)
//   #! limite: 5000            numero massimo di istruzioni (predefinito 2 milioni)
//   #! memoria: 2000           byte per testi e liste     #! pila: 32   valori sulla pila
// Un file può contenere più programmi, separati da righe «#--- nome».
#pragma once

#include <string>

#include "polpo/script/script.h"

namespace polpo {
namespace script {

std::string run_transcript(const std::string& source, const Limits& limits = Limits());
std::string run_transcript_file(const std::string& content, const Limits& limits = Limits());

}  // namespace script
}  // namespace polpo
