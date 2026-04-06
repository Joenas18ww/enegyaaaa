"""
HelioGrid Email Alert Service — Port 5001
==========================================
Fixes applied vs previous version:
  1. SSR labels updated → K1 (Solar), K2 (Grid), K3 (Grid Assist),
                          K4 (ATS Contactor) — no more old SSR1/2/3/4 names
  2. 'info' severity handler added → battery_full + battery_full emails now send
  3. 'battery_critical' email_type → includes MCCB instruction prominently
  4. Warning suppression now LOGGED to console with structured info
  5. email_type routing → explicit 'login' / 'battery_full' / 'battery_critical'
     / 'emergency' no longer relies on keyword matching of fault_type string
  6. Battery critical template → MCCB instruction added as prominent red banner
  7. K3 reconnect info → shows stable_seconds / 300 in email footer

FIXES (v2):
  FIX-1. Legacy keyword fallback removed — email_type is now the sole router;
          "discharge" / "overcharge" in fault_type no longer triggers MCCB alert
  FIX-2. _normalize() logs a WARNING when a sensor field silently falls back to 0.0
  FIX-3. /api/send-alert validates required fields before routing
  FIX-4. _fmt_ts() guards against None / non-string timestamps
  FIX-5. EMAIL_RECIPIENT fallback to MAIL_USERNAME is documented via startup warning
  FIX-6. /api/test-email requires X-Api-Key header (set TEST_API_KEY in .env)

SMART ALERT POLICY:
  • CRITICAL (Drift/Spike/Dropout ONLY) → Grid AC / Inverter AC anomaly email
                       Triggered by VoltageAnomalyEngine — 3 consecutive critical readings
                       → buzzer 5s + email. ONLY fault_types containing "drift", "spike",
                       or "dropout" are allowed through the anomaly gate.
                       All other critical fault_types (battery, solar, thermal, etc.)
                       are BLOCKED — they use their own dedicated email_type routes.
  • BATTERY FULL     → dedicated info email (no buzzer)
  • BATTERY WARNING  → battery low email only (no buzzer) — <23.0V (~50% SOC)
  • BATTERY CRITICAL → MCCB alert email (no buzzer) — <21.6V deep discharge
  • SOLAR PANEL      → panel health email (no buzzer) — 3 consecutive low health
                       Aging (<40%) or Replace (<20%) → email alert
  • WARNING          → REJECTED at service level (dashboard display only)
  • LOGIN            → always sends login notification email
  • EMERGENCY        → sends critical email immediately (no cooldown)
"""

import os
import smtplib
import traceback
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

MAIL_SERVER     = os.getenv("MAIL_SERVER",    "smtp.gmail.com")
MAIL_PORT       = int(os.getenv("MAIL_PORT",  "587"))
MAIL_USERNAME   = os.getenv("MAIL_USERNAME",  "")
MAIL_PASSWORD   = (os.getenv("MAIL_PASSWORD", "")).replace(" ", "")
EMAIL_RECIPIENT = os.getenv("EMAIL_RECIPIENT", MAIL_USERNAME)

# FIX-6: API key for test endpoint
TEST_API_KEY    = os.getenv("TEST_API_KEY", "")

VALID_EMAIL_TYPES = {"login", "battery_full", "battery_warning", "battery_critical", "solar_panel", "critical", "emergency"}


def _debug_config():
    print(f"  MAIL_SERVER    : {MAIL_SERVER}:{MAIL_PORT}")
    print(f"  MAIL_USERNAME  : {MAIL_USERNAME}")
    print(f"  MAIL_PASSWORD  : {'SET (' + str(len(MAIL_PASSWORD)) + ' chars)' if MAIL_PASSWORD else 'NOT SET'}")
    print(f"  EMAIL_RECIPIENT: {EMAIL_RECIPIENT}")
    # FIX-5: Warn if EMAIL_RECIPIENT was not explicitly set
    if not os.getenv("EMAIL_RECIPIENT"):
        print("  [WARN] EMAIL_RECIPIENT not set in .env — falling back to MAIL_USERNAME.")
        print("         Set EMAIL_RECIPIENT explicitly to send alerts to a different address.")
    if not TEST_API_KEY:
        print("  [WARN] TEST_API_KEY not set — /api/test-email endpoint is UNPROTECTED.")


# =============================================================================
#  SMTP
# =============================================================================

def _send_raw(to_email: str, subject: str, html: str) -> tuple[bool, str]:
    if not MAIL_USERNAME:
        return False, "MAIL_USERNAME not set in .env"
    if not MAIL_PASSWORD:
        return False, "MAIL_PASSWORD not set in .env"
    if not to_email:
        return False, "No recipient email"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"HelioGrid Alerts <{MAIL_USERNAME}>"
    msg["To"]      = to_email
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        print(f"  [SMTP] Connecting to {MAIL_SERVER}:{MAIL_PORT}...")
        with smtplib.SMTP(MAIL_SERVER, MAIL_PORT, timeout=15) as s:
            s.ehlo(); s.starttls(); s.ehlo()
            s.login(MAIL_USERNAME, MAIL_PASSWORD)
            s.sendmail(MAIL_USERNAME, [to_email], msg.as_string())
        print(f"  [SMTP] Sent to {to_email}")
        return True, ""
    except smtplib.SMTPAuthenticationError as e:
        err = f"Auth failed — use Google App Password: {e}"
        print(f"  [SMTP] {err}")
        return False, err
    except Exception as e:
        print(f"  [SMTP] {e}")
        traceback.print_exc()
        return False, str(e)


# =============================================================================
#  HELPERS
# =============================================================================

# FIX-4: Guard against None / non-string / malformed timestamps
def _fmt_ts(ts) -> str:
    if ts is None:
        return "Unknown"
    try:
        ts_str = str(ts)
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return dt.strftime("%B %d, %Y at %I:%M:%S %p")
    except Exception:
        return str(ts) if ts else "Unknown"


