"""
settings.py — HelioGrid System Configuration
Hybrid Smart Energy System — Raspberry Pi 4

Hardware:
  Battery:  24V 2S Lead Acid — 100Ah (2× 12V 100Ah series, Bank A)
            Expandable to 200Ah: plug in Bank B (2× 12V 100Ah) + 2× PZEM-017
  Current:  2x PZEM-017 DC meters @ /dev/ttyBatteryPZEM (Bank A, addr 0x01 & 0x02)
            +2x PZEM-017 for Bank B expansion (addr 0x03 & 0x04, plug-and-play)
  Relays:   Arduino Uno → K1/K2/K3/K4 via USB serial
  PZEM:     Two PZEM-004T units, both slave_addr=0x01, separate serial ports
  DHT:      DHT22 on GPIO BCM 27 (adafruit-circuitpython-dht library)
"""

# ============================================================
# BATTERY — 24V 2S Lead Acid Gel (2× 12V 100Ah series)
# ============================================================
BATTERY_CONFIG = {
    "rated_capacity_ah":     100,
    "nominal_voltage":       24,
    "num_cells":             2,            # 2× 12V in series
    "cell_nominal_voltage":  12,
    "cell_full_voltage":     13.2,         # 26.4V / 2
    "cell_critical_voltage": 10.8,         # 21.6V / 2
    "pack_full_voltage":     26.4,         # BAT_FULL
    "pack_nominal_voltage":  24.0,
    "pack_warning_low":      23.0,         # BAT_WARNING_LOW
    "pack_critical_low":     21.6,         # BAT_CRITICAL_LOW
    "pack_critical_high":    27.6,         # BAT_CRITICAL_HIGH
    "chemistry":             "lead_acid_gel",
}

# ============================================================
# THRESHOLDS
# ============================================================
THRESHOLDS = {
    "grid": {
        "voltage_critical_low":  200.0,
        "voltage_critical_high": 245.0,
        "voltage_normal_low":    210.0,
        "voltage_normal_high":   241.0,
        "voltage_nominal":       230.0,   # PH standard 230V nominal (IEC 60038)
        "frequency_nominal":     60.0,
        "frequency_crit_dev":    1.0,
    },
    "battery": {
        "voltage_full":          26.4,
        "voltage_warning_low":   23.0,
        "voltage_critical_low":  21.6,
        "voltage_critical_high": 27.6,
        "soc_critical":          20.0,
        "soc_warning":           30.0,
        "overcurrent": {
            100: {"warn_a": 75,  "trip_a": 100},
            200: {"warn_a": 150, "trip_a": 200},
        },
    },
    "solar": {
        "array_config":           "2S2P",
        "panels":                 4,
        "rated_power_w":          2320.0,
        "panel_rated_w":          580.0,
        "vmp_v":                  84.74,
        "voc_v":                  100.80,
        "imp_a":                  27.38,
        "critical_low_w":         464.0,
        "warning_low_w":          1392.0,
        "string_mismatch_warn":   0.30,
        "string_mismatch_crit":   0.50,
        "wcs1500_sensitivity_va": 0.011,
        "wcs1500_zero_v":         2.5,
        "wcs1500_zero_filter_a":  0.15,
        "voltage_divider_r1_kohm": 200,
        "voltage_divider_r2_kohm": 10,
        "voltage_divider_ratio":   21.0,
        "voltage_filter_v":        1.5,
    },
    "inverter": {
        "voltage_critical_low":  207.0,
        "voltage_critical_high": 253.0,
        "voltage_nominal":       230.0,   # Hybrid inverter output 230V nominal
        "frequency_nominal":     60.0,
        "frequency_min":         59.0,
        "frequency_max":         61.0,
    },
    "temperature": {
        "normal_max": 40.0,
        "warning":    50.0,
        "critical":   60.0,
        "resume":     45.0,
    },
}

# ============================================================
# PZEM-017 DC BATTERY METERS — replaces INA226
# Bank A (always active):
#   B1 → 12V 100Ah bottom battery | addr 0x01 (factory default)
#   B2 → 12V 100Ah top battery    | addr 0x02 (set via PZEM Config Tool)
# Bank B (200Ah expansion — plug-and-play):
#   B3 → 12V 100Ah bottom battery | addr 0x03 (set via PZEM Config Tool)
#   B4 → 12V 100Ah top battery    | addr 0x04 (set via PZEM Config Tool)
#
# All 4 share one RS485 bus: USB Hub → /dev/ttyBatteryPZEM (ttyUSB3)
# Auto-detect: if B3/B4 answer → 200Ah mode; else 100Ah mode.
#
# Pack math (100Ah):
#   pack_voltage = B1.V + B2.V
#   pack_current = avg(B1.I, B2.I)
# Pack math (200Ah):
#   pack_voltage = avg(BankA.V, BankB.V)   ← parallel, same V
#   pack_current = BankA.I + BankB.I        ← parallel, adds up
# ============================================================
PZEM017_PORT = "/dev/ttyBatteryPZEM"

