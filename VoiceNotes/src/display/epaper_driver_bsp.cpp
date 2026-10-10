/*
 * ESP32-S3-ePaper-1.54G display adapter. Initialization sequence adapted from
 * Waveshare team's EPD_1in54g.c, version V1.0, 2024-08-07.
 * https://github.com/waveshareteam/ESP32-S3-ePaper-1.54G
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
#include "epaper_driver_bsp.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_heap_caps.h"
#include <cstring>
static void pauseMs(int ms) { vTaskDelay(pdMS_TO_TICKS(ms)); }

epaper_driver_display::epaper_driver_display(int width, int height, custom_lcd_spi_t config)
    : pins(config), Width(width), Height(height) {
    if (pins.buffer_len != (Width + 3) / 4 * Height) { healthy = false; return; }
    spi_bus_config_t bus{};
    bus.mosi_io_num = pins.mosi; bus.sclk_io_num = pins.scl;
    bus.miso_io_num = bus.quadwp_io_num = bus.quadhd_io_num = -1;
    bus.data4_io_num = bus.data5_io_num = bus.data6_io_num = bus.data7_io_num = -1;
    bus.max_transfer_sz = pins.buffer_len;
    if (spi_bus_initialize((spi_host_device_t)pins.spi_host, &bus, SPI_DMA_CH_AUTO) != ESP_OK) {
        healthy = false; return;
    }
    spi_device_interface_config_t device{};
    device.clock_speed_hz = 4000000; device.mode = 0;
    device.spics_io_num = -1; device.queue_size = 1;
    if (spi_bus_add_device((spi_host_device_t)pins.spi_host, &device, &spi) != ESP_OK) {
        healthy = false; return;
    }
    gpio_config_t gpio{};
    gpio.mode = GPIO_MODE_OUTPUT;
    gpio.pin_bit_mask = (1ULL << pins.cs) | (1ULL << pins.dc) | (1ULL << pins.rst);
    if (gpio_config(&gpio) != ESP_OK) { healthy = false; return; }
    gpio.pin_bit_mask = 1ULL << pins.busy;
    gpio.mode = GPIO_MODE_INPUT;
    if (gpio_config(&gpio) != ESP_OK) { healthy = false; return; }
    gpio_set_level((gpio_num_t)pins.cs, 1);
    gpio_set_level((gpio_num_t)pins.rst, 1);
    buffer = (uint8_t *)heap_caps_malloc(pins.buffer_len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!buffer) { healthy = false; return; }
    EPD_Clear();
}

epaper_driver_display::~epaper_driver_display() {
    free(buffer);
    if (spi) spi_bus_remove_device(spi);
    spi_bus_free((spi_host_device_t)pins.spi_host);
}

void epaper_driver_display::command(uint8_t value) {
    if (!healthy) return;
    gpio_set_level((gpio_num_t)pins.dc, 0);
    gpio_set_level((gpio_num_t)pins.cs, 0);
    spi_transaction_t transfer{};
    transfer.flags = SPI_TRANS_USE_TXDATA;
    transfer.length = 8; transfer.tx_data[0] = value;
    esp_err_t result = spi_device_polling_transmit(spi, &transfer);
    gpio_set_level((gpio_num_t)pins.cs, 1);
    if (result != ESP_OK) healthy = false;
}

void epaper_driver_display::data(const uint8_t *values, size_t length) {
    if (!healthy) return;
    gpio_set_level((gpio_num_t)pins.dc, 1);
    gpio_set_level((gpio_num_t)pins.cs, 0);
    spi_transaction_t transfer{};
    transfer.length = length * 8;
    if (length <= 4) {
        transfer.flags = SPI_TRANS_USE_TXDATA;
        memcpy(transfer.tx_data, values, length);
    } else {
        transfer.tx_buffer = values; // IDF copies non-DMA/PSRAM buffers as needed.
    }
    esp_err_t result = spi_device_polling_transmit(spi, &transfer);
    gpio_set_level((gpio_num_t)pins.cs, 1);
    if (result != ESP_OK) healthy = false;
}

bool epaper_driver_display::waitReady() {
    if (!healthy) return false;
    // This four-color controller is LOW while busy, HIGH when ready.
    // Allow time for BUSY to assert after a command before inspecting it.
    pauseMs(100);
    TickType_t started = xTaskGetTickCount();
    while (gpio_get_level((gpio_num_t)pins.busy) == 0) {
        if (xTaskGetTickCount() - started > pdMS_TO_TICKS(45000)) {
            healthy = false; return false; // Owner reports fault using the USB output mutex.
        }
        pauseMs(10);
    }
    return true;
}

void epaper_driver_display::initialize(bool fast) {
    if (!healthy) return;
    gpio_set_level((gpio_num_t)pins.rst, 1); pauseMs(200);
    gpio_set_level((gpio_num_t)pins.rst, 0); pauseMs(2);
    gpio_set_level((gpio_num_t)pins.rst, 1); pauseMs(200);
    command(0x4D); dataByte(0x78);
    const uint8_t psr[] = {0x0F, 0x29};
    command(0x00); data(psr, sizeof(psr));
    const uint8_t boost[] = {0x0D, 0x12, 0x30, 0x20, 0x19, 0x2A, 0x22};
    command(0x06); data(boost, sizeof(boost));
    command(0x50); dataByte(0x37);
    const uint8_t resolution[] = {uint8_t(Width >> 8), uint8_t(Width), uint8_t(Height >> 8), uint8_t(Height)};
    command(0x61); data(resolution, sizeof(resolution));
    command(0xE9); dataByte(0x01);
    command(0x30); dataByte(0x08);
    command(0x04);
    if (!waitReady()) return;
    if (fast) {
        command(0xE0); dataByte(0x02);
        command(0xE6); dataByte(0x5D);
        command(0xA5); dataByte(0x00);
        waitReady();
    }
}

void epaper_driver_display::EPD_Clear() {
    if (buffer) memset(buffer, 0x55, pins.buffer_len); // 01 = white for each pixel.
}

void epaper_driver_display::EPD_DrawColorPixel(uint16_t x, uint16_t y, uint8_t color) {
    if (!buffer || x >= Width || y >= Height) return;
    size_t index = y * ((Width + 3) / 4) + x / 4;
    uint8_t shift = (3 - x % 4) * 2;
    buffer[index] = (buffer[index] & ~(3 << shift)) | ((color & 3) << shift);
}

void epaper_driver_display::EPD_Display() {
    if (!healthy) return;
    command(0x10); data(buffer, pins.buffer_len);
    command(0x12); dataByte(0x00);
    waitReady();
}

void epaper_driver_display::EPD_Sleep() {
    if (!healthy) return;
    command(0x02); dataByte(0x00);
    if (waitReady()) { command(0x07); dataByte(0xA5); }
}
