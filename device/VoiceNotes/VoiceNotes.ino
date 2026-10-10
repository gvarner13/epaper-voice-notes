#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <WiFi.h>
#include "wifi_credentials.h"
#include <atomic>
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include "esp_vfs_fat.h"
#include "sdmmc_cmd.h"
#include "driver/sdmmc_host.h"
#include "esp_sleep.h"
#include "driver/rtc_io.h"
#include "src/display/epaper_driver_bsp.h"
#include "src/codec_board/codec_board.h"
#include "src/codec_board/codec_init.h"
#include "src/esp_codec_dev/include/esp_codec_dev.h"
#include "wav.h"

// Waveshare ESP32-S3-ePaper-1.54G (four colors). All recordings stay local.
constexpr int PWR_PIN = 18; // BOOT_PIN = 0 is provided by the ESP32 core.
constexpr int EPD_POWER = 6, AUDIO_POWER = 42, BATTERY_HOLD = 17, AMP_ENABLE = 46;
constexpr uint32_t MAX_DATA = 0x7FFF0000; // Stay below signed 32-bit fseek / RIFF / FAT32 limits.
constexpr size_t FRAMES = 1024; // 64 ms audio per read.
const char *NOTES = "/sdcard/NOTES";

enum Action : uint8_t { TOGGLE, START, STOP, REPORT, LIST, GET, SHUTDOWN };
struct Command { Action action; char name[13]; };
enum WifiState : uint8_t { WIFI_CONNECTING, WIFI_CONNECTED, WIFI_OFFLINE };
struct Screen { char title[24]; char detail[40]; uint32_t seconds; bool recording; WifiState wifi; };
QueueHandle_t commands, screens;
SemaphoreHandle_t usbOutputLock, screenLock;
Screen currentScreen{};
std::atomic<WifiState> wifiState{WIFI_CONNECTING};

const char *wifiStateName(WifiState state) {
  switch (state) {
    case WIFI_CONNECTING: return "connecting";
    case WIFI_CONNECTED: return "connected";
    default: return "offline";
  }
}
enum PanelState { PANEL_STARTING, PANEL_REFRESHING, PANEL_READY, PANEL_OFFLINE };
std::atomic<PanelState> panelState{PANEL_STARTING};
esp_codec_dev_handle_t microphone;
std::atomic<bool> ready{false};
std::atomic<bool> shuttingDown{false};
std::atomic<bool> powerScreenDone{false};
epaper_driver_display *panel;

class PaperGraphics : public Adafruit_GFX {
public:
  PaperGraphics() : Adafruit_GFX(200, 200) {}
  void drawPixel(int16_t x, int16_t y, uint16_t color) override {
    if (x >= 0 && x < 200 && y >= 0 && y < 200)
      panel->EPD_DrawColorPixel(x, y, color & 3);
  }
};

void show(const char *title, const char *detail = "", uint32_t seconds = 0, bool recording = false) {
  Screen s{};
  snprintf(s.title, sizeof(s.title), "%s", title);
  snprintf(s.detail, sizeof(s.detail), "%s", detail);
  s.seconds = seconds; s.recording = recording;
  xSemaphoreTake(screenLock, portMAX_DELAY);
  s.wifi = wifiState.load();
  currentScreen = s;
  xQueueOverwrite(screens, &s);
  xSemaphoreGive(screenLock);
}

void usbLine(const char *line) {
  xSemaphoreTake(usbOutputLock, portMAX_DELAY);
  // Pace small chunks for the native USB-JTAG CDC FIFO (long writes can truncate).
  size_t length = strlen(line), sent = 0;
  uint32_t started = millis();
  while (sent < length && millis() - started < 250) {
    sent += Serial.write((const uint8_t *)line + sent, min(size_t(32), length - sent));
    delay(1);
  }
  Serial.println();
  xSemaphoreGive(usbOutputLock);
}

void updateWifiScreen(WifiState state) {
  // Preserve Ready / Saved / Recording; never replace it with a network-only screen.
  xSemaphoreTake(screenLock, portMAX_DELAY);
  if (!shuttingDown && wifiState.load() != state) {
    wifiState = state;
    currentScreen.wifi = state;
    xQueueOverwrite(screens, &currentScreen);
  }
  xSemaphoreGive(screenLock);
}

