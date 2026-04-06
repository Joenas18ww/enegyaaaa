"""
HelioGrid — Unified Flask API Server  (PATCHED v7.1)
=====================================
v7.0 CHANGES (on top of v6.0):
  [FIX-SSR-1] _seq_solar_on — FIXED command order:
              OLD (WRONG): 'q','w' → '1' → '4'
                Sent K1+K2 OFF simultaneously then K1 ON.
                Arduino SSR1_SSR2_INTERLOCK triggered briefly, leaving
                system on Solar even after clicking Grid.
              NEW (CORRECT): 'w'(K2 OFF) → sleep → 'q'(K1 clean) → '1'(K1 ON) → '4'

  [FIX-SSR-2] _seq_grid_on — FIXED command order:
              OLD (WRONG): '1'(K1 ON) → 'q'(K1 OFF) → '2' → '4'
                Momentarily turned Solar ON, interlock forced Grid OFF,
                left system on Solar despite clicking Grid.
              NEW (CORRECT): 'q'(K1 OFF) → sleep → 'w'(K2 clean) → '2'(K2 ON) → '4'

  [FIX-SSR-3] _seq_apply_ssr_state — FIXED mutual exclusion:
              Now always turns OFF the opposite relay first before
              turning ON the desired one. Prevents interlock race condition
              on every manual SSR state change from the UI.

  [FIX-TIMING] background_logger — FIXED RPi loop timing:
              OLD: naive time.sleep(5) AFTER sensor reads.
                On RPi, PZEM reads take 1-2s each + DB writes = 8-12s actual cycle.
                SSR manual lockout (15s) was relative to stale loop, causing UI
                clicks to appear unresponsive on RPi.
              NEW: target-time sleep = max(0.5, 5.0 - elapsed).
                Keeps cycle at ~5s regardless of sensor read duration.

  [FIX-LOGS]  sensor_logs INSERT — FIXED missing rows when Arduino disconnected:
              OLD: INSERT guarded by `if any(k in log_data for k in _sensor_keys)`.
                When Arduino unplugged (no solar data) AND Inverter PZEM missing,
                log_data was empty → INSERT skipped → blank sensor log table.
              NEW: setdefault() fills all required columns with 0.0 before INSERT.
                A row is always written every cycle, even with partial hardware.

  [FIX-SOLAR-V] /api/sensor-data/current solar voltage — FIXED 4× voltage bug:
              OLD: summed voltage of all 4 panels (valid_panels loop) →
                4P parallel array has SAME voltage on all panels, so
                dashboard showed 164V instead of 41V.
              NEW: uses cache['solarVoltage'] / cache['solarCurrent'] / cache['solarPower']
                which are set directly from Arduino A4 voltage divider read.

  [FIX-DB]    DB default host — FIXED wrong fallback:
              OLD: os.getenv("MYSQL_HOST", "192.168.1.8") — if .env fails to load,
                Flask tried to connect to wrong IP, causing silent DB errors.
              NEW: os.getenv("MYSQL_HOST", "localhost") — matches .env default.

v6.0 CHANGES (on top of v5.0):
  [v7.0] Battery via PZEM-017 DC meters (B1=/dev/ttyBattery1PZEM, B2=/dev/ttyBattery2PZEM)

All v5.0 Phase 1 fixes remain active:
  [P1-FIX-1..6] — see v5.0 header
All v4.2-safe patches remain active:
  [FIX-1..8]    — see original header
"""

import os, sys, json, threading, time, requests
try:
    import serial
except ImportError:
    serial = None  # type: ignore  # pyserial not installed — Arduino comms disabled on dev
from datetime import datetime
from flask import Flask, request, jsonify, redirect, session, url_for
from flask_cors import CORS
import mysql.connector
from mysql.connector import Error
from authlib.integrations.flask_client import OAuth
from urllib.parse import urlencode
from dotenv import load_dotenv
from typing import Any, Dict, Optional, cast
from anomaly_engine import GRID_ENGINE, INVERTER_ENGINE, VoltageAnomalyEngine
import buzzer_controller as _bc

load_dotenv()

BACKEND_PATH = os.path.dirname(os.path.abspath(__file__))
SENSORS_PATH = os.path.join(BACKEND_PATH, '..', 'sensors')
CONFIG_PATH  = os.path.join(BACKEND_PATH, '..', 'config')
sys.path.insert(0, SENSORS_PATH)
sys.path.insert(0, CONFIG_PATH)

PZEM004TReader:        Any = None
InverterPZEMReader:    Any = None
PZEM017BatteryReader:  Any = None

I2C_CONFIG:  Dict[str, Any] = {"solar_panels": [], "batteries": []}
UART_CONFIG: Dict[str, Any] = {
    "grid_pzem":     {"port": "/dev/ttyGridPZEM"},
    "inverter_pzem": {"port": "/dev/ttyInverterPZEM"},
}

PZEM_AVAILABLE    = False
try:
    sys.path.insert(0, "/home/r-pi/HILEOGRID/HelioGrid/src/backend/sensors")
    from Grid import PZEM004TReader
    from Inverter import InverterPZEMReader
    PZEM_AVAILABLE = True
    print("PZEM-004T readers loaded from Grid.py + Inverter.py")
except Exception as _pzem_err:
    print(f"PZEM-004T not available: {_pzem_err}")
INA219_AVAILABLE  = False  # INA219 via battery_reader (fallback path when PZEM017 unavailable)
PZEM017_AVAILABLE = False  # declared here; set to True after pymodbus import below

# [P1-FIX-4] DHT import — uses adafruit_dht (CircuitPython, matches Temp.py)
#   Sensor type: DHT22 (physical sensor on GPIO27)
#   GPIO pin:    BCM 27 (matches Temp.py board.D27)
#   Install:     pip install adafruit-circuitpython-dht --break-system-packages
DHT_TYPE      = "DHT22"   # "DHT11" or "DHT22" — must match physical sensor
DHT_PIN       = 27        # RPi GPIO BCM 27 (board.D27 in Temp.py)
DHT_AVAILABLE = False
_dht_device:  Any = None
try:
    import board as _board
    import adafruit_dht as _adafruit_dht_mod
    _dht_pin = getattr(_board, f"D{DHT_PIN}")
    if DHT_TYPE == "DHT22":
        _dht_device = _adafruit_dht_mod.DHT22(_dht_pin, use_pulseio=False)
    else:
        _dht_device = _adafruit_dht_mod.DHT11(_dht_pin, use_pulseio=False)
    DHT_AVAILABLE = True
    print(f"{DHT_TYPE} (adafruit_dht CircuitPython) initialized on GPIO{DHT_PIN}")
except Exception as _dht_err:
    print(f"{DHT_TYPE} not available — temp reads will return 0.0 ({_dht_err})")

# ── RPi GPIO Buzzer (v4.3 — moved from Arduino Pin 8 to RPi GPIO 14) ─────────
BUZZER_GPIO_PIN  = 14          # BCM GPIO 14 (physical Pin 8)
GPIO_AVAILABLE   = False
_gpio_mod: Any   = None
try:
    import RPi.GPIO as _gpio_mod
    _gpio_mod.setwarnings(False)
    _gpio_mod.setmode(_gpio_mod.BCM)
    _gpio_mod.setup(BUZZER_GPIO_PIN, _gpio_mod.OUT, initial=_gpio_mod.LOW)
    GPIO_AVAILABLE = True
    print(f"✅ RPi GPIO: Buzzer initialized on GPIO BCM {BUZZER_GPIO_PIN}")
except Exception as _gpio_err:
    print(f"⚠️  RPi.GPIO not available — buzzer disabled ({_gpio_err})")
    print("  Install: pip install RPi.GPIO --break-system-packages")


# =============================================================================
# ── DS3231 RTC Module ─────────────────────────────────────────────────────────
# Provides accurate timestamping + boot clock sync (offline-safe)
# Install: pip install adafruit-circuitpython-ds3231 adafruit-circuitpython-busdevice --break-system-packages
# =============================================================================
RTC_AVAILABLE             = False
sync_system_clock_from_rtc = lambda: None
sync_rtc_from_ntp          = lambda: None
get_rtc_status             = lambda: {"available": False, "reason": "RTC module not loaded"}
get_timestamp              = lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S")
try:
    from RTC import (
        sync_system_clock_from_rtc,
        sync_rtc_from_ntp,
        get_rtc_status,
        get_timestamp,
        RTC_AVAILABLE,
    )
except (ImportError, ModuleNotFoundError):
    pass  # RPi-only module — stubs active on Windows/dev

# =============================================================================
# ── PZEM-017 DC Battery Meters (replaces INA226) ─────────────────────────────
# 2x PZEM-017 via USB Hub → USB-TTL03
# B1 → /dev/ttyBattery1PZEM | B2 → /dev/ttyBattery2PZEM
# Pack voltage = B1.V + B2.V (series) | Pack current = avg(B1.I, B2.I)
# Install: pip install pymodbus --break-system-packages
# Both PZEM-017 on same RS485 bus — USB Hub → ttyUSB3
# udev: /dev/ttyBatteryPZEM → ttyUSB3 (by USB port path, set after hardware arrives)
PZEM017_PORT     = "/dev/ttyBatteryPZEM"
PZEM017_B1_ADDR  = 0x01   # Bank A — Battery 1 (factory default)
PZEM017_B2_ADDR  = 0x02   # Bank A — Battery 2
PZEM017_B3_ADDR  = 0x03   # Bank B — Battery 3 (200Ah expansion, plug-and-play)
PZEM017_B4_ADDR  = 0x04   # Bank B — Battery 4 (200Ah expansion, plug-and-play)

PZEM017_AVAILABLE = False
_ModbusClient: Any = None
try:
    from pymodbus.client import ModbusSerialClient as _ModbusClientImport
    _ModbusClient     = _ModbusClientImport
    PZEM017_AVAILABLE = True
    print("pymodbus imported — PZEM-017 battery monitoring active")
except ImportError:
    print("pymodbus not found. Install: pip install pymodbus --break-system-packages")

SENSORS_AVAILABLE = PZEM_AVAILABLE or PZEM017_AVAILABLE

# Legacy stubs — prevent NameError in any old code paths
INA226_AVAILABLE = False
_INA226Class: Any = None

try:
    from settings import I2C_CONFIG as _I2C, UART_CONFIG as _UART
    I2C_CONFIG  = _I2C
    UART_CONFIG = _UART
except ImportError:
    print("settings.py not found, using defaults")

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "heliogrid-super-secret-2024")

# [FIX-CORS] Allow all local network origins so RPi kiosk (192.168.x.x)
# and any device on the LAN can access the Flask API.
# Individual IPs are unpredictable — use regex pattern instead.
import re as _re

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5000",
    _re.compile(r"http://192\.168\.\d+\.\d+(:\d+)?$"),
    _re.compile(r"http://10\.\d+\.\d+\.\d+(:\d+)?$"),
    "https://nontheoretic-submedially-grayce.ngrok-free.dev",
]
CORS(app, supports_credentials=True, origins=ALLOWED_ORIGINS)

FRONTEND_URL        = os.getenv("FRONTEND_URL",        "http://localhost:3000")
OAUTH_CALLBACK_BASE = os.getenv("OAUTH_CALLBACK_BASE", "http://localhost:5000")

_https = OAUTH_CALLBACK_BASE.startswith("https")
app.config.update(
    SESSION_COOKIE_SECURE   =_https,
    SESSION_COOKIE_SAMESITE ='None' if _https else 'Lax',
    SESSION_COOKIE_HTTPONLY =True,
)
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

oauth  = OAuth(app)
google = oauth.register(
    name='google',
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'},
)

DB_CONFIG = {
    "host":     os.getenv("MYSQL_HOST",     "localhost"),  # [FIX-DB] default matches .env (was "192.168.1.8" — wrong fallback if .env fails to load)
    "port":     int(os.getenv("MYSQL_PORT", "3306")),
    "user":     os.getenv("MYSQL_USER",     "root"),
    "password": os.getenv("MYSQL_PASSWORD", "Energy#123"),
    "database": os.getenv("MYSQL_DATABASE", "smart_energy_db"),
}

def get_db():
    return mysql.connector.connect(**DB_CONFIG)


# =============================================================================
#  THRESHOLDS — 24V Lead Acid Gel
# =============================================================================

BAT_FULL          = 26.4
BAT_WARNING_LOW   = 23.0
BAT_CRITICAL_LOW  = 21.6
BAT_CRITICAL_HIGH = 27.6

GRID_CRITICAL_LOW  = 200.0
GRID_CRITICAL_HIGH = 245.0
GRID_NORMAL_LOW    = 210.0
GRID_NORMAL_HIGH   = 241.0
GRID_FREQ_NOMINAL  = 60.0
GRID_FREQ_CRIT     = 1.0

INV_CRITICAL_LOW  = 207.0
INV_CRITICAL_HIGH = 253.0

SOLAR_RATED_W    = 2200.0
SOLAR_CRITICAL_W = 440.0
SOLAR_WARNING_W  = 1320.0
SOLAR_CHARGE_W   = 1320.0

STRING_MISMATCH_WARNING  = 0.30
STRING_MISMATCH_CRITICAL = 0.50

# [P1-FIX-5] Thermal thresholds
TEMP_WARNING  = 50.0
TEMP_CRITICAL = 60.0
TEMP_RESUME   = 45.0

K3_RECONNECT_DELAY_S = 300
SOLAR_DAYLIGHT_START = 6
SOLAR_DAYLIGHT_END   = 18

BAT_OVERCURRENT_CONFIG = {
    100: {"warn": 75,  "trip": 100},
    200: {"warn": 150, "trip": 200},
}

FAULT_CONFIRM_COUNT       = 3
EMAIL_COOLDOWN_CRITICAL_S = 600
EMAIL_COOLDOWN_DEFAULT_S  = 1800
BUZZER_DURATION_MS        = 5000
MANUAL_LOCKOUT_S          = 15


# =============================================================================
#  DB TABLE SETUP
# =============================================================================

