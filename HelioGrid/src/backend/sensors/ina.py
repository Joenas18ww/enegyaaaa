"""
ina.py — INA219 Dual-Module Battery Monitor
Hybrid Smart Energy System — Raspberry Pi 4

System: 24V 100Ah (2× 12V Lead Acid in SERIES)
  Battery 1 (Bat1) @ 0x41 — Series cell 1 (bottom)
  Battery 2 (Bat2) @ 0x44 — Series cell 2 (top)
  Shunt: 200A / 75mV External Shunt Bar
         Resistance = 75mV / 200A = 0.000375 Ω

Pack voltage  = B1.voltage + B2.voltage  (series sum → ~24V)
Pack current  = average(B1.current, B2.current)  (same wire, series)
Per-cell SOC  = 12V Lead Acid table (per battery)
Pack SOC      = average of B1 SOC and B2 SOC

Install:
  pip install adafruit-circuitpython-ina219 --break-system-packages
"""

import time
import board
import busio
from adafruit_ina219 import INA219

# ── INA219 I2C Addresses ──────────────────────────────────────────────────────
INA219_BAT1_ADDR  = 0x41        # Battery 1 (series cell 1)
INA219_BAT2_ADDR  = 0x44        # Battery 2 (series cell 2)

# ── External Shunt: 200A / 75mV ───────────────────────────────────────────────
# R = V / I = 0.075V / 200A = 0.000375 Ω
# This replaces the old 0.6Ω onboard shunt value.
INA219_SHUNT_OHMS = 0.000375    # Ω  (both sensors use the same external shunt bar)

# ── INA219 Custom Calibration Constants ──────────────────────────────────────
#
#  Cal = trunc(0.04096 / (I_max_lsb × R_shunt))
#
#  We want to measure up to 200A.
#  Current LSB = max_expected_current / 32768
#              = 200A / 32768 ≈ 0.006104 A/bit  (~6.1 mA per LSB)
#
#  Cal = trunc(0.04096 / (0.006104 × 0.000375))
#      = trunc(0.04096 / 0.000002289)
#      = trunc(17892)  → 17892
#
#  Power LSB = 20 × Current LSB = 20 × 0.006104 ≈ 0.1221 W/bit
#
INA219_CURRENT_LSB = 200.0 / 32768.0   # A per bit ≈ 0.006104 A
INA219_CAL_VALUE   = int(0.04096 / (INA219_CURRENT_LSB * INA219_SHUNT_OHMS))  # → 17892

# ── INA219 Register constants (from datasheet) ────────────────────────────────
# Config register value:
#   BRNG  = 1  → 32V Bus Voltage Range
#   PGA   = 01 → ÷2 Gain  → ±160mV shunt range  (75mV fits comfortably)
#   BADC  = 1111 → 12-bit, 128 samples, 68.1ms averaging
#   SADC  = 1111 → 12-bit, 128 samples, 68.1ms averaging
#   MODE  = 111 → Shunt and Bus, Continuous
#
#   Bit layout: BRNG[13] PGA[12:11] BADC[10:7] SADC[6:3] MODE[2:0]
#   = 1 01 1111 1111 111
#   = 0b0010_1111_1111_0111  (but using adafruit constants below is safer)
#
# We write the calibration register directly; bus/shunt config via library consts.

INA219_REG_CONFIG       = 0x00
INA219_REG_CALIBRATION  = 0x05

# Config word:  BRNG=32V | PGA=/2 (±160mV) | 12-bit 128sps averaging both ADCs | Continuous
_CONFIG_WORD = (
    0x2000 |   # BRNG = 32V bus range
    0x0800 |   # PGA  = /2 → ±160 mV shunt range
    0x0780 |   # BADC = 1111 → 128-sample averaging
    0x0078 |   # SADC = 1111 → 128-sample averaging
    0x0007     # MODE = shunt+bus continuous
)
# = 0x2FFF