void wifiTask(void *) {
  WiFi.persistent(false); // Credentials live in the local header, not flash preferences.
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD); // No blocking wait for a connection.
  uint32_t lastAttempt = millis();
  WifiState lastReported = WIFI_CONNECTING;
  usbLine("WIFI connecting");
  while (!shuttingDown) {
    bool connected = WiFi.status() == WL_CONNECTED;
    WifiState state = connected ? WIFI_CONNECTED :
      (wifiState.load() == WIFI_CONNECTING && millis() - lastAttempt < 15000 ? WIFI_CONNECTING : WIFI_OFFLINE);
    updateWifiScreen(state);
    if (state != lastReported) {
      char log[128];
      snprintf(log, sizeof(log), "WIFI %s ssid=%s ip=%s", wifiStateName(state), WIFI_SSID,
               connected ? WiFi.localIP().toString().c_str() : "0.0.0.0");
      usbLine(log);
      lastReported = state;
    }
    if (!connected && !shuttingDown && millis() - lastAttempt >= 30000) {
      WiFi.reconnect();
      lastAttempt = millis();
    }
    vTaskDelay(pdMS_TO_TICKS(500));
  }
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  vTaskDelete(nullptr);
}

void displayTask(void *) {
  custom_lcd_spi_t pins{};
  pins.cs = 11; pins.dc = 10; pins.rst = 9; pins.busy = 8;
  pins.mosi = 13; pins.scl = 12; pins.spi_host = SPI2_HOST; pins.buffer_len = 10000;
  panel = new epaper_driver_display(200, 200, pins);
  panel->EPD_Init();
  if (!panel->isHealthy()) {
    panelState = PANEL_OFFLINE;
    usbLine("DISPLAY_OFFLINE recorder remains usable");
    powerScreenDone = true; // Don't wait for a broken display during shutdown.
    vTaskDelete(nullptr); return;
  }
  PaperGraphics gfx;
  gfx.setTextColor(0); gfx.setTextWrap(false);
  bool first = true;
  Screen s;
  while (xQueueReceive(screens, &s, portMAX_DELAY) == pdTRUE) {
    panelState = PANEL_REFRESHING;
    if (!first) panel->EPD_Init_Fast();
    panel->EPD_Clear();
    gfx.fillRect(0, 0, 200, 38, DRIVER_COLOR_RED);
    gfx.setTextColor(DRIVER_COLOR_WHITE);
    gfx.setTextSize(2); gfx.setCursor(16, 12); gfx.print("VOICE NOTES");
    gfx.setTextColor(s.recording ? DRIVER_COLOR_RED : DRIVER_COLOR_BLACK);
    gfx.setCursor(12, 52); gfx.print(s.title);
    gfx.setTextColor(DRIVER_COLOR_BLACK);
    gfx.setTextSize(1); gfx.setCursor(12, 85); gfx.print(s.detail);
    if (s.recording) {
      gfx.setCursor(12, 115); gfx.print("Capturing audio now.");
      gfx.setCursor(12, 130); gfx.print("Press BOOT again to save.");
    } else if (s.seconds) {
      gfx.setTextSize(3); gfx.setCursor(12, 110);
      gfx.printf("%02lu:%02lu", (unsigned long)(s.seconds / 60), (unsigned long)(s.seconds % 60));
    }
    gfx.setTextSize(1); gfx.setCursor(12, 147);
    if (s.wifi == WIFI_CONNECTED) {
      gfx.print("WiFi: "); gfx.print(WIFI_SSID); gfx.print(" connected");
    } else {
      gfx.print(!strcmp(s.title, "Power off") ? "WiFi: off" :
                (s.wifi == WIFI_CONNECTING ? "WiFi: connecting..." : "WiFi: offline (retrying)"));
    }
    gfx.setTextSize(1); gfx.setCursor(12, 162); gfx.print("BOOT: start / stop");
    gfx.setCursor(12, 179); gfx.print("Hold PWR: save / off");
    panel->EPD_Display();
    first = false;
    if (!panel->isHealthy()) {
      panelState = PANEL_OFFLINE;
      usbLine("DISPLAY_OFFLINE recorder remains usable");
      powerScreenDone = true;
      vTaskDelete(nullptr); return;
    }
    panelState = PANEL_READY;
    char log[64]; snprintf(log, sizeof(log), "DISPLAY_UPDATED %s", s.title); usbLine(log);
    if (!strcmp(s.title, "Power off")) {
      panel->EPD_Sleep();
      powerScreenDone = true;
    }
  }
}

