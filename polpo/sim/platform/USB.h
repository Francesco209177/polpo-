// Polpo — simulatore: porta USB. «Collegata» se nel mondo simulato c'è un PC.
#pragma once
#include <Arduino.h>
class SimUsb {
  public:
    bool begin() { return true; }
    explicit operator bool() const;
};
extern SimUsb USB;
