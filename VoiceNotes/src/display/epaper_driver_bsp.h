#pragma once
#include "driver/spi_master.h"
#include "driver/gpio.h"

// ESP32-S3-ePaper-1.54G: four pixels/byte, MSB first, 2 bits/pixel.
enum COLOR_IMAGE : uint8_t {
    DRIVER_COLOR_BLACK = 0,
    DRIVER_COLOR_WHITE = 1,
    DRIVER_COLOR_YELLOW = 2,
    DRIVER_COLOR_RED = 3,
};
struct custom_lcd_spi_t {
    uint8_t cs, dc, rst, busy, mosi, scl;
    int spi_host, buffer_len;
};

class epaper_driver_display {
    const custom_lcd_spi_t pins;
    const int Width, Height;
    spi_device_handle_t spi = nullptr;
    uint8_t *buffer = nullptr;
    bool healthy = true;
    void command(uint8_t value);
    void data(const uint8_t *values, size_t length);
    void dataByte(uint8_t value) { data(&value, 1); }
    void initialize(bool fast);
    bool waitReady();
public:
    epaper_driver_display(int width, int height, custom_lcd_spi_t config);
    ~epaper_driver_display();
    bool isHealthy() const { return healthy; }
    void EPD_Init() { initialize(false); }
    void EPD_Init_Fast() { initialize(true); }
    void EPD_Clear(); // Clear RAM only; no physical refresh.
    void EPD_Display();
    void EPD_Sleep();
    void EPD_DrawColorPixel(uint16_t x, uint16_t y, uint8_t color);
};
