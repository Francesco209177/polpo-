// Polpo — simulatore: al posto di <Arduino.h>. Solo ciò che il firmware usa davvero.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <malloc.h>
#include <memory>
#include <string>
#include <vector>

// ---- pila del ciclo principale: sul dispositivo la sceglie il firmware con questa macro; qui non cambia niente ----
size_t getArduinoLoopTaskStackSize();
#define SET_LOOP_TASK_STACK_SIZE(sz) \
    size_t getArduinoLoopTaskStackSize() { return sz; }

// ---- tempo (virtuale: vedi sim/nucleo.h) ----
uint32_t millis();
uint32_t micros();
void delay(uint32_t ms);
void delayMicroseconds(uint32_t us);
inline void yield() {}

// ---- piedini ----
enum : uint8_t { INPUT = 0x01, OUTPUT = 0x03, INPUT_PULLUP = 0x05, INPUT_PULLDOWN = 0x09 };
enum : uint8_t { LOW = 0, HIGH = 1 };
enum : int { RISING = 1, FALLING = 2, CHANGE = 3 };
void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t livello);
int digitalRead(uint8_t pin);
void attachInterrupt(uint8_t pin, void (*funzione)(), int modo);
void detachInterrupt(uint8_t pin);
inline uint8_t digitalPinToInterrupt(uint8_t pin) { return pin; }
inline void noInterrupts() {}
inline void interrupts() {}
#define IRAM_ATTR
#ifndef PROGMEM
#define PROGMEM
#endif

// ---- RMT: stessa interfaccia del core Arduino-ESP32 3.x ----
typedef union {
    struct {
        uint32_t duration0 : 15;
        uint32_t level0 : 1;
        uint32_t duration1 : 15;
        uint32_t level1 : 1;
    };
    uint32_t val;
} rmt_data_t;
#define RMT_SYMBOLS_PER_CHANNEL_BLOCK 48
typedef enum { RMT_RX_MODE = 0, RMT_TX_MODE = 1 } rmt_ch_dir_t;
typedef enum { RMT_MEM_NUM_BLOCKS_1 = 1, RMT_MEM_NUM_BLOCKS_2, RMT_MEM_NUM_BLOCKS_3, RMT_MEM_NUM_BLOCKS_4 } rmt_reserve_memsize_t;
bool rmtInit(int pin, rmt_ch_dir_t direzione, rmt_reserve_memsize_t blocchi, uint32_t frequenza_hz);
bool rmtDeinit(int pin);
bool rmtSetEOT(int pin, uint8_t livello);
bool rmtSetCarrier(int pin, bool attiva, bool livello, uint32_t frequenza_hz, float duty);
bool rmtWrite(int pin, rmt_data_t* dati, size_t n, uint32_t timeout_ms);
bool rmtSetRxMaxThreshold(int pin, uint16_t us);
bool rmtSetRxMinThreshold(int pin, uint8_t us);
bool rmtReadAsync(int pin, rmt_data_t* dati, size_t* n);
bool rmtReceiveCompleted(int pin);

// ---- testo in stile Arduino (serve solo a WiFi.SSID(i).c_str()) ----
class String {
  public:
    String() = default;
    String(const char* s) : s_(s ? s : "") {}
    String(const std::string& s) : s_(s) {}
    const char* c_str() const { return s_.c_str(); }
    size_t length() const { return s_.size(); }

  private:
    std::string s_;
};

// ---- seriale USB ----
class SimSerial {
  public:
    void begin(unsigned long = 0) {}
    void setRxBufferSize(size_t) {}
    void setTxTimeoutMs(uint32_t) {}
    int available();
    int read();
    size_t write(uint8_t b);
    size_t write(const uint8_t* dati, size_t n);
    explicit operator bool() const { return true; }
};
extern SimSerial Serial;

// ---- informazioni sul chip ----
class SimEsp {
  public:
    uint32_t getFreeHeap() const { return 210 * 1024; }      // valori verosimili per un ESP32-S3 senza PSRAM:
    uint32_t getMaxAllocHeap() const { return 150 * 1024; }  // la memoria vera NON è simulata
};
extern SimEsp ESP;