def _write_register(ina: INA219, register: int, value: int):
    """Write a 16-bit value to an INA219 register over I2C."""
    register_bytes = [(value >> 8) & 0xFF, value & 0xFF]
    ina.i2c_device.write(bytes([register] + register_bytes))


def _apply_custom_calibration(ina: INA219):
    """
    Apply custom config + calibration to INA219 for 200A/75mV external shunt.

    Steps:
      1. Write Config register  → set PGA=÷2 (±160mV range) + 128sps averaging
      2. Write Calibration reg  → tell chip what 1 LSB of current equals
    """
    _write_register(ina, INA219_REG_CONFIG,      _CONFIG_WORD)
    _write_register(ina, INA219_REG_CALIBRATION, INA219_CAL_VALUE)


# ── 24V pack thresholds (2× 12V series) ──────────────────────────────────────
BAT_FULL          = 25.4        # 12.7V × 2
BAT_WARNING_LOW   = 23.0        # 11.5V × 2
BAT_CRITICAL_LOW  = 21.0        # 10.5V × 2

# ── 12V per-cell SOC table (Lead Acid) ───────────────────────────────────────
_SOC_12V = [
    (12.7, 100), (12.5, 90), (12.3, 80), (12.1, 70),
    (12.0, 60),  (11.9, 50), (11.8, 40), (11.6, 30),
    (11.5, 20),  (11.0, 10), (10.5,  0),
]

# ── Shared I2C bus ────────────────────────────────────────────────────────────
_i2c      = None
_ina_bat1 = None
_ina_bat2 = None


def _init_sensors():
    global _i2c, _ina_bat1, _ina_bat2
    if _i2c is None:
        _i2c = board.I2C()

    if _ina_bat1 is None:
        try:
            _ina_bat1 = INA219(_i2c, addr=INA219_BAT1_ADDR)
            _apply_custom_calibration(_ina_bat1)
            print(f"✅ INA219 Bat1 initialized at 0x{INA219_BAT1_ADDR:02X}")
            print(f"   Cal={INA219_CAL_VALUE}  LSB={INA219_CURRENT_LSB*1000:.3f}mA/bit  "
                  f"Shunt={INA219_SHUNT_OHMS*1000:.4f}mΩ")
        except Exception as e:
            print(f"⚠️  INA219 Bat1 @ 0x{INA219_BAT1_ADDR:02X}: {e}")

    if _ina_bat2 is None:
        try:
            _ina_bat2 = INA219(_i2c, addr=INA219_BAT2_ADDR)
            _apply_custom_calibration(_ina_bat2)
            print(f"✅ INA219 Bat2 initialized at 0x{INA219_BAT2_ADDR:02X}")
            print(f"   Cal={INA219_CAL_VALUE}  LSB={INA219_CURRENT_LSB*1000:.3f}mA/bit  "
                  f"Shunt={INA219_SHUNT_OHMS*1000:.4f}mΩ")
        except Exception as e:
            print(f"⚠️  INA219 Bat2 @ 0x{INA219_BAT2_ADDR:02X}: {e}")


def calc_cell_soc(v: float) -> float:
    """SOC from 12V Lead Acid single-cell voltage."""
    for threshold, soc in _SOC_12V:
        if v >= threshold:
            return float(soc)
    return 0.0


def calculate_pack_soc(pack_voltage: float) -> float:
    """
    SOC from 24V pack voltage (2× 12V series).
    Linearly interpolated between 21.0V (0%) and 25.4V (100%).
    """
    if pack_voltage >= BAT_FULL:         return 100.0
    if pack_voltage <= BAT_CRITICAL_LOW: return 0.0
    return round(
        ((pack_voltage - BAT_CRITICAL_LOW) / (BAT_FULL - BAT_CRITICAL_LOW)) * 100, 1
    )


