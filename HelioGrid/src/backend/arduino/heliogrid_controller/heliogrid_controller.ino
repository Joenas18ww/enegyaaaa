// ============================================================================
// HelioGrid Arduino Controller — RELAY EXECUTOR v4.5
// Production-ready for JA Solar JAM72D40-580/MB — 2S2P Array
//
// Array config: 2S2P — 4x 580W panels
//   String 1: PV-01(A0) + PV-02(A1) in series  → Vmp=84.74V, Imp=13.69A
//   String 2: PV-03(A2) + PV-04(A3) in series  → Vmp=84.74V, Imp=13.69A
//   Parallel: String1 || String2 → Vmp=84.74V, Imp=27.38A, Pmax=2320W
//
// Voltage divider (A4): R1=200kΩ, R2=10kΩ, ratio=21.0
//   Voc array = 100.80V → ADC = 4.800V ✅ safe on 5V Arduino
//   Vmp array = 84.74V  → ADC = 4.035V
//
// v4.5 CHANGES:
//   1. Per-sensor zero calibration (WCS_ZERO_V0..V3) — each unit different
//   5. FIXED i_total — was i0+i1+i2+i3 (double-counted). Now avg(i0,i1)+avg(i2,i3)
//      s1_i = avg(i0,i1) = String 1 current | s2_i = avg(i2,i3) = String 2 current
//      s1_mismatch, s2_mismatch added for panel fault detection
//   2. 'c' command — raw ADC dump + suggested new zero values
//   3. Production filters based on JA Solar panel specs
//   4. Pin map fixed: K1=7, K2=6, K3=5, K4=4
// ============================================================================


// ============================================================================
// ── CALIBRATION CONSTANTS — update WCS_ZERO_Vx after running 'c' with no load
//
//  Per-sensor zero (from cal_dump with no load connected):
//    A0 = 2.4740V, A1 = 2.5096V, A2 = 2.4999V, A3 = 2.5148V
//
//  WCS_SENSITIVITY: 0.011 V/A (bench-tested on this unit)
//    At Isc (13.84A/panel): ADC shifts 0.152V — clearly detectable ✅
//
//  CURRENT_FILTER_A: 1.37A = 10% of Imp per panel (13.69A)
//    Eliminates ghost readings while detecting real panel current
//    Change to 0.05A for low-current testing (fan, resistor, etc.)
//
//  VOLTAGE_FILTER_V: 16.9V = 20% of Vmp array (84.74V)
//    Below this = panels offline / nighttime → report 0.00V
//    Change to 0.50V for PSU testing
// ============================================================================

// Per-sensor zero — from cal_dump (no load connected)
const float WCS_ZERO_V0   = 2.4740f;  // A0 — PV-01
const float WCS_ZERO_V1   = 2.5096f;  // A1 — PV-02
const float WCS_ZERO_V2   = 2.4999f;  // A2 — PV-03
const float WCS_ZERO_V3   = 2.5148f;  // A3 — PV-04

// Shared sensitivity (same for all WCS1500 units on this board)
const float WCS_SENSITIVITY   = 0.011f;    // V/A — bench-tested

// Production filters (based on JA Solar JAM72D40-580 specs)
const float CURRENT_FILTER_A  = 1.37f;     // 10% of Imp=13.69A — ghost filter
const float VOLTAGE_FILTER_V  = 16.9f;     // 20% of Vmp=84.74V — offline filter

// NOTE: For testing with PSU + small load:
//   CURRENT_FILTER_A = 0.05f
//   VOLTAGE_FILTER_V = 0.50f


// ── Relay Pins ───────────────────────────────────────────────────────────────
const int PIN_SSR1_K1 = 7;   // K1 — Solar/Inverter → ATS-A
const int PIN_SSR2_K2 = 6;   // K2 — Grid → ATS-B
const int PIN_SSR3_K3 = 5;   // K3 — Grid Assist / Charging
const int PIN_SSR4_K4 = 4;   // K4 — Contactor → Outlets

