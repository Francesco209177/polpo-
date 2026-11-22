// Polpo — simulatore: il motore grafico vero (LovyanGFX, dentro la libreria M5GFX) compilato fuori dal dispositivo.
// È un unico file che include i sorgenti della libreria così come sono: nessuno viene modificato.
// Le intestazioni di sistema si includono prima; poi si fa credere alla libreria di essere su Linux con il
// "framebuffer", la sua unica variante senza hardware né SDL (serve anche -DLGFX_LINUX_FB).
#include <algorithm>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <malloc.h>
#include <memory>
#include <string>
#include <vector>
#if !defined(__linux__)
#define __linux__ 1
#endif
#include "lgfx/v1/LGFXBase.cpp"
#include "lgfx/v1/lgfx_fonts.cpp"
#include "lgfx/v1/lgfx_v1.cpp"

#include "nucleo.h"

// Le poche funzioni di piattaforma che la libreria si aspetta (dichiarate in platforms/framebuffer/common.hpp):
// il tempo è quello virtuale del simulatore, i piedini non esistono.
namespace lgfx {
inline namespace v1 {
unsigned long millis(void) { return static_cast<unsigned long>(sim::ora_us() / 1000); }
unsigned long micros(void) { return static_cast<unsigned long>(sim::ora_us()); }
void delay(unsigned long ms) { sim::avanza_us(static_cast<uint64_t>(ms) * 1000); }
void delayMicroseconds(unsigned int us) { sim::avanza_us(us); }
void gpio_hi(uint32_t) {}
void gpio_lo(uint32_t) {}
bool gpio_in(uint32_t) { return false; }
void pinMode(int_fast16_t, pin_mode_t) {}
void lgfxPinMode(int_fast16_t, pin_mode_t) {}
}  // namespace v1
}  // namespace lgfx
