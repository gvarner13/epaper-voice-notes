#include "cloud_sync.h"
#include "sync_format.h"
#if __has_include("cloud_credentials.h")
#include "cloud_credentials.h"
#else
#include "cloud_credentials.h.example"
#endif
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WiFi.h>
#include <cJSON.h>
#include <mbedtls/sha256.h>
#include <dirent.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <time.h>

std::atomic<bool> cloudPaused{true};
std::atomic<unsigned> cloudPending{0}, cloudUploaded{0}, cloudReady{0}, cloudDamaged{0}, cloudFailed{0};
std::atomic<bool> cloudIsEnabled{false};
std::atomic<int> cloudLastHttp{0};
extern void usbLine(const char *);
extern void updateCloudScreen();
extern bool validName(const char *);
static bool interrupted() { return cloudPaused || shuttingDown || !ready || WiFi.status() != WL_CONNECTED; }
static void sidePath(char *out, const char *name, const char *extension) {
  snprintf(out, 64, "/sdcard/NOTES/%.8s.%s", name, extension);
}
static bool exists(const char *path) { struct stat st{}; return stat(path, &st) == 0; }
static bool durableText(const char *path, const char *text) {
  char temp[72]; snprintf(temp, sizeof(temp), "%s.TMP", path);
  FILE *f = fopen(temp, "wb"); if (!f) return false;
  bool ok = fwrite(text, 1, strlen(text), f) == strlen(text) && fflush(f) == 0 && fsync(fileno(f)) == 0;
  if (fclose(f) != 0) ok = false;
  return ok && rename(temp, path) == 0;
}
static bool ensureIdentity(const char *name, char *id, char *captured, bool fresh) {
  char path[64]; sidePath(path, name, "ID");
  FILE *f = fopen(path, "rb");
  if (f) {
    char line[80]{}; size_t size = fread(line, 1, sizeof(line) - 1, f); fclose(f);
    if (size < 41 || sscanf(line, "%32s %20s", id, captured) != 2 || !syncValidId(id)) return false;
    return !strcmp(captured, "unknown") || (strlen(captured) == 20 && captured[19] == 'Z');
  }
  // A random ID is stored on SD, not derived from filenames or NVS/card counters.
  uint8_t random[16]; esp_fill_random(random, sizeof(random));
  for (int i = 0; i < 16; i++) snprintf(id + 2 * i, 3, "%02x", random[i]);
  strcpy(captured, "unknown");
  time_t now = time(nullptr);
  if (fresh && now >= 1767225600) { struct tm utc{}; gmtime_r(&now, &utc); strftime(captured, 21, "%Y-%m-%dT%H:%M:%SZ", &utc); }
  char text[80]; snprintf(text, sizeof(text), "%s %s\n", id, captured);
  return durableText(path, text);
}
bool cloudBeginRecording(const char *name) {
  char marker[64], id[33]{}, captured[21]{}; sidePath(marker, name, "RUN");
  int fd = open(marker, O_CREAT | O_EXCL | O_WRONLY, 0664);
  if (fd < 0) return false;
  bool ok = fsync(fd) == 0; if (close(fd) != 0) ok = false;
  return ok && ensureIdentity(name, id, captured, true);
}
void cloudFinishRecording(const char *name, bool saved) {
  // An interrupted/error recording remains explicitly blocked, even if a checkpoint WAV looks valid.
  if (saved) { char marker[64]; sidePath(marker, name, "RUN"); unlink(marker); }
}
class GuardedFileStream : public Stream {
  FILE *file;
  uint32_t remaining;
  bool failed = false;
public:
  GuardedFileStream(FILE *f, uint32_t bytes) : file(f), remaining(bytes) {}
  int available() override { return interrupted() || failed || !remaining ? -1 : int(min(remaining, uint32_t(1024))); }
  int read() override { uint8_t b; return readBytes(&b, 1) == 1 ? b : -1; }
  int peek() override { return -1; }
  size_t write(uint8_t) override { return 0; }
  size_t readBytes(char *buffer, size_t length) override { return readBytes((uint8_t *)buffer, length); }
  size_t readBytes(uint8_t *buffer, size_t length) override {
    if (interrupted()) return 0;
    SdGuard guard;
    if (interrupted()) return 0;
    size_t n = fread(buffer, 1, min(length, size_t(remaining)), file); remaining -= n;
    if (!n && remaining) { failed = true; cloudLastHttp = -100; }
    return n;
  }
};
static bool hashAudio(FILE *f, uint32_t size, char *checksum) {
  mbedtls_sha256_context ctx; mbedtls_sha256_init(&ctx); mbedtls_sha256_starts(&ctx, 0);
  uint8_t buffer[1024], digest[32]; uint32_t total = 0;
  while (total < size && !interrupted()) {
    size_t n;
    { SdGuard guard; if (interrupted()) break; n = fread(buffer, 1, min(size_t(size - total), sizeof(buffer)), f); }
    if (!n || mbedtls_sha256_update(&ctx, buffer, n) != 0) break;
    total += n; delay(1);
  }
  bool ok = total == size && !interrupted() && mbedtls_sha256_finish(&ctx, digest) == 0;
  mbedtls_sha256_free(&ctx);
  if (!ok) return false;
  for (int i = 0; i < 32; i++) snprintf(checksum + 2 * i, 3, "%02x", digest[i]);
  { SdGuard guard; rewind(f); }
  return true;
}
static int requestNote(const char *id, FILE *file, uint32_t size, const char *name, const char *captured, const char *checksum, String &state) {
  if (interrupted()) return 0;
  WiFiClientSecure client;
  client.setCACert(CLOUD_ROOT_CA); client.setHandshakeTimeout(5); client.setTimeout(1000);
  HTTPClient http; http.setConnectTimeout(1500); http.setTimeout(1500); http.setReuse(false);
  http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS); // Never leak the device credential to redirects.
  String url = String("https://") + CLOUD_HOST + "/recordings/" + CLOUD_DEVICE_ID + "_" + id;
  if (!http.begin(client, url)) return -1;
  http.setUserAgent("VoiceNotesDevice/1.3");
  http.addHeader("Authorization", String("Bearer ") + CLOUD_DEVICE_TOKEN);
  int code;
  if (file) {
    http.addHeader("Content-Type", "audio/wav"); http.addHeader("X-Audio-SHA256", checksum);
    http.addHeader("X-Original-Filename", name); http.addHeader("X-Captured-At", captured);
    GuardedFileStream stream(file, size);
    code = http.sendRequest("PUT", &stream, size);
  } else code = http.GET();
  if (code >= 200 && code < 300 && !interrupted()) {
    // Small fixed metadata response; never read a transcript or arbitrary unbounded response.
    String body;
    class ResponseStream : public Stream {
      String &body;
    public:
      explicit ResponseStream(String &value) : body(value) {}
      int available() override { return 0; } int read() override { return -1; } int peek() override { return -1; }
      size_t write(uint8_t b) override { if (body.length() >= 2048) return 0; body += char(b); return 1; }
      size_t write(const uint8_t *data, size_t n) override {
        if (interrupted() || body.length() + n > 2048) return 0;
        for (size_t i = 0; i < n; ++i) body += char(data[i]); return n;
      }
    } output(body);
    if (http.writeToStream(&output) > 0) {
      cJSON *json = cJSON_Parse(body.c_str());
      cJSON *value = json ? cJSON_GetObjectItemCaseSensitive(json, "state") : nullptr;
      cJSON *returnedId = json ? cJSON_GetObjectItemCaseSensitive(json, "id") : nullptr;
      String expected = String(CLOUD_DEVICE_ID) + "_" + id;
      cJSON *returnedSha = json ? cJSON_GetObjectItemCaseSensitive(json, "sha256") : nullptr;
      if (cJSON_IsString(value) && cJSON_IsString(returnedId) && cJSON_IsString(returnedSha) &&
          expected == returnedId->valuestring && !strcmp(checksum, returnedSha->valuestring)) state = value->valuestring;
      else code = 409;
      cJSON_Delete(json);
    }
  }
  http.end(); client.stop(); return code;
}
static void syncNote(const char *name, unsigned &pending, unsigned &uploaded, unsigned &transcribed, unsigned &damaged, unsigned &failed) {
  char path[64], marker[64], statusPath[64], id[33]{}, captured[21]{};
  snprintf(path, sizeof(path), "/sdcard/NOTES/%s", name); sidePath(marker, name, "RUN"); sidePath(statusPath, name, "UP");
  FILE *file = nullptr; uint32_t size = 0; bool wasUploaded = false;
  String previousState;
  {
    SdGuard guard;
    if (interrupted()) return;
    if (exists(marker)) { damaged++; return; }
    struct stat st{}; uint8_t header[44];
    if (stat(path, &st) != 0 || st.st_size > UINT32_MAX || !(file = fopen(path, "rb"))) { damaged++; return; }
    size = st.st_size;
    bool valid = syncValidWav(header, fread(header, 1, 44, file), size);
    if (!valid || !ensureIdentity(name, id, captured, false)) { fclose(file); damaged++; return; }
    rewind(file);
    FILE *status = fopen(statusPath, "rb");
    if (status) {
      char previous[32]{}; fread(previous, 1, sizeof(previous) - 1, status); fclose(status);
      wasUploaded = true;
      previousState = previous;
    }
  }
  char checksum[65]{}, fingerprint[64]; sidePath(fingerprint, name, "SHA");
  if (!hashAudio(file, size, checksum)) { SdGuard guard; fclose(file); pending++; return; }
  {
    SdGuard guard;
    FILE *stored = fopen(fingerprint, "rb");
    bool same = true;
    if (stored) { char old[65]{}; same = fread(old, 1, 64, stored) == 64 && !strcmp(old, checksum); fclose(stored); }
    else same = durableText(fingerprint, checksum);
    if (!same) { fclose(file); damaged++; return; } // Reused filename / modified audio must not reuse its old identity.
    if (previousState == "ready") { fclose(file); uploaded++; transcribed++; return; }
  }
  String state; int code = 0;
  if (wasUploaded) code = requestNote(id, nullptr, 0, name, captured, checksum, state);
  // Lost local marker or ack: immutable PUT is safe and repairs cloud ledger/outbox state.
  if (!wasUploaded || code == 404) code = requestNote(id, file, size, name, captured, checksum, state);
  { SdGuard guard; fclose(file); }
  if (interrupted()) { pending++; return; }
  cloudLastHttp = code;
  if (code >= 200 && code < 300 && state.length()) {
    { SdGuard guard; durableText(statusPath, state.c_str()); }
    uploaded++; if (state == "ready") transcribed++;
    if (state == "failed" || state == "uncertain") failed++;
  } else if (wasUploaded && code != 404) uploaded++;
  else pending++;
}
static void cloudTask(void *) {
  for (;;) {
    if (!interrupted()) {
      unsigned pending = 0, uploaded = 0, transcribed = 0, damaged = 0, failed = 0;
      DIR *dir;
      { SdGuard guard; dir = opendir("/sdcard/NOTES"); }
      if (dir) {
        while (!interrupted()) {
          char name[13]{}; bool done;
          { SdGuard guard; auto entry = readdir(dir); done = !entry;
            if (entry && validName(entry->d_name)) snprintf(name, sizeof(name), "%s", entry->d_name); }
          if (done) break;
          if (*name) syncNote(name, pending, uploaded, transcribed, damaged, failed);
        }
        { SdGuard guard; closedir(dir); }
        if (!interrupted()) { cloudPending = pending; cloudUploaded = uploaded; cloudReady = transcribed; cloudDamaged = damaged; cloudFailed = failed; updateCloudScreen(); }
      }
    }
    // One pass per minute; no busy polling and no retry loop for rejected credentials.
    for (int i = 0; i < 600 && !shuttingDown; ++i) vTaskDelay(pdMS_TO_TICKS(100));
    if (shuttingDown) vTaskDelete(nullptr);
  }
}
void cloudStartTask() {
#if CLOUD_ENABLED
  if (strlen(CLOUD_DEVICE_TOKEN) < 32 || !strlen(CLOUD_ROOT_CA) || !strlen(CLOUD_HOST)) {
    usbLine("CLOUD_DISABLED invalid credentials or trusted CA"); return;
  }
  cloudIsEnabled = true;
  if (xTaskCreatePinnedToCore(cloudTask, "cloud", 12288, nullptr, 1, nullptr, 1) != pdPASS) {
    cloudIsEnabled = false; usbLine("CLOUD_ERROR task allocation");
  }
#else
  usbLine("CLOUD_DISABLED local recording remains available");
#endif
}
