// Polpo — simulatore: Wi-Fi. Solo la scansione, con reti inventate dal mondo simulato (nessuna rete vera viene letta).
#pragma once
#include <Arduino.h>
typedef enum {
    WIFI_AUTH_OPEN = 0,
    WIFI_AUTH_WEP,
    WIFI_AUTH_WPA_PSK,
    WIFI_AUTH_WPA2_PSK,
    WIFI_AUTH_WPA_WPA2_PSK,
    WIFI_AUTH_ENTERPRISE,
    WIFI_AUTH_WPA2_ENTERPRISE = WIFI_AUTH_ENTERPRISE,
    WIFI_AUTH_WPA3_PSK,
    WIFI_AUTH_WPA2_WPA3_PSK,
    WIFI_AUTH_WAPI_PSK,
    WIFI_AUTH_MAX
} wifi_auth_mode_t;
typedef enum { WIFI_OFF = 0, WIFI_STA = 1, WIFI_AP = 2, WIFI_AP_STA = 3 } wifi_mode_t;
#define WIFI_SCAN_RUNNING (-1)
#define WIFI_SCAN_FAILED (-2)
class SimWiFi {
  public:
    bool mode(wifi_mode_t m);
    bool disconnect(bool = false, bool = false) { return true; }
    int16_t scanNetworks(bool asincrona = false, bool nascoste = false);
    int16_t scanComplete();
    void scanDelete();
    String SSID(uint8_t i);
    String BSSIDstr(uint8_t i);
    int32_t RSSI(uint8_t i);
    int32_t channel(uint8_t i);
    wifi_auth_mode_t encryptionType(uint8_t i);
};
extern SimWiFi WiFi;
