#pragma once
#include <stdint.h>
#include <string.h>

// Explicit little-endian PCM header, independent of structure packing.
inline void makeWavHeader(uint8_t *h, uint32_t bytes) {
  memset(h, 0, 44);
  memcpy(h, "RIFF", 4); memcpy(h + 8, "WAVEfmt ", 8); memcpy(h + 36, "data", 4);
  auto put32 = [h](int p, uint32_t v) {
    for (int i = 0; i < 4; ++i) h[p + i] = (v >> (8 * i)) & 255;
  };
  put32(4, bytes + 36); put32(16, 16);
  h[20] = 1; h[22] = 1; // PCM, mono
  put32(24, 16000); put32(28, 32000);
  h[32] = 2; h[34] = 16;
  put32(40, bytes);
}