// ── Solar Sensor Pins ────────────────────────────────────────────────────────
const int PIN_SOLAR_I0 = A0;  // PV-01 current (String 1)
const int PIN_SOLAR_I1 = A1;  // PV-02 current (String 1)
const int PIN_SOLAR_I2 = A2;  // PV-03 current (String 2)
const int PIN_SOLAR_I3 = A3;  // PV-04 current (String 2)
const int PIN_SOLAR_V  = A4;  // Array DC voltage (R1=200kΩ, R2=10kΩ, ratio=21.0)

// ── ADC ──────────────────────────────────────────────────────────────────────
const float ADC_VREF    = 5.0f;
const float ADC_COUNTS  = 1024.0f;
const float VDIV_RATIO  = 21.0f;   // (200k+10k)/10k
const int   ADC_SAMPLES = 500;     // 500 samples — stable reading

const unsigned long CONTACTOR_DELAY_MS = 100UL;

bool stSSR1 = false;
bool stSSR2 = false;
bool stSSR3 = false;
bool stSSR4 = false;


// =============================================================================
// RELAY WRITE — hard interlocks
// =============================================================================
void writeRelays(bool ssr1, bool ssr2, bool ssr3, bool ssr4) {
  if (ssr1 && ssr2) {
    Serial.println(F("{\"warn\":\"SSR1_SSR2_INTERLOCK\",\"action\":\"SSR2_FORCED_OFF\"}"));
    ssr2 = false;
  }
  if (!ssr4 && ssr3) {
    Serial.println(F("{\"warn\":\"K3_ANTI_ISLANDING\",\"action\":\"SSR3_FORCED_OFF\"}"));
    ssr3 = false;
  }
  stSSR1 = ssr1; stSSR2 = ssr2; stSSR3 = ssr3; stSSR4 = ssr4;
  digitalWrite(PIN_SSR1_K1, ssr1 ? HIGH : LOW);
  digitalWrite(PIN_SSR2_K2, ssr2 ? HIGH : LOW);
  digitalWrite(PIN_SSR3_K3, ssr3 ? HIGH : LOW);
  digitalWrite(PIN_SSR4_K4, ssr4 ? HIGH : LOW);
}

void k4SafeClose(bool ssr1, bool ssr2, bool ssr3) {
  writeRelays(ssr1, ssr2, false, false);
  delay(CONTACTOR_DELAY_MS);
  writeRelays(ssr1, ssr2, ssr3, true);
}

