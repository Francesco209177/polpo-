// PolpoScript — piccole cose condivise tra vm.cpp e natives.cpp.
#pragma once

#include "polpo/script/script.h"

namespace polpo {
namespace script {

constexpr size_t kObjectOverhead = 32;  // byte contati per ogni testo o lista, uguali su ogni piattaforma
constexpr size_t kValueBytes = 16;      // byte contati per ogni elemento di una lista
constexpr uint8_t kObjectText = 1;
constexpr uint8_t kObjectList = 2;
extern const char* const kBroken;       // messaggio per istruzioni non valide

inline Value make_bool(bool b) {
    Value v;
    v.type = Type::Bool;
    v.b = b;
    return v;
}
inline Value make_number(double n) {
    Value v;
    v.type = Type::Number;
    v.n = n == 0 ? 0.0 : n;  // mai zero negativo
    return v;
}
inline Value make_ref(Type type, uint32_t ref) {
    Value v;
    v.type = type;
    v.ref = ref;
    return v;
}

}  // namespace script
}  // namespace polpo