def ensure_tables():
    conn   = get_db()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ssr_state (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            control_mode     VARCHAR(20)  NOT NULL DEFAULT 'solar',
            auto_switch      TINYINT(1)   NOT NULL DEFAULT 1,
            manual_override  TINYINT(1)   NOT NULL DEFAULT 0,
            ssr1_state       TINYINT(1)   NOT NULL DEFAULT 0,
            ssr2_state       TINYINT(1)   NOT NULL DEFAULT 0,
            ssr3_state       TINYINT(1)   NOT NULL DEFAULT 0,
            ssr4_state       TINYINT(1)   NOT NULL DEFAULT 1,
            contactor_closed TINYINT(1)   NOT NULL DEFAULT 1,
            grid_assist      TINYINT(1)   NOT NULL DEFAULT 0,
            total_switches   INT          NOT NULL DEFAULT 0,
            last_switch_time VARCHAR(20)           DEFAULT '--:--',
            updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    """)
    for col, definition in [
        ('ssr1_state',       'TINYINT(1) NOT NULL DEFAULT 0'),
        ('ssr2_state',       'TINYINT(1) NOT NULL DEFAULT 0'),
        ('ssr3_state',       'TINYINT(1) NOT NULL DEFAULT 0'),
        ('ssr4_state',       'TINYINT(1) NOT NULL DEFAULT 1'),
        ('contactor_closed', 'TINYINT(1) NOT NULL DEFAULT 1'),
        ('grid_assist',      'TINYINT(1) NOT NULL DEFAULT 0'),
    ]:
        try:
            cursor.execute(f"ALTER TABLE ssr_state ADD COLUMN {col} {definition}")
        except Exception:
            pass

    cursor.execute("SELECT COUNT(*) AS cnt FROM ssr_state")
    _r1 = cursor.fetchone()
    count_row: Dict[str, Any] = cast(Dict[str, Any], _r1) if _r1 else {}
    if count_row.get("cnt", 0) == 0:
        cursor.execute("""
            INSERT INTO ssr_state
                (control_mode,auto_switch,manual_override,
                 ssr1_state,ssr2_state,ssr3_state,ssr4_state,
                 contactor_closed,grid_assist,total_switches,last_switch_time)
            VALUES ('solar',1,0,0,0,0,1,1,0,0,'--:--')
        """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            google_id     VARCHAR(255) UNIQUE,
            email         VARCHAR(255) UNIQUE NOT NULL,
            name          VARCHAR(255),
            picture       VARCHAR(500),
            password_hash VARCHAR(255),
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sensor_logs (
            id                   INT AUTO_INCREMENT PRIMARY KEY,
            timestamp            DATETIME DEFAULT CURRENT_TIMESTAMP,
            grid_voltage         DECIMAL(10,2), grid_current       DECIMAL(10,2),
            grid_power           DECIMAL(10,2), grid_energy        DECIMAL(10,2),
            grid_frequency       DECIMAL(10,2), grid_power_factor  DECIMAL(5,2),
            inverter_voltage     DECIMAL(10,2), inverter_current   DECIMAL(10,2),
            inverter_power       DECIMAL(10,2), inverter_frequency DECIMAL(10,2),
            solar_dc_voltage     DECIMAL(10,2), solar_dc_current   DECIMAL(10,2),
            solar_dc_power       DECIMAL(10,2), solar_ac_voltage   DECIMAL(10,2),
            solar_ac_current     DECIMAL(10,2), solar_ac_power     DECIMAL(10,2),
            battery_pack_voltage DECIMAL(10,2), battery_pack_current DECIMAL(10,2),
            battery_pack_power   DECIMAL(10,2), battery_pack_soc   DECIMAL(5,2),
            ssr1_state TINYINT(1), ssr2_state TINYINT(1),
            ssr3_state TINYINT(1), ssr4_state TINYINT(1),
            outlet_1_voltage DECIMAL(10,2), outlet_1_current DECIMAL(10,2),
            outlet_2_voltage DECIMAL(10,2), outlet_2_current DECIMAL(10,2),
            system_temp        DECIMAL(5,2),
            system_efficiency  DECIMAL(6,2),  -- P_out(inverter) / P_in(grid+solar) × 100
            solar_efficiency   DECIMAL(6,2),  -- solar_dc_power / 2200W rated × 100
            -- [PZEM017] B1/B2 individual readings
            battery_charge_a    DECIMAL(10,3),   -- B1 current (PZEM-017 #1)
            battery_discharge_a DECIMAL(10,3),   -- B2 current (PZEM-017 #2)
            INDEX idx_timestamp (timestamp DESC)
        )
    """)

    # Add INA226 columns if table existed before v6.0
    for col, definition in [
        ('battery_charge_a',    'DECIMAL(10,3) NULL AFTER system_temp'),
        ('battery_discharge_a', 'DECIMAL(10,3) NULL AFTER battery_charge_a'),
        ('system_efficiency',   'DECIMAL(6,2)  NULL AFTER battery_discharge_a'),
        ('solar_efficiency',    'DECIMAL(6,2)  NULL AFTER system_efficiency'),
    ]:
        try:
            cursor.execute(f"ALTER TABLE sensor_logs ADD COLUMN {col} {definition}")
            print(f"  sensor_logs: added column {col}")
        except Exception:
            pass

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS anomaly_logs (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            timestamp           DATETIME DEFAULT CURRENT_TIMESTAMP,
            detected_at         DATETIME NULL,
            action_at           DATETIME NULL,
            response_time_ms    INT NULL,
            resolved_at         DATETIME NULL,
            type                VARCHAR(50),  source           VARCHAR(50),
            severity            VARCHAR(20),  system_action    TEXT,
            system_temp         DECIMAL(5,2), battery_soc      VARCHAR(20),
            solar_power         VARCHAR(20),  grid_voltage     VARCHAR(20),
            inverter_power      DECIMAL(8,2) NULL,
            panel_fault_detail  VARCHAR(100) NULL,
            email_status        VARCHAR(20),  buzzer_status    VARCHAR(10),
            status              VARCHAR(20),
            anomaly_source      VARCHAR(20) NULL,
            anomaly_delta       DECIMAL(8,3) NULL,
            confirm_count       TINYINT NULL,
            INDEX idx_timestamp (timestamp DESC)
        )
    """)

    for col, definition in [
        ('detected_at',        'DATETIME NULL AFTER timestamp'),
        ('action_at',          'DATETIME NULL AFTER detected_at'),
        ('response_time_ms',   'INT NULL AFTER action_at'),
        ('resolved_at',        'DATETIME NULL AFTER response_time_ms'),
        ('inverter_power',     'DECIMAL(8,2) NULL AFTER grid_voltage'),
        ('panel_fault_detail', 'VARCHAR(100) NULL AFTER inverter_power'),
        ('anomaly_source',     'VARCHAR(20) NULL AFTER panel_fault_detail'),
        ('anomaly_delta',      'DECIMAL(8,3) NULL AFTER anomaly_source'),
        ('confirm_count',      'TINYINT NULL AFTER anomaly_delta'),
    ]:
        try:
            cursor.execute(f"ALTER TABLE anomaly_logs ADD COLUMN {col} {definition}")
            print(f"  anomaly_logs: added column {col}")
        except Exception:
            pass

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS buzzer_logs (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            duration_ms  INT NOT NULL DEFAULT 5000,
            reason       VARCHAR(255)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS network_logs (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            timestamp        DATETIME DEFAULT CURRENT_TIMESTAMP,
            local_latency_ms INT NULL,
            local_status     VARCHAR(10) NOT NULL,
            internet_status  VARCHAR(10) NOT NULL,
            temperature      FLOAT DEFAULT 0,
            temp_status      VARCHAR(20),
            signal_quality   VARCHAR(20),
            INDEX idx_timestamp (timestamp DESC)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS system_config (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            config_key VARCHAR(50) UNIQUE NOT NULL,
            config_val VARCHAR(100) NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("SELECT COUNT(*) AS cnt FROM system_config")
    _r2 = cursor.fetchone()
    cfg_row: Dict[str, Any] = cast(Dict[str, Any], _r2) if _r2 else {}
    if cfg_row.get("cnt", 0) == 0:
        cursor.execute("""
            INSERT INTO system_config (config_key, config_val) VALUES
                ('battery_capacity_ah',   '100'),
                ('battery_current_warn_a', '75')
        """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS k3_reconnect (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            fault_started   DATETIME,
            grid_recovered  DATETIME,
            reconnect_ok    TINYINT(1) NOT NULL DEFAULT 1,
            grid_stable_s   INT NOT NULL DEFAULT 300,
            updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("SELECT COUNT(*) AS cnt FROM k3_reconnect")
    _r3 = cursor.fetchone()
    k3r: Dict[str, Any] = cast(Dict[str, Any], _r3) if _r3 else {}
    if k3r.get("cnt", 0) == 0:
        cursor.execute("""
            INSERT INTO k3_reconnect (fault_started, grid_recovered, reconnect_ok, grid_stable_s)
            VALUES (NULL, NULL, 1, 300)
        """)

    # ── SSR Switch Log — full history of every relay switch event ──────────
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ssr_switch_log (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            switched_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            trigger_source  VARCHAR(20) NOT NULL DEFAULT 'auto',
            from_mode       VARCHAR(20),
            to_mode         VARCHAR(20) NOT NULL,
            ssr1_before     TINYINT(1) NOT NULL DEFAULT 0,
            ssr2_before     TINYINT(1) NOT NULL DEFAULT 0,
            ssr3_before     TINYINT(1) NOT NULL DEFAULT 0,
            ssr4_before     TINYINT(1) NOT NULL DEFAULT 1,
            ssr1_after      TINYINT(1) NOT NULL DEFAULT 0,
            ssr2_after      TINYINT(1) NOT NULL DEFAULT 0,
            ssr3_after      TINYINT(1) NOT NULL DEFAULT 0,
            ssr4_after      TINYINT(1) NOT NULL DEFAULT 1,
            reason          VARCHAR(255),
            battery_soc     DECIMAL(5,2) NULL,
            solar_power_w   DECIMAL(10,2) NULL,
            grid_voltage_v  DECIMAL(6,2) NULL,
            INDEX idx_switched_at (switched_at DESC)
        )
    """)

    # ── Email Logs — every send attempt (sent, failed, cooldown-skipped) ───
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS email_logs (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            sent_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            fault_key       VARCHAR(100) NOT NULL,
            fault_type      VARCHAR(100),
            severity        VARCHAR(20),
            source          VARCHAR(50),
            recipient       VARCHAR(255),
            status          VARCHAR(20) NOT NULL,
            error_msg       VARCHAR(255),
            battery_soc     DECIMAL(5,2) NULL,
            solar_power_w   DECIMAL(10,2) NULL,
            grid_voltage_v  DECIMAL(6,2) NULL,
            INDEX idx_sent_at (sent_at DESC),
            INDEX idx_fault_key (fault_key)
        )
    """)

    conn.commit()
    cursor.close()
    conn.close()
    print("All database tables ready")


# =============================================================================
#  ARDUINO — /dev/ttyArduino
# =============================================================================

arduino               = None
arduino_lock          = threading.Lock()

try:
    if serial is None:
        raise ImportError("pyserial not installed")
    arduino = serial.Serial('/dev/ttyArduino', 9600, timeout=1)
    time.sleep(2)
    print("Arduino connected on /dev/ttyArduino")
except Exception as e:
    print(f"Arduino not connected: {e}")


def arduino_send(cmd: str) -> Optional[str]:
    if arduino and arduino.is_open:
        try:
            with arduino_lock:
                arduino.write(cmd.encode())
                time.sleep(0.05)
                return arduino.readline().decode().strip()
        except Exception as e:
            print(f"Arduino send error: {e}")
    return None

_bc.set_arduino_fn(arduino_send)  # wire buzzer_controller fallback


def arduino_get_status() -> Optional[dict]:
    response = arduino_send('?')
    if response:
        try:
            return json.loads(response)
        except Exception:
            return None
    return None


# =============================================================================
#  SENSOR READERS
# =============================================================================

grid_pzem:      Any = None  # type: Optional[Any]
inverter_pzem:  Any = None  # type: Optional[Any]
battery_reader: Any = None
solar_reader:   Any = None

if PZEM_AVAILABLE and PZEM004TReader is not None:
    try:
        port = UART_CONFIG.get('grid_pzem', {}).get('port', '/dev/ttyGridPZEM')
        grid_pzem = PZEM004TReader(port=port, slave_addr=0x01)
        if not grid_pzem.serial_connection:
            grid_pzem = None
    except Exception as e:
        print(f"Grid PZEM error: {e}"); grid_pzem = None

if PZEM_AVAILABLE and InverterPZEMReader is not None:
    try:
        port = UART_CONFIG.get('inverter_pzem', {}).get('port', '/dev/ttyInverterPZEM')
        inverter_pzem = InverterPZEMReader(port=port, slave_addr=0x01)  # same addr as Grid PZEM — isolated by separate serial port
        if not inverter_pzem.serial_connection:
            inverter_pzem = None
    except Exception as e:
        print(f"Inverter PZEM error: {e}"); inverter_pzem = None

if PZEM017_AVAILABLE and _ModbusClient is not None:
    try:
        from Battery import PZEM017BatteryReader
        battery_reader = PZEM017BatteryReader([
            {"port": PZEM017_PORT, "slave_addr": PZEM017_B1_ADDR, "label": "Battery 1"},
            {"port": PZEM017_PORT, "slave_addr": PZEM017_B2_ADDR, "label": "Battery 2"},
            {"port": PZEM017_PORT, "slave_addr": PZEM017_B3_ADDR, "label": "Battery 3"},
            {"port": PZEM017_PORT, "slave_addr": PZEM017_B4_ADDR, "label": "Battery 4"},
        ])
        print("PZEM-017 battery reader initialized")
    except Exception as e:
        print(f"PZEM-017 reader init error: {e}")
# Solar INA219 reader removed — solar data now comes from Arduino WCS1500 (A0-A3)
# and voltage divider (A4) via arduino_get_status() in background_logger.
solar_reader = None


# =============================================================================
#  IN-MEMORY CACHE & STATE
# =============================================================================

cache: Dict[str, Any] = {
    'grid': {}, 'inverter': {}, 'solar': [], 'battery': [],
    'last_update': None,
    'system_temp': 0.0,
    # [PZEM017] INA226 battery data cache
    'ina226': {
        'voltage':     0.0,
        'charge_a':    0.0,
        'discharge_a': 0.0,
        'net_current': 0.0,
        'soc':         0.0,
        'available':   False,
    },
}
buzzer_state: Dict[str, Any] = {
    'active': False, 'duration_ms': 0, 'triggered_at': None,
}

_thermal_shutdown_active: bool = False
_email_sent_times: Dict[str, float] = {}   # fault_key → last sent timestamp (replaces _email_cooldowns)

# ── Gap Fix globals ────────────────────────────────────────────────────────
# Gap 1: K3 cloud-drop hysteresis
K3_CLOUD_HYSTERESIS_S     = 60       # K3 stays ON for 60s after solar drops below SOLAR_CHARGE_W
_k3_charge_last_eligible:  float = 0.0

# Gap 3: Inverter cold-start ramp guard (0V → 230V takes ~3s)
INV_STARTUP_GRACE_S   = 10           # ignore inv fault for 10s after cold start
_inv_last_zero_ts:    float = 0.0    # when iv last read 0
_inv_was_zero:        bool  = True   # True = inverter was previously at 0V
_grid_read_count:     int   = 0      # sequential reading number for [LIVE-LOG]
_inv_read_count:      int   = 0      # sequential reading number for [LIVE-LOG]

_k3_reconnect_state: Dict[str, Any] = {
    'grid_fault_active': False,
    'grid_recovered_at': None,
    'reconnect_allowed': True,
    'stable_seconds':    300,
}

_last_manual_ts: float = 0.0


# =============================================================================
#  [P1-FIX-4] DHT READ FUNCTION — adafruit_dht CircuitPython API (matches Temp.py)
# =============================================================================

def read_dht22() -> float:
    """Read temperature from DHT22 sensor using adafruit_dht CircuitPython API.
    Auto-reinitializes the device on [Errno 22] / Invalid argument errors.
    """
    global _dht_device, DHT_AVAILABLE

    if not DHT_AVAILABLE or _dht_device is None:
        return 0.0
    try:
        temperature = _dht_device.temperature
        if temperature is not None:
            return round(float(temperature), 2)
        print(f"[{DHT_TYPE}] temperature returned None — sensor may be disconnected")
        return 0.0
    except RuntimeError as e:
        # DHT sensors throw RuntimeError on read failures — expected, retry next cycle
        print(f"[{DHT_TYPE}] Read error (retry next cycle): {e}")
        return 0.0
    except Exception as e:
        print(f"[{DHT_TYPE}] Unexpected error: {e}")
        # [FIX] Errno 22 / Invalid argument — reinitialize the device object
        try:
            _dht_device.exit()
        except Exception:
            pass
        try:
            import board as _board_reinit
            import adafruit_dht as _adafruit_dht_reinit
            _pin_reinit = getattr(_board_reinit, f"D{DHT_PIN}")
            if DHT_TYPE == "DHT22":
                _dht_device = _adafruit_dht_reinit.DHT22(_pin_reinit, use_pulseio=False)
            else:
                _dht_device = _adafruit_dht_reinit.DHT11(_pin_reinit, use_pulseio=False)
            print(f"[{DHT_TYPE}] Device reinitialized on GPIO{DHT_PIN} — will retry next cycle")
        except Exception as reinit_err:
            print(f"[{DHT_TYPE}] Reinit failed: {reinit_err} — marking unavailable")
            DHT_AVAILABLE = False
        return 0.0


# =============================================================================
#  [PZEM017] INA226 BATTERY READ FUNCTION
#  Reads both INA226 modules and returns unified battery data.
#
#  Returns dict:
#    voltage     — battery pack voltage from INA226 #1 (charging side)
#    charge_a    — positive charging current (Solar/Grid → Battery) from #1
#    discharge_a — positive discharging current (Battery → Inverter) from #2
#    net_current — net current: positive=charging, negative=discharging
#    soc         — calculated SOC from pack voltage
#    available   — True if at least one INA226 responded
# =============================================================================

def read_pzem017_battery() -> dict:
    """
    [EXPAND-200Ah] Read 2 or 4 PZEM-017 DC meters on shared RS485 bus.
    Bank B (PZEM#3+#4) is auto-detected — if they respond = 200Ah mode.
    Returns unified pack + per-bank data + anomaly messages.
    """
    result = {
        'voltage': 0.0, 'current': 0.0, 'net_current': 0.0, 'pack_power': 0.0,
        'soc': 0.0, 'charge_a': 0.0, 'discharge_a': 0.0,
        'available': False,
        # Bank A
        'b1_voltage': 0.0, 'b1_current': 0.0, 'b1_available': False,
        'b2_voltage': 0.0, 'b2_current': 0.0, 'b2_available': False,
        # Bank B — stays 0 / False until PZEM#3+#4 plug in
        'bank_b_available': False,
        'bank_b_voltage':   0.0,
        'bank_b_current':   0.0,
        'bank_b_soc':       0.0,
        'b3_voltage': 0.0, 'b3_current': 0.0, 'b3_available': False,
        'b4_voltage': 0.0, 'b4_current': 0.0, 'b4_available': False,
        'capacity_ah':      100,
        'anomaly_details':  [],
    }
    if not PZEM017_AVAILABLE or _ModbusClient is None:
        return result

    def _read_one(port: str, slave_addr: int = 0x01) -> dict:
        r = {'voltage': 0.0, 'current': 0.0, 'power': 0.0, 'available': False}
        try:
            client = _ModbusClient(port=port, baudrate=9600, bytesize=8,
                                   parity='N', stopbits=2, timeout=1.0)
            if not client.connect():
                return r
            rr = client.read_input_registers(address=0x0000, count=8, slave=slave_addr)
            client.close()
            if rr.isError():
                return r
            regs = rr.registers
            r.update({
                'voltage':   round(regs[0] * 0.01, 3),
                'current':   round(regs[1] * 0.01, 3),
                'power':     round(((regs[3] << 16) | regs[2]) * 0.1, 2),
                'available': True,
            })
        except Exception as e:
            print(f"[PZEM017] addr=0x{slave_addr:02X} error: {e}")
        return r

    # ── Read all 4 units ──────────────────────────────────────────────────────
    b1 = _read_one(PZEM017_PORT, PZEM017_B1_ADDR)
    b2 = _read_one(PZEM017_PORT, PZEM017_B2_ADDR)
    b3 = _read_one(PZEM017_PORT, PZEM017_B3_ADDR)
    b4 = _read_one(PZEM017_PORT, PZEM017_B4_ADDR)

    bank_a_ok = b1['available'] or b2['available']
    bank_b_ok = b3['available'] or b4['available']

    result['b1_available'] = b1['available']
    result['b2_available'] = b2['available']
    result['b3_available'] = b3['available']
    result['b4_available'] = b4['available']
    result['available']    = bank_a_ok

    if not bank_a_ok:
        return result

    # ── Bank A (always present) ───────────────────────────────────────────────
    a_v1 = b1['voltage'] if b1['available'] else 0.0
    a_v2 = b2['voltage'] if b2['available'] else 0.0
    a_i1 = b1['current'] if b1['available'] else 0.0
    a_i2 = b2['current'] if b2['available'] else 0.0
    bank_a_voltage = round(a_v1 + a_v2, 3)
    valid_a_i      = [i for i, ok in [(a_i1, b1['available']), (a_i2, b2['available'])] if ok]
    bank_a_current = round(sum(valid_a_i) / len(valid_a_i), 3) if valid_a_i else 0.0

    result.update({
        'b1_voltage': a_v1, 'b1_current': a_i1,
        'b2_voltage': a_v2, 'b2_current': a_i2,
    })

    # ── Bank B (optional — 200Ah expansion) ───────────────────────────────────
    bank_b_voltage = 0.0
    bank_b_current = 0.0
    bank_b_soc     = 0.0
    b_v1 = b_v2 = 0.0
    if bank_b_ok:
        b_v1 = b3['voltage'] if b3['available'] else 0.0
        b_v2 = b4['voltage'] if b4['available'] else 0.0
        b_i1 = b3['current'] if b3['available'] else 0.0
        b_i2 = b4['current'] if b4['available'] else 0.0
        bank_b_voltage = round(b_v1 + b_v2, 3)
        valid_b_i      = [i for i, ok in [(b_i1, b3['available']), (b_i2, b4['available'])] if ok]
        bank_b_current = round(sum(valid_b_i) / len(valid_b_i), 3) if valid_b_i else 0.0
        bank_b_soc     = calculate_pack_soc(bank_b_voltage)
        result.update({
            'bank_b_available': True,
            'bank_b_voltage':   bank_b_voltage,
            'bank_b_current':   bank_b_current,
            'bank_b_soc':       bank_b_soc,
            'b3_voltage': b_v1, 'b3_current': b3.get('current', 0),
            'b4_voltage': b_v2, 'b4_current': b4.get('current', 0),
        })

    # ── Pack totals ───────────────────────────────────────────────────────────
    if bank_b_ok:
        # 200Ah — parallel banks: avg voltage, sum current
        pack_voltage = round((bank_a_voltage + bank_b_voltage) / 2, 3)
        pack_current = round(bank_a_current + bank_b_current, 3)
        capacity_ah  = 200
    else:
        # 100Ah — single bank series
        pack_voltage = bank_a_voltage
        pack_current = bank_a_current
        capacity_ah  = 100

    pack_soc   = calculate_pack_soc(pack_voltage)
    pack_power = round(pack_voltage * pack_current, 2)

    result.update({
        'voltage':      pack_voltage,
        'current':      pack_current,
        'net_current':  pack_current,
        'pack_power':   pack_power,
        'soc':          pack_soc,
        'charge_a':     round(max(0.0, pack_current), 3),
        'discharge_a':  round(max(0.0, -pack_current), 3),
        'capacity_ah':  capacity_ah,
    })

    # ── Anomaly detection ─────────────────────────────────────────────────────
    anomaly_details = []

    # Pack: deep discharge / overcharge / low
    if pack_voltage > 0:
        if pack_voltage < 21.6:
            anomaly_details.append(
                f'Pack {pack_voltage:.2f}V DEEP DISCHARGE ({pack_soc:.0f}% SOC)')
        elif pack_voltage > 27.6:
            anomaly_details.append(
                f'Pack {pack_voltage:.2f}V OVERCHARGE — check charge controller')
        elif pack_voltage < 23.0:
            anomaly_details.append(
                f'Pack {pack_voltage:.2f}V LOW ({pack_soc:.0f}% SOC)')

    # Bank A cell imbalance (B1 vs B2)
    if b1['available'] and b2['available']:
        diff = abs(a_v1 - a_v2)
        if diff > 0.3:
            anomaly_details.append(
                f'BankA imbalance: B1={a_v1:.2f}V B2={a_v2:.2f}V diff={diff:.2f}V')

    # Bank B cell imbalance (B3 vs B4)
    if bank_b_ok and b3['available'] and b4['available']:
        diff = abs(b_v1 - b_v2)
        if diff > 0.3:
            anomaly_details.append(
                f'BankB imbalance: B3={b_v1:.2f}V B4={b_v2:.2f}V diff={diff:.2f}V')

    # Bank-to-bank imbalance (200Ah mode)
    if bank_b_ok:
        bank_diff = abs(bank_a_voltage - bank_b_voltage)
        if bank_diff > 0.5:
            anomaly_details.append(
                f'Bank mismatch: BankA={bank_a_voltage:.2f}V BankB={bank_b_voltage:.2f}V diff={bank_diff:.2f}V')

    # Overcurrent per bank
    if abs(bank_a_current) > 75:
        anomaly_details.append(f'BankA overcurrent {bank_a_current:+.1f}A > 75A warn')
    if bank_b_ok and abs(bank_b_current) > 75:
        anomaly_details.append(f'BankB overcurrent {bank_b_current:+.1f}A > 75A warn')

    result['anomaly_details'] = anomaly_details

    print(
        f"[PZEM017] BankA={bank_a_voltage:.2f}V/{bank_a_current:+.2f}A"
        + (f" | BankB={bank_b_voltage:.2f}V/{bank_b_current:+.2f}A" if bank_b_ok else " | BankB=offline")
        + f" | Pack={pack_voltage:.2f}V/{pack_current:+.2f}A SOC={pack_soc:.0f}% {capacity_ah}Ah"
        + (f" ⚠ {anomaly_details}" if anomaly_details else "")
    )
    return result


# Alias for any remaining old references
def read_ina226_battery() -> dict:
    return read_pzem017_battery()


def _is_daytime() -> bool:
    h = datetime.now().hour
    return SOLAR_DAYLIGHT_START <= h < SOLAR_DAYLIGHT_END


def _get_battery_capacity() -> int:
    try:
        conn = get_db()
        cur  = conn.cursor(dictionary=True)
        cur.execute("SELECT config_val FROM system_config WHERE config_key='battery_capacity_ah'")
        row  = cur.fetchone()
        cur.close(); conn.close()
        _val = cast(Dict[str, Any], row).get('config_val', 100) if row else 100
        return int(str(_val))
    except Exception:
        return 100


def _get_battery_current_warn() -> float:
    cap = _get_battery_capacity()
    return float(BAT_OVERCURRENT_CONFIG.get(cap, BAT_OVERCURRENT_CONFIG[100])['warn'])


# =============================================================================
#  SOC CALCULATION — 24V Lead Acid Gel
# =============================================================================

def calculate_pack_soc(pack_voltage: float) -> float:
    if pack_voltage >= BAT_FULL:         return 100.0
    if pack_voltage <= BAT_CRITICAL_LOW: return 0.0
    return round(
        ((pack_voltage - BAT_CRITICAL_LOW) / (BAT_FULL - BAT_CRITICAL_LOW)) * 100, 1
    )


# =============================================================================
#  SSR3/K3 RECONNECT TIMER
# =============================================================================

# =============================================================================
#  EMAIL ALERT ENGINE
# =============================================================================

def _log_email(
    fault_key:  str,
    fault_type: str,
    severity:   str,
    source:     str,
    recipient:  str,
    status:     str,          # 'sent' | 'failed' | 'skipped_cooldown' | 'no_recipient'
    error_msg:  str = '',
):
    """Insert one row into email_logs. Non-blocking — errors are silently swallowed."""
    try:
        bsoc  = float(cache.get('batterySoc',   0) or 0)
        solar = float(cache.get('solarPower',   0) or 0)
        gv    = float(cache.get('gridVoltage',  0) or 0)
        conn_e = get_db(); cur_e = conn_e.cursor()
        cur_e.execute("""
            INSERT INTO email_logs
                (fault_key, fault_type, severity, source, recipient,
                 status, error_msg, battery_soc, solar_power_w, grid_voltage_v)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (fault_key, fault_type, severity, source, recipient,
              status, error_msg[:255] if error_msg else '',
              bsoc, solar, gv))
        conn_e.commit(); cur_e.close(); conn_e.close()
    except Exception as _e:
        print(f"[email_log] DB write error: {_e}")


