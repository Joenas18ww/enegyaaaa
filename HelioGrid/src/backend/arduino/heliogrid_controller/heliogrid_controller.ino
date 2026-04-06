// ============================================================================
// HelioGrid Arduino Controller — RELAY EXECUTOR v5.0 (Revised Current Code)
// Based on uploaded v4.5.ino
//
// RELAY LOGIC:
//   K1 (SSR1) = Manual ON/OFF only
//   K2 (SSR2) = Manual ON/OFF only
//   K3 (SSR3) = Auto charging control
//               ON  when charging
//               OFF when full charge and/or discharging
//   K4 (SSR4) = Normally ON
//               OFF during dropout
//               ON again after 60s recovery when source returns
//   Contactor = ON when connected, OFF when disconnected
//
// SAFETY:
//   K1 and K2 MUST NEVER be ON at the same time.
// ============================================================================

// ─── CALIBRATION ─────────────────────────────────────────────────────────────
const float WCS_ZERO_V0     = 2.4740f;
const float WCS_ZERO_V1     = 2.5096f;
const float WCS_ZERO_V2     = 2.4999f;
const float WCS_ZERO_V3     = 2.5148f;
const float WCS_SENSITIVITY = 0.011f;

// ─── FILTERS ─────────────────────────────────────────────────────────────────
const float CURRENT_FILTER_A = 1.33f;
const float VOLTAGE_FILTER_V = 16.9f;

// ─── VOLTAGE DIVIDER ─────────────────────────────────────────────────────────
const float VDIV_RATIO  = 38.09f;
const int   ADC_SAMPLES = 500;

// ─── PINS ─────────────────────────────────────────────────────────────────────
const int PIN_SSR1_K1  = 7;
const int PIN_SSR2_K2  = 6;
const int PIN_SSR3_K3  = 5;
const int PIN_SSR4_K4  = 4;
const int PIN_SOLAR_I0 = A0;
const int PIN_SOLAR_I1 = A1;
const int PIN_SOLAR_I2 = A2;
const int PIN_SOLAR_I3 = A3;
const int PIN_SOLAR_V  = A4;

// ─── ADC ──────────────────────────────────────────────────────────────────────
const float ADC_VREF   = 5.0f;
const float ADC_COUNTS = 1024.0f;

// ─── TIMING ───────────────────────────────────────────────────────────────────
const unsigned long DEAD_TIME_MS      = 20UL;
const unsigned long RECOVERY_TIME_MS  = 60000UL;   // 60 seconds
const unsigned long DROPOUT_DEBOUNCE  = 200UL;

// ─── STATE ────────────────────────────────────────────────────────────────────
bool stSSR1 = false;
bool stSSR2 = false;
bool stSSR3 = false;
bool stSSR4 = true;    // always ON by default

bool dropoutActive = false;
bool recoveryPending = false;
unsigned long recoveryStartMillis = 0;
unsigned long lastDropoutMillis = 0;

// =============================================================================
// CORE RELAY WRITE
// =============================================================================
void writeRelays(bool ssr1, bool ssr2, bool ssr3, bool ssr4) {
  // Interlock: K1 and K2 must never both be ON
  if (ssr1 && ssr2) {
    Serial.println(F("{\"warn\":\"K1_K2_INTERLOCK\",\"action\":\"K2_FORCED_OFF\"}"));
    ssr2 = false;
  }

  stSSR1 = ssr1;
  stSSR2 = ssr2;
  stSSR3 = ssr3;
  stSSR4 = ssr4;

  digitalWrite(PIN_SSR1_K1, stSSR1 ? HIGH : LOW);
  digitalWrite(PIN_SSR2_K2, stSSR2 ? HIGH : LOW);
  digitalWrite(PIN_SSR3_K3, stSSR3 ? HIGH : LOW);
  digitalWrite(PIN_SSR4_K4, stSSR4 ? HIGH : LOW);
}

// =============================================================================
// MANUAL CONTROL — SSR1 / K1
// =============================================================================
void ssr1On() {
  writeRelays(true, false, stSSR3, stSSR4);
  Serial.println(F("{\"ssr1_k1\":1,\"mode\":\"manual\",\"fn\":\"k1_on\"}"));
}

void ssr1Off() {
  writeRelays(false, stSSR2, stSSR3, stSSR4);
  Serial.println(F("{\"ssr1_k1\":0,\"mode\":\"manual\",\"fn\":\"k1_off\"}"));
}

// =============================================================================
// MANUAL CONTROL — SSR2 / K2
// =============================================================================
void ssr2On() {
  writeRelays(false, true, stSSR3, stSSR4);
  Serial.println(F("{\"ssr2_k2\":1,\"mode\":\"manual\",\"fn\":\"k2_on\"}"));
}

void ssr2Off() {
  writeRelays(stSSR1, false, stSSR3, stSSR4);
  Serial.println(F("{\"ssr2_k2\":0,\"mode\":\"manual\",\"fn\":\"k2_off\"}"));
}