PZEM017_CONFIG = [
    # ── Bank A (always present) ──────────────────────────────
    {
        "port":        PZEM017_PORT,
        "slave_addr":  0x01,
        "label":       "Battery 1",
        "bank":        "A",
        "description": "12V 100Ah — Bank A bottom (2S series)",
    },
    {
        "port":        PZEM017_PORT,
        "slave_addr":  0x02,
        "label":       "Battery 2",
        "bank":        "A",
        "description": "12V 100Ah — Bank A top (2S series)",
    },
    # ── Bank B (200Ah expansion — ikakabit lang kapag mag-eexpand) ──
    {
        "port":        PZEM017_PORT,
        "slave_addr":  0x03,
        "label":       "Battery 3",
        "bank":        "B",
        "description": "12V 100Ah — Bank B bottom (parallel expansion)",
    },
    {
        "port":        PZEM017_PORT,
        "slave_addr":  0x04,
        "label":       "Battery 4",
        "bank":        "B",
        "description": "12V 100Ah — Bank B top (parallel expansion)",
    },
]

# ============================================================
# I2C CONFIG — RTC only (INA226/INA219 removed)
# ============================================================
I2C_CONFIG = {
    "bus": 1,
    "ds3231": {
        "address": 0x68,
        "label":   "Real-Time Clock",
    },
}

# ============================================================
# UART — PZEM-004T AC Power Meters
# Both slave_addr=0x01, isolated by separate serial ports
# ============================================================
UART_CONFIG = {
    "grid_pzem":     {"port": "/dev/ttyGridPZEM",     "slave_addr": 0x01},
    "inverter_pzem": {"port": "/dev/ttyInverterPZEM", "slave_addr": 0x01},
}

# ============================================================
# ARDUINO RELAY EXECUTOR — heliogrid_controller.ino v4.2
# RPi 4 → /dev/ttyArduino (USB) → Arduino Uno → SSRs + Buzzer
#
# Serial commands (9600 baud, single char):
#   '1'/'q' → K1 ON/OFF  (Solar/Inverter path)
#   '2'/'w' → K2 ON/OFF  (Grid bypass path)
#   '3'/'e' → K3 ON/OFF  (Grid Assist — Flask auto only)
#   '4'/'r' → K4 CLOSE/OPEN (Contactor → Outlets)
#   'Z'/'z' → Buzzer ON (5s auto-off) / OFF immediately
#   'X'     → Emergency cutoff
#   '?'     → JSON status report
#
# Hard interlocks (enforced IN Arduino):
#   K1 ∧ K2 = NEVER both ON  (backfeed prevention)
#   K3 OFF when K4 OPEN       (anti-islanding IEEE 1547 §4.2.3)
# ============================================================
ARDUINO_CONFIG = {
    "port": "/dev/ttyArduino",
    "baud": 9600,
    "pins": {
        "BUZZER":   "RPi_GPIO14",  # Buzzer moved to RPi GPIO 14 (v4.3)
        "SSR1_K1":  7,   # [v4.3] PIN_SSR1_K1 = 7
        "SSR2_K2":  6,   # [v4.3] PIN_SSR2_K2 = 6
        "SSR3_K3":  5,   # [v4.3] PIN_SSR3_K3 = 5
        "SSR4_K4":  4,   # [v4.3] PIN_SSR4_K4 = 4
    },
}

# ============================================================
# DHT TEMPERATURE SENSOR
# Library: adafruit-circuitpython-dht
# Install: pip install adafruit-circuitpython-dht --break-system-packages
# ============================================================
DHT_CONFIG = {
    "sensor_type": "DHT22",
    "gpio_pin":    27,
}

# ============================================================
# CONTROL MODES
# ============================================================
CONTROL_MODES = {
    "solar": {
        "K1": True,  "K2": False, "K3": "auto", "K4": True,
        "description": "Solar Priority — Inverter AC powers outlets via K1",
    },
    "grid": {
        "K1": False, "K2": True,  "K3": "auto", "K4": True,
        "description": "Grid Backup — Grid AC powers outlets via K2",
    },
    "failsafe": {
        "K1": False, "K2": True,  "K3": "auto", "K4": True,
        "description": "Failsafe — defaults to Grid",
    },
    "shutdown": {
        "K1": False, "K2": False, "K3": False, "K4": False,
        "description": "Emergency Shutdown — K4 contactor opens, outlets cut",
    },
}

# ============================================================
# K3 GRID ASSIST / CHARGING LOGIC
# ============================================================
K3_CONFIG = {
    "reconnect_delay_s": 300,
    "daylight_start_h":  6,
    "daylight_end_h":    18,
    "charge_min_soc":    95,
    "import_conditions": [
        "battery_voltage < BAT_WARNING_LOW (23V)",
        "night time and battery not full (< 26.4V)",
        "solar_power < SOLAR_CRITICAL_W (464W) during harvest",
    ],
    "charge_conditions": [
        "battery_voltage >= BAT_FULL (26.4V)",
        "solar_power > SOLAR_CHARGE_W (1392W)",
    ],
}

# ============================================================
# API & SYSTEM
# ============================================================
API_CONFIG = {
    "host":               "0.0.0.0",
    "port":               5000,
    "email_service_port": 5001,
    "debug":              False,
}

SYSTEM_CONFIG = {
    "startup_mode":          "solar",
    "enable_auto_switching": True,
    "sensor_poll_rate_s":    2.0,
    "manual_lockout_s":      15,
    "buzzer_duration_ms":    5000,
    "fault_confirm_count":   3,
    "email_cooldown_crit_s": 600,
    "email_cooldown_def_s":  1800,
    "k3_reconnect_delay_s":  300,
}