def _send_email_alert(
    fault_key:    str,
    fault_type:   str,
    severity:     str,
    action:       str,
    source:       str,
    target_email: Optional[str] = None,
    email_type:   str = "",
    cooldown_override_s: Optional[int] = None,
) -> bool:
    now       = time.time()
    last_sent = _email_sent_times.get(fault_key, 0)
    cooldown  = cooldown_override_s if cooldown_override_s is not None \
                else (EMAIL_COOLDOWN_CRITICAL_S if severity == "critical" else EMAIL_COOLDOWN_DEFAULT_S)

    if now - last_sent < cooldown:
        _log_email(fault_key, fault_type, severity, source,
                   target_email or '', 'skipped_cooldown',
                   f'Cooldown {int(cooldown - (now - last_sent))}s remaining')
        return False

    try:
        final_recipient = target_email or os.getenv('EMAIL_RECIPIENT', '')
        if not final_recipient:
            _log_email(fault_key, fault_type, severity, source,
                       '', 'no_recipient', 'EMAIL_RECIPIENT not set in .env')
            return False

        gv      = cache.get('grid',     {}).get('voltage',   0)
        gf      = cache.get('grid',     {}).get('frequency', 0)
        iv      = cache.get('inverter', {}).get('voltage',   0)
        inv_f   = cache.get('inverter', {}).get('frequency', 0)
        solar_w = sum(p.get('power', 0) for p in cache.get('solar', []) if 'error' not in p)

        # [PZEM017] Use INA226 voltage if available, else INA219 fallback
        ina226_data = cache.get('ina226', {})
        if ina226_data.get('available') and ina226_data.get('voltage', 0) > 0:
            bat_v   = ina226_data['voltage']
            bat_soc = ina226_data['soc']
        else:
            bat_v   = sum(c.get('voltage', 0) for c in cache.get('battery', []) if 'error' not in c)
            bat_soc = calculate_pack_soc(bat_v)

        ssr_data: Dict[str, str] = {}
        try:
            conn_s = get_db()
            cur_s  = conn_s.cursor(dictionary=True)
            cur_s.execute(
                "SELECT ssr1_state,ssr2_state,ssr3_state,ssr4_state "
                "FROM ssr_state ORDER BY id DESC LIMIT 1"
            )
            _rs = cur_s.fetchone()
            ssr_row: Dict[str, Any] = cast(Dict[str, Any], _rs) if _rs else {}
            cur_s.close(); conn_s.close()
            if ssr_row:
                ssr_data = {
                    "ssr1_k1": "ON" if ssr_row.get("ssr1_state") else "OFF",
                    "ssr2_k2": "ON" if ssr_row.get("ssr2_state") else "OFF",
                    "ssr3_k3": "ON" if ssr_row.get("ssr3_state") else "OFF",
                    "ssr4_k4": "ON" if ssr_row.get("ssr4_state") else "OFF",
                }
        except Exception:
            ssr_data = {"ssr1_k1": "N/A", "ssr2_k2": "N/A", "ssr3_k3": "N/A", "ssr4_k4": "N/A"}

        active_src = (
            "Solar (SSR1/K1)" if ssr_data.get("ssr1_k1") == "ON" else
            "Grid (SSR2/K2)"  if ssr_data.get("ssr2_k2") == "ON" else "Unknown"
        )

        payload = {
            "to_email":        final_recipient,
            "email_type":      email_type,
            "faultType":       fault_type,
            "severity":        severity,
            "source":          source,
            "systemAction":    action,
            "systemCondition": cache.get('systemCondition', 'Unknown'),
            "gridVoltage":     f"{gv:.1f}V",
            "gridFrequency":   f"{gf:.2f}Hz",
            "inverterVoltage": f"{iv:.1f}V",
            "inverterFrequency": f"{inv_f:.2f}Hz",
            "solarPower":      f"{solar_w:.1f}W",
            "batteryVoltage":  f"{bat_v:.2f}V",
            "battery_soc":     f"{bat_soc:.1f}%",   # [FIX] matches email_service expected key
            "activeSource":    active_src,
            "buzzerStatus":    "ON" if buzzer_state.get('active') else "OFF",
            "k1":  ssr_data.get("ssr1_k1", "N/A"),   # [FIX] email_service expects k1/k2/k3/k4
            "k2":  ssr_data.get("ssr2_k2", "N/A"),
            "k3":  ssr_data.get("ssr3_k3", "N/A"),
            "k4":  ssr_data.get("ssr4_k4", "N/A"),
            "k3_reconnect_blocked": not _k3_reconnect_state.get('reconnect_allowed', True),
            "k3_stable_seconds":    _k3_reconnect_state.get('stable_seconds', 0),
            "timestamp":        datetime.now().isoformat(),
        }

        resp = requests.post("http://localhost:5001/api/send-alert", json=payload, timeout=5)
        if resp.status_code == 200:
            _email_sent_times[fault_key] = now
            print(f"EMAIL SENT [{fault_key}] → {final_recipient}")
            _log_email(fault_key, fault_type, severity, source, final_recipient, 'sent')
            return True
        _log_email(fault_key, fault_type, severity, source, final_recipient, 'failed',
                   f'email_service returned HTTP {resp.status_code}')
        return False
    except Exception as e:
        print(f"Email service unreachable: {e}")
        _log_email(fault_key, fault_type, severity, source,
                   target_email or os.getenv('EMAIL_RECIPIENT', ''),
                   'failed', str(e)[:255])
        return False


# ── Buzzer helpers ────────────────────────────────────────────────────────────
def _buzzer_on() -> None:
    if GPIO_AVAILABLE and _gpio_mod is not None:
        try:
            _gpio_mod.output(BUZZER_GPIO_PIN, _gpio_mod.HIGH); return
        except Exception as e:
            print(f"[BUZZER] GPIO on error: {e}")
    arduino_send('Z')