void powerDown() {
  shuttingDown = true; ready = false;
  wifiState = WIFI_OFFLINE;
  show("Power off", "Safe to disconnect");
  uint32_t start = millis();
  while (!powerScreenDone && millis() - start < 120000) delay(10);
  if (microphone) esp_codec_dev_close(microphone);
  digitalWrite(EPD_POWER, HIGH); digitalWrite(AUDIO_POWER, HIGH);
  while (digitalRead(PWR_PIN) == LOW) delay(10);
  esp_sleep_enable_ext1_wakeup(1ULL << PWR_PIN, ESP_EXT1_WAKEUP_ALL_LOW);
  digitalWrite(BATTERY_HOLD, LOW);
  esp_deep_sleep_start();
}

bool mountCard() {
  esp_vfs_fat_sdmmc_mount_config_t cfg{};
  cfg.format_if_mount_failed = false; // NEVER format the user's card.
  cfg.max_files = 5; cfg.allocation_unit_size = 16 * 1024;
  sdmmc_host_t host = SDMMC_HOST_DEFAULT();
  host.max_freq_khz = SDMMC_FREQ_DEFAULT; // Conservative 20 MHz.
  sdmmc_slot_config_t slot = SDMMC_SLOT_CONFIG_DEFAULT();
  slot.width = 1; slot.clk = GPIO_NUM_39; slot.cmd = GPIO_NUM_41; slot.d0 = GPIO_NUM_40;
  slot.d1 = slot.d2 = slot.d3 = slot.d4 = slot.d5 = slot.d6 = slot.d7 = GPIO_NUM_NC;
  slot.flags |= SDMMC_SLOT_FLAG_INTERNAL_PULLUP;
  sdmmc_card_t *card = nullptr;
  esp_err_t err = esp_vfs_fat_sdmmc_mount("/sdcard", &host, &slot, &cfg, &card);
  if (err != ESP_OK) {
    Serial.printf("SD_ERROR %s; card was NOT formatted\n", esp_err_to_name(err));
    // Read-only filesystem diagnostics after the failed mount cleaned up its host.
    if (sdmmc_host_init() == ESP_OK) {
      sdmmc_card_t probe{};
      uint8_t *sector = (uint8_t *)heap_caps_malloc(512, MALLOC_CAP_DMA);
      if (sector && sdmmc_host_init_slot(host.slot, &slot) == ESP_OK &&
          sdmmc_card_init(&host, &probe) == ESP_OK &&
          sdmmc_read_sectors(&probe, sector, 0, 1) == ESP_OK) {
        Serial.printf("SD_READ_OK capacity=%lluMB OEM=%.8s signature=%02X%02X\n",
                      (unsigned long long)probe.csd.capacity * probe.csd.sector_size / 1048576,
                      sector + 3, sector[510], sector[511]);
        if (!memcmp(sector + 3, "EXFAT   ", 8)) Serial.println("SD_FORMAT exFAT (requires FAT32)");
        else {
          uint32_t lba = 0;
          for (int i = 0; i < 4; ++i) lba |= uint32_t(sector[454 + i]) << (i * 8);
          Serial.printf("SD_PARTITION type=0x%02X start=%lu\n", sector[450], (unsigned long)lba);
          if (lba && lba < probe.csd.capacity && sdmmc_read_sectors(&probe, sector, lba, 1) == ESP_OK)
            Serial.printf("SD_PARTITION_FS OEM=%.8s FAT32=%.8s\n", sector + 3, sector + 82);
        }
      }
      free(sector); sdmmc_host_deinit();
    }
    show("SD error", "Check card / FAT32; reboot"); return false;
  }
  sdmmc_card_print_info(stdout, card);
  struct stat st{};
  if (stat(NOTES, &st) != 0) {
    if (mkdir(NOTES, 0775) != 0) { show("SD error", "Cannot create NOTES folder"); return false; }
  } else if (!S_ISDIR(st.st_mode)) {
    show("SD error", "NOTES exists; not a folder"); return false;
  }
  Serial.println("SD_OK /NOTES (no format)");
  return true;
}

