#include <Arduino.h>
#include <GxEPD2_BW.h>
#include "driver/rtc_io.h"
GxEPD2_BW<GxEPD2_154_D67, GxEPD2_154_D67::HEIGHT> display(GxEPD2_154_D67(11, 10, 9, 8));
void setup() {
  gpio_deep_sleep_hold_dis();
  for (int p : {0, 6, 8, 9, 10, 11, 12, 13, 17, 18}) {
    gpio_hold_dis((gpio_num_t)p); rtc_gpio_deinit((gpio_num_t)p);
  }
  pinMode(17, OUTPUT); digitalWrite(17, HIGH);
  pinMode(6, OUTPUT); digitalWrite(6, HIGH); delay(500); digitalWrite(6, LOW);
  Serial.begin(115200); delay(1000);
  Serial.println("DISPLAY_TEST SSD1681 / no SD card writes");
  SPI.begin(12, -1, 13, 11);
  display.epd2.selectSPI(SPI, SPISettings(4000000, MSBFIRST, SPI_MODE0));
  display.init(115200, true, 2, false);
  Serial.printf("BUSY after reset: %d\n", digitalRead(8));
  display.setRotation(0); display.setFullWindow(); display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK); display.setTextSize(2);
    display.setCursor(12, 40); display.print("VOICE NOTES");
    display.setCursor(12, 85); display.print("Screen test");
    display.setTextSize(1); display.setCursor(12, 140); display.print("SD card: FAT32 ready");
  } while (display.nextPage());
  Serial.printf("DISPLAY_TEST_DONE busy=%d\n", digitalRead(8));
}
void loop() { delay(1000); }
