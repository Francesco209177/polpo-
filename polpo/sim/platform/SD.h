// Polpo — simulatore: microSD in memoria. Stesse funzioni della libreria SD del core Arduino-ESP32 usate dal firmware.
#pragma once
#include <FS.h>
#include <SPI.h>
class SimSD {
  public:
    bool begin(int cs = -1, SPIClass& spi = SPI, uint32_t hz = 4000000);
    void end();
    File open(const char* percorso, const char* modo = FILE_READ);
    bool exists(const char* percorso);
    bool remove(const char* percorso);
    bool rename(const char* da, const char* a);
    bool mkdir(const char* percorso);
    bool rmdir(const char* percorso);
    uint64_t totalBytes();
    uint64_t usedBytes();
};
extern SimSD SD;