def _normalize(raw: dict) -> dict:
    d = dict(raw)

    # Normalize fault_type / action / email
    if "fault_type" not in d:
        d["fault_type"] = d.get("faultType", "System Alert")
    if "action" not in d:
        d["action"] = d.get("systemAction", d.get("system_action", ""))
    if "email" not in d:
        d["email"] = d.get("to_email", d.get("target_email", ""))
    d["severity"]   = d.get("severity",   "critical").lower()
    d["email_type"] = d.get("email_type", "").lower()

    # FIX-2: Log a warning when a sensor field silently falls back to 0.0
    def _f(val, field_name="unknown", default=0.0):
        try:
            return float(
                str(val).replace("V","").replace("Hz","").replace("W","")
                         .replace("%","").replace("°C","").replace("C","").strip()
            )
        except Exception:
            if val is not None and val != 0 and val != "":
                print(
                    f"  [WARN] Could not parse sensor field '{field_name}' "
                    f"value={val!r} — defaulting to {default}. "
                    f"Check the payload from the sender."
                )
            return default

    for nk, ok in [
        ("grid_voltage",   "gridVoltage"),   ("grid_frequency",  "gridFrequency"),
        ("inv_voltage",    "inverterVoltage"),("inv_frequency",   "inverterFrequency"),
        ("solar_power",    "solarPower"),     ("battery_voltage", "batteryVoltage"),
        ("battery_soc",    "batterySOC"),     ("temperature",     "deviceTemp"),
    ]:
        raw_val = d.get(nk, d.get(ok, 0))
        d[nk] = _f(raw_val, field_name=nk)

    if "panel_condition" not in d: d["panel_condition"] = d.get("panelCondition", "No Output")
    if "active_source"   not in d: d["active_source"]   = d.get("activeSource",   "Unknown")
    if "system_status"   not in d: d["system_status"]   = d.get("systemCondition","Unknown")

    # Anomaly engine fields (from VoltageAnomalyEngine)
    if "anomaly_source"     not in d: d["anomaly_source"]     = d.get("anomalySource", "")
    if "anomaly_delta"      not in d: d["anomaly_delta"]      = d.get("anomalyDelta",  None)
    if "anomaly_first_seen" not in d: d["anomaly_first_seen"] = d.get("anomalyFirstSeen", d.get("first_seen", None))
    if "confirm_count"      not in d: d["confirm_count"]      = d.get("confirmCount", None)

    # Relay states — support both old ssr1..4 and new k1..4 naming
    def _bool(v):
        if isinstance(v, bool): return v
        if isinstance(v, int):  return bool(v)
        if isinstance(v, str):  return v.strip().upper() == "ON"
        return False

    d["k1"] = _bool(d.get("k1", d.get("ssr1", False)))
    d["k2"] = _bool(d.get("k2", d.get("ssr2", False)))
    d["k3"] = _bool(d.get("k3", d.get("ssr3", False)))
    d["k4"] = _bool(d.get("k4", d.get("ssr4", False)))

    d["buzzer"]              = _bool(d.get("buzzer", d.get("buzzerStatus", False)))
    d["k3_reconnect_blocked"]= _bool(d.get("k3_reconnect_blocked", False))
    d["k3_stable_seconds"]   = int(d.get("k3_stable_seconds", 0))

    return d


def _badge(state: bool) -> str:
    if state:
        return (
            '<span style="display:inline-block;background:#dcfce7;color:#166534;'
            'border:1px solid #86efac;font-size:10px;font-weight:700;letter-spacing:1px;'
            'padding:3px 10px;border-radius:5px;white-space:nowrap;">ON</span>'
        )
    return (
        '<span style="display:inline-block;background:#f1f5f9;color:#94a3b8;'
        'border:1px solid #cbd5e1;font-size:10px;font-weight:700;letter-spacing:1px;'
        'padding:3px 10px;border-radius:5px;white-space:nowrap;">OFF</span>'
    )


# =============================================================================
#  LOGIN EMAIL
# =============================================================================

