#include <Arduino.h>
#include <sys/stat.h>
#include <unistd.h>
#include "esp_vfs_fat.h"
#include "sdmmc_cmd.h"
#include "driver/sdmmc_host.h"
#include "ff.h"

// Temporary SD-only formatter. Requires an explicit USB command, never formats on boot.
bool attempted = false;
void setup() {
  pinMode(17, OUTPUT); digitalWrite(17, HIGH);
  Serial.begin(115200); delay(1000);
  Serial.println("FORMATTER_READY: send FORMAT_SD_FAT32 to erase the inserted SD card");
}
void loop() {
  static char line[64]; static size_t used = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') { if (used < sizeof(line) - 1) line[used++] = c; continue; }
    line[used] = 0; used = 0;
    if (strcmp(line, "FORMAT_SD_FAT32") || attempted) { Serial.println("WAITING / already attempted"); continue; }
    attempted = true;
    Serial.println("FORMATTING_SD_ONLY"); Serial.flush();
    sdmmc_host_t host = SDMMC_HOST_DEFAULT();
    host.max_freq_khz = SDMMC_FREQ_DEFAULT;
    sdmmc_slot_config_t slot = SDMMC_SLOT_CONFIG_DEFAULT();
    slot.width = 1; slot.clk = GPIO_NUM_39; slot.cmd = GPIO_NUM_41; slot.d0 = GPIO_NUM_40;
    slot.d1 = slot.d2 = slot.d3 = slot.d4 = slot.d5 = slot.d6 = slot.d7 = GPIO_NUM_NC;
    slot.flags |= SDMMC_SLOT_FLAG_INTERNAL_PULLUP;
    esp_vfs_fat_sdmmc_mount_config_t cfg{};
    cfg.format_if_mount_failed = true; // Authorized by user; formatter only, not recorder firmware.
    cfg.max_files = 5; cfg.allocation_unit_size = 32768;
    sdmmc_card_t *card = nullptr;
    esp_err_t err = esp_vfs_fat_sdmmc_mount("/sdcard", &host, &slot, &cfg, &card);
    if (err != ESP_OK) { Serial.printf("FORMAT_ERROR %s\n", esp_err_to_name(err)); continue; }
    FATFS *fs = nullptr; DWORD freeClusters = 0;
    FRESULT result = f_getfree("0:", &freeClusters, &fs);
    if (result != FR_OK || !fs || fs->fs_type != FS_FAT32) {
      Serial.printf("VERIFY_ERROR fatfs=%d type=%d\n", result, fs ? fs->fs_type : -1);
      continue;
    }
    f_setlabel("0:VOICE_NOTES");
    mkdir("/sdcard/NOTES", 0775);
    FILE *f = fopen("/sdcard/NOTES/SDTEST.TXT", "wb");
    const char text[] = "FAT32 read/write verified\n";
    bool ok = f && fwrite(text, 1, sizeof(text) - 1, f) == sizeof(text) - 1;
    if (f) { if (fflush(f) || fsync(fileno(f))) ok = false; if (fclose(f)) ok = false; }
    char readback[64]{};
    f = fopen("/sdcard/NOTES/SDTEST.TXT", "rb");
    if (!f || fread(readback, 1, sizeof(text) - 1, f) != sizeof(text) - 1 || strcmp(readback, text)) ok = false;
    if (f) fclose(f);
    if (ok) unlink("/sdcard/NOTES/SDTEST.TXT");
    Serial.printf("FORMAT_DONE FAT32 cluster=%u bytes capacity=%lluMB free=%lluMB readwrite=%s\n",
                  unsigned(fs->csize) * 512, (unsigned long long)card->csd.capacity * card->csd.sector_size / 1048576,
                  (unsigned long long)freeClusters * fs->csize * 512 / 1048576, ok ? "OK" : "FAILED");
    esp_vfs_fat_sdcard_unmount("/sdcard", card);
    Serial.println("RESTORE_RECORDER_FIRMWARE_NOW");
  }
  delay(5);
}