// =============================================================================
// AUTO CONTROL — SSR3 / K3
// =============================================================================
void ssr3ChargingOn() {
  writeRelays(stSSR1, stSSR2, true, stSSR4);
  Serial.println(F("{\"ssr3_k3\":1,\"mode\":\"auto\",\"state\":\"charging\",\"fn\":\"k3_on\"}"));
}

void ssr3ChargingOff() {
  writeRelays(stSSR1, stSSR2, false, stSSR4);
  Serial.println(F("{\"ssr3_k3\":0,\"mode\":\"auto\",\"state\":\"full_or_discharging\",\"fn\":\"k3_off\"}"));
}

// =============================================================================
// SSR4 / CONTACTOR DROPOUT + RECOVERY
// =============================================================================
void triggerDropout() {
  unsigned long now = millis();

  if ((now - lastDropoutMillis) < DROPOUT_DEBOUNCE) return;
  lastDropoutMillis = now;

  dropoutActive = true;
  recoveryPending = false;

  writeRelays(stSSR1, stSSR2, stSSR3, false);

  Serial.println(F("{\"ssr4_k4\":0,\"dropout\":1,\"contactor\":\"off\",\"connected\":0,\"fn\":\"dropout_off\"}"));
}

void restoreAfterDropout() {
  if (dropoutActive) {
    dropoutActive = false;
    recoveryPending = true;
    recoveryStartMillis = millis();

    Serial.println(F("{\"recovery\":\"started\",\"delay_s\":60,\"fn\":\"recovery_wait\"}"));
  }
}

void handleRecoveryTimer() {
  if (recoveryPending && (millis() - recoveryStartMillis >= RECOVERY_TIME_MS)) {
    recoveryPending = false;
    writeRelays(stSSR1, stSSR2, stSSR3, true);

    Serial.println(F("{\"ssr4_k4\":1,\"recovery\":\"complete\",\"contactor\":\"on\",\"connected\":1,\"fn\":\"k4_on_after_recovery\"}"));
  }
}

// =============================================================================
// SENSOR READS
// =============================================================================
float readAdcVoltage(int pin) {
  long sum = 0;
  for (int i = 0; i < ADC_SAMPLES; i++) {
    sum += analogRead(pin);
    delayMicroseconds(200);
  }
  return (sum / (float)ADC_SAMPLES) * (ADC_VREF / ADC_COUNTS);
}

float readWCS1500(int pin, float zeroV) {
  float v = readAdcVoltage(pin);
  float i = (v - zeroV) / WCS_SENSITIVITY;
  if (i < CURRENT_FILTER_A && i > -CURRENT_FILTER_A) return 0.0f;
  return max(0.0f, i);
}

float readSolarVoltage(int pin) {
  float v  = readAdcVoltage(pin);
  float sv = v * VDIV_RATIO;
  if (sv < VOLTAGE_FILTER_V) return 0.0f;
  return sv;
}

// =============================================================================
// STATUS JSON — '?' command
// =============================================================================
void sendStatus() {
  float i0 = readWCS1500(PIN_SOLAR_I0, WCS_ZERO_V0);
  float i1 = readWCS1500(PIN_SOLAR_I1, WCS_ZERO_V1);
  float i2 = readWCS1500(PIN_SOLAR_I2, WCS_ZERO_V2);
  float i3 = readWCS1500(PIN_SOLAR_I3, WCS_ZERO_V3);
  float sv = readSolarVoltage(PIN_SOLAR_V);

  float totalI = ((i0 + i1) / 2.0f) + ((i2 + i3) / 2.0f);
  float totalP = sv * totalI;

  Serial.print(F("{"));
  Serial.print(F("\"ssr1_k1\":")); Serial.print(stSSR1 ? 1 : 0); Serial.print(F(","));
  Serial.print(F("\"ssr2_k2\":")); Serial.print(stSSR2 ? 1 : 0); Serial.print(F(","));
  Serial.print(F("\"ssr3_k3\":")); Serial.print(stSSR3 ? 1 : 0); Serial.print(F(","));
  Serial.print(F("\"ssr4_k4\":")); Serial.print(stSSR4 ? 1 : 0); Serial.print(F(","));
  Serial.print(F("\"contactor\":")); Serial.print(stSSR4 ? F("\"on\"") : F("\"off\"")); Serial.print(F(","));
  Serial.print(F("\"connected\":")); Serial.print(stSSR4 ? 1 : 0); Serial.print(F(","));
  Serial.print(F("\"dropout\":")); Serial.print(dropoutActive ? 1 : 0); Serial.print(F(","));
  Serial.print(F("\"recovery_pending\":")); Serial.print(recoveryPending ? 1 : 0); Serial.print(F(","));
  Serial.print(F("\"solar\":{"));
  Serial.print(F("\"v\":")); Serial.print(sv, 2); Serial.print(F(","));
  Serial.print(F("\"i0\":")); Serial.print(i0, 3); Serial.print(F(","));
  Serial.print(F("\"i1\":")); Serial.print(i1, 3); Serial.print(F(","));
  Serial.print(F("\"i2\":")); Serial.print(i2, 3); Serial.print(F(","));
  Serial.print(F("\"i3\":")); Serial.print(i3, 3); Serial.print(F(","));
  Serial.print(F("\"i_total\":")); Serial.print(totalI, 3); Serial.print(F(","));
  Serial.print(F("\"p_total\":")); Serial.print(totalP, 1);
  Serial.println(F("}}"));
}