bool initMicrophone() {
  set_codec_board_type("S3_ePaper_1_54");
  codec_init_cfg_t cfg{};
  cfg.in_mode = CODEC_I2S_MODE_STD; cfg.out_mode = CODEC_I2S_MODE_STD;
  cfg.reuse_dev = false;
  if (init_codec(&cfg) != 0 || !(microphone = get_record_handle())) return false;
  // The codec uses two I2S slots; save its left ADC slot as mono PCM.
  esp_codec_dev_sample_info_t fs{};
  fs.sample_rate = 16000; fs.channel = 2; fs.bits_per_sample = 16;
  if (esp_codec_dev_open(microphone, &fs) != ESP_CODEC_DEV_OK) return false;
  if (esp_codec_dev_set_in_gain(microphone, 30.0f) != ESP_CODEC_DEV_OK) return false;
  digitalWrite(AMP_ENABLE, LOW); // Keep speaker amplifier disabled.
  Serial.println("MIC_OK ES8311 16000Hz / 16-bit / mono, gain 30dB");
  return true;
}

bool checkpoint(FILE *f, uint32_t bytes) {
  uint8_t header[44]; makeWavHeader(header, bytes);
  if (fseek(f, 0, SEEK_SET) != 0 || fwrite(header, 1, 44, f) != 44) return false;
  if (fflush(f) != 0 || fsync(fileno(f)) != 0) return false;
  return fseek(f, 44L + bytes, SEEK_SET) == 0;
}

bool validName(const char *n) {
  if (strlen(n) != 12 || strncmp(n, "VN", 2) || strcmp(n + 8, ".WAV")) return false;
  for (int i = 2; i < 8; ++i) if (n[i] < '0' || n[i] > '9') return false;
  return true;
}

void listNotes() {
  DIR *dir = opendir(NOTES);
  if (!dir) { usbLine("LIST_ERROR"); return; }
  usbLine("FILES_BEGIN");
  while (auto e = readdir(dir)) {
    if (!validName(e->d_name)) continue;
    char path[64]; snprintf(path, sizeof(path), "%s/%s", NOTES, e->d_name);
    struct stat st{};
    if (stat(path, &st) == 0) {
      char entry[48]; snprintf(entry, sizeof(entry), "%s %ld", e->d_name, (long)st.st_size);
      usbLine(entry);
    }
  }
  closedir(dir); usbLine("FILES_END");
}

void getNote(const char *name) {
  if (!validName(name)) { Serial.println("GET_ERROR invalid name"); return; }
  char path[64]; snprintf(path, sizeof(path), "%s/%s", NOTES, name);
  FILE *f = fopen(path, "rb");
  if (!f) { Serial.println("GET_ERROR not found"); return; }
  fseek(f, 0, SEEK_END); long size = ftell(f); rewind(f);
  xSemaphoreTake(usbOutputLock, portMAX_DELAY);
  Serial.printf("FILE_BEGIN %s %ld\n", name, size);
  uint8_t data[1024]; size_t n;
  while ((n = fread(data, 1, sizeof(data), f))) {
    size_t sent = 0;
    while (sent < n) {
      size_t written = Serial.write(data + sent, min(size_t(32), n - sent)); // Same CDC pacing as status lines.
      if (!written) { fclose(f); xSemaphoreGive(usbOutputLock); return; }
      sent += written;
      delay(1);
    }
  }
  fclose(f); Serial.println("\nFILE_END");
  xSemaphoreGive(usbOutputLock);
}