void k4SafeOpen() {
  writeRelays(stSSR1, stSSR2, false, false);
  delay(CONTACTOR_DELAY_MS);
  writeRelays(false, false, false, false);
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

// Per-sensor zero — pass each sensor's calibrated zero voltage
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
  float i0 = readWCS1500(PIN_SOLAR_I0, WCS_ZERO_V0);  // PV-01 (String 1)
  float i1 = readWCS1500(PIN_SOLAR_I1, WCS_ZERO_V1);  // PV-02 (String 1)
  float i2 = readWCS1500(PIN_SOLAR_I2, WCS_ZERO_V2);  // PV-03 (String 2)
  float i3 = readWCS1500(PIN_SOLAR_I3, WCS_ZERO_V3);  // PV-04 (String 2)
  float sv = readSolarVoltage(PIN_SOLAR_V);

  // 2S2P current math:
  // String 1 (PV-01 + PV-02 in series) — i0 ≈ i1, use avg for accuracy
  // String 2 (PV-03 + PV-04 in series) — i2 ≈ i3, use avg for accuracy
  // Total array current = String1 + String2 (parallel)
  float s1_i = (i0 + i1) / 2.0f;   // String 1 current (avg of series pair)
  float s2_i = (i2 + i3) / 2.0f;   // String 2 current (avg of series pair)
  float totalI = s1_i + s2_i;       // Total array current (parallel sum)
  float totalP = sv * totalI;

  // String mismatch detection (large diff = panel fault / shading)
  float s1_mismatch = abs(i0 - i1);  // Should be < 1A normally
  float s2_mismatch = abs(i2 - i3);  // Should be < 1A normally

  Serial.print(F("{"));
  Serial.print(F("\"ssr1_k1\":")); Serial.print(stSSR1 ? 1 : 0); Serial.print(F(","));
  Serial.print(F("\"ssr2_k2\":")); Serial.print(stSSR2 ? 1 : 0); Serial.print(F(","));
  Serial.print(F("\"ssr3_k3\":")); Serial.print(stSSR3 ? 1 : 0); Serial.print(F(","));
  Serial.print(F("\"ssr4_k4\":")); Serial.print(stSSR4 ? 1 : 0); Serial.print(F(","));
  Serial.print(F("\"contactor\":")); Serial.print(stSSR4 ? F("\"closed\"") : F("\"open\"")); Serial.print(F(","));
  Serial.print(F("\"outlets\":")); Serial.print((stSSR4 && (stSSR1 || stSSR2)) ? 1 : 0); Serial.print(F(","));
  Serial.print(F("\"solar\":{"));
  Serial.print(F("\"v\":")); Serial.print(sv, 2); Serial.print(F(","));
  Serial.print(F("\"i0\":")); Serial.print(i0, 3); Serial.print(F(","));
  Serial.print(F("\"i1\":")); Serial.print(i1, 3); Serial.print(F(","));
  Serial.print(F("\"i2\":")); Serial.print(i2, 3); Serial.print(F(","));
  Serial.print(F("\"i3\":")); Serial.print(i3, 3); Serial.print(F(","));
  Serial.print(F("\"s1_i\":")); Serial.print(s1_i, 3); Serial.print(F(","));
  Serial.print(F("\"s2_i\":")); Serial.print(s2_i, 3); Serial.print(F(","));
  Serial.print(F("\"i_total\":")); Serial.print(totalI, 3); Serial.print(F(","));
  Serial.print(F("\"p_total\":")); Serial.print(totalP, 1); Serial.print(F(","));
  Serial.print(F("\"s1_mm\":")); Serial.print(s1_mismatch, 3); Serial.print(F(","));
  Serial.print(F("\"s2_mm\":")); Serial.print(s2_mismatch, 3);
  Serial.println(F("}}"));
}