def _buzzer_off() -> None:
    if GPIO_AVAILABLE and _gpio_mod is not None:
        try:
            _gpio_mod.output(BUZZER_GPIO_PIN, _gpio_mod.LOW); return
        except Exception as e:
            print(f"[BUZZER] GPIO off error: {e}")
    arduino_send('z')


def _fire_buzzer_once(reason: str) -> None:
    """Fire buzzer for BUZZER_DURATION_MS ms. Caller handles dedup."""
    if buzzer_state.get('active'):
        return
    buzzer_state['active']       = True
    buzzer_state['duration_ms']  = BUZZER_DURATION_MS
    buzzer_state['triggered_at'] = datetime.now().isoformat()
    _buzzer_on()

    def _auto_off():
        time.sleep(BUZZER_DURATION_MS / 1000)
        _buzzer_off()
        buzzer_state['active']      = False
        buzzer_state['duration_ms'] = 0

    threading.Thread(target=_auto_off, daemon=True).start()
    try:
        conn_b = get_db(); cur_b = conn_b.cursor()
        cur_b.execute(
            "INSERT INTO buzzer_logs (duration_ms, reason) VALUES (%s, %s)",
            (BUZZER_DURATION_MS, reason)
        )
        conn_b.commit(); cur_b.close(); conn_b.close()
    except Exception:
        pass


# =============================================================================
#  ANOMALY ENGINE  (self-contained per-fault debounce — replaces check_and_alert)
# =============================================================================

# =============================================================================
#  VOLTAGE ANOMALY STATE  — Grid AC + Inverter AC only
# =============================================================================

_fault_state:          Dict[str, str]      = {}
_fault_counters:       Dict[str, int]      = {}
_fault_first_detected: Dict[str, datetime] = {}
_fault_buzzer_fired:   Dict[str, bool]     = {}
_fault_first_type:     Dict[str, str]      = {}   # [FIX-BUG6] captures fault_type at first reading


def check_and_alert(
    fault_key:    str,
    raw_level:    str,           # 'none' | 'warning' | 'critical'
    fault_type:   str,
    action:       str,
    source:       str,
    safe_reset:   bool = False,
    cursor        = None,
    pack_soc:     float = 0.0,
    solar_w:      float = 0.0,
    grid_v:       float = 0.0,
    system_temp:  float = 0.0,
    inverter_power: Optional[float] = None,
    anomaly_source: Optional[str]  = None,
    anomaly_delta:  Optional[float] = None,
    confirm_count:  Optional[int]   = None,
) -> str:
    """
    Per-fault debounce + alert for AC voltage anomalies (Grid & Inverter).
    Returns 'none' | 'warning' | 'critical'.

    Rules:
      safe_reset=True  → clear fault immediately; mark resolved in DB.
      raw_level='none' → full counter reset (not decrement); state unchanged until
                         safe_reset clears it — prevents premature banner clear.
      raw_level='warning' → log once on transition, no buzzer/email.
      raw_level='critical' → count up; fire buzzer + email on first confirmed event.
        Dropout (voltage=0): bypass 3-reading confirm — fires on reading 1.
        Non-dropout: require FAULT_CONFIRM_COUNT consecutive readings.
      _fault_buzzer_fired resets on safe_reset so next fault event can fire again.
    """
    global _fault_first_detected

    # ── safe reset: fault is gone ──────────────────────────────────────────────
    if safe_reset:
        prev = _fault_state.get(fault_key, 'none')
        _fault_state[fault_key]       = 'none'
        _fault_counters[fault_key]    = 0
        _fault_buzzer_fired[fault_key] = False          # allow next event to buzz
        _fault_first_detected.pop(fault_key, None)
        _fault_first_type.pop(fault_key, None)          # [FIX-BUG6] clear captured type
        if prev in ('warning', 'critical') and cursor:
            try:
                cursor.execute("""
                    UPDATE anomaly_logs
                    SET status='Resolved', resolved_at=NOW()
                    WHERE type=%s AND status IN ('Monitoring','Active','Warning','Critical')
                    ORDER BY id DESC LIMIT 5
                """, (fault_type,))
            except Exception as e:
                print(f"[check_and_alert] resolve update failed: {e}")
        return 'none'

    # ── no fault this cycle: reset counter fully ───────────────────────────────
    if raw_level == 'none':
        _fault_counters[fault_key] = 0          # full reset, not decrement
        return _fault_state.get(fault_key, 'none')

    # ── warning: dashboard-only, no buzzer/email ───────────────────────────────
    if raw_level == 'warning':
        prev_w = _fault_state.get(fault_key, 'none')
        _fault_state[fault_key] = 'warning'
        _fault_counters[fault_key] = 0          # warnings don't accumulate
        if prev_w != 'warning' and cursor:
            log_anomaly_to_db(
                cursor, fault_type, source, "Warning", action,
                email_sent=False, buzzer_on=False,
                bat_soc=pack_soc, solar_w=solar_w, grid_v=grid_v,
                system_temp=system_temp, status="Warning",
                inverter_power=inverter_power,
                anomaly_source=anomaly_source,
                anomaly_delta=anomaly_delta,
                confirm_count=confirm_count,
            )
        return 'warning'

    # ── critical path ──────────────────────────────────────────────────────────
    _fault_counters[fault_key] = _fault_counters.get(fault_key, 0) + 1

    if _fault_counters[fault_key] == 1:
        _fault_first_detected[fault_key] = datetime.now()
        # [FIX-BUG6] Capture fault_type at first reading — engine reclassifies Spike→Drift
        # on readings 2+ (once delta≈0, engine sees sustained out-of-range as Drift).
        # Without this, a spike that holds out-of-range logs as 'Drift High/Low' in DB.
        _fault_first_type[fault_key] = fault_type
        print(f"[FAULT] {fault_key} first reading  @ "
              f"{_fault_first_detected[fault_key].strftime('%H:%M:%S.%f')}  type={fault_type}")

    # Dropout (V=0): bypass confirm gate — fire immediately on reading 1
    is_dropout = 'dropout' in (fault_type or '').lower()
    if is_dropout:
        _fault_counters[fault_key] = FAULT_CONFIRM_COUNT

    if _fault_counters[fault_key] < FAULT_CONFIRM_COUNT:
        # Not confirmed yet — show warning severity on dashboard while counting
        _fault_state[fault_key] = 'warning'
        return 'warning'

    prev_state = _fault_state.get(fault_key, 'none')
    _fault_state[fault_key] = 'critical'
    is_new = prev_state != 'critical'

    detected_at = _fault_first_detected.get(fault_key, datetime.now())

    # [FIX-BUG6] Use the fault_type captured at first reading (reading 1), not the
    # current engine label which may have changed Spike→Drift by reading 3.
    # e.g. V=265V: reading1='Spike High', reading2+='Drift High' (delta≈0, still outside range)
    # DB and email should say 'Spike High' (what actually happened), not 'Drift High'.
    confirmed_fault_type = _fault_first_type.get(fault_key, fault_type)

    if is_new:
        action_at = datetime.now()
        # Buzzer — fires only once per fault event; resets on safe_reset
        if not _fault_buzzer_fired.get(fault_key):
            _fault_buzzer_fired[fault_key] = True
            _fire_buzzer_once(f"{confirmed_fault_type}: {action[:80]}")
        # Email
        sent = _send_email_alert(
            fault_key, confirmed_fault_type, "critical", action, source,
            email_type="critical",
        )
        if cursor:
            log_anomaly_to_db(
                cursor, confirmed_fault_type, source, "Critical", action,
                email_sent=sent, buzzer_on=True,
                bat_soc=pack_soc, solar_w=solar_w, grid_v=grid_v,
                system_temp=system_temp,
                detected_at=detected_at, action_at=action_at,
                inverter_power=inverter_power,
                anomaly_source=anomaly_source,
                anomaly_delta=anomaly_delta,
                confirm_count=confirm_count,
            )
    else:
        # Already critical — attempt periodic email resend (subject to cooldown)
        sent = _send_email_alert(
            fault_key, confirmed_fault_type, "critical", action, source,
            email_type="critical",
        )
        if sent and cursor:
            log_anomaly_to_db(
                cursor, confirmed_fault_type, source, "Critical", action,
                email_sent=True, buzzer_on=False,
                bat_soc=pack_soc, solar_w=solar_w, grid_v=grid_v,
                system_temp=system_temp,
                inverter_power=inverter_power,
                anomaly_source=anomaly_source,
                anomaly_delta=anomaly_delta,
                confirm_count=confirm_count,
            )

    return 'critical'


def log_anomaly_to_db(
    cursor, fault_type: str, source: str, severity: str, action: str,
    email_sent: bool, buzzer_on: bool,
    bat_soc: float, solar_w: float, grid_v: float,
    system_temp:    float = 0.0,
    status:         str   = "Monitoring",
    detected_at:    Optional[datetime] = None,
    action_at:      Optional[datetime] = None,
    inverter_power: Optional[float]    = None,
    anomaly_source: Optional[str]      = None,
    anomaly_delta:  Optional[float]    = None,
    confirm_count:  Optional[int]      = None,
):
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        det_str = detected_at.strftime("%Y-%m-%d %H:%M:%S") if detected_at else now_str
        act_str = action_at.strftime("%Y-%m-%d %H:%M:%S")   if action_at   else now_str
        resp_ms: Optional[int] = None
        if detected_at and action_at:
            resp_ms = int((action_at - detected_at).total_seconds() * 1000)

        cursor.execute("""
            INSERT INTO anomaly_logs
                (timestamp, detected_at, action_at, response_time_ms, resolved_at,
                 type, source, severity, system_action,
                 system_temp, battery_soc, solar_power, grid_voltage,
                 inverter_power,
                 email_status, buzzer_status, status,
                 anomaly_source, anomaly_delta, confirm_count)
            VALUES (%s,%s,%s,%s,NULL, %s,%s,%s,%s, %s,%s,%s,%s, %s, %s,%s,%s, %s,%s,%s)
        """, (
            now_str, det_str, act_str, resp_ms,
            fault_type, source, severity, action,
            round(system_temp, 2),
            f"{bat_soc:.1f}%", f"{solar_w:.1f}W", f"{grid_v:.1f}V",
            round(inverter_power, 2) if inverter_power is not None else None,
            "Sent"  if email_sent else "Queued",
            "ON"    if buzzer_on  else "OFF",
            status,
            anomaly_source,
            round(anomaly_delta, 3) if anomaly_delta is not None else None,
            confirm_count,
        ))
    except Exception as e:
        print(f"[log_anomaly_to_db] INSERT failed: {e}")


# =============================================================================
#  [P1-FIX-5] THERMAL SHUTDOWN
# =============================================================================

def check_thermal(system_temp: float, cursor, pack_soc: float, solar_w: float, grid_v: float):
    global _thermal_shutdown_active

    if system_temp <= 0:
        return

    if system_temp >= TEMP_CRITICAL:
        if not _thermal_shutdown_active:
            print(f"[THERMAL CRITICAL] {system_temp:.1f}°C ≥ {TEMP_CRITICAL}°C — initiating thermal shutdown")
            _thermal_shutdown_active = True

            print('[THERMAL] Shutdown triggered — anomaly logged')
            _fire_buzzer_once(f"Thermal shutdown at {system_temp:.1f}°C")
            _send_email_alert(
                fault_key='thermal_critical',
                fault_type='Thermal Shutdown',
                severity='critical',
                action=(
                    f"Enclosure temperature {system_temp:.1f}°C exceeded {TEMP_CRITICAL}°C limit. "
                    f"All relays OFF. System will auto-resume when temp ≤ {TEMP_RESUME}°C."
                ),
                source=f'{DHT_TYPE} Enclosure Sensor',
                email_type='emergency',
            )
            detected_at = _fault_first_detected.get('thermal_critical', datetime.now())
            action_at   = datetime.now()
            log_anomaly_to_db(
                cursor,
                fault_type='Thermal Shutdown',
                source=f'{DHT_TYPE} Enclosure Sensor',
                severity='Critical',
                action=f"Enclosure {system_temp:.1f}°C > {TEMP_CRITICAL}°C. All relays OFF.",
                email_sent=True, buzzer_on=True,
                bat_soc=pack_soc, solar_w=solar_w, grid_v=grid_v,
                system_temp=system_temp,
                detected_at=detected_at, action_at=action_at,
                status='Monitoring',
            )

        check_and_alert(
            fault_key='thermal_critical', raw_level='critical',
            fault_type='Thermal Shutdown', source=f'{DHT_TYPE} Enclosure Sensor',
            action=f"Enclosure {system_temp:.1f}°C > {TEMP_CRITICAL}°C.",
            cursor=cursor, pack_soc=pack_soc, solar_w=solar_w, grid_v=grid_v,
            system_temp=system_temp,
        )
        return

    if _thermal_shutdown_active and system_temp <= TEMP_RESUME:
        print(f"[THERMAL RESUME] {system_temp:.1f}°C ≤ {TEMP_RESUME}°C — resuming solar mode")
        _thermal_shutdown_active = False
        print('[THERMAL] Temp recovered — anomaly cleared')
        check_and_alert(
            fault_key='thermal_critical', raw_level='none',
            fault_type='Thermal Shutdown', source=f'{DHT_TYPE} Enclosure Sensor',
            action='Temperature normalized — system resumed.',
            safe_reset=True, cursor=cursor,
        )
        return

    if system_temp >= TEMP_WARNING:
        check_and_alert(
            fault_key='thermal_warning', raw_level='warning',
            fault_type='High Enclosure Temperature',
            source=f'{DHT_TYPE} Enclosure Sensor',
            action=f"Enclosure {system_temp:.1f}°C — approaching critical limit of {TEMP_CRITICAL}°C.",
            cursor=cursor, pack_soc=pack_soc, solar_w=solar_w, grid_v=grid_v,
            system_temp=system_temp,
        )
    else:
        check_and_alert(
            fault_key='thermal_warning', raw_level='none',
            fault_type='High Enclosure Temperature',
            source=f'{DHT_TYPE} Enclosure Sensor',
            action='', safe_reset=True,
        )


# =============================================================================
#  BACKGROUND LOGGER
#  [PZEM017] INA226 read replaces INA219 battery read when available
# =============================================================================

_last_rtc_sync: float = 0.0