void recorderTask(void *) {
  bool cardOK = mountCard();
  // Mount/diagnostic cleanup must finish before another driver configures GPIOs.
  xTaskCreatePinnedToCore(displayTask, "paper", 6144, nullptr, 1, nullptr, 1);
  bool micOK = initMicrophone();
  gpio_set_direction(GPIO_NUM_0, GPIO_MODE_INPUT);
  gpio_pullup_en(GPIO_NUM_0);
  if (!cardOK || !micOK) {
    if (cardOK) show("Mic error", "Codec initialization failed");
    Serial.println("NOT_READY");
    for (;;) {
      Command c;
      if (xQueueReceive(commands, &c, portMAX_DELAY)) {
        if (c.action == SHUTDOWN) powerDown();
        Serial.printf("NOT_READY card=%d mic=%d epdPower=%d audioPower=%d busy=%d rst=%d cs=%d boot=%d pwr=%d\n",
                      cardOK, micOK, digitalRead(EPD_POWER), digitalRead(AUDIO_POWER),
                      digitalRead(8), digitalRead(9), digitalRead(11), digitalRead(BOOT_PIN), digitalRead(PWR_PIN));
      }
    }
  }
  int16_t *stereo = (int16_t *)heap_caps_malloc(FRAMES * 4, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  int16_t *mono = (int16_t *)heap_caps_malloc(FRAMES * 2, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  if (!stereo || !mono) { show("Memory error"); vTaskDelete(nullptr); return; }
  FILE *file = nullptr;
  char name[13] = "";
  uint32_t bytes = 0, nextId = 1, lastSync = 0;
  int peakLeft = 0, peakRight = 0;
  ready = true; show("Ready", "SD card mounted"); Serial.println("READY");
  for (;;) {
    Command cmd{};
    bool haveCommand = xQueueReceive(commands, &cmd, 0) == pdTRUE;
    bool finish = haveCommand && (cmd.action == STOP || cmd.action == SHUTDOWN || (cmd.action == TOGGLE && file));
    bool start = haveCommand && (cmd.action == START || (cmd.action == TOGGLE && !file));
    if (finish && file) {
      bool ok = checkpoint(file, bytes);
      if (fclose(file) != 0) ok = false;
      file = nullptr;
      Serial.printf("%s %s bytes=%lu seconds=%.2f peakL=%d peakR=%d\n",
                    ok ? "SAVED" : "SAVE_ERROR", name, (unsigned long)bytes, bytes / 32000.0, peakLeft, peakRight);
      show(ok ? "Saved" : "Save error", name, bytes / 32000);
    }
    if (haveCommand && cmd.action == SHUTDOWN) {
      powerDown();
    }
    if (haveCommand && cmd.action == REPORT) {
      char status[256];
      bool connected = WiFi.status() == WL_CONNECTED;
      snprintf(status, sizeof(status), "STATUS %s file=%s bytes=%lu boot=%d pwr=%d display=%d wifi=%s ssid=%s ip=%s rssi=%d",
               file ? "RECORDING" : "IDLE", name, (unsigned long)bytes,
               digitalRead(BOOT_PIN), digitalRead(PWR_PIN), int(panelState.load()),
               wifiStateName(wifiState.load()), WIFI_SSID,
               connected ? WiFi.localIP().toString().c_str() : "0.0.0.0", connected ? WiFi.RSSI() : 0);
      usbLine(status);
    }
    if (haveCommand && (cmd.action == LIST || cmd.action == GET)) {
      if (file) Serial.println("BUSY stop recording first");
      else if (cmd.action == LIST) listNotes();
      else getNote(cmd.name);
    }
    if (start && !file) {
      char path[64];
      int fd = -1;
      while (nextId <= 999999) {
        snprintf(name, sizeof(name), "VN%06lu.WAV", (unsigned long)nextId++);
        snprintf(path, sizeof(path), "%s/%s", NOTES, name);
        fd = open(path, O_CREAT | O_EXCL | O_RDWR, 0664); // Never overwrite any existing note.
        if (fd >= 0 || errno != EEXIST) break;
      }
      file = fd >= 0 ? fdopen(fd, "wb+") : nullptr;
      if (!file) {
        if (fd >= 0) close(fd);
        Serial.println("CREATE_ERROR card full / write failed"); show("Write error", "Check card space");
      } else {
        bytes = 0; peakLeft = peakRight = 0;
        lastSync = millis();
        if (!checkpoint(file, 0)) {
          fclose(file); file = nullptr; show("Write error", "Cannot write WAV header");
        } else {
          show("Recording", name, 0, true); Serial.printf("RECORDING %s\n", name);
        }
      }
    }
    // Continuously drain I2S, even idle: a new note has no old DMA-buffered audio.
    if (esp_codec_dev_read(microphone, stereo, FRAMES * 4) != ESP_CODEC_DEV_OK) {
      if (file) { checkpoint(file, bytes); fclose(file); file = nullptr; }
      Serial.println("MIC_READ_ERROR"); show("Mic error", "Reboot device");
      ready = false; vTaskDelete(nullptr); return;
    }
    if (!file) continue;
    for (size_t i = 0; i < FRAMES; ++i) {
      mono[i] = stereo[2 * i];
      peakLeft = max(peakLeft, abs((int)stereo[2 * i]));
      peakRight = max(peakRight, abs((int)stereo[2 * i + 1]));
    }
    size_t wrote = fwrite(mono, 1, FRAMES * 2, file);
    bytes += wrote - (wrote % 2);
    bool failed = wrote != FRAMES * 2;
    if (!failed && millis() - lastSync >= 2000) {
      failed = !checkpoint(file, bytes); lastSync = millis();
    }
    if (failed || bytes > MAX_DATA - FRAMES * 2) {
      checkpoint(file, bytes); fclose(file); file = nullptr;
      Serial.println("WRITE_STOP card full / write error / file limit");
      show("Recording stopped", "Check SD card space");
    }
    // The 1.54G needs 15-20 seconds per refresh. Only refresh on state changes,
    // not a live timer; capture/start/stop still respond immediately.
  }
}

void sendCommand(Action action, const char *name = "") {
  Command cmd{}; cmd.action = action; snprintf(cmd.name, sizeof(cmd.name), "%s", name);
  if (xQueueSend(commands, &cmd, 0) != pdTRUE) usbLine("COMMAND_QUEUE_FULL");
}

void setup() {
  gpio_deep_sleep_hold_dis();
  for (int p : {0, 6, 8, 9, 10, 11, 12, 13, 17, 18}) {
    gpio_hold_dis((gpio_num_t)p);
    rtc_gpio_deinit((gpio_num_t)p);
  }
  // Arduino 3.x requires pins to be attached as GPIO before digitalWrite.
  pinMode(BATTERY_HOLD, OUTPUT); digitalWrite(BATTERY_HOLD, HIGH);
  pinMode(EPD_POWER, OUTPUT); digitalWrite(EPD_POWER, HIGH);
  // Prevent SPI/reset pins from back-powering the panel during its power cycle.
  for (int p : {9, 10, 11, 12, 13}) { pinMode(p, OUTPUT); digitalWrite(p, LOW); }
  delay(2000);
  digitalWrite(EPD_POWER, LOW);
  delay(100);
  pinMode(AUDIO_POWER, OUTPUT); digitalWrite(AUDIO_POWER, LOW);
  pinMode(AMP_ENABLE, OUTPUT); digitalWrite(AMP_ENABLE, LOW);
  pinMode(BOOT_PIN, INPUT_PULLUP); pinMode(PWR_PIN, INPUT_PULLUP);
  Serial.begin(115200); delay(1000);
  Serial.println("VOICE_NOTES_1.54G v1.2; SD card is never formatted");
  commands = xQueueCreate(8, sizeof(Command)); screens = xQueueCreate(1, sizeof(Screen));
  usbOutputLock = xSemaphoreCreateMutex();
  screenLock = xSemaphoreCreateMutex();
  if (!commands || !screens || !usbOutputLock || !screenLock || !psramFound()) {
    Serial.println("INIT_ERROR queues / PSRAM"); return;
  }
  show("Starting", "Checking SD / microphone");
  xTaskCreatePinnedToCore(recorderTask, "recorder", 8192, nullptr, 4, nullptr, 0);
  if (xTaskCreatePinnedToCore(wifiTask, "wifi", 4096, nullptr, 1, nullptr, 1) != pdPASS) {
    updateWifiScreen(WIFI_OFFLINE);
    usbLine("WIFI_ERROR cannot start network task");
  }
}

void loop() {
  if (!commands) { delay(100); return; }
  // Debounce on the input loop, independent of SD writes and screen refreshes.
  static bool raw = HIGH, stable = HIGH, armed = false;
  static uint32_t changedAt = 0, pwrAt = 0;
  static bool pwrHeld = false, powerSent = false;
  bool now = digitalRead(BOOT_PIN);
  if (now != raw) { raw = now; changedAt = millis(); }
  if (ready && raw == HIGH) armed = true;
  if (raw != stable && millis() - changedAt >= 35) {
    stable = raw;
    if (stable == LOW && armed && ready && !shuttingDown) sendCommand(TOGGLE);
  }
  if (digitalRead(PWR_PIN) == LOW) {
    if (!pwrHeld) { pwrAt = millis(); pwrHeld = true; }
    if (!powerSent && !shuttingDown && millis() - pwrAt >= 2000) {
      sendCommand(SHUTDOWN); powerSent = true;
    }
  } else { pwrHeld = false; powerSent = false; }
  static char line[64]; static size_t used = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      line[used] = 0;
      if (!strcmp(line, "START")) sendCommand(START);
      else if (!strcmp(line, "STOP")) sendCommand(STOP);
      else if (!strcmp(line, "STATUS")) sendCommand(REPORT);
      else if (!strcmp(line, "LIST")) sendCommand(LIST);
      else if (!strncmp(line, "GET ", 4)) sendCommand(GET, line + 4);
      else if (used) usbLine("Commands: START STOP STATUS LIST GET VN000001.WAV");
      used = 0;
    } else if (used < sizeof(line) - 1) line[used++] = c;
  }
  delay(5);
}
