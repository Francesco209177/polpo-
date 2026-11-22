// Polpo — simulatore: bus I2C della porta Grove. Risponde solo il modulo collegato nel "mondo" simulato.
#pragma once
#include <Arduino.h>
class TwoWire {
  public:
    bool begin(int sda = -1, int scl = -1, uint32_t hz = 100000);
    bool end();
    void setTimeOut(uint16_t ms) { timeout_ms_ = ms; }
    void beginTransmission(uint8_t indirizzo) { indirizzo_ = indirizzo; }
    uint8_t endTransmission(bool = true);  // 0 = qualcuno ha risposto, 2 = nessuno
  private:
    uint8_t indirizzo_ = 0;
    uint16_t timeout_ms_ = 50;
    bool attivo_ = false;
};
extern TwoWire Wire;