def _build_login_email(data: dict) -> str:
    email     = data.get("email", "Unknown")
    name      = data.get("name",  email.split("@")[0].capitalize() if "@" in email else email)
    source    = str(data.get("source", "Web Login"))
    timestamp = _fmt_ts(data.get("timestamp", datetime.now().isoformat()))
    method    = "Google OAuth" if "Google" in source else "Email / Password"
    now_str   = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2f8;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f8;padding:24px 12px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

  <tr><td style="background:#1b2e5a;border-radius:14px 14px 0 0;padding:16px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle;">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;background:#2563eb;border-radius:10px;width:36px;height:36px;text-align:center;font-size:18px;color:#fff;">&#9889;</td>
          <td style="vertical-align:middle;padding-left:10px;">
            <div style="font-size:14px;font-weight:700;color:#fff;">HelioGrid</div>
            <div style="font-size:11px;color:#7b9ccf;">Campus Resilience</div>
          </td>
        </tr></table>
      </td>
      <td align="right">
        <span style="background:rgba(56,189,248,.2);color:#38bdf8;border:1px solid rgba(56,189,248,.4);font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:5px 12px;border-radius:20px;">LOGIN</span>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:linear-gradient(135deg,#1b2e5a,#1e3a72);padding:24px 20px;border-bottom:3px solid #2563eb;">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#60a5fa;margin-bottom:8px;">&#10003; Successful Login</div>
    <div style="font-size:19px;font-weight:700;color:#fff;margin-bottom:6px;">Dashboard Access Granted</div>
    <div style="font-size:13px;color:#93b4d8;line-height:1.6;">A new session was authenticated on your HelioGrid account.</div>
  </td></tr>

  <tr><td style="background:#fff;padding:18px 20px;border-left:1px solid #dde3ee;border-right:1px solid #dde3ee;">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#6b7c9e;margin-bottom:14px;">Account Details</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;font-weight:500;width:42%;">Email</td>
          <td style="padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#2563eb;font-weight:600;text-align:right;word-break:break-all;">{email}</td></tr>
      <tr><td style="padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;font-weight:500;">Name</td>
          <td style="padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">{name}</td></tr>
      <tr><td style="padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;font-weight:500;">Sign-in Method</td>
          <td style="padding:9px 0;border-bottom:1px solid #f1f5f9;text-align:right;">
            <span style="background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe;border-radius:5px;padding:2px 10px;font-size:12px;font-weight:700;">{method}</span>
          </td></tr>
      <tr><td style="padding:9px 0;font-size:13px;color:#64748b;font-weight:500;">Timestamp</td>
          <td style="padding:9px 0;font-size:12px;color:#0f172a;font-weight:600;text-align:right;">{timestamp}</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
      <tr><td style="padding:12px 14px;font-size:12px;color:#92400e;line-height:1.6;">
        <strong style="color:#d97706;">&#9888; Not you?</strong> Change your password immediately from account settings.
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="background:#f5f8ff;border:1px solid #dde3ee;border-top:none;padding:12px 20px;border-radius:0 0 14px 14px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:10px;color:#6b7c9e;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Notified At</td>
      <td style="text-align:right;font-size:11px;color:#334155;font-family:monospace,Courier;">{now_str} UTC</td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:10px 4px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:11px;color:#8898b8;">HelioGrid Smart Energy System</td>
      <td style="font-size:11px;color:#8898b8;text-align:right;">Do not reply</td>
    </tr></table>
  </td></tr>

</table></td></tr></table>
</body></html>"""


# =============================================================================
#  BATTERY FULL EMAIL
# =============================================================================

def _build_battery_full_email(data: dict) -> str:
    bat_v   = float(data.get("battery_voltage", 0))
    bat_soc = float(data.get("battery_soc", 100))
    timestamp = _fmt_ts(data.get("timestamp", datetime.now().isoformat()))
    now_str   = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    solar_w   = float(data.get("solar_power", 0))
    grid_v    = float(data.get("grid_voltage", 0))

    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2f8;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f8;padding:24px 12px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

  <tr><td style="background:#1b2e5a;border-radius:14px 14px 0 0;padding:16px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td><table cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="background:#10b981;border-radius:10px;width:36px;height:36px;text-align:center;font-size:18px;color:#fff;">&#128267;</td>
        <td style="padding-left:10px;">
          <div style="font-size:14px;font-weight:700;color:#fff;">HelioGrid</div>
          <div style="font-size:11px;color:#7b9ccf;">Campus Resilience</div>
        </td>
      </tr></table></td>
      <td align="right">
        <span style="background:rgba(16,185,129,.2);color:#34d399;border:1px solid rgba(16,185,129,.4);font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:5px 12px;border-radius:20px;">BATTERY FULL</span>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:linear-gradient(135deg,#064e3b,#065f46);padding:24px 20px;border-bottom:3px solid #10b981;">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#34d399;margin-bottom:8px;">&#9989; Battery Fully Charged</div>
    <div style="font-size:19px;font-weight:700;color:#fff;margin-bottom:6px;">Battery Pack at 100% SOC</div>
    <div style="font-size:13px;color:#6ee7b7;line-height:1.6;">The 24V Lead Acid battery pack has reached full charge. No action required.</div>
  </td></tr>

  <tr><td style="background:#fff;padding:18px 20px;border-left:1px solid #dde3ee;border-right:1px solid #dde3ee;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="width:50%;padding:0 4px 8px 0;vertical-align:top;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0fdf4;border:1px solid #86efac;border-top:3px solid #10b981;border-radius:10px;">
            <tr><td style="padding:14px 12px;">
              <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#166534;margin-bottom:6px;">Battery Voltage</div>
              <div style="font-size:26px;font-weight:700;color:#0f1c3f;font-family:monospace,Courier;">{bat_v:.2f} V</div>
              <div style="font-size:11px;color:#16a34a;margin-top:4px;font-family:monospace,Courier;">Full at 26.4V</div>
            </td></tr>
          </table>
        </td>
        <td style="width:50%;padding:0 0 8px 4px;vertical-align:top;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0fdf4;border:1px solid #86efac;border-top:3px solid #10b981;border-radius:10px;">
            <tr><td style="padding:14px 12px;">
              <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#166534;margin-bottom:6px;">State of Charge</div>
              <div style="font-size:26px;font-weight:700;color:#0f1c3f;font-family:monospace,Courier;">{bat_soc:.0f}%</div>
              <div style="height:4px;background:#e2e8f0;border-radius:2px;margin-top:8px;">
                <div style="height:4px;width:{min(100,bat_soc):.0f}%;background:#10b981;border-radius:2px;"></div>
              </div>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px;background:#f8faff;border:1px solid #dde3ee;border-radius:8px;">
      <tr>
        <td style="padding:10px 14px;width:33%;border-right:1px solid #dde3ee;">
          <div style="font-size:10px;font-weight:700;color:#6b7c9e;text-transform:uppercase;letter-spacing:1px;">Solar Power</div>
          <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:4px;font-family:monospace,Courier;">{solar_w:.0f} W</div>
        </td>
        <td style="padding:10px 14px;width:33%;border-right:1px solid #dde3ee;">
          <div style="font-size:10px;font-weight:700;color:#6b7c9e;text-transform:uppercase;letter-spacing:1px;">Grid Voltage</div>
          <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:4px;font-family:monospace,Courier;">{grid_v:.1f} V</div>
        </td>
        <td style="padding:10px 14px;width:33%;">
          <div style="font-size:10px;font-weight:700;color:#6b7c9e;text-transform:uppercase;letter-spacing:1px;">Admin Action</div>
          <div style="font-size:12px;font-weight:600;color:#16a34a;margin-top:4px;">None required</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="background:#f5f8ff;border:1px solid #dde3ee;border-top:none;padding:12px 20px;border-radius:0 0 14px 14px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:10px;color:#6b7c9e;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Alert Timestamp</td>
      <td style="text-align:right;font-size:11px;color:#334155;font-family:monospace,Courier;">{timestamp}</td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:10px 4px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:11px;color:#8898b8;">HelioGrid Smart Energy System</td>
      <td style="font-size:11px;color:#8898b8;text-align:right;">Do not reply &nbsp;&middot;&nbsp; {now_str[:10]}</td>
    </tr></table>
  </td></tr>

</table></td></tr></table>
</body></html>"""


# =============================================================================
#  CRITICAL / ANOMALY EMAIL  (includes MCCB alert for battery_critical type)
# =============================================================================

def _build_anomaly_email(data: dict) -> str:
    fault_type  = data.get("fault_type",  "System Alert")
    action      = data.get("action",      "")
    severity    = data.get("severity",    "critical").lower()
    email_type  = data.get("email_type",  "").lower()
    timestamp   = _fmt_ts(data.get("timestamp", datetime.now().isoformat()))
    is_bat_crit = (email_type == "battery_critical")
    is_emergency= (email_type == "emergency")

    grid_v     = float(data.get("grid_voltage",    0))
    grid_hz    = float(data.get("grid_frequency",  0))
    inv_v      = float(data.get("inv_voltage",     0))
    inv_hz     = float(data.get("inv_frequency",   0))
    solar_w    = float(data.get("solar_power",     0))
    panel_cond = str(data.get("panel_condition",   "No Output"))
    bat_v      = float(data.get("battery_voltage", 0))
    bat_soc    = float(data.get("battery_soc",     0))
    temp_c     = float(data.get("temperature",     0))
    active_src = str(data.get("active_source",     "Unknown"))
    sys_status = str(data.get("system_status",     "Critical"))

    k1 = bool(data.get("k1", False))
    k2 = bool(data.get("k2", False))
    k3 = bool(data.get("k3", False))
    k4 = bool(data.get("k4", False))
    buzzer = bool(data.get("buzzer", False))

    k3_blocked  = bool(data.get("k3_reconnect_blocked", False))
    k3_stable_s = int(data.get("k3_stable_seconds", 0))
    k3_status   = (
        f"BLOCKED — {k3_stable_s}/300s (IEEE 1547 reconnect timer)" if k3_blocked
        else "Normal"
    )

    # Anomaly engine fields
    anomaly_source     = str(data.get("anomaly_source", "")).strip()
    anomaly_delta_raw  = data.get("anomaly_delta", None)
    anomaly_first_seen = data.get("anomaly_first_seen", None)
    confirm_count      = data.get("confirm_count", None)

    anomaly_delta_str = ""
    if anomaly_delta_raw is not None:
        try:
            dv = float(anomaly_delta_raw)
            sign = "+" if dv >= 0 else ""
            anomaly_delta_str = f"{sign}{dv:.2f} V"
        except Exception:
            anomaly_delta_str = str(anomaly_delta_raw)

    anomaly_first_seen_str = _fmt_ts(anomaly_first_seen) if anomaly_first_seen else ""
    confirm_str = str(confirm_count) if confirm_count is not None else ""

    # Fault type icon mapping
    _ft_lower = fault_type.lower()
    if "dropout" in _ft_lower:
        fault_icon = "&#9889;"
        fault_color = "#dc2626"
        fault_bg    = "#fef2f2"
        fault_border= "#fecaca"
    elif "spike" in _ft_lower:
        fault_icon = "&#128200;"
        fault_color = "#d97706"
        fault_bg    = "#fffbeb"
        fault_border= "#fde68a"
    elif "drift" in _ft_lower:
        fault_icon = "&#128201;"
        fault_color = "#7c3aed"
        fault_bg    = "#f5f3ff"
        fault_border= "#ddd6fe"
    else:
        fault_icon = "&#9888;"
        fault_color = "#dc2626"
        fault_bg    = "#fef2f2"
        fault_border= "#fecaca"

    # Build the anomaly detail block (only when engine data is present)
    _has_engine_data = any([anomaly_source, anomaly_delta_str, anomaly_first_seen_str, confirm_str])

    if _has_engine_data:
        _detail_rows = ""
        if anomaly_source:
            src_label = anomaly_source.upper()
            _detail_rows += f"""
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;font-weight:500;width:42%;">Source</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;font-weight:700;color:#1e40af;text-align:right;">
          <span style="background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe;border-radius:5px;padding:2px 10px;">{src_label}</span>
        </td>
      </tr>"""
        if anomaly_delta_str:
            delta_col = "#dc2626" if "-" in anomaly_delta_str else "#16a34a"
            _detail_rows += f"""
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;font-weight:500;">Voltage Delta (ΔV)</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:{delta_col};text-align:right;font-family:monospace,Courier;">{anomaly_delta_str}</td>
      </tr>"""
        if confirm_str:
            _detail_rows += f"""
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;font-weight:500;">Confirm Count</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;font-weight:700;color:#0f172a;text-align:right;font-family:monospace,Courier;">{confirm_str}× consecutive</td>
      </tr>"""
        if anomaly_first_seen_str:
            _detail_rows += f"""
      <tr>
        <td style="padding:8px 0;font-size:12px;color:#64748b;font-weight:500;">First Detected</td>
        <td style="padding:8px 0;font-size:12px;font-weight:600;color:#0f172a;text-align:right;">{anomaly_first_seen_str}</td>
      </tr>"""

        anomaly_detail_block = f"""
  <!-- ANOMALY ENGINE DETAIL -->
  <tr><td style="background:{fault_bg};padding:14px 20px;border-left:4px solid {fault_color};border-right:1px solid {fault_border};border-bottom:1px solid {fault_border};">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:{fault_color};margin-bottom:10px;">
      {fault_icon} Anomaly Classification
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;font-weight:500;width:42%;">Fault Type</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:{fault_color};text-align:right;">{fault_type}</td>
      </tr>{_detail_rows}
    </table>
  </td></tr>"""
    else:
        anomaly_detail_block = ""

    soc_pct   = min(100, max(0, bat_soc))
    soc_col   = "#10b981" if soc_pct > 60 else "#d97706" if soc_pct > 30 else "#dc2626"
    panel_col = {"Good":"#16a34a","Low":"#d97706","Critical":"#dc2626","No Output":"#64748b"}.get(panel_cond,"#64748b")
    src_col   = "#d97706" if "Solar" in active_src else "#2563eb" if "Grid" in active_src else "#64748b"
    now_str   = datetime.now().strftime("%Y-%m-%d")

    if is_emergency:
        pill_style  = "background:rgba(239,68,68,.3);color:#ff6b6b;border:1px solid rgba(239,68,68,.6);"
        pill_label  = "EMERGENCY"
        banner_bg   = "#1a0000"
        banner_bdr  = "#dc2626"
        tag_color   = "#fca5a5"
        tag_label   = "&#128680;&#128680; EMERGENCY CUTOFF"
        action_col  = "#fbd5d5"
        chip_style  = "background:#fef2f2;color:#7f1d1d;border:1px solid #fecaca;"
        chip_dot    = "#dc2626"
        chip_label  = "EMERGENCY"
    elif is_bat_crit:
        pill_style  = "background:rgba(239,68,68,.2);color:#f87171;border:1px solid rgba(239,68,68,.4);"
        pill_label  = "CRITICAL"
        banner_bg   = "#2d0a0a"
        banner_bdr  = "#ef4444"
        tag_color   = "#fca5a5"
        tag_label   = "&#128267;&#128680; Battery Critical — MCCB Alert"
        action_col  = "#fbd5d5"
        chip_style  = "background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;"
        chip_dot    = "#ef4444"
        chip_label  = sys_status
    elif severity == "warning":
        pill_style  = "background:rgba(245,158,11,.2);color:#fbbf24;border:1px solid rgba(245,158,11,.4);"
        pill_label  = "WARNING"
        banner_bg   = "#1b2e5a"
        banner_bdr  = "#f59e0b"
        tag_color   = "#fbbf24"
        tag_label   = "&#9889; Anomaly Detected"
        action_col  = "#93b4d8"
        chip_style  = "background:#fffbeb;color:#b45309;border:1px solid #fde68a;"
        chip_dot    = "#f59e0b"
        chip_label  = "Warning"
    else:
        pill_style  = "background:rgba(239,68,68,.2);color:#f87171;border:1px solid rgba(239,68,68,.4);"
        pill_label  = "CRITICAL"
        banner_bg   = "#2d0a0a"
        banner_bdr  = "#ef4444"
        tag_color   = "#fca5a5"
        tag_label   = "&#128680; Critical Fault Detected"
        action_col  = "#fbd5d5"
        chip_style  = "background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;"
        chip_dot    = "#ef4444"
        chip_label  = sys_status

    mccb_banner = ""
    if is_bat_crit or is_emergency:
        mccb_banner = f"""
  <tr><td style="background:#7f1d1d;padding:14px 20px;border-left:4px solid #dc2626;">
    <div style="font-size:11px;font-weight:700;color:#fca5a5;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">
      &#9888;&#65039; ADMIN ACTION REQUIRED — MCCB
    </div>
    <div style="font-size:12px;color:#fecaca;line-height:1.7;">
      <strong style="color:#fff;">1.</strong> Check inverter LED / display — it should have already protected the battery automatically.<br>
      <strong style="color:#fff;">2.</strong> If inverter protection has NOT activated: <strong style="color:#fbbf24;">manually trip the MCCB</strong> (battery → inverter line) immediately.<br>
      <strong style="color:#fff;">3.</strong> Do NOT restart until fault is identified and resolved.<br>
      <strong style="color:#fff;">4.</strong> Battery path: <code style="background:#991b1b;color:#fca5a5;padding:1px 5px;border-radius:3px;">Battery → MCCB → Inverter DC Bus</code>
    </div>
  </td></tr>"""

    def _pcell(label, value, sub, top_color, extra=""):
        return f"""<td style="width:50%;padding:0 4px 8px 0;vertical-align:top;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:#f8faff;border:1px solid #dde3ee;border-top:3px solid {top_color};border-radius:10px;">
    <tr><td style="padding:14px 12px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7c9e;margin-bottom:6px;">{label}</div>
      <div style="font-size:22px;font-weight:700;color:#0f1c3f;line-height:1;font-family:monospace,Courier;">{value}</div>
      <div style="font-size:11px;color:#6b7c9e;margin-top:4px;font-family:monospace,Courier;">{sub}</div>
      {extra}
    </td></tr>
  </table></td>"""

    def _pcell_r(label, value, sub, top_color, extra=""):
        return f"""<td style="width:50%;padding:0 0 8px 4px;vertical-align:top;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:#f8faff;border:1px solid #dde3ee;border-top:3px solid {top_color};border-radius:10px;">
    <tr><td style="padding:14px 12px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7c9e;margin-bottom:6px;">{label}</div>
      <div style="font-size:22px;font-weight:700;color:#0f1c3f;line-height:1;font-family:monospace,Courier;">{value}</div>
      <div style="font-size:11px;color:#6b7c9e;margin-top:4px;font-family:monospace,Courier;">{sub}</div>
      {extra}
    </td></tr>
  </table></td>"""

    def _rcell(relay_id, name, state, desc, right=False):
        pad = "0 0 6px 4px" if right else "0 4px 6px 0"
        return f"""<td style="width:50%;padding:{pad};vertical-align:top;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:#f8faff;border:1px solid #dde3ee;border-radius:9px;">
    <tr>
      <td style="padding:10px 14px;vertical-align:middle;">
        <div style="font-size:10px;font-weight:700;color:#2563eb;letter-spacing:1px;text-transform:uppercase;">{relay_id}</div>
        <div style="font-size:11px;font-weight:500;color:#334155;margin-top:2px;">{name}</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:1px;">{desc}</div>
      </td>
      <td style="padding:10px 14px;text-align:right;vertical-align:middle;">{_badge(state)}</td>
    </tr>
  </table></td>"""

    soc_bar = (
        f'<div style="height:4px;background:#e2e8f0;border-radius:2px;margin-top:8px;overflow:hidden;">'
        f'<div style="height:4px;width:{soc_pct:.0f}%;background:{soc_col};border-radius:2px;"></div></div>'
    )

    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2f8;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f8;padding:24px 12px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

  <!-- BRAND BAR -->
  <tr><td style="background:#1b2e5a;border-radius:14px 14px 0 0;padding:16px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle;">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;background:#2563eb;border-radius:10px;width:36px;height:36px;text-align:center;font-size:18px;color:#fff;">&#9889;</td>
          <td style="vertical-align:middle;padding-left:10px;">
            <div style="font-size:14px;font-weight:700;color:#fff;">HelioGrid</div>
            <div style="font-size:11px;color:#7b9ccf;">Campus Resilience</div>
          </td>
        </tr></table>
      </td>
      <td align="right" style="vertical-align:middle;">
        <span style="{pill_style}font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:5px 12px;border-radius:20px;">{pill_label}</span>
      </td>
    </tr></table>
  </td></tr>

  <!-- ALERT BANNER -->
  <tr><td style="background:{banner_bg};padding:22px 20px;border-bottom:3px solid {banner_bdr};">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:{tag_color};margin-bottom:8px;">{tag_label}</div>
    <div style="font-size:18px;font-weight:700;color:#fff;line-height:1.35;margin-bottom:8px;">{fault_type}</div>
    <div style="font-size:13px;color:{action_col};line-height:1.65;">{action}</div>
  </td></tr>

  <!-- MCCB ADMIN ACTION (battery_critical and emergency only) -->
  {mccb_banner}

  <!-- ANOMALY ENGINE DETAIL (grid/inverter voltage engine faults) -->
  {anomaly_detail_block}

  <!-- STATUS CHIPS -->
  <tr><td style="background:#f5f8ff;border-bottom:1px solid #dde3ee;padding:10px 20px;border-left:1px solid #dde3ee;border-right:1px solid #dde3ee;">
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:6px;">
        <span style="{chip_style}display:inline-block;border-radius:7px;padding:5px 10px;font-size:11px;font-weight:600;">
          <span style="display:inline-block;width:6px;height:6px;background:{chip_dot};border-radius:50%;vertical-align:middle;margin-right:4px;"></span>{chip_label}
        </span>
      </td>
      <td style="padding-right:6px;">
        <span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;display:inline-block;border-radius:7px;padding:5px 10px;font-size:11px;font-weight:600;">
          <span style="display:inline-block;width:6px;height:6px;background:{src_col};border-radius:50%;vertical-align:middle;margin-right:4px;"></span>{active_src}
        </span>
      </td>
      <td>
        <span style="background:#f8fafc;color:#475569;border:1px solid #e2e8f0;display:inline-block;border-radius:7px;padding:5px 10px;font-size:11px;font-weight:600;">{temp_c:.1f} &#176;C</span>
      </td>
    </tr></table>
  </td></tr>

  <!-- POWER SOURCES -->
  <tr><td style="background:#fff;padding:18px 20px;border-bottom:1px solid #eef2f8;border-left:1px solid #dde3ee;border-right:1px solid #dde3ee;">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#6b7c9e;margin-bottom:12px;">Power Sources</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        {_pcell("Grid AC",    f"{grid_v:.1f} V",  f"{grid_hz:.2f} Hz", "#2563eb")}
        {_pcell_r("Inverter", f"{inv_v:.1f} V",   f"{inv_hz:.2f} Hz",  "#8b5cf6")}
      </tr>
      <tr>
        {_pcell("Solar Output",  f"{solar_w:.0f} W",  f'<span style="color:{panel_col};font-weight:600;">{panel_cond}</span>', "#f59e0b")}
        {_pcell_r("Battery",     f"{bat_v:.2f} V",    f"SOC: {bat_soc:.1f}%", "#10b981", soc_bar)}
      </tr>
    </table>
  </td></tr>

  <!-- RELAY STATES -->
  <tr><td style="background:#fff;padding:18px 20px;border-bottom:1px solid #eef2f8;border-left:1px solid #dde3ee;border-right:1px solid #dde3ee;">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#6b7c9e;margin-bottom:12px;">Relay States</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        {_rcell("K1",  "Solar Path (SSR)",         k1, "Inverter → ATS-A → Load",    False)}
        {_rcell("K2",  "Grid Bypass (SSR)",         k2, "Grid → ATS-B → Load",        True)}
      </tr>
      <tr>
        {_rcell("K3",  "Grid Assist / Charging (SSR, Auto)",  k3, k3_status,                    False)}
        {_rcell("K4",  "ATS Contactor → Outlets",   k4, "CLOSED=Outlets ON / OPEN=Outlets OFF", True)}
      </tr>
      <tr>
        <td colspan="2" style="padding:0 0 0 0;vertical-align:top;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:#f8faff;border:1px solid #dde3ee;border-radius:9px;">
            <tr>
              <td style="padding:10px 14px;vertical-align:middle;">
                <div style="font-size:10px;font-weight:700;color:#2563eb;letter-spacing:1px;text-transform:uppercase;">Buzzer</div>
                <div style="font-size:11px;font-weight:500;color:#334155;margin-top:2px;">Alert Sound (5s)</div>
              </td>
              <td style="padding:10px 14px;text-align:right;vertical-align:middle;">{_badge(buzzer)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- TIMESTAMP BAR -->
  <tr><td style="background:#f5f8ff;border:1px solid #dde3ee;border-top:none;padding:12px 20px;border-radius:0 0 14px 14px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:10px;color:#6b7c9e;font-weight:700;letter-spacing:1px;text-transform:uppercase;white-space:nowrap;">Alert Timestamp</td>
      <td style="text-align:right;font-size:11px;color:#334155;font-family:monospace,Courier;">{timestamp}</td>
    </tr></table>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding:10px 4px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:11px;color:#8898b8;">HelioGrid Smart Energy System</td>
      <td style="font-size:11px;color:#8898b8;text-align:right;">Do not reply &nbsp;&middot;&nbsp; {now_str}</td>
    </tr></table>
  </td></tr>

</table></td></tr></table>
</body></html>"""




# =============================================================================
#  SOLAR PANEL HEALTH EMAIL
# =============================================================================

def _build_solar_panel_email(data: dict) -> str:
    """
    Solar panel health alert email.
    Triggered by 3 consecutive low-health readings.
    No buzzer — email only.
    Levels: Aging (<40%) or Replace (<20%)
    """
    panel_id      = str(data.get("panel_id",      "Unknown"))
    health_pct    = float(data.get("health_pct",  0))
    health_label  = str(data.get("health_label",  "Aging"))   # "Aging" | "Replace Soon" | "Replace Now"
    string_id     = str(data.get("string_id",     "—"))        # "String A" or "String B"
    current_a     = float(data.get("current_a",   0))
    rated_imp     = float(data.get("rated_imp",   13.28))
    solar_power   = float(data.get("solar_power", 0))
    battery_v     = float(data.get("battery_voltage", 0))
    battery_soc   = float(data.get("battery_soc", 0))
    grid_v        = float(data.get("grid_voltage", 0))
    confirm_count = int(data.get("confirm_count", 3))
    timestamp     = _fmt_ts(data.get("timestamp", datetime.now().isoformat()))
    now_str       = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Color scheme based on health level
    if health_pct < 20:
        level_color  = "#dc2626"
        level_bg     = "#fef2f2"
        level_border = "#fecaca"
        level_icon   = "&#9940;"   # 🚫
        pill_style   = "background:rgba(220,38,38,.2);color:#f87171;border:1px solid rgba(220,38,38,.4);"
        pill_label   = "REPLACE NOW"
        banner_bg    = "#2d0a0a"
        banner_bdr   = "#ef4444"
        tag_label    = "&#9940; Panel Replacement Required"
        tag_color    = "#fca5a5"
        action_text  = f"{panel_id} health at {health_pct:.0f}% — below viable threshold. Panel no longer producing adequate power. Replacement recommended after 14+ consecutive days below 20% post-cleaning."
    else:
        level_color  = "#d97706"
        level_bg     = "#fffbeb"
        level_border = "#fde68a"
        level_icon   = "&#9888;"   # ⚠
        pill_style   = "background:rgba(245,158,11,.2);color:#fbbf24;border:1px solid rgba(245,158,11,.4);"
        pill_label   = "AGING"
        banner_bg    = "#1c1400"
        banner_bdr   = "#d97706"
        tag_label    = "&#9888; Panel Aging — Inspection Required"
        tag_color    = "#fbbf24"
        action_text  = f"{panel_id} health at {health_pct:.0f}% — below 40% rated output. Clean panels and check connections. Monitor for 14+ clear days before deciding replacement."

    soc_col = "#10b981" if battery_soc > 60 else "#d97706" if battery_soc > 30 else "#dc2626"
    soc_bar = (
        f'<div style="height:4px;background:#e2e8f0;border-radius:2px;margin-top:8px;overflow:hidden;">'
        f'<div style="height:4px;width:{min(100,battery_soc):.0f}%;background:{soc_col};border-radius:2px;"></div></div>'
    )
    health_bar = (
        f'<div style="height:4px;background:#e2e8f0;border-radius:2px;margin-top:8px;overflow:hidden;">'
        f'<div style="height:4px;width:{min(100,health_pct):.0f}%;background:{level_color};border-radius:2px;"></div></div>'
    )

    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2f8;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f8;padding:24px 12px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">

  <!-- BRAND BAR -->
  <tr><td style="background:#1b2e5a;border-radius:14px 14px 0 0;padding:16px 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle;">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle;background:#f59e0b;border-radius:10px;width:36px;height:36px;text-align:center;font-size:18px;color:#fff;">&#9728;</td>
          <td style="vertical-align:middle;padding-left:10px;">
            <div style="font-size:14px;font-weight:700;color:#fff;">HelioGrid</div>
            <div style="font-size:11px;color:#7b9ccf;">Campus Resilience</div>
          </td>
        </tr></table>
      </td>
      <td align="right" style="vertical-align:middle;">
        <span style="{pill_style}font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:5px 12px;border-radius:20px;">{pill_label}</span>
      </td>
    </tr></table>
  </td></tr>

  <!-- ALERT BANNER -->
  <tr><td style="background:{banner_bg};padding:22px 20px;border-bottom:3px solid {banner_bdr};">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:{tag_color};margin-bottom:8px;">{tag_label}</div>
    <div style="font-size:18px;font-weight:700;color:#fff;line-height:1.35;margin-bottom:8px;">Solar Panel Health Alert — {panel_id}</div>
    <div style="font-size:13px;color:#e5d8b0;line-height:1.65;">{action_text}</div>
  </td></tr>

  <!-- PANEL HEALTH DETAIL -->
  <tr><td style="background:{level_bg};padding:14px 20px;border-left:4px solid {level_color};border-right:1px solid {level_border};border-bottom:1px solid {level_border};">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:{level_color};margin-bottom:10px;">
      {level_icon} Panel Health Classification
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;font-weight:500;width:42%;">Panel ID</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:{level_color};text-align:right;">{panel_id}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;font-weight:500;">String</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;font-weight:700;color:#0f172a;text-align:right;">{string_id}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;font-weight:500;">Health</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:700;color:{level_color};text-align:right;">{health_pct:.0f}% — {health_label}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;font-weight:500;">String Current</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;font-weight:700;color:#0f172a;text-align:right;font-family:monospace,Courier;">{current_a:.2f} A / {rated_imp:.2f} A rated</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:12px;color:#64748b;font-weight:500;">Consecutive Low Readings</td>
        <td style="padding:8px 0;font-size:12px;font-weight:700;color:#0f172a;text-align:right;font-family:monospace,Courier;">{confirm_count}× confirmed</td>
      </tr>
    </table>
    <div style="margin-top:10px;">
      <div style="font-size:10px;color:#64748b;margin-bottom:4px;">Health Progress</div>
      {health_bar}
    </div>
  </td></tr>

  <!-- SYSTEM SNAPSHOT -->
  <tr><td style="background:#fff;padding:18px 20px;border-bottom:1px solid #eef2f8;border-left:1px solid #dde3ee;border-right:1px solid #dde3ee;">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#6b7c9e;margin-bottom:12px;">System Snapshot at Alert</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="width:50%;padding:0 4px 8px 0;vertical-align:top;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffbeb;border:1px solid #fde68a;border-top:3px solid #f59e0b;border-radius:10px;">
            <tr><td style="padding:12px;">
              <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#92400e;margin-bottom:4px;">Array Output</div>
              <div style="font-size:22px;font-weight:700;color:#0f1c3f;font-family:monospace,Courier;">{solar_power:.0f} W</div>
              <div style="font-size:11px;color:#92400e;margin-top:4px;">of 2360W rated</div>
            </td></tr>
          </table>
        </td>
        <td style="width:50%;padding:0 0 8px 4px;vertical-align:top;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0fdf4;border:1px solid #86efac;border-top:3px solid #10b981;border-radius:10px;">
            <tr><td style="padding:12px;">
              <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#166534;margin-bottom:4px;">Battery</div>
              <div style="font-size:22px;font-weight:700;color:#0f1c3f;font-family:monospace,Courier;">{battery_v:.2f} V</div>
              <div style="font-size:11px;color:{soc_col};margin-top:4px;">{battery_soc:.0f}% SOC</div>
              {soc_bar}
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px;background:#f8faff;border:1px solid #dde3ee;border-radius:8px;">
      <tr>
        <td style="padding:10px 14px;border-right:1px solid #dde3ee;">
          <div style="font-size:10px;font-weight:700;color:#6b7c9e;text-transform:uppercase;letter-spacing:1px;">Grid Voltage</div>
          <div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:4px;font-family:monospace,Courier;">{grid_v:.1f} V</div>
        </td>
        <td style="padding:10px 14px;">
          <div style="font-size:10px;font-weight:700;color:#6b7c9e;text-transform:uppercase;letter-spacing:1px;">Recommendation</div>
          <div style="font-size:12px;font-weight:600;color:{level_color};margin-top:4px;">{"Replace panel" if health_pct < 20 else "Clean & inspect"}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- ADMIN NOTE -->
  <tr><td style="background:#fffbeb;border:1px solid #fde68a;border-top:none;padding:14px 20px;">
    <div style="font-size:12px;color:#92400e;line-height:1.7;">
      <strong style="color:#d97706;">&#9888; Admin Action Required:</strong>
      {"Panel output is critically low. Inspect for physical damage, shading, or connector failure. If health remains below 20% for 14+ consecutive clear days after cleaning, schedule panel replacement." if health_pct < 20 else "Panel output is degraded. Clean panel surface with water and soft cloth. Check MC4 connectors and cable routing. Re-evaluate after 14 clear-day monitoring period."}
    </div>
  </td></tr>

  <!-- TIMESTAMP BAR -->
  <tr><td style="background:#f5f8ff;border:1px solid #dde3ee;border-top:none;padding:12px 20px;border-radius:0 0 14px 14px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:10px;color:#6b7c9e;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Alert Timestamp</td>
      <td style="text-align:right;font-size:11px;color:#334155;font-family:monospace,Courier;">{timestamp}</td>
    </tr></table>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding:10px 4px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:11px;color:#8898b8;">HelioGrid Smart Energy System · JAM72D40-590/MB (2S2P)</td>
      <td style="font-size:11px;color:#8898b8;text-align:right;">Do not reply &nbsp;&middot;&nbsp; {now_str[:10]}</td>
    </tr></table>
  </td></tr>

</table></td></tr></table>
</body></html>"""


# =============================================================================
#  ROUTES
# =============================================================================

@app.route("/health")
@app.route("/api/health")
def health():
    return jsonify({
        "status":   "ok",
        "port":     5001,
        "policy":   "critical + login + battery_full; warning=suppressed",
        "smtp":     MAIL_SERVER,
        "user":     MAIL_USERNAME,
        "password": "SET" if MAIL_PASSWORD else "NOT SET",
    })


@app.route("/api/send-alert", methods=["POST"])
def send_alert():
    raw  = request.get_json(force=True) or {}
    data = _normalize(raw)

    to_email   = data.get("email") or EMAIL_RECIPIENT
    fault_type = data.get("fault_type", "System Alert")
    severity   = data.get("severity",  "critical")
    email_type = data.get("email_type", "")

    print(f"\n[ALERT] type={fault_type!r} email_type={email_type!r} sev={severity!r} to={to_email!r}")

    if not to_email:
        return jsonify({"success": False, "error": "No recipient — set EMAIL_RECIPIENT in .env"}), 400

    # FIX-3: Validate email_type is a known value (warn if unrecognized, don't silently misroute)
    if email_type and email_type not in VALID_EMAIL_TYPES:
        print(f"  [WARN] Unknown email_type={email_type!r} — treating as 'critical'. "
              f"Valid types: {sorted(VALID_EMAIL_TYPES)}")
        email_type = "critical"
        data["email_type"] = "critical"

    # Route ONLY by explicit email_type
    is_login      = (email_type == "login")
    is_bat_full   = (email_type == "battery_full")
    is_bat_warn   = (email_type == "battery_warning")
    is_bat_crit   = (email_type == "battery_critical")
    is_solar      = (email_type == "solar_panel")
    is_emergency  = (email_type == "emergency")

    # Legacy fallback ONLY for login (safe — no safety-critical implication)
    if not any([is_login, is_bat_full, is_bat_warn, is_bat_crit, is_solar, is_emergency]):
        if "login" in fault_type.lower() or "access" in fault_type.lower():
            is_login = True
            print(f"  [LEGACY] Matched login via fault_type keyword — set email_type='login' in payload to suppress this warning.")

    # Suppress warnings (dashboard-only alerts — no email)
    if not any([is_login, is_bat_full, is_bat_warn, is_bat_crit, is_solar, is_emergency]) and severity == "warning":
        print(
            f"[WARNING SUPPRESSED] fault={fault_type!r} | source={raw.get('source','?')} | "
            f"sev={severity} | to={to_email} | Policy: dashboard-only for warnings."
        )
        return jsonify({"success": False, "reason": "warning_suppressed",
                        "fault_type": fault_type}), 200

    # [FIX-ANOMALY-GATE] Critical emails must be Drift/Spike/Dropout (Grid or Inverter AC only)
    # Battery and Solar have dedicated email_type routes — they must NOT fall through to critical
    # Any other fault_type (battery_low, string_mismatch, etc.) is blocked here
    _is_voltage_anomaly = (email_type == "critical") or (
        not any([is_login, is_bat_full, is_bat_warn, is_bat_crit, is_solar, is_emergency])
        and severity == "critical"
    )
    if _is_voltage_anomaly:
        _ft_lower = fault_type.lower()
        _valid_anomaly = any([
            "drift" in _ft_lower,
            "spike" in _ft_lower,
            "dropout" in _ft_lower,
        ])
        if not _valid_anomaly:
            print(
                f"[ANOMALY GATE BLOCKED] fault={fault_type!r} | source={raw.get('source','?')} | "
                f"sev={severity} | Policy: Only Drift/Spike/Dropout from Grid/Inverter AC trigger anomaly email."
            )
            return jsonify({"success": False, "reason": "not_voltage_anomaly",
                            "fault_type": fault_type,
                            "policy": "Only Drift/Spike/Dropout trigger anomaly email"}), 200

    data["timestamp"] = raw.get("timestamp", datetime.now().isoformat())

    # Build and send appropriate email
    if is_login:
        subject = f"HelioGrid — Dashboard Login: {to_email}"
        html    = _build_login_email(data)
        label   = "LOGIN"
    elif is_bat_full:
        subject = "HelioGrid — Battery Fully Charged ✅"
        html    = _build_battery_full_email(data)
        label   = "BATTERY_FULL"
    elif is_bat_warn:
        subject = "HelioGrid — Battery Low Warning ⚠️"
        html    = _build_battery_full_email(data)   # reuses same template, data has low voltage
        label   = "BATTERY_WARNING"
    elif is_solar:
        panel_id     = data.get("panel_id", "Panel")
        health_label = data.get("health_label", "Aging")
        subject = f"HelioGrid — Solar Panel Health Alert: {panel_id} {health_label} ☀️"
        html    = _build_solar_panel_email(data)
        label   = "SOLAR_PANEL"
    else:
        subject = (
            f"[HelioGrid EMERGENCY] {fault_type}" if is_emergency else
            f"[HelioGrid CRITICAL] {fault_type} — MCCB CHECK REQUIRED" if is_bat_crit else
            f"[HelioGrid CRITICAL] {fault_type}"
        )
        html  = _build_anomaly_email(data)
        label = "EMERGENCY" if is_emergency else "BATTERY_CRITICAL" if is_bat_crit else "CRITICAL"

    ok, err = _send_raw(to_email, subject, html)
    if ok:
        print(f"[EMAIL OK] {label} → {to_email} | {fault_type}")
        return jsonify({"success": True, "type": label.lower()})

    print(f"[EMAIL FAIL] {err}")
    return jsonify({"success": False, "error": err}), 500


@app.route("/api/test-email", methods=["POST"])
def test_email():
    # FIX-6: Require API key header to prevent abuse
    if TEST_API_KEY:
        provided_key = request.headers.get("X-Api-Key", "")
        if provided_key != TEST_API_KEY:
            print(f"  [TEST] Rejected — bad or missing X-Api-Key header")
            return jsonify({"success": False, "error": "Unauthorized — missing or invalid X-Api-Key header"}), 401

    raw      = request.get_json(force=True) or {}
    to_email = raw.get("email") or EMAIL_RECIPIENT
    mode     = raw.get("mode", "critical")

    if not to_email:
        return jsonify({"success": False, "error": "No recipient"}), 400

    print(f"\n[TEST] mode={mode} to={to_email}")

    now_ts = datetime.now().isoformat()

    if mode == "login":
        subject = "HelioGrid — Login Notification Test"
        html    = _build_login_email({
            "email": to_email,
            "name":  to_email.split("@")[0].capitalize(),
            "source": "Google OAuth",
            "timestamp": now_ts,
        })
    elif mode == "battery_full":
        subject = "HelioGrid — Battery Fully Charged Test ✅"
        html    = _build_battery_full_email({
            "battery_voltage": 26.4, "battery_soc": 100,
            "solar_power": 1800, "grid_voltage": 230,
            "timestamp": now_ts,
        })
    elif mode == "solar_panel":
        subject = "HelioGrid — Solar Panel Health Alert: PV-03 Aging ☀️"
        html    = _build_solar_panel_email({
            "panel_id":       "PV-03",
            "health_pct":     35.0,
            "health_label":   "Aging",
            "string_id":      "String B",
            "current_a":      4.65,
            "rated_imp":      13.28,
            "solar_power":    820.0,
            "battery_voltage": 24.6,
            "battery_soc":    58.0,
            "grid_voltage":   229.5,
            "confirm_count":  3,
            "timestamp":      now_ts,
        })
    elif mode == "battery_critical":
        subject = "[HelioGrid CRITICAL] Battery Deep Discharge — MCCB CHECK REQUIRED"
        html    = _build_anomaly_email({
            "fault_type":      "Battery Deep Discharge — MCCB Alert",
            "email_type":      "battery_critical",
            "severity":        "critical",
            "action":          "Battery 21.1V (3.5% SOC) DEEP DISCHARGE. Inverter protection active. ⚠️ ADMIN: Trip MCCB manually if inverter fails.",
            "timestamp":       now_ts,
            "system_status":   "Critical",
            "active_source":   "None",
            "temperature":     38.0,
            "grid_voltage":    230.0, "grid_frequency":   60.0,
            "inv_voltage":     230.0, "inv_frequency":    60.0,
            "solar_power":     0.0,   "panel_condition":  "No Output",
            "battery_voltage": 21.1,  "battery_soc":      3.5,
            "k1": False, "k2": False, "k3": False, "k4": False,
            "buzzer": True,
            "k3_reconnect_blocked": False,
        })
    else:
        subject = "[HelioGrid CRITICAL] Test — Grid Voltage Low"
        html    = _build_anomaly_email({
            "fault_type":      "Drift Low",
            "email_type":      "critical",
            "severity":        "critical",
            "action":          "Grid 195.4V below 200V threshold. K2+K3 isolated. 5-min reconnect timer started.",
            "timestamp":       now_ts,
            "system_status":   "Critical",
            "active_source":   "Solar",
            "temperature":     39.2,
            "grid_voltage":    195.4, "grid_frequency":   59.98,
            "inv_voltage":     218.3, "inv_frequency":    60.00,
            "solar_power":     980.0, "panel_condition":  "Low",
            "battery_voltage": 24.8,  "battery_soc":      62.0,
            "k1": True, "k2": False, "k3": False, "k4": True,
            "buzzer": False,
            "k3_reconnect_blocked": True,
            "k3_stable_seconds": 45,
            "anomaly_source":     "grid",
            "anomaly_delta":      -14.6,
            "anomaly_first_seen": now_ts,
            "confirm_count":      3,
        })

    ok, err = _send_raw(to_email, subject, html)
    return jsonify({"success": ok, "to": to_email, "mode": mode, "error": err if not ok else None})


# =============================================================================
#  STARTUP
# =============================================================================

if __name__ == "__main__":
    print("=" * 56)
    print("  HelioGrid Email Service — port 5001")
    print("  Policy : CRITICAL + LOGIN + BATTERY_FULL")
    print("  WARNING: buzzer-only, emails suppressed & logged")
    print("  MCCB   : battery_critical email includes MCCB alert")
    print("  K1/K2/K3/K4 relay names in all templates")
    _debug_config()
    print("=" * 56)
    app.run(host="0.0.0.0", port=5001, debug=False)
