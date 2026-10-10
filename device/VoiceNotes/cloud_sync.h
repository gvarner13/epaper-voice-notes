#pragma once
#include <Arduino.h>
#include <atomic>
extern SemaphoreHandle_t sdLock;
extern std::atomic<bool> cloudPaused;
extern std::atomic<bool> shuttingDown;
extern std::atomic<bool> ready;
extern std::atomic<unsigned> cloudPending, cloudUploaded, cloudReady, cloudDamaged, cloudFailed;
extern std::atomic<bool> cloudIsEnabled;
extern std::atomic<int> cloudLastHttp;
void cloudStartTask();
// Called while sdLock is held. Mark before opening audio; remove only after a clean save.
bool cloudBeginRecording(const char *name);
void cloudFinishRecording(const char *name, bool saved);
class SdGuard {
public:
  SdGuard() { xSemaphoreTake(sdLock, portMAX_DELAY); }
  ~SdGuard() { xSemaphoreGive(sdLock); }
};
