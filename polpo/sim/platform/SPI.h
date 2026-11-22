// Polpo — simulatore: bus SPI (serve solo a inizializzare la microSD).
#pragma once
#include <Arduino.h>
class SPIClass {
  public:
    void begin(int = -1, int = -1, int = -1, int = -1) {}
    void end() {}
};
extern SPIClass SPI;