def background_logger() -> None:
    global _last_rtc_sync, grid_pzem, inverter_pzem
    while True:
        loop_start = time.time()   # [FIX-TIMING] track start for target-time sleep
        try:
            conn   = get_db()
            cursor = conn.cursor(dictionary=True)
            log_data: Dict[str, Any] = {}

            gv = 0.0; gf = 0.0; iv = 0.0; inv_f = 0.0; inv_power = 0.0
            dc_power = 0.0
            pack_voltage = 0.0; pack_current = 0.0; pack_soc = 0.0

            # ── [P1-FIX-4] Read DHT22 temperature ──────────────────────────
            raw_temp = read_dht22()
            if raw_temp > 0:
                cache['system_temp'] = raw_temp
            system_temp = float(cache.get('system_temp', 0))

            # ── DS3231 RTC — periodic NTP sync (every 60s) ─────────────────────
            # If internet is available and NTP is confirmed, update DS3231
            if RTC_AVAILABLE:
                _now = time.time()
                if _now - _last_rtc_sync >= 60:
                    sync_rtc_from_ntp()
                    _last_rtc_sync = _now

            # ── [P1-FIX-5] Thermal check ────────────────────────────────────
            # [FIX-THERMAL-SOC] pack_soc=0 here because battery hasn't been read yet.
            # Use previous cycle's cached ina226 SOC so thermal email has correct SOC.
            _cached_soc = cache.get('ina226', {}).get('soc', pack_soc)
            check_thermal(system_temp, cursor, _cached_soc, dc_power, gv)

            # ── GRID PZEM ───────────────────────────────────────────────────
            if grid_pzem:
                data = grid_pzem.read_all()
                # [FIX-RECONNECT] If serial error — try to reconnect once
                if 'error' in data:
                    print(f"[Grid PZEM] Error: {data['error']} — attempting reconnect")
                    try:
                        grid_pzem.close()
                    except Exception:
                        pass
                    try:
                        port = UART_CONFIG.get('grid_pzem', {}).get('port', '/dev/ttyGridPZEM')
                        grid_pzem = PZEM004TReader(port=port, slave_addr=0x01)
                        if grid_pzem.serial_connection:
                            data = grid_pzem.read_all()
                            print(f"[Grid PZEM] Reconnected — {data}")
                        else:
                            grid_pzem = None
                            data = {}
                    except Exception as _re:
                        print(f"[Grid PZEM] Reconnect failed: {_re}")
                        grid_pzem = None
                        data = {}
                if data and 'error' not in data:
                    # ── [GHOST-VOLTAGE-GUARD] PZEM-004T retains residual capacitance
                    # readings after AC is removed — voltage stays high (e.g. 236V) but
                    # frequency drops to exactly 0Hz (no AC cycle to measure).
                    # Current alone is NOT reliable (reads 0A even with real AC + no load).
                    # Rule: voltage > 50V but frequency == 0Hz → ghost → zero out.
                    _raw_gv  = float(data.get('voltage', 0) or 0)
                    _raw_gf  = float(data.get('frequency', 0) or 0)
                    # [FIX-GHOST-FLASK-V2] Threshold raised 1.0→5.0 Hz.
                    # Some PZEM-004T firmware variants return 0.1–0.3 Hz ghost freq
                    # (non-zero) when AC is removed — old < 1.0 guard missed these.
                    # Real AC is always 45–65 Hz. < 5 Hz is definitively not real AC.
                    _ghost   = _raw_gv > 50 and _raw_gf < 5.0
                    if _ghost:
                        print(f"[GRID GHOST] V={_raw_gv:.1f}V F={_raw_gf:.1f}Hz — zeroed out (residual capacitance, freq<5Hz)")
                        data = {**data, 'voltage': 0.0, 'current': 0.0, 'power': 0.0, 'frequency': 0.0}
                    cache['grid'] = data
                    gv = data.get('voltage', 0); gf = data.get('frequency', 0)
                    log_data['grid_voltage']      = gv
                    log_data['grid_current']      = data.get('current', 0)
                    log_data['grid_power']        = data.get('power', 0)
                    log_data['grid_energy']       = data.get('energy', 0)
                    log_data['grid_frequency']    = gf
                    log_data['grid_power_factor'] = data.get('power_factor', 0)

                    if gv > 0 and (gv < GRID_CRITICAL_LOW or gv > GRID_CRITICAL_HIGH):
                        raw_lvl = 'critical'; safe_rst = False
                        fault_action = (
                            f"Grid {gv:.1f}V outside safe range "
                            f"({GRID_CRITICAL_LOW}–{GRID_CRITICAL_HIGH}V)."
                        )
                    elif gv > 0 and abs(gf - GRID_FREQ_NOMINAL) > GRID_FREQ_CRIT:
                        raw_lvl = 'critical'; safe_rst = False
                        fault_action = (
                            f"Grid frequency {gf:.2f}Hz deviation > {GRID_FREQ_CRIT}Hz "
                            f"from nominal {GRID_FREQ_NOMINAL}Hz."
                        )
                    elif gv > 0 and GRID_NORMAL_LOW <= gv <= GRID_NORMAL_HIGH:
                        raw_lvl = 'none'; safe_rst = True; fault_action = ""
                    elif gv > 0:
                        raw_lvl = 'warning'; safe_rst = False
                        fault_action = f"Grid voltage {gv:.1f}V approaching limit."
                    else:
                        # gv == 0 after ghost guard — always Dropout critical
                        raw_lvl = 'critical'; safe_rst = False
                        fault_action = "Grid Dropout — 0V detected."

                    # Always run engine so last_fault_type + last_delta stay current
                    GRID_ENGINE.process(gv)

                    if safe_rst:
                        GRID_ENGINE.reset()
                        confirmed = check_and_alert(
                            fault_key="grid_voltage", raw_level='none',
                            fault_type="Grid Voltage Anomaly",
                            action="", source="Grid AC (PZEM-004T)",
                            safe_reset=True, cursor=cursor,
                        )
                        cache['gridAnomaly']   = 'none'
                        cache['gridFaultType'] = ''
                    else:
                        # [FIX-DROPOUT-FAULTTYPE] When gv==0, engine.last_fault_type may still
                        # hold previous cycle's value ('Normal' or '') because engine.process(0)
                        # was just called above on THIS cycle — engine needs 1 cycle to update.
                        # Force 'Dropout' immediately so cache, DB, and frontend all see it now.
                        _fault_type_now = ('Dropout' if gv == 0
                                           else (GRID_ENGINE.last_fault_type or "Grid Voltage Anomaly"))
                        confirmed = check_and_alert(
                            fault_key="grid_voltage", raw_level=raw_lvl,
                            fault_type=_fault_type_now,
                            action=fault_action, source="Grid AC (PZEM-004T)",
                            safe_reset=False, cursor=cursor,
                            pack_soc=pack_soc, solar_w=dc_power, grid_v=gv,
                            system_temp=system_temp,
                            anomaly_source=GRID_ENGINE.cfg.name,
                            anomaly_delta=round(GRID_ENGINE.last_delta, 3),
                            confirm_count=GRID_ENGINE.cfg.confirm_count,
                        )
                        cache['gridAnomaly']   = confirmed
                        # [FIX-DROPOUT-CACHE] Set gridFaultType='Dropout' immediately on gv==0
                        # so frontend ghost guard sees it on the SAME poll cycle — no 1-cycle lag.
                        cache['gridFaultType'] = _fault_type_now
                    # Live log
                    global _grid_read_count
                    _grid_read_count += 1
                    _ft  = GRID_ENGINE.last_fault_type or 'Normal'
                    _dv  = GRID_ENGINE.last_delta
                    _cc  = GRID_ENGINE._engine.get_active_count()
                    _sev = {'none': 'Normal', 'warning': 'Warning', 'critical': 'CRITICAL'}.get(confirmed, confirmed)
                    print(f"[GRID #{_grid_read_count:>4}]  {gv:6.1f}V  freq={gf:.2f}Hz  "
                          f"dV={_dv:+.2f}V  type={_ft:<12}  result={_sev:<8}  "
                          f"count={_cc}/{GRID_ENGINE.cfg.confirm_count}")

            # ── INVERTER PZEM ───────────────────────────────────────────────
            if inverter_pzem:
                data = inverter_pzem.read_all()
                # [FIX-RECONNECT] Auto-reconnect on serial error
                if 'error' in data:
                    print(f"[Inverter PZEM] Error: {data['error']} — attempting reconnect")
                    try:
                        inverter_pzem.close()
                    except Exception:
                        pass
                    try:
                        port = UART_CONFIG.get('inverter_pzem', {}).get('port', '/dev/ttyInverterPZEM')
                        inverter_pzem = InverterPZEMReader(port=port, slave_addr=0x01)
                        if inverter_pzem.serial_connection:
                            data = inverter_pzem.read_all()
                            print(f"[Inverter PZEM] Reconnected — {data}")
                        else:
                            inverter_pzem = None
                            data = {}
                    except Exception as _re:
                        print(f"[Inverter PZEM] Reconnect failed: {_re}")
                        inverter_pzem = None
                        data = {}
                if data and 'error' not in data:
                    # ── [GHOST-VOLTAGE-GUARD] Frequency-based — same as Grid ──
                    _raw_iv  = float(data.get('voltage', 0) or 0)
                    _raw_if  = float(data.get('frequency', 0) or 0)
                    # [FIX-GHOST-FLASK-V2] Same threshold fix as grid — < 5.0 Hz
                    _ghost_i = _raw_iv > 50 and _raw_if < 5.0
                    if _ghost_i:
                        print(f"[INV GHOST] V={_raw_iv:.1f}V F={_raw_if:.1f}Hz — zeroed out (residual capacitance, freq<5Hz)")
                        data = {**data, 'voltage': 0.0, 'current': 0.0, 'power': 0.0, 'frequency': 0.0}
                    cache['inverter'] = data
                    iv        = data.get('voltage', 0)
                    inv_f     = data.get('frequency', 0)
                    inv_power = data.get('power', 0)
                    log_data['inverter_voltage']   = iv
                    log_data['inverter_current']   = data.get('current', 0)
                    log_data['inverter_power']     = inv_power
                    log_data['inverter_frequency'] = inv_f

                    if iv > 0 and (iv < INV_CRITICAL_LOW or iv > INV_CRITICAL_HIGH):
                        raw_lvl = 'critical'; safe_rst = False
                        fault_action = (
                            f"Inverter {iv:.1f}V outside safe range "
                            f"({INV_CRITICAL_LOW}–{INV_CRITICAL_HIGH}V)."
                        )
                    elif iv > 0 and INV_CRITICAL_LOW <= iv <= INV_CRITICAL_HIGH:
                        raw_lvl = 'none'; safe_rst = True; fault_action = ""
                    else:
                        raw_lvl = 'critical'; safe_rst = False
                        fault_action = "Inverter Dropout — 0V detected."

                    INVERTER_ENGINE.process(iv)

                    if safe_rst:
                        INVERTER_ENGINE.reset()
                        confirmed = check_and_alert(
                            fault_key="inverter_voltage", raw_level='none',
                            fault_type="Inverter Voltage Anomaly",
                            action="", source="Inverter AC (PZEM-004T)",
                            safe_reset=True, cursor=cursor,
                        )
                        cache['inverterAnomaly'] = 'none'
                        cache['invFaultType']    = ''
                    else:
                        # [FIX-DROPOUT-FAULTTYPE] Same fix as grid — force 'Dropout' immediately on iv==0
                        _inv_fault_type_now = ('Dropout' if iv == 0
                                               else (INVERTER_ENGINE.last_fault_type or "Inverter Voltage Anomaly"))
                        confirmed = check_and_alert(
                            fault_key="inverter_voltage", raw_level=raw_lvl,
                            fault_type=_inv_fault_type_now,
                            action=fault_action, source="Inverter AC (PZEM-004T)",
                            safe_reset=False, cursor=cursor,
                            pack_soc=pack_soc, solar_w=dc_power, grid_v=gv,
                            system_temp=system_temp,
                            inverter_power=inv_power,
                            anomaly_source=INVERTER_ENGINE.cfg.name,
                            anomaly_delta=round(INVERTER_ENGINE.last_delta, 3),
                            confirm_count=INVERTER_ENGINE.cfg.confirm_count,
                        )
                        cache['inverterAnomaly'] = confirmed
                        # [FIX-DROPOUT-CACHE] Set invFaultType='Dropout' immediately on iv==0
                        cache['invFaultType']    = _inv_fault_type_now
                    # Live log
                    global _inv_read_count
                    _inv_read_count += 1
                    _ft  = INVERTER_ENGINE.last_fault_type or 'Normal'
                    _dv  = INVERTER_ENGINE.last_delta
                    _cc  = INVERTER_ENGINE._engine.get_active_count()
                    _sev = {'none': 'Normal', 'warning': 'Warning', 'critical': 'CRITICAL'}.get(confirmed, confirmed)
                    print(f"[INV  #{_inv_read_count:>4}]  {iv:6.1f}V  freq={inv_f:.2f}Hz  "
                          f"dV={_dv:+.2f}V  type={_ft:<12}  result={_sev:<8}  "
                          f"count={_cc}/{INVERTER_ENGINE.cfg.confirm_count}")

            # ── SOLAR — WCS1500 + Voltage Divider via Arduino A0-A4 ─────────
            # Arduino '?' response now includes:
            #   solar.v      — DC array voltage (voltage divider on A4)
            #   solar.i0–i3  — per-panel current (WCS1500 on A0–A3)
            #   solar.i_total — sum of all 4 panel currents
            #   solar.p_total — V × I_total
            arduino_status = arduino_get_status()
            if arduino_status and 'solar' in arduino_status:
                sol = arduino_status['solar']
                sv        = float(sol.get('v',       0))
                si_total  = float(sol.get('i_total', 0))
                sp_total  = float(sol.get('p_total', 0))
                si0       = float(sol.get('i0', 0))
                si1       = float(sol.get('i1', 0))
                si2       = float(sol.get('i2', 0))
                si3       = float(sol.get('i3', 0))
                dc_power  = sp_total

                # Build per-panel cache list matching old INA219 format
                # so SolarPanelsStatusCard.tsx gets stringCurrents correctly
                string_currents = [si0, si1, si2, si3]
                panels = [
                    {'label': f'PV-0{i+1}', 'voltage': sv, 'current': string_currents[i],
                     'power': round(sv * string_currents[i], 1)}
                    for i in range(4)
                ]
                cache['solar']          = panels
                cache['solarVoltage']   = round(sv, 2)
                cache['solarCurrent']   = round(si_total, 3)
                cache['solarPower']     = round(sp_total, 1)
                cache['stringCurrents'] = string_currents

                log_data['solar_dc_voltage'] = round(sv, 2)
                log_data['solar_dc_current'] = round(si_total, 3)
                log_data['solar_dc_power']   = round(sp_total, 1)

                print(f"[SOLAR WCS1500] V={sv:.1f}V | "
                      f"I={si_total:.2f}A (PV01={si0:.2f} PV02={si1:.2f} "
                      f"PV03={si2:.2f} PV04={si3:.2f}) | P={sp_total:.1f}W")

            else:
                # Arduino not responding or solar key missing — keep last cache
                dc_power = cache.get('solarPower', 0.0)

            # ── [PZEM017] BATTERY READ ────────────────────────────────────────
            if PZEM017_AVAILABLE:
                ina226_data = read_pzem017_battery()
                cache['ina226'] = ina226_data

                if ina226_data['available'] and ina226_data['voltage'] > 0:
                    pack_voltage = ina226_data['voltage']
                    pack_current = ina226_data['net_current']
                    pack_soc     = ina226_data['soc']

                    log_data['battery_pack_voltage'] = pack_voltage
                    log_data['battery_pack_current'] = pack_current
                    log_data['battery_pack_power']   = round(pack_voltage * pack_current, 2)
                    log_data['battery_pack_soc']     = pack_soc
                    log_data['battery_charge_a']     = ina226_data['charge_a']
                    log_data['battery_discharge_a']  = ina226_data['discharge_a']

                    print(f"[PZEM017] Pack: {pack_voltage:.2f}V | SOC: {pack_soc:.1f}% | "
                          f"Net: {pack_current:+.2f}A "
                          f"(chg={ina226_data['charge_a']:.2f}A / "
                          f"dis={ina226_data['discharge_a']:.2f}A)")

                    # Auto-update battery_capacity_ah in DB
                    detected_ah = ina226_data.get('capacity_ah', 100)
                    try:
                        cursor.execute(
                            "UPDATE system_config SET config_val=%s WHERE config_key='battery_capacity_ah'",
                            (str(detected_ah),)
                        )
                    except Exception as _cap_err:
                        print(f"[BATTERY] capacity_ah DB update error: {_cap_err}")

            elif battery_reader:
                cells        = battery_reader.read_all_sensors()
                cache['battery'] = cells
                pack_voltage = sum(c.get('voltage', 0) for c in cells if 'error' not in c)
                valid_c      = [c.get('current', 0) for c in cells if 'error' not in c]
                pack_current = sum(valid_c) / len(valid_c) if valid_c else 0
                pack_soc     = calculate_pack_soc(pack_voltage)

                log_data['battery_pack_voltage'] = pack_voltage
                log_data['battery_pack_current'] = pack_current
                log_data['battery_pack_power']   = pack_voltage * pack_current
                log_data['battery_pack_soc']     = pack_soc

            # ── Efficiency computation ────────────────────────────────────────
            # System Efficiency = P_out(inverter) / P_in(grid + solar) × 100
            _p_out   = log_data.get('inverter_power',   0) or 0
            _p_grid  = log_data.get('grid_power',       0) or 0
            _p_solar = log_data.get('solar_dc_power',   0) or 0
            _p_in    = _p_grid + _p_solar

            log_data['system_efficiency'] = round((_p_out / _p_in) * 100, 2) \
                if _p_in > 0 else None
            log_data['solar_efficiency']  = round((_p_solar / SOLAR_RATED_W) * 100, 2) \
                if _p_solar > 0 else None

            # [FIX-LOGS] Always ensure minimum fields present so a log row is
            # inserted every cycle — even when Arduino is unplugged (no solar data)
            # or Inverter PZEM is unavailable. Without this, log_data could be
            # empty or missing _sensor_keys, causing silent INSERT skip and blank
            # sensor log tables in the dashboard.
            log_data.setdefault('grid_voltage',      0.0)
            log_data.setdefault('grid_frequency',    0.0)
            log_data.setdefault('grid_current',      0.0)
            log_data.setdefault('grid_power',        0.0)
            log_data.setdefault('inverter_voltage',  0.0)
            log_data.setdefault('inverter_current',  0.0)
            log_data.setdefault('inverter_power',    0.0)
            log_data.setdefault('inverter_frequency',0.0)
            log_data.setdefault('solar_dc_voltage',  0.0)
            log_data.setdefault('solar_dc_current',  0.0)
            log_data.setdefault('solar_dc_power',    0.0)
            log_data.setdefault('battery_pack_voltage', 0.0)
            log_data.setdefault('battery_pack_current', 0.0)
            log_data.setdefault('battery_pack_soc',     0.0)
            log_data.setdefault('battery_pack_power',   0.0)
            log_data.setdefault('battery_charge_a',     0.0)
            log_data.setdefault('battery_discharge_a',  0.0)
            log_data.setdefault('system_temp',       system_temp)

            # Always insert — log_data now always has at least the defaults above
            columns      = ', '.join(log_data.keys())
            placeholders = ', '.join(['%s'] * len(log_data))
            cursor.execute(
                f"INSERT INTO sensor_logs ({columns}) VALUES ({placeholders})",
                tuple(log_data.values())
            )

            conn.commit()
            cursor.close()
            conn.close()

            # systemCondition — based only on AC voltage anomalies
            grid_lvl = _fault_state.get('grid_voltage',    'none')
            inv_lvl  = _fault_state.get('inverter_voltage', 'none')
            if 'critical' in (grid_lvl, inv_lvl):
                cache['systemCondition'] = 'Critical'
            elif 'warning' in (grid_lvl, inv_lvl):
                cache['systemCondition'] = 'Warning'
            else:
                cache['systemCondition'] = 'Optimal'

            cache['last_update'] = datetime.now().isoformat()

            # [FIX-TIMING] Target-time sleep: keep cycle at ~5s regardless of
            # how long sensor reads + DB writes took. On RPi, PZEM reads alone
            # take 1-2s, so naive time.sleep(5) means actual cycle = 8-12s,
            # causing SSR timing mismatch and stale sensor log entries.
            elapsed       = time.time() - loop_start
            sleep_needed  = max(0.5, 5.0 - elapsed)
            time.sleep(sleep_needed)

        except Exception as e:
            print(f"Logger error: {e}")
            import traceback; traceback.print_exc()
            time.sleep(5)


