// Polpo — simulatore: memoria delle impostazioni (NVS). Sta in RAM e si salva con lo stato del simulatore.
#pragma once
#include <Arduino.h>
class Preferences {
  public:
    bool begin(const char* spazio, bool sola_lettura = false);
    void end() {}
    uint8_t getUChar(const char* chiave, uint8_t predefinito = 0);
    bool getBool(const char* chiave, bool predefinito = false);
    uint32_t getUInt(const char* chiave, uint32_t predefinito = 0);
    size_t putUChar(const char* chiave, uint8_t v);
    size_t putBool(const char* chiave, bool v);
    size_t putUInt(const char* chiave, uint32_t v);
  private:
    std::string spazio_;
    bool sola_lettura_ = false;
};
