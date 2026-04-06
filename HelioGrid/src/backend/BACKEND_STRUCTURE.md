# HelioGrid Backend Structure

Quick map para mas madali mag-debug ng backend.

## Entry points

- `main.py` – backend bootstrap / runner-level logic.
- `api/flask_unified_complete.py` – primary Flask API app with routes and orchestration.
- `rpi_data_sender.py` – sender/bridge utility for Raspberry Pi data flow.

## Main modules

- `api/`
  - Core API routes and control logic (SSR, anomaly, buzzer, sensor exposure).
- `sensors/`
  - Sensor readers/integrations (`Grid.py`, `Inverter.py`, `ina.py`, `Rtc.py`, etc.).
- `anomaly/`
  - Anomaly detection engine and related logic.
- `config/`
  - Backend settings and sensor YAML config.
- `email/`
  - Email alert delivery service integration.
- `buzzer/`
  - Buzzer control layer.
- `arduino/`
  - Arduino firmware sketch used by hardware controller.

## Recommended debug flow

1. **API route error** → start at `api/flask_unified_complete.py` route handlers.
2. **Wrong sensor values** → trace through files in `sensors/`.
3. **Anomaly/alert mismatch** → inspect `anomaly/anomaly_engine.py` + `api/anomaly_engine.py`.
4. **Notification/email issue** → inspect `email/email_service_app.py`.
5. **Device/actuator issue** → inspect `buzzer/` and `arduino/` integration points.

## Cleanup done

- Removed generated Python artifacts (`__pycache__`, `*.pyc`) and stale backup files (`*.bak`) from tracked backend tree.
- Removed runtime Flask session files from tracked tree and ignored them via `.gitignore`.