# =============================================================================
#  AUTH ROUTES
# =============================================================================

@app.route("/auth/logout")
def logout():
    session.clear()
    return jsonify({"success": True})


@app.route("/auth/google")
def auth_google():
    redirect_uri = url_for('auth_google_callback', _external=True)
    if "ngrok-free.dev" in redirect_uri:
        redirect_uri = redirect_uri.replace("http://", "https://")
    return google.authorize_redirect(redirect_uri)


@app.route("/auth/google/callback")
def auth_google_callback():
    try:
        token     = google.authorize_access_token()
        user_info = token.get("userinfo") or google.userinfo()
        google_id = user_info.get("sub")
        email     = user_info.get("email")
        name      = user_info.get("name", email.split("@")[0] if email else "User")
        picture   = user_info.get("picture", "")
        if not email:
            return redirect(f"{FRONTEND_URL}/login?error=no_email")
        try:
            conn   = get_db()
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
            if cursor.fetchone():
                cursor.execute(
                    "UPDATE users SET google_id=%s,name=%s,picture=%s,last_login=NOW() WHERE email=%s",
                    (google_id, name, picture, email)
                )
            else:
                cursor.execute(
                    "INSERT INTO users (google_id,email,name,picture) VALUES (%s,%s,%s,%s)",
                    (google_id, email, name, picture)
                )
            conn.commit(); cursor.close(); conn.close()
        except Exception as e:
            print(f"Google OAuth DB error: {e}")
        session["user"] = {"email": email, "name": name, "picture": picture}
        params = urlencode({"email": email, "name": name, "picture": picture})
        return redirect(f"{FRONTEND_URL}/auth/callback?{params}")
    except Exception as e:
        print(f"Google OAuth callback error: {e}")
        return redirect(f"{FRONTEND_URL}/login?error=oauth_failed")


@app.route("/auth/me")
def auth_me():
    user = session.get("user")
    if user:
        return jsonify({"success": True, "user": user})
    return jsonify({"success": False, "error": "Not logged in"}), 401


try:
    import bcrypt as _bcrypt_module
    bcrypt = _bcrypt_module
    BCRYPT_AVAILABLE = True
except ImportError:
    bcrypt = None  # type: ignore[assignment]
    BCRYPT_AVAILABLE = False
    print("bcrypt not installed — password hashing disabled. Run: pip install bcrypt")

@app.route("/auth/register", methods=["POST"])
def register():
    data     = request.get_json()
    email    = (data.get("email")    or "").strip().lower()
    password = (data.get("password") or "").strip()
    name     = (data.get("name")     or email.split("@")[0]).strip()
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
        if cursor.fetchone():
            cursor.close(); conn.close()
            return jsonify({"error": "Email already registered."}), 409
        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode() if bcrypt else ""  # type: ignore[union-attr]
        cursor.execute(
            "INSERT INTO users (email, name, password_hash) VALUES (%s, %s, %s)",
            (email, name, password_hash)
        )
        conn.commit(); cursor.close(); conn.close()
        return jsonify({"success": True, "user": {"email": email, "name": name, "picture": ""}}), 201
    except Exception as e:
        return jsonify({"error": "Registration failed."}), 500


@app.route("/auth/login", methods=["POST"])
def email_login():
    data     = request.get_json()
    email    = (data.get("email")    or "").strip().lower()
    password = (data.get("password") or "").strip()
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(
            "SELECT id,email,name,picture,password_hash FROM users WHERE email = %s", (email,)
        )
        _u = cursor.fetchone()
        user: Dict[str, Any] = cast(Dict[str, Any], _u) if _u else {}
        if not user:
            cursor.close(); conn.close()
            return jsonify({"error": "No account found with this email."}), 404
        db_hash = user.get("password_hash")
        if not db_hash:
            cursor.close(); conn.close()
            return jsonify({"error": "This account uses Google Sign-In."}), 400
        if not bcrypt or not bcrypt.checkpw(str(password).encode('utf-8'), str(db_hash).encode('utf-8')):  # type: ignore[union-attr]
            cursor.close(); conn.close()
            return jsonify({"error": "Incorrect password."}), 401
        cursor.execute("UPDATE users SET last_login = NOW() WHERE id = %s", (user.get("id"),))
        conn.commit(); cursor.close(); conn.close()
        return jsonify({"success": True, "user": {
            "email":   user.get("email"),
            "name":    user.get("name") or email.split("@")[0],
            "picture": user.get("picture") or "",
        }})
    except Exception as e:
        return jsonify({"error": f"Login failed: {str(e)}"}), 500


# =============================================================================
#  SYSTEM HEALTH
# =============================================================================

@app.route("/api/system/health", methods=["GET"])
def system_health():
    try:
        conn = get_db(); conn.close()
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {str(e)}"

    ina226_data = cache.get('ina226', {})

    return jsonify({
        "status":    "healthy" if db_status == "connected" else "degraded",
        "timestamp": datetime.now().isoformat(),
        "database":  db_status,
        "arduino_pins": {
            "buzzer":   "RPi_GPIO14", "SSR1_K1":  6,
            "SSR2_K2":  4, "SSR3_K3":  3, "SSR4_K4":  5,
        },
        "relay_map": {
            "SSR1_K1": "Solar path (Inverter → ATS-A → Load)       Pin 6",
            "SSR2_K2": "Grid bypass (Grid → ATS-B → Load)          Pin 4",
            "SSR3_K3": "Grid Assist / Charging (auto only)        Pin 3",
            "SSR4_K4": "ATS Output → Contactor → Outlets           Pin 5",
            "Buzzer":  "Alert relay (Active LOW)                   Pin 8",
        },
        "hardware": {
            "grid_pzem":       grid_pzem is not None,
            "inverter_pzem":   inverter_pzem is not None,
            "arduino":         arduino is not None and arduino.is_open,
            "dht_sensor":      DHT_AVAILABLE,
            "pzem017_b1":      ina226_data.get('b1_available', False),
            "pzem017_b2":      ina226_data.get('b2_available', False),
            "pzem017_library": PZEM017_AVAILABLE,
        },
        "rtc_ds3231":  get_rtc_status(),
        "sensors": {
            "grid_pzem":     "connected" if grid_pzem     else "disconnected",
            "inverter_pzem": "connected" if inverter_pzem else "disconnected",
            "solar_panels":  len(cache['solar']),
            "battery_cells": len(cache['battery']),
            "arduino":       "connected" if arduino and arduino.is_open else "disconnected",
            "dht22":         "available" if DHT_AVAILABLE else "not installed",
            "pzem017_library":   "available" if PZEM017_AVAILABLE else "not installed (pip install pymodbus)",
            "pzem017_b1":       f"{PZEM017_PORT} slave=0x{PZEM017_B1_ADDR:02X} — {'responding' if ina226_data.get('b1_available') else 'not connected'}",
            "pzem017_b2":       f"{PZEM017_PORT} slave=0x{PZEM017_B2_ADDR:02X} — {'responding' if ina226_data.get('b2_available') else 'not connected'}",
            "battery_mode":     "PZEM-017" if PZEM017_AVAILABLE and ina226_data.get('available') else "no battery sensor",
        },
        "battery_ina226": {
            "voltage":     ina226_data.get('voltage',     0),
            "charge_a":    ina226_data.get('charge_a',    0),
            "discharge_a": ina226_data.get('discharge_a', 0),
            "net_current": ina226_data.get('net_current', 0),
            "soc":         ina226_data.get('soc',         0),
            "available":   ina226_data.get('available',   False),
        },
        "thermal": {
            "current_temp":    cache.get('system_temp', 0),
            "shutdown_active": _thermal_shutdown_active,
            "temp_warning_c":  TEMP_WARNING,
            "temp_critical_c": TEMP_CRITICAL,
            "temp_resume_c":   TEMP_RESUME,
        },
        "k3_reconnect": {
            "grid_fault_active": _k3_reconnect_state.get('grid_fault_active', False),
            "reconnect_allowed": _k3_reconnect_state.get('reconnect_allowed', True),
            "stable_seconds":    _k3_reconnect_state.get('stable_seconds', 0),
            "required_seconds":  K3_RECONNECT_DELAY_S,
        },
        "manual_lockout": {
            "active":           False,
            "remaining_seconds": max(0, MANUAL_LOCKOUT_S - int(time.time() - _last_manual_ts)),
        },
    })




@app.route("/api/status", methods=["GET"])
def api_status_alias():
    """Alias for /api/system/health — used by SystemStatusCard."""
    return system_health()

@app.route("/api/system/refresh", methods=["POST"])
def system_refresh():
    return jsonify({"success": True, "last_update": cache.get('last_update')})


# =============================================================================
#  CURRENT SENSOR DATA
#  [PZEM017] Battery data now sourced from INA226 when available
# =============================================================================