def _read_current_a(ina: INA219) -> float:
    """
    Read current from raw shunt voltage.

    IMPORTANT: Adafruit INA219 library returns shunt_voltage in VOLTS, not mV.
    Verified: idle reading was 0.00013 (V) not mV.

    Hardware fact: INA219 shunt ADC = 10μV per LSB (fixed)
    So shunt_voltage is already in Volts: e.g. 0.00375V at 10A load.

    Formula: I = V_shunt / R_shunt
      At 10A: 0.00375V / 0.000375Ω = 10.0A ✅

    Noise floor: ignore below 0.5A (shunt_v < 0.0001875V)
    """
    try:
        shunt_v = ina.shunt_voltage            # Volts (NOT mV!)
        amps = shunt_v / INA219_SHUNT_OHMS     # V / Ω = A
        return round(amps, 2) if abs(amps) >= 0.5 else 0.0
    except Exception:
        return 0.0


def read_battery() -> dict:
    """
    Read both INA219 modules — 24V series pack.

    Pack voltage  = B1.V + B2.V  (series)
    Pack current  = average(B1.I, B2.I)  (same current path, series)
    Pack SOC      = from 24V lookup table
    Per-cell SOC  = from 12V lookup table (individual)

    Returns dict compatible with flask read_ina226_battery():
        voltage        — 24V pack voltage (V)
        current        — net pack current, + charging / − discharging (A)
        charge_a       — charging current, always positive (A)
        discharge_a    — discharging current, always positive (A)
        net_current    — charge_a − discharge_a
        soc            — pack SOC (%)
        available      — True if at least one INA219 responded
        b1_voltage     — Battery 1 voltage (V)  ~12V
        b1_current     — Battery 1 current signed (A)
        b1_available   — True if Battery 1 responded
        b1_soc         — Battery 1 SOC (%)
        b2_voltage     — Battery 2 voltage (V)  ~12V
        b2_current     — Battery 2 current signed (A)
        b2_available   — True if Battery 2 responded
        b2_soc         — Battery 2 SOC (%)
        capacity_ah    — 100Ah
        anomaly_details — list of warning strings
    """
    _init_sensors()

    result = {
        "voltage":        0.0,
        "current":        0.0,
        "charge_a":       0.0,
        "discharge_a":    0.0,
        "net_current":    0.0,
        "soc":            0.0,
        "available":      False,
        "b1_voltage":     0.0,
        "b1_current":     0.0,
        "b1_available":   False,
        "b1_soc":         0.0,
        "b2_voltage":     0.0,
        "b2_current":     0.0,
        "b2_available":   False,
        "b2_soc":         0.0,
        "capacity_ah":    100,
        "anomaly_details": [],
    }

    # ── Battery 1 @ 0x41 ─────────────────────────────────────────────────────
    if _ina_bat1 is not None:
        try:
            v1 = round(_ina_bat1.bus_voltage, 3)
            i1 = _read_current_a(_ina_bat1)
            if v1 > 2.0:
                result["b1_voltage"]   = v1
                result["b1_current"]   = i1
                result["b1_available"] = True
                result["b1_soc"]       = calc_cell_soc(v1)
                result["available"]    = True
        except Exception as e:
            print(f"⚠️  INA219 Bat1 read error: {e}")

    # ── Battery 2 @ 0x44 ─────────────────────────────────────────────────────
    if _ina_bat2 is not None:
        try:
            v2 = round(_ina_bat2.bus_voltage, 3)
            i2 = _read_current_a(_ina_bat2)
            if v2 > 2.0:
                result["b2_voltage"]   = v2
                result["b2_current"]   = i2
                result["b2_available"] = True
                result["b2_soc"]       = calc_cell_soc(v2)
                result["available"]    = True
        except Exception as e:
            print(f"⚠️  INA219 Bat2 read error: {e}")

    # ── Pack calculations (SERIES) ────────────────────────────────────────────
    b1_ok = result["b1_available"]
    b2_ok = result["b2_available"]
    v1    = result["b1_voltage"]
    v2    = result["b2_voltage"]
    i1    = result["b1_current"]
    i2    = result["b2_current"]

    if b1_ok and b2_ok:
        pack_v = round(v1 + v2, 3)
        pack_i = round((i1 + i2) / 2.0, 2)
    elif b1_ok:
        pack_v = v1
        pack_i = i1
    elif b2_ok:
        pack_v = v2
        pack_i = i2
    else:
        pack_v = 0.0
        pack_i = 0.0

    result["voltage"]     = pack_v
    result["current"]     = pack_i
    result["charge_a"]    = max(0.0, pack_i)
    result["discharge_a"] = max(0.0, abs(min(0.0, pack_i)))
    result["net_current"] = round(result["charge_a"] - result["discharge_a"], 2)
    result["soc"]         = calculate_pack_soc(pack_v)

    # ── Anomaly detection ─────────────────────────────────────────────────────
    if result["available"] and pack_v > 0:
        if pack_v < BAT_CRITICAL_LOW:
            result["anomaly_details"].append(
                f"CRITICAL: Pack voltage {pack_v:.2f}V below {BAT_CRITICAL_LOW}V (deep discharge)")
        elif pack_v < BAT_WARNING_LOW:
            result["anomaly_details"].append(
                f"WARNING: Pack voltage {pack_v:.2f}V below {BAT_WARNING_LOW}V")
        if b1_ok and b2_ok and abs(v1 - v2) > 0.5:
            result["anomaly_details"].append(
                f"WARNING: Cell imbalance {abs(v1-v2):.2f}V (B1={v1:.2f}V B2={v2:.2f}V)")

    return result


