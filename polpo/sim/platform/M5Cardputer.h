// Polpo — simulatore: al posto di <M5Cardputer.h>.
// Il motore grafico è quello vero (LovyanGFX, dentro M5GFX): cambia solo dove finiscono i pixel, cioè in una
// tela in memoria invece che sul display. Tastiera, altoparlante e batteria sono quelli del mondo simulato.
#pragma once

#include <Arduino.h>

// LovyanGFX sceglie la piattaforma dai simboli del compilatore: la sua unica variante senza hardware e senza
// SDL è "framebuffer su Linux" (serve anche -DLGFX_LINUX_FB). Nel browser gli si fa credere di essere lì.
#if !defined(__linux__)
#define __linux__ 1
#define POLPO_SIM_FINTO_LINUX 1
#endif
#include <M5GFX.h>
#ifdef POLPO_SIM_FINTO_LINUX
#undef __linux__
#undef POLPO_SIM_FINTO_LINUX
#endif

// ---- tastiera: stessi nomi e stessa disposizione del Cardputer (4 file da 14 tasti) ----
#define KEY_LEFT_CTRL 0x80
#define KEY_LEFT_SHIFT 0x81
#define KEY_LEFT_ALT 0x82
#define KEY_FN 0xff
#define KEY_OPT 0x00
#define KEY_BACKSPACE 0x2a
#define KEY_TAB 0x2b
#define KEY_ENTER 0x28

struct Point2D_t {
    int x = 0;  // colonna, 0-13
    int y = 0;  // fila, 0-3
    bool operator==(const Point2D_t& o) const { return x == o.x && y == o.y; }
};
struct KeyValue_t {
    const char value_first;   // senza Maiusc
    const char value_second;  // con Maiusc
};
class Keyboard_Class {
  public:
    const std::vector<Point2D_t>& keyList();
    KeyValue_t getKeyValue(const Point2D_t& tasto);
};

namespace m5 {
using board_t = m5gfx::board_t;
struct config_t {
    uint32_t serial_baudrate = 115200;
    bool clear_display = true;
    bool internal_spk = true;
    bool internal_mic = true;
};
class Power_Class {
  public:
    enum class is_charging_t { is_discharging = 0, is_charging, charge_unknown };
    int32_t getBatteryLevel();
    is_charging_t isCharging();
};
class Speaker_Class {
  public:
    void setVolume(uint8_t v) { volume_ = v; }
    uint8_t getVolume() const { return volume_; }
    bool tone(float hz, uint32_t ms = UINT32_MAX, int canale = -1, bool ferma = true);
  private:
    uint8_t volume_ = 64;
};
class Button_Class {
  public:
    bool wasPressed();
};
}  // namespace m5

// Il "display": una tela a 16 bit grande come lo schermo del Cardputer.
class SimDisplay : public lgfx::LGFX_Sprite {
  public:
    void setRotation(uint_fast8_t) {}  // la tela è già orizzontale
    void setBrightness(uint8_t livello);
    uint8_t getBrightness() const;
};

class M5Cardputer_Class {
  public:
    SimDisplay Display;
    Keyboard_Class Keyboard;
    m5::Speaker_Class Speaker;
    m5::Power_Class Power;
    m5::Button_Class BtnA;
    void begin(m5::config_t = {}, bool tastiera = true);
    void update() {}
};
extern M5Cardputer_Class M5Cardputer;

class M5Unified_Sim {
  public:
    m5::config_t config() { return {}; }
    m5::board_t getBoard() { return m5::board_t::board_M5CardputerADV; }
};
extern M5Unified_Sim M5;