@app.route("/api/sensor-data/current", methods=["GET"])
def get_current_sensor_data():
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(
            "SELECT ssr1_state,ssr2_state,ssr3_state,ssr4_state "
            "FROM ssr_state ORDER BY id DESC LIMIT 1"
        )
        _sr2 = cursor.fetchone()
        ssr_row: Dict[str, Any] = cast(Dict[str, Any], _sr2) if _sr2 else {}
        cursor.close(); conn.close()

        k1_on = bool(ssr_row.get("ssr1_state", 0))
        k2_on = bool(ssr_row.get("ssr2_state", 0))
        current_source = "Solar (SSR1/K1)" if k1_on else "Grid (SSR2/K2)" if k2_on else "None"

        # [PZEM017] Use INA226 data if available, else INA219 fallback
        ina226_data = cache.get('ina226', {})
        if PZEM017_AVAILABLE and ina226_data.get('available') and ina226_data.get('voltage', 0) > 0:
            pack_voltage = ina226_data['voltage']
            pack_current = ina226_data['net_current']
            pack_soc     = ina226_data['soc']
            battery_source = "INA219"
        else:
            pack_voltage = sum(c.get('voltage', 0) for c in cache['battery'] if 'error' not in c)
            valid_c      = [c.get('current', 0) for c in cache['battery'] if 'error' not in c]
            pack_current = sum(valid_c) / len(valid_c) if valid_c else 0
            pack_soc     = calculate_pack_soc(pack_voltage)
            battery_source = "INA219"

        # [FIX-SOLAR-V] 4P parallel array: all panels share the same voltage.
        # OLD BUG: summed voltage across 4 panels → reported 4× actual voltage
        # (e.g. 41V array showed as 164V on dashboard).
        # NOW: use pre-computed cache values from background_logger Arduino read.
        # cache['solarVoltage'] = single array voltage (V divider on A4)
        # cache['solarCurrent'] = total array current (sum of 4× WCS1500)
        # cache['solarPower']   = V × I_total
        solar_voltage = cache.get('solarVoltage', 0)
        solar_current = cache.get('solarCurrent', 0)
        solar_power   = cache.get('solarPower',   0)
        # Fallback: if cache keys missing (cold start), derive from panels list
        if solar_voltage == 0 and solar_power == 0:
            valid_panels = [p for p in cache['solar'] if 'error' not in p]
            if valid_panels:
                solar_voltage = valid_panels[0].get('voltage', 0)   # same V for all panels (parallel)
                solar_current = sum(p.get('current', 0) for p in valid_panels)
                solar_power   = sum(p.get('power',   0) for p in valid_panels)
        solar_eff = round(solar_power / SOLAR_RATED_W * 100, 1) if solar_power > 0 else 0

        return jsonify({
            "grid": {
                "voltage":      cache['grid'].get('voltage',      0),
                "frequency":    cache['grid'].get('frequency',    0),
                "current":      cache['grid'].get('current',      0),
                "power":        cache['grid'].get('power',        0),
                "power_factor": cache['grid'].get('power_factor', 0),
            },
            "solar": {
                "voltage":        solar_voltage, "current": solar_current,
                "power":          solar_power,   "efficiency": solar_eff,
                "stringCurrents": cache.get('stringCurrents', []),
            },
            "battery": {
                "voltage":      round(pack_voltage, 2),
                "current":      round(pack_current, 2),
                "soc":          pack_soc,
                "power":        round(pack_voltage * pack_current, 2),
                # [PZEM017] Extra fields for dashboard display
                "charge_a":     round(ina226_data.get('charge_a',    0), 2),
                "discharge_a":  round(ina226_data.get('discharge_a', 0), 2),
                "source":       battery_source,
                # [EXPAND-200Ah] Bank B — 0/False when not connected, live when PZEM#3+#4 online
                "bank_b_available": ina226_data.get('bank_b_available', False),
                "bank_b_voltage":   round(ina226_data.get('bank_b_voltage', 0), 2),
                "bank_b_current":   round(ina226_data.get('bank_b_current', 0), 2),
                "bank_b_soc":       ina226_data.get('bank_b_soc', 0),
                "capacity_ah":      ina226_data.get('capacity_ah', 100),
                "anomaly_details":  ina226_data.get('anomaly_details', []),
            },
            "inverter": {
                "voltage":   cache['inverter'].get('voltage',   0),
                "current":   cache['inverter'].get('current',   0),
                "frequency": cache['inverter'].get('frequency', 0),
                "power":     cache['inverter'].get('power',     0),
            },
            "system": {
                "temperature":       cache.get('system_temp', 0),
                "thermalShutdown":   _thermal_shutdown_active,
                "currentSource":     current_source,
                "server_time":       get_timestamp(),
                "rtc_available":     RTC_AVAILABLE,
                "systemEfficiency":  round((cache.get('inverter', {}).get('power', 0) /
                                     max((cache.get('grid', {}).get('power', 0) or 0) +
                                         (cache.get('solarPower', 0) or 0), 0.001)) * 100, 2)
                                     if ((cache.get('grid', {}).get('power', 0) or 0) +
                                         (cache.get('solarPower', 0) or 0)) > 0 else None,
            },
            "k3": {
                "active":          cache.get('k3Active', False),
                "direction":       cache.get('k3Direction', 'standby'),
                "reconnectOk":     cache.get('k3ReconnectOk', True),
                "stableSeconds":   cache.get('k3StableSeconds', 0),
                "requiredSeconds": K3_RECONNECT_DELAY_S,
            },
            "manualLockout": {
                "active":    False,
                "remaining": max(0, MANUAL_LOCKOUT_S - int(time.time() - _last_manual_ts)),
            },
            # [FIX-ANOMALY-FLOW] Expose backend engine confirmed anomaly levels to UI.
            # Previously the UI re-derived anomaly from raw voltage, bypassing the
            # 3-reading confirm logic in the engine. Now UI reads confirmed engine result
            # so buzzer/email and UI banner always stay in sync.
            "anomaly": {
                "grid":          cache.get('gridAnomaly',    'none'),
                "inverter":      cache.get('inverterAnomaly','none'),
                "gridFaultType": cache.get('gridFaultType',  ''),
                "invFaultType":  cache.get('invFaultType',   ''),
            },
            # [FIX-TIMESTAMP] Always use server now — cache.last_update may be
            # from previous cycle (up to 5s stale on RPi with slow PZEM reads).
            "timestamp": datetime.now().isoformat(),
            "last_sensor_update": cache.get('last_update', ''),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# =============================================================================
#  SENSOR HISTORY
# =============================================================================

@app.route("/api/sensor-data/logs", methods=["GET"])
def get_sensor_logs():
    limit = request.args.get("limit", 100, type=int)
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM sensor_logs ORDER BY id DESC LIMIT %s", (limit,))
        rows = cursor.fetchall()
        cursor.close(); conn.close()
        result = []
        for row in rows:
            r: Dict[str, Any] = cast(Dict[str, Any], row)
            for col in ['ssr1_state', 'ssr2_state', 'ssr3_state', 'ssr4_state']:
                r[col] = bool(r.get(col, 0))
            result.append(r)
        return jsonify({"logs": result})
    except Error as e:
        return jsonify({"error": str(e)}), 500


# =============================================================================
#  ANOMALY LOGS
# =============================================================================

@app.route("/api/anomaly-logs", methods=["GET"])
def get_anomaly_logs():
    limit = request.args.get("limit", 50, type=int)
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT id, timestamp,
                   detected_at     AS detectedAt,
                   action_at       AS actionAt,
                   response_time_ms AS responseTimeMs,
                   resolved_at     AS resolvedAt,
                   type, source, severity,
                   system_action   AS systemAction,
                   system_temp     AS systemTemp,
                   battery_soc     AS battery,
                   solar_power     AS solarPower,
                   grid_voltage    AS gridVoltage,
                   inverter_power  AS inverterPower,
                   panel_fault_detail AS panelFaultDetail,
                   email_status    AS emailStatus,
                   buzzer_status   AS buzzer,
                   status,
                   anomaly_source  AS anomalySource,
                   anomaly_delta   AS anomalyDelta,
                   confirm_count   AS confirmCount
            FROM anomaly_logs ORDER BY id DESC LIMIT %s
        """, (limit,))
        rows = cursor.fetchall()
        cursor.close(); conn.close()
        return jsonify({"logs": rows})
    except Error as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/anomaly-logs", methods=["POST"])
def add_anomaly_log():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            INSERT INTO anomaly_logs
                (timestamp,type,source,severity,system_action,
                 system_temp,battery_soc,solar_power,grid_voltage,
                 email_status,buzzer_status,status)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            data.get("type","Unknown"),  data.get("source","Unknown"),
            data.get("severity","Low"),  data.get("systemAction",""),
            data.get("systemTemp",0),    data.get("battery",""),
            data.get("solarPower",""),   data.get("gridVoltage",""),
            data.get("emailStatus","Queued"), data.get("buzzer","OFF"),
            data.get("status","Monitoring"),
        ))
        conn.commit()
        new_id = cursor.lastrowid
        cursor.close(); conn.close()
        return jsonify({"success": True, "id": new_id}), 201
    except Error as e:
        return jsonify({"error": str(e)}), 500


# =============================================================================
#  /api/anomaly-events  — alias of anomaly_logs (used by EnergySystemContext
#  and AnomalyLogView). Reads from and deletes rows in anomaly_logs table.
# =============================================================================

@app.route("/api/anomaly-events", methods=["GET"])
def get_anomaly_events():
    """
    GET /api/anomaly-events?limit=200
    Returns anomaly_logs rows shaped as AnomalyLog objects expected by
    EnergySystemContext → mapDbLogToEntry().
    """
    limit = request.args.get("limit", 200, type=int)
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT
                id,
                timestamp,
                detected_at      AS detectedAt,
                action_at        AS actionAt,
                response_time_ms AS responseTimeMs,
                resolved_at      AS resolvedAt,
                type,
                source,
                severity,
                system_action    AS systemAction,
                system_temp      AS systemTemp,
                battery_soc      AS battery,
                solar_power      AS solarPower,
                grid_voltage     AS gridVoltage,
                inverter_power   AS inverterPower,
                panel_fault_detail AS panelFaultDetail,
                email_status     AS emailStatus,
                buzzer_status    AS buzzer,
                status,
                anomaly_source   AS anomalySource,
                anomaly_delta    AS anomalyDelta,
                confirm_count    AS confirmCount
            FROM anomaly_logs
            ORDER BY id DESC
            LIMIT %s
        """, (limit,))
        rows = cursor.fetchall()
        cursor.close(); conn.close()
        # Return as flat list — EnergySystemContext expects array or {events:[]}
        return jsonify(rows)
    except Error as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/anomaly-events", methods=["DELETE"])
def delete_anomaly_events():
    """
    DELETE /api/anomaly-events
    Clears all rows from anomaly_logs. Called by AnomalyLogView "Delete All" button.
    """
    try:
        conn   = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM anomaly_logs")
        deleted = cursor.rowcount
        conn.commit()
        cursor.close(); conn.close()
        print(f"[anomaly-events] Deleted {deleted} rows from anomaly_logs")
        return jsonify({"success": True, "deleted": deleted})
    except Error as e:
        return jsonify({"error": str(e)}), 500


# =============================================================================
#  SSR / RELAY STATE
# =============================================================================

@app.route("/api/ssr/state", methods=["GET"])
def get_ssr_state():
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM ssr_state ORDER BY id DESC LIMIT 1")
        _rw = cursor.fetchone()
        row: Dict[str, Any] = cast(Dict[str, Any], _rw) if _rw else {}
        cursor.close(); conn.close()
        if not row:
            return jsonify({"error": "No SSR state found"}), 404
        return jsonify({
            "controlMode":       row.get("control_mode",    "solar"),
            "autoSwitchEnabled": bool(row.get("auto_switch",     1)),
            "manualOverride":    bool(row.get("manual_override",  0)),
            "ssrStates": {
                "SSR1": bool(row.get("ssr1_state", 0)),
                "SSR2": bool(row.get("ssr2_state", 0)),
                "SSR3": bool(row.get("ssr3_state", 0)),
                "SSR4": bool(row.get("ssr4_state", 1)),
                "K1":   bool(row.get("ssr1_state", 0)),
                "K2":   bool(row.get("ssr2_state", 0)),
                "K4":   bool(row.get("ssr4_state", 1)),
            },
            "contactorClosed":  bool(row.get("contactor_closed", 1)),
            "k4Closed":         bool(row.get("ssr4_state",       1)),
            "totalSwitches":    row.get("total_switches",    0),
            "lastSwitchTime":   row.get("last_switch_time",  "--:--"),
            "k3ReconnectOk":    _k3_reconnect_state.get('reconnect_allowed', True),
            "k3StableSeconds":  _k3_reconnect_state.get('stable_seconds', 0),
            "arduino":          "connected" if arduino and arduino.is_open else "disconnected",
            "manualLockout": {
                "active":    False,
                "remaining": max(0, MANUAL_LOCKOUT_S - int(time.time() - _last_manual_ts)),
            },
        })
    except Error as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ssr/state", methods=["POST"])
def update_ssr_state():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    ssr_states   = data.get("ssrStates", {})
    control_mode = data.get("controlMode", "solar")

    if data.get("initialLoad", False):
        try:
            conn   = get_db()
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE ssr_state SET
                    control_mode=%s, auto_switch=%s, manual_override=%s,
                    ssr1_state=%s, ssr2_state=%s, ssr3_state=%s, ssr4_state=%s,
                    contactor_closed=%s, grid_assist=%s
                WHERE id = (SELECT id FROM (SELECT MAX(id) AS id FROM ssr_state) t)
            """, (
                control_mode,
                int(data.get("autoSwitchEnabled", True)),
                int(data.get("manualOverride",    False)),
                int(ssr_states.get("SSR1", False)),
                int(ssr_states.get("SSR2", False)),
                int(ssr_states.get("SSR3", False)),
                int(ssr_states.get("SSR4", True)),
                int(data.get("contactorClosed",   True)),
                int(data.get("gridAssistActive",  False)),
            ))
            conn.commit(); cursor.close(); conn.close()
        except Exception as e:
            print(f"Initial load DB sync error: {e}")
        return jsonify({"success": True, "arduino": "skipped (initial load)"})

    # [FIX-SHUTDOWN-1] K4 must ALWAYS be OPEN on shutdown — never trust SSR4 from payload
    # Frontend sometimes sends SSR4=True before derived state updates, causing K4 to stay CLOSED
    if control_mode == 'shutdown':
        k4_close = False
    else:
        k4_close = bool(ssr_states.get("SSR4", True))

    # Send relay commands directly via arduino
    k1 = bool(ssr_states.get("SSR1"))
    k2 = bool(ssr_states.get("SSR2"))
    k3 = bool(ssr_states.get("SSR3"))
    # Safety: never K1+K2 both ON
    if k1 and k2:
        k2 = False
    arduino_send('1' if k1 else 'q')
    arduino_send('2' if k2 else 'w')
    arduino_send('3' if k3 else 'e')
    arduino_send('4' if k4_close else 'r')

    # manual_ts removed

    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)

        # Get current state BEFORE update for history
        cursor.execute("SELECT control_mode, ssr1_state, ssr2_state, ssr3_state, ssr4_state FROM ssr_state ORDER BY id DESC LIMIT 1")
        _prev2 = cursor.fetchone()
        prev2: Dict[str, Any] = cast(Dict[str, Any], _prev2) if _prev2 else {}
        from_mode  = prev2.get("control_mode") if prev2 else None
        prev_tuple = (bool(prev2.get("ssr1_state", 0)), bool(prev2.get("ssr2_state", 0)),
                      bool(prev2.get("ssr3_state", 0)), bool(prev2.get("ssr4_state", 1))) if prev2 else (False, False, False, True)

        cursor.execute("""
            UPDATE ssr_state SET
                control_mode=%s, auto_switch=%s, manual_override=%s,
                ssr1_state=%s, ssr2_state=%s, ssr3_state=%s, ssr4_state=%s,
                contactor_closed=%s, grid_assist=%s,
                total_switches=total_switches+1, last_switch_time=%s
            WHERE id = (SELECT id FROM (SELECT MAX(id) AS id FROM ssr_state) t)
        """, (
            control_mode,
            int(data.get("autoSwitchEnabled", True)),
            int(data.get("manualOverride",    False)),
            int(ssr_states.get("SSR1", False)),
            int(ssr_states.get("SSR2", False)),
            int(ssr_states.get("SSR3", False)),
            int(k4_close),
            int(k4_close),
            int(data.get("gridAssistActive",  False)),
            datetime.now().strftime("%H:%M"),
        ))

        # Insert history row
        after_tuple = (
            bool(ssr_states.get("SSR1", False)),
            bool(ssr_states.get("SSR2", False)),
            bool(ssr_states.get("SSR3", False)),
            bool(k4_close),
        )
        # ssr_switch_log removed

        conn.commit(); cursor.close(); conn.close()
        return jsonify({
            "success": True,
            "arduino": "sent" if arduino else "not connected",
            "manual_lockout_started": True,
            "lockout_seconds": MANUAL_LOCKOUT_S,
        })
    except Error as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ssr/emergency", methods=["POST"])
def emergency_cutoff():
    if arduino:
        arduino_send('X')
    print("EMERGENCY CUTOFF — SSR4/K4 OPEN + all SSRs OFF")

    # manual_ts removed

    _email_sent_times.pop('emergency_cutoff', None)  # reset cooldown for emergency
    _send_email_alert(
        fault_key="emergency_cutoff",
        fault_type="EMERGENCY CUTOFF Triggered",
        severity="critical",
        action=(
            "Emergency stop. All relays OFF. SSR4/K4 OPEN. Outlets disconnected. "
            "⚠️ ADMIN: Inspect before restart. Trip MCCB if battery at risk."
        ),
        source="Emergency Cutoff (API)",
        email_type="emergency",
    )
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        # Get current before clearing
        cursor.execute("SELECT control_mode, ssr1_state, ssr2_state, ssr3_state, ssr4_state FROM ssr_state ORDER BY id DESC LIMIT 1")
        _prev3 = cursor.fetchone()
        prev3: Dict[str, Any] = cast(Dict[str, Any], _prev3) if _prev3 else {}
        from_mode  = prev3.get("control_mode") if prev3 else None
        prev_tuple = (bool(prev3.get("ssr1_state", 0)), bool(prev3.get("ssr2_state", 0)),
                      bool(prev3.get("ssr3_state", 0)), bool(prev3.get("ssr4_state", 1))) if prev3 else (False, False, False, True)

        cursor.execute("""
            UPDATE ssr_state SET control_mode='shutdown',
                ssr1_state=0, ssr2_state=0, ssr3_state=0, ssr4_state=0,
                contactor_closed=0, grid_assist=0, last_switch_time=%s,
                total_switches=total_switches+1
            WHERE id = (SELECT id FROM (SELECT MAX(id) AS id FROM ssr_state) t)
        """, (datetime.now().strftime("%H:%M"),))


        conn.commit(); cursor.close(); conn.close()
    except Exception as e:
        print(f"Emergency cutoff DB update failed: {e}")
    return jsonify({"success": True, "action": "EMERGENCY_CUTOFF"})


@app.route("/api/ssr/switch-log", methods=["GET"])
def get_ssr_switch_log():
    """Return full SSR switch history — every relay change event ever recorded."""
    limit = min(int(request.args.get("limit", 100)), 500)
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT id, switched_at, trigger_source, from_mode, to_mode,
                   ssr1_before, ssr2_before, ssr3_before, ssr4_before,
                   ssr1_after,  ssr2_after,  ssr3_after,  ssr4_after,
                   reason, battery_soc, solar_power_w, grid_voltage_v
            FROM ssr_switch_log
            ORDER BY switched_at DESC
            LIMIT %s
        """, (limit,))
        rows = cursor.fetchall()
        cursor.close(); conn.close()
        # Stringify datetimes — cast each row to Dict for Pylance
        result = []
        for _r in rows:
            r: Dict[str, Any] = cast(Dict[str, Any], _r)
            if r.get("switched_at"):
                r["switched_at"] = str(r["switched_at"])
            result.append(r)
        return jsonify({"logs": result, "total": len(result)})
    except Error as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/email-logs", methods=["GET"])
def get_email_logs():
    """Return full email send history — sent, failed, skipped_cooldown, no_recipient."""
    limit = min(int(request.args.get("limit", 100)), 500)
    status_filter = request.args.get("status")   # optional ?status=sent
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        if status_filter:
            cursor.execute("""
                SELECT id, sent_at, fault_key, fault_type, severity, source,
                       recipient, status, error_msg,
                       battery_soc, solar_power_w, grid_voltage_v
                FROM email_logs
                WHERE status = %s
                ORDER BY sent_at DESC LIMIT %s
            """, (status_filter, limit))
        else:
            cursor.execute("""
                SELECT id, sent_at, fault_key, fault_type, severity, source,
                       recipient, status, error_msg,
                       battery_soc, solar_power_w, grid_voltage_v
                FROM email_logs
                ORDER BY sent_at DESC LIMIT %s
            """, (limit,))
        rows = cursor.fetchall()
        cursor.close(); conn.close()
        result_e = []
        for _re in rows:
            re: Dict[str, Any] = cast(Dict[str, Any], _re)
            if re.get("sent_at"):
                re["sent_at"] = str(re["sent_at"])
            result_e.append(re)
        return jsonify({"logs": result_e, "total": len(result_e)})
    except Error as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/arduino/status", methods=["GET"])