// =============================================================================
// CALIBRATION DUMP — 'c' command
// Run with ALL loads disconnected to get true zero per sensor
// Copy "paste_these_as_new_zero" values into WCS_ZERO_V0..V3 above
// =============================================================================
void sendCalibration() {
  float v0 = readAdcVoltage(PIN_SOLAR_I0);
  float v1 = readAdcVoltage(PIN_SOLAR_I1);
  float v2 = readAdcVoltage(PIN_SOLAR_I2);
  float v3 = readAdcVoltage(PIN_SOLAR_I3);
  float v4 = readAdcVoltage(PIN_SOLAR_V);

  float r0 = (v0 - WCS_ZERO_V0) / WCS_SENSITIVITY;
  float r1 = (v1 - WCS_ZERO_V1) / WCS_SENSITIVITY;
  float r2 = (v2 - WCS_ZERO_V2) / WCS_SENSITIVITY;
  float r3 = (v3 - WCS_ZERO_V3) / WCS_SENSITIVITY;

  Serial.print(F("{\"cal_dump\":{"));
  Serial.print(F("\"note\":\"disconnect_all_loads_first\","));
  Serial.print(F("\"raw_v\":{"));
  Serial.print(F("\"A0\":")); Serial.print(v0, 4); Serial.print(F(","));
  Serial.print(F("\"A1\":")); Serial.print(v1, 4); Serial.print(F(","));
  Serial.print(F("\"A2\":")); Serial.print(v2, 4); Serial.print(F(","));
  Serial.print(F("\"A3\":")); Serial.print(v3, 4); Serial.print(F(","));
  Serial.print(F("\"A4\":")); Serial.print(v4, 4);
  Serial.print(F("},\"paste_these_as_new_zero\":{"));
  Serial.print(F("\"WCS_ZERO_V0\":")); Serial.print(v0, 4); Serial.print(F(","));
  Serial.print(F("\"WCS_ZERO_V1\":")); Serial.print(v1, 4); Serial.print(F(","));
  Serial.print(F("\"WCS_ZERO_V2\":")); Serial.print(v2, 4); Serial.print(F(","));
  Serial.print(F("\"WCS_ZERO_V3\":")); Serial.print(v3, 4);
  Serial.print(F("},\"residual_i\":{"));
  Serial.print(F("\"A0\":")); Serial.print(r0, 3); Serial.print(F(","));
  Serial.print(F("\"A1\":")); Serial.print(r1, 3); Serial.print(F(","));
  Serial.print(F("\"A2\":")); Serial.print(r2, 3); Serial.print(F(","));
  Serial.print(F("\"A3\":")); Serial.print(r3, 3);
  Serial.print(F("},\"solar_v\":")); Serial.print(v4 * VDIV_RATIO, 2);
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
  pinMode(PIN_SSR4_K4, OUTPUT); digitalWrite(PIN_SSR4_K4, LOW);

  delay(100);
  while (Serial.available()) Serial.read();

  Serial.println(F(
    "{\"boot\":\"heliogrid_v4.5\","
    "\"array\":\"2S2P_4x580W_JASolar_JAM72D40\","
    "\"pmax_w\":2320,"
    "\"vmp_v\":84.74,"
    "\"imp_a\":27.38,"
    "\"pins\":{\"SSR1_K1\":7,\"SSR2_K2\":6,\"SSR3_K3\":5,\"SSR4_K4\":4},"
    "\"status\":\"ready\"}"
  ));
}


// =============================================================================
// COMMAND HANDLER
// =============================================================================
void handleCommand(char cmd) {
  switch (cmd) {
    case '1': writeRelays(true,   false,  stSSR3, stSSR4); Serial.println(F("{\"ssr1_k1\":1,\"fn\":\"solar_on\"}")); break;
    case 'q': writeRelays(false,  stSSR2, stSSR3, stSSR4); Serial.println(F("{\"ssr1_k1\":0,\"fn\":\"solar_off\"}")); break;
    case '2': writeRelays(false,  true,   stSSR3, stSSR4); Serial.println(F("{\"ssr2_k2\":1,\"fn\":\"grid_on\"}")); break;
    case 'w': writeRelays(stSSR1, false,  stSSR3, stSSR4); Serial.println(F("{\"ssr2_k2\":0,\"fn\":\"grid_off\"}")); break;
    case '3':
      if (stSSR4) { writeRelays(stSSR1, stSSR2, true,  stSSR4); Serial.println(F("{\"ssr3_k3\":1,\"fn\":\"grid_assist_on\"}")); }
      else        { Serial.println(F("{\"ssr3_k3\":0,\"fn\":\"blocked_k4_open\"}")); }
      break;
    case 'e': writeRelays(stSSR1, stSSR2, false, stSSR4); Serial.println(F("{\"ssr3_k3\":0,\"fn\":\"grid_assist_off\"}")); break;
    case '4': k4SafeClose(stSSR1, stSSR2, stSSR3); Serial.println(F("{\"ssr4_k4\":1,\"fn\":\"contactor_closed\"}")); break;
    case 'r': k4SafeOpen(); Serial.println(F("{\"ssr4_k4\":0,\"fn\":\"contactor_open\"}")); break;
    case 'X':
      k4SafeOpen();
      Serial.println(F("{\"emergency\":1,\"all_off\":1,\"outlets\":\"OFF\"}"));
      break;
    case '?': sendStatus(); break;
    case 'c': sendCalibration(); break;
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
}
