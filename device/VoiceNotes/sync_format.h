#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
inline uint32_t wavLE32(const uint8_t *p) { return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24; }
inline uint16_t wavLE16(const uint8_t *p) { return uint16_t(p[0]) | uint16_t(p[1]) << 8; }
inline bool syncValidWav(const uint8_t *h, size_t headerBytes, uint32_t bytes) {
  return headerBytes == 44 && bytes > 44 && !((bytes - 44) % 2) &&
    !memcmp(h, "RIFF", 4) && !memcmp(h + 8, "WAVEfmt ", 8) && !memcmp(h + 36, "data", 4) &&
    wavLE32(h + 4) == bytes - 8 && wavLE32(h + 16) == 16 && wavLE16(h + 20) == 1 &&
    wavLE16(h + 22) == 1 && wavLE32(h + 24) == 16000 && wavLE32(h + 28) == 32000 &&
    wavLE16(h + 32) == 2 && wavLE16(h + 34) == 16 && wavLE32(h + 40) == bytes - 44;
}
inline bool syncValidId(const char *id) {
  if (strlen(id) != 32) return false;
  for (size_t i = 0; i < 32; i++) if (!((id[i] >= 'a' && id[i] <= 'f') || (id[i] >= '0' && id[i] <= '9'))) return false;
  return true;
}