# ── Stubs for old code paths ──────────────────────────────────────────────────
INA226_CHARGE_ADDR    = INA219_BAT1_ADDR
INA226_DISCHARGE_ADDR = INA219_BAT2_ADDR


# =============================================================================
# TEST SCRIPT
# =============================================================================
if __name__ == "__main__":
    print("🔋 INA219 Battery Monitor — 24V Series Pack (2× 12V 100Ah)")
    print("=" * 60)
    print(f"  Bat1 @ 0x{INA219_BAT1_ADDR:02X}")
    print(f"  Bat2 @ 0x{INA219_BAT2_ADDR:02X}")
    print(f"  External Shunt: 200A / 75mV  →  R = {INA219_SHUNT_OHMS*1000:.4f} mΩ")
    print(f"  Cal Register  : {INA219_CAL_VALUE}")
    print(f"  Current LSB   : {INA219_CURRENT_LSB*1000:.3f} mA/bit")
    print(f"  Pack Range    : {BAT_CRITICAL_LOW}V – {BAT_FULL}V")
    print("=" * 60)

    try:
        while True:
            data = read_battery()
            print("-" * 60)
            if data["available"]:
                net   = data["net_current"]
                sign  = "+" if net >= 0 else ""
                state = ("🔋 CHARGING"    if net >  0.1 else
                         "⚡ DISCHARGING" if net < -0.1 else "— IDLE")
                print(f"  Pack:  {data['voltage']:.2f}V  SOC: {data['soc']:.0f}%  {state}")
                print(f"  B1(0x41): {data['b1_voltage']:.3f}V  {data['b1_current']:+.2f}A  SOC: {data['b1_soc']:.0f}%")
                print(f"  B2(0x44): {data['b2_voltage']:.3f}V  {data['b2_current']:+.2f}A  SOC: {data['b2_soc']:.0f}%")
                print(f"  Net:   {sign}{net:.2f}A")
                for msg in data["anomaly_details"]:
                    print(f"  ⚠️  {msg}")
            else:
                print("  ❌ No INA219 modules responding")
            time.sleep(2)
    except KeyboardInterrupt:
        print("\n⏹️  Stopped")