def get_arduino_status():
    status = arduino_get_status()
    if status:
        return jsonify({"success": True, "arduino": status})
    return jsonify({"success": False, "error": "Arduino not responding"}), 503


# =============================================================================
#  SYSTEM CONFIG
# =============================================================================

@app.route("/api/system/config", methods=["GET"])
def get_system_config():
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT config_key, config_val FROM system_config")
        rows = cursor.fetchall()
        cursor.close(); conn.close()
        config: Dict[str, Any] = {
            str(r['config_key']): r['config_val']  # type: ignore[index]
            for r in rows if r is not None
        }
        cap_ah  = int(str(config.get('battery_capacity_ah', 100)))
        oc_cfg  = BAT_OVERCURRENT_CONFIG.get(cap_ah, BAT_OVERCURRENT_CONFIG[100])
        config['battery_overcurrent_warn_a'] = str(oc_cfg['warn'])
        config['battery_overcurrent_trip_a'] = str(oc_cfg['trip'])
        return jsonify({"success": True, "config": config})
    except Exception as e:
        return jsonify({"error": str(e)}), 500




@app.route("/api/system-config/<key>", methods=["GET"])
def get_system_config_by_key(key: str):
    """Alias — frontend calls /api/system-config/<key> directly."""
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(
            "SELECT config_val FROM system_config WHERE config_key = %s", (key,)
        )
        _row = cursor.fetchone()
        cursor.close(); conn.close()
        if not _row:
            return jsonify({"error": f"Key not found"}), 404
        row: Dict[str, Any] = cast(Dict[str, Any], _row)  # Pylance: cursor is dictionary=True
        return jsonify({"success": True, "key": key, "value": row["config_val"]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/system/config", methods=["POST"])
def update_system_config():
    data = request.get_json() or {}
    try:
        conn   = get_db()
        cursor = conn.cursor()
        for key, val in data.items():
            cursor.execute("""
                INSERT INTO system_config (config_key, config_val)
                VALUES (%s, %s)
                ON DUPLICATE KEY UPDATE config_val = VALUES(config_val)
            """, (key, str(val)))
        if 'battery_capacity_ah' in data:
            cap_ah = int(data['battery_capacity_ah'])
            oc_cfg = BAT_OVERCURRENT_CONFIG.get(cap_ah, BAT_OVERCURRENT_CONFIG[100])
            cursor.execute("""
                INSERT INTO system_config (config_key, config_val)
                VALUES ('battery_current_warn_a', %s)
                ON DUPLICATE KEY UPDATE config_val = VALUES(config_val)
            """, (str(oc_cfg['warn']),))
            print(f"Battery capacity → {cap_ah}Ah | warn={oc_cfg['warn']}A | trip={oc_cfg['trip']}A")
        # Hot-reload inverter thresholds into engine (no restart needed)
        if 'inverter_voltage_min' in data or 'inverter_voltage_max' in data:
            inv_lo = float(data.get('inverter_voltage_min', INVERTER_ENGINE.cfg.v_critical_low))
            inv_hi = float(data.get('inverter_voltage_max', INVERTER_ENGINE.cfg.v_critical_high))
            INVERTER_ENGINE.update_thresholds(inv_lo, inv_hi)
            print(f'[ENGINE] Inverter thresholds hot-reloaded: {inv_lo}–{inv_hi} V')
        conn.commit(); cursor.close(); conn.close()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# =============================================================================
#  K3 RECONNECT TIMER API
# =============================================================================

@app.route("/api/k3/reconnect-status", methods=["GET"])
def get_k3_reconnect_status():
    return jsonify({
        "reconnect_allowed":  _k3_reconnect_state.get('reconnect_allowed', True),
        "grid_fault_active":  _k3_reconnect_state.get('grid_fault_active', False),
        "stable_seconds":     _k3_reconnect_state.get('stable_seconds', 0),
        "required_seconds":   K3_RECONNECT_DELAY_S,
        "remaining_seconds":  max(0, K3_RECONNECT_DELAY_S - _k3_reconnect_state.get('stable_seconds', 300)),
    })


@app.route("/api/k3/reconnect-status", methods=["POST"])
def post_k3_reconnect_status():
    if not _k3_reconnect_state.get('reconnect_allowed', True):
        remaining = max(0, K3_RECONNECT_DELAY_S - _k3_reconnect_state.get('stable_seconds', 0))
    else:
        remaining = 0
    return jsonify({
        "success": True,
        "backend_locked":    not _k3_reconnect_state.get('reconnect_allowed', True),
        "remaining_seconds": remaining,
    })


# =============================================================================
#  NETWORK LOGS
# =============================================================================

@app.route('/api/network-logs', methods=['POST'])
def save_network_log():
    try:
        data   = request.get_json()
        conn   = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO network_logs
            (local_latency_ms, local_status, internet_status, temperature, temp_status, signal_quality)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (
            data.get('localLatency'),  data.get('localStatus'),
            data.get('internetStatus'), data.get('temperature'),
            data.get('tempStatus'),    data.get('signalQuality'),
        ))
        conn.commit(); cursor.close(); conn.close()
        return jsonify({'status': 'ok'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/network-logs', methods=['GET'])
def get_network_logs():
    try:
        limit  = int(request.args.get('limit', 200))
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM network_logs ORDER BY id DESC LIMIT %s", (limit,))
        rows   = cursor.fetchall()
        cursor.close(); conn.close()
        return jsonify(rows)
    except Exception as e:
        return jsonify({'error': str(e)}), 500



@app.route('/api/network-logs', methods=['DELETE'])
def delete_network_logs():
    """
    DELETE /api/network-logs
    [FIX] Route was missing — frontend got 405 on delete.
    """
    try:
        conn   = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM network_logs")
        deleted = cursor.rowcount
        conn.commit()
        cursor.close(); conn.close()
        print(f"[network-logs] Deleted {deleted} rows")
        return jsonify({"success": True, "deleted": deleted})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =============================================================================
#  SENSOR DATA HISTORY  (alias routes expected by frontend getSensorHistory)
# =============================================================================

@app.route("/api/sensor-data/history", methods=["GET"])
def get_sensor_data_history():
    """
    GET /api/sensor-data/history?limit=N
    [FIX] Frontend api.getSensorHistory() calls this URL but Flask only had
    /api/sensor-data/logs which wraps result in {logs:[]} — frontend expects
    a flat array. Returns flat array so PowerHistoryCard/SensorDataLogsView work.
    """
    limit = request.args.get("limit", 200, type=int)
    try:
        conn   = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT
                id, timestamp,
                grid_voltage, grid_current, grid_power, grid_frequency,
                inverter_voltage, inverter_current, inverter_power, inverter_frequency,
                solar_dc_voltage, solar_dc_current, solar_dc_power,
                battery_pack_voltage, battery_pack_current, battery_pack_power,
                system_temp, ssr1_state, ssr2_state, ssr3_state, ssr4_state,
                grid_energy, grid_power_factor, system_efficiency, solar_efficiency
            FROM sensor_logs
            ORDER BY id DESC
            LIMIT %s
        """, (limit,))
        rows = cursor.fetchall()
        cursor.close(); conn.close()
        result = []
        for row in rows:
            r = dict(row)
            for col in ['ssr1_state', 'ssr2_state', 'ssr3_state', 'ssr4_state']:
                r[col] = bool(r.get(col, 0))
            result.append(r)
        return jsonify(result)
    except Error as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/sensor-data/history", methods=["DELETE"])
def delete_sensor_data_history():
    """
    DELETE /api/sensor-data/history
    [FIX] Called by SensorDataLogsView Delete All — route was missing (405).
    """
    try:
        conn   = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sensor_logs")
        deleted = cursor.rowcount
        conn.commit()
        cursor.close(); conn.close()
        print(f"[sensor-data/history] Deleted {deleted} rows from sensor_logs")
        return jsonify({"success": True, "deleted": deleted})
    except Error as e:
        return jsonify({"error": str(e)}), 500


# =============================================================================
#  OUTLET / BUZZER CONTROL
# =============================================================================

@app.route("/api/outlets/<outlet>", methods=["POST"])
def control_outlet(outlet: str):
    data   = request.get_json()
    status = data.get("status", False) if data else False
    return jsonify({"success": True, "outlet": outlet, "status": status})


@app.route("/api/buzzer/trigger", methods=["POST"])
def trigger_buzzer():
    data        = request.get_json() or {}
    duration_ms = int(data.get("duration_ms", BUZZER_DURATION_MS))
    reason      = data.get("reason", "Anomaly alert")
    if buzzer_state['active']:
        return jsonify({"success": False, "message": "Buzzer already active"}), 409
    buzzer_state['active']       = True
    buzzer_state['duration_ms']  = duration_ms
    buzzer_state['triggered_at'] = datetime.now().isoformat()
    _buzzer_on()

    def _auto_off():
        time.sleep(duration_ms / 1000)
        _buzzer_off()
        buzzer_state['active']      = False
        buzzer_state['duration_ms'] = 0

    threading.Thread(target=_auto_off, daemon=True).start()
    try:
        conn   = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO buzzer_logs (duration_ms, reason) VALUES (%s, %s)",
            (duration_ms, reason)
        )
        conn.commit(); cursor.close(); conn.close()
    except Exception as e:
        print(f"Buzzer log DB error: {e}")
    return jsonify({
        "success": True, "duration_ms": duration_ms,
        "triggered_at": buzzer_state['triggered_at'],
        "arduino": "sent" if arduino else "not connected",
    }), 200


@app.route("/api/buzzer/stop", methods=["POST"])
def stop_buzzer():
    _buzzer_off()
    buzzer_state['active']      = False
    buzzer_state['duration_ms'] = 0
    return jsonify({"success": True})


@app.route("/api/buzzer/state", methods=["GET"])
def get_buzzer_state():
    return jsonify({
        "active":       buzzer_state['active'],
        "duration_ms":  buzzer_state['duration_ms'],
        "triggered_at": buzzer_state['triggered_at'],
    })


# =============================================================================
#  DEBUG ROUTES
# =============================================================================

@app.route("/api/debug/alert-state", methods=["GET"])
def debug_alert_state():
    now = time.time()
    ina226_data = cache.get('ina226', {})
    return jsonify({
        "fault_states":   dict(_fault_state),
        "fault_counters": dict(_fault_counters),
        "fault_buzzer_fired": dict(_fault_buzzer_fired),
        "fault_first_detected": {
            k: v.strftime('%Y-%m-%d %H:%M:%S.%f')
            for k, v in _fault_first_detected.items()
        },

        "thermal": {
            "shutdown_active": _thermal_shutdown_active,
            "current_temp":    cache.get('system_temp', 0),
            "dht22_available": DHT_AVAILABLE,
        },
        # [PZEM017] INA226 debug info
        "ina226": {
            "library_available": PZEM017_AVAILABLE,
            "hardware_responding": ina226_data.get('available', False),
            "voltage":     ina226_data.get('voltage',     0),
            "charge_a":    ina226_data.get('charge_a',    0),
            "discharge_a": ina226_data.get('discharge_a', 0),
            "net_current": ina226_data.get('net_current', 0),
            "soc":         ina226_data.get('soc',         0),
            "pzem017_port":     PZEM017_PORT,
            "b1_addr":          f"0x{PZEM017_B1_ADDR:02X}",
            "b1_voltage":      ina226_data.get("b1_voltage", 0),
            "b2_voltage":      ina226_data.get("b2_voltage", 0),
        },
        "cooldowns": {
            k: f"{int(EMAIL_COOLDOWN_DEFAULT_S - (now - t))}s remaining"
            for k, t in _email_sent_times.items()
            if now - t < EMAIL_COOLDOWN_DEFAULT_S
        },
        "k3_reconnect":   dict(_k3_reconnect_state),
        "daylight_now":   _is_daytime(),
        "manual_lockout": {
            "active":    False,
            "remaining": max(0, MANUAL_LOCKOUT_S - int(now - _last_manual_ts)),
        },
    })


@app.route("/api/debug/reset-cooldowns", methods=["POST"])
def debug_reset_cooldowns():
    cleared = list(_email_sent_times.keys())
    _email_sent_times.clear()
    return jsonify({"success": True, "cleared": cleared})


@app.route("/api/debug/reset-faults", methods=["POST"])
def debug_reset_faults():
    _fault_state.clear(); _fault_counters.clear()
    _fault_buzzer_fired.clear(); _email_sent_times.clear()
    _fault_first_detected.clear()
    return jsonify({"success": True, "message": "All alert state reset."})


@app.route("/auth/callback")
def auth_callback():
    params = request.query_string.decode()
    return redirect(f"{FRONTEND_URL}/?{params}" if params else FRONTEND_URL)


# =============================================================================
#  STARTUP
# =============================================================================

if __name__ == "__main__":
    print("\n" + "=" * 70)
    print("  HELIOGRID — UNIFIED FLASK API SERVER  (v6.0 — PZEM-017 Battery)")
    print("=" * 70)
    print(f"  Arduino Pin Map (v4.3):")
    print(f"    RPi GPIO14 → Buzzer (moved from Arduino Pin 8 in v4.3)")
    print(f"    Pin  6 → SSR1 = K1 → Solar path    (Inverter → ATS-A → Load)")
    print(f"    Pin  4 → SSR2 = K2 → Grid bypass   (Grid → ATS-B → Load)")
    print(f"    Pin  3 → SSR3 = K3 → Grid Assist  (auto only, IEEE 1547)")
    print(f"    Pin  5 → SSR4 = K4 → Contactor → Outlets")
    print(f"\n  [PZEM017] Battery Current Sensor:")
    print(f"    Port: {PZEM017_PORT} (USB Hub → ttyUSB3)")
    print(f"    B1: slave=0x{PZEM017_B1_ADDR:02X} — 12V 100Ah bottom battery")
    print(f"    B2: slave=0x{PZEM017_B2_ADDR:02X} — 12V 100Ah top battery")
    print(f"    Library:  {'AVAILABLE' if PZEM017_AVAILABLE else 'NOT INSTALLED — pip install pymodbus --break-system-packages'}")
    print(f"    pymodbus: {'AVAILABLE' if PZEM017_AVAILABLE else 'NOT INSTALLED — pip install pymodbus --break-system-packages'}")
    print(f"\n  Phase 1 Fixes (v5.0) still active:")
    print(f"    [P1-FIX-1..6] detected_at, resolved_at, inverter_power,")
    print(f"                  {DHT_TYPE}, thermal shutdown, sensor guard")
    print(f"\n  {DHT_TYPE}: {'AVAILABLE — GPIO BCM ' + str(DHT_PIN) if DHT_AVAILABLE else 'NOT AVAILABLE (pip install adafruit-circuitpython-dht)'}")
    print("=" * 70)
    try:
        ensure_tables()
        print("Database initialized")
    except Exception as e:
        print(f"Database initialization failed: {e}")
        exit(1)
    # ── DS3231 RTC Boot Sync ──────────────────────────────────────────────────
    # Sync RPi system clock from DS3231 before sensors start (offline-safe)
    if RTC_AVAILABLE:
        print("Syncing system clock from DS3231 RTC...")
        sync_system_clock_from_rtc()
    else:
        print("DS3231 not available — using system clock only")

    arduino_connected = arduino is not None and arduino.is_open
    # [FIX-LOGGING] Always start background_logger regardless of hardware.
    # Old gate (SENSORS_AVAILABLE or PZEM017_AVAILABLE or arduino_connected or DHT_AVAILABLE)
    # caused silent no-op when all flags are False — sensor_logs table stayed empty
    # even though data was arriving via /api/sensor-data/current from another source.
    # Logger already uses setdefault(0.0) for all fields so it's safe with no hardware.
    threading.Thread(target=background_logger, daemon=True).start()
    print(f"Background sensor logger started (hardware: PZEM={SENSORS_AVAILABLE}, PZEM017={PZEM017_AVAILABLE}, Arduino={arduino_connected}, DHT={DHT_AVAILABLE})")
    print("\nServer starting on http://0.0.0.0:5000\n")
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)
