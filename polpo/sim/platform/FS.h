// Polpo — simulatore: file della microSD. La scheda è in memoria (vedi SD.h) e si salva con lo stato del simulatore.
#pragma once
#include <Arduino.h>
#define FILE_READ "r"
#define FILE_WRITE "w"
#define FILE_APPEND "a"
namespace fs {
struct StatoFile;
class File {
  public:
    File() = default;
    explicit File(std::shared_ptr<StatoFile> s) : s_(std::move(s)) {}
    explicit operator bool() const;
    bool isDirectory();
    File openNextFile(const char* modo = FILE_READ);
    const char* name() const;
    const char* path() const;
    size_t size() const;
    size_t position() const;
    bool seek(uint32_t pos);
    size_t read(uint8_t* buf, size_t n);
    int read();
    int available();
    size_t write(const uint8_t* buf, size_t n);
    size_t write(uint8_t b) { return write(&b, 1); }
    void flush() {}
    void close();
  private:
    std::shared_ptr<StatoFile> s_;
};
}  // namespace fs
using fs::File;
