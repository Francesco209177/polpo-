// Polpo — simulatore: tastiera USB. I rapporti HID arrivano al PC finto del mondo simulato, nessun PC vero li riceve.
#pragma once
#include <Arduino.h>
struct KeyReport {
    uint8_t modifiers;
    uint8_t reserved;
    uint8_t keys[6];
};
class USBHIDKeyboard {
  public:
    void begin() {}
    void end() {}
    void sendReport(KeyReport* rapporto);
};