// =============================================================================
// CALIBRATION DUMP — 'c' command
// =============================================================================
void sendCalibration() {
  float v0 = readAdcVoltage(PIN_SOLAR_I0);
  float v1 = readAdcVoltage(PIN_SOLAR_I1);
  float v2 = readAdcVoltage(PIN_SOLAR_I2);
  float v3 = readAdcVoltage(PIN_SOLAR_I3);
  float v4 = readAdcVoltage(PIN_SOLAR_V);
  float sv = v4 * VDIV_RATIO;

  Serial.print(F("{\"cal\":{"));
  Serial.print(F("\"A0\":")); Serial.print(v0, 4); Serial.print(F(","));
  Serial.print(F("\"A1\":")); Serial.print(v1, 4); Serial.print(F(","));
  Serial.print(F("\"A2\":")); Serial.print(v2, 4); Serial.print(F(","));
  Serial.print(F("\"A3\":")); Serial.print(v3, 4); Serial.print(F(","));
  Serial.print(F("\"A4\":")); Serial.print(v4, 4); Serial.print(F(","));
  Serial.print(F("\"v\":")); Serial.print(sv, 2); Serial.print(F(","));
  Serial.print(F("\"ratio\":")); Serial.print(VDIV_RATIO, 1);
  Serial.println(F("}}"));
}

// =============================================================================
// SETUP
// =============================================================================
void setup() {
  Serial.begin(9600);

  pinMode(PIN_SSR1_K1, OUTPUT); digitalWrite(PIN_SSR1_K1, LOW);
  pinMode(PIN_SSR2_K2, OUTPUT); digitalWrite(PIN_SSR2_K2, LOW);
  pinMode(PIN_SSR3_K3, OUTPUT); digitalWrite(PIN_SSR3_K3, LOW);
  pinMode(PIN_SSR4_K4, OUTPUT); digitalWrite(PIN_SSR4_K4, HIGH);

  delay(200);
  while (Serial.available()) Serial.read();

  stSSR1 = false;
  stSSR2 = false;
  stSSR3 = false;
  stSSR4 = true;

  Serial.println(F(
    "{\"boot\":\"heliogrid_v5.0\"," \
    "\"pins\":{\"SSR1_K1\":7,\"SSR2_K2\":6,\"SSR3_K3\":5,\"SSR4_K4\":4}," \
    "\"logic\":{\"ssr1\":\"manual\",\"ssr2\":\"manual\",\"ssr3\":\"auto_charging\",\"ssr4\":\"always_on_with_60s_recovery_after_dropout\"}," \
    "\"contactor\":\"follows_connection\",\"boot_state\":\"SSR4_ON\",\"status\":\"ready\"}"
  ));
}

// =============================================================================
// COMMAND HANDLER
//
// MANUAL:
//   '1' = SSR1 ON
//   'q' = SSR1 OFF
//   '2' = SSR2 ON
//   'w' = SSR2 OFF
//
// AUTO:
//   '3' = SSR3 ON  (charging)
//   'e' = SSR3 OFF (full charge / discharging)
//
// DROPOUT / RECOVERY:
//   'd' = dropout detected -> SSR4 OFF
//   'r' = source returned  -> start 60s recovery
//
// DIAGNOSTICS:
//   '?' = status JSON
//   'c' = calibration dump
// =============================================================================
void handleCommand(char cmd) {
  switch (cmd) {
    case '1':
      ssr1On();
      break;

    case 'q':
      ssr1Off();
      break;

    case '2':
      ssr2On();
      break;

    case 'w':
      ssr2Off();
      break;

    case '3':
      ssr3ChargingOn();
      break;

    case 'e':
      ssr3ChargingOff();
      break;

    case 'd':
      triggerDropout();
      break;

    case 'r':
      restoreAfterDropout();
      break;

    case '?':
      sendStatus();
      break;

    case 'c':
      sendCalibration();
      break;

    default:
      if (cmd >= 32 && cmd <= 126) {
        Serial.print(F("{\"warn\":\"unknown_cmd\",\"char\":\""));
        Serial.print(cmd);
        Serial.println(F("\"}"));
      }
      break;
  }
}

// =============================================================================
// LOOP
// =============================================================================
void loop() {
  if (Serial.available() > 0) {
    char cmd = (char)Serial.read();
    handleCommand(cmd);
  }

  handleRecoveryTimer();
}
