// Polpo — simulatore: lettura diretta dei piedini, come dal registro dell'ESP32.
#pragma once
#include "nucleo.h"
#define GPIO_IN_REG 0
#define REG_READ(registro) (sim::pin_registro())
