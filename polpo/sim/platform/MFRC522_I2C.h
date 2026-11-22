// Polpo — simulatore: al posto della libreria del lettore NFC (chip MFRC522/WS1850S via I2C).
// Stessa interfaccia usata da src/hal/nfc.cpp; dall'altra parte c'è il tag del mondo simulato.
#pragma once
#include <Arduino.h>
#include <Wire.h>
typedef uint8_t byte;
class MFRC522_I2C {
  public:
    enum StatusCode : byte { STATUS_OK = 1, STATUS_ERROR, STATUS_COLLISION, STATUS_TIMEOUT, STATUS_NO_ROOM, STATUS_INTERNAL_ERROR, STATUS_INVALID, STATUS_CRC_WRONG, STATUS_MIFARE_NACK = 255 };
    struct Uid {
        byte size = 0;
        byte uidByte[10] = {};
        byte sak = 0;
    };
    Uid uid;
    MFRC522_I2C(byte indirizzo, int reset, TwoWire* bus = &Wire) { (void)indirizzo; (void)reset; (void)bus; }
    void PCD_Reset() {}
    void PCD_Init() {}
    void PCD_AntennaOff() {}
    byte PICC_WakeupA(byte* atqa, byte* dimensione);
    byte PICC_Select(Uid* uid, byte bit_validi = 0);
    byte PICC_HaltA();
    byte PCD_CalculateCRC(byte* dati, byte n, byte* risultato);
    byte PCD_TransceiveData(byte* invio, byte n_invio, byte* risposta, byte* n_risposta, byte* bit_validi = nullptr, byte allineamento = 0, bool controlla_crc = false);
    byte MIFARE_Read(byte pagina, byte* buffer, byte* dimensione);
    byte MIFARE_Ultralight_Write(byte pagina, byte* buffer, byte dimensione);
  private:
    bool selezionato_ = false;
};
