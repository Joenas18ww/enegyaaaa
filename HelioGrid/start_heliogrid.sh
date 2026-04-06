#!/bin/bash

# Config Paths (single-command friendly: works from any current directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="${BASE_DIR:-$SCRIPT_DIR}"
API_DIR="$BASE_DIR/src/backend/api"
SENSORS_DIR="$BASE_DIR/src/backend/sensors"
ANOMALY_DIR="$BASE_DIR/src/backend/anomaly"
BUZZER_DIR="$BASE_DIR/src/backend/buzzer"
EMAIL_DIR="$BASE_DIR/src/backend/email"
NGROK_DOMAIN="nonprotecting-abstersive-thaddeus.ngrok-free.dev"
MYSQL_HOST="${MYSQL_HOST:-localhost}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
MYSQL_DATABASE="${MYSQL_DATABASE:-smart_energy_db}"

echo "======================================"
echo "🚀 Starting HelioGrid System..."
echo "📁 BASE_DIR: $BASE_DIR"
echo "======================================"

# 1. Kill existing processes
echo "🧹 Cleaning up old processes..."
pkill -9 -f "flask_unified|email_service|vite|ngrok" 2>/dev/null
for PORT in 5000 5001 3000; do
    kill -9 $(lsof -ti tcp:$PORT 2>/dev/null) 2>/dev/null
done
sleep 2

# 2. Fix missing DB columns (safe — IF NOT EXISTS)
echo "🗄️  Checking DB columns..."
MYSQL_PWD="$MYSQL_PASSWORD" mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" "$MYSQL_DATABASE" -e "
ALTER TABLE sensor_logs
  ADD COLUMN IF NOT EXISTS ssr1_state           TINYINT(1)   NULL,
  ADD COLUMN IF NOT EXISTS ssr2_state           TINYINT(1)   NULL,
  ADD COLUMN IF NOT EXISTS ssr3_state           TINYINT(1)   NULL,
  ADD COLUMN IF NOT EXISTS ssr4_state           TINYINT(1)   NULL,
  ADD COLUMN IF NOT EXISTS grid_energy          FLOAT        DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grid_power_factor    FLOAT        DEFAULT 0,
  ADD COLUMN IF NOT EXISTS system_efficiency    FLOAT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS solar_efficiency     FLOAT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS battery_pack_soc     FLOAT        DEFAULT 0,
  ADD COLUMN IF NOT EXISTS battery_charge_a     FLOAT        DEFAULT 0,
  ADD COLUMN IF NOT EXISTS battery_discharge_a  FLOAT        DEFAULT 0;
ALTER TABLE anomaly_logs
  ADD COLUMN IF NOT EXISTS inverter_voltage DECIMAL(7,2) NULL;
" 2>/dev/null && echo "   ✅ DB columns OK" || echo "   ⚠️  DB column check failed (non-fatal — check MYSQL_* env vars)"

# 3. Copy anomaly_engine + buzzer_controller to api/
echo "📦 Syncing modules to api/..."
cp -u "$ANOMALY_DIR/anomaly_engine.py"    "$API_DIR/" 2>/dev/null && echo "   ✅ anomaly_engine.py OK"    || echo "   ⚠️  anomaly_engine.py not found"
cp -u "$BUZZER_DIR/buzzer_controller.py"  "$API_DIR/" 2>/dev/null && echo "   ✅ buzzer_controller.py OK" || echo "   ⚠️  buzzer_controller.py not found"

# 4. Start Flask
echo "⚡ Starting Flask (port 5000)..."
cd "$API_DIR"
PYTHONPATH="$SENSORS_DIR:$ANOMALY_DIR:$BUZZER_DIR" python3 flask_unified_complete.py > /tmp/flask.log 2>&1 &

# Health check
for i in $(seq 1 15); do
  sleep 1
  if curl -s http://localhost:5000/api/system/health > /dev/null 2>&1; then
    echo "   ✅ Flask is ready! (${i}s)"
    break
  fi
  [ $i -eq 15 ] && echo "   ⚠️  Flask slow to start — check: tail -f /tmp/flask.log"
done

# 5. Start Email Service
echo "📧 Starting Email Service (port 5001)..."
cd "$EMAIL_DIR"
python3 email_service_app.py > /tmp/email.log 2>&1 &
sleep 2

# 6. Start Vite dev server (single instance)
echo "🌐 Starting Vite dev server (port 3000)..."
cd "$BASE_DIR"
VITE_NGROK=true npm run dev -- --host 0.0.0.0 > /tmp/vite.log 2>&1 &
sleep 3

# 7. Start ngrok
echo "🔗 Starting ngrok tunnel..."
ngrok http 3000 --url="$NGROK_DOMAIN" > /tmp/ngrok.log 2>&1 &
sleep 3

echo ""
echo "======================================"
echo "✅ HelioGrid is running!"
echo ""
echo "🏠 Local:    http://raspberrypi.local:3000"
echo "🗄️  Database: http://raspberrypi.local/phpmyadmin"
echo "🌐 Remote:   https://$NGROK_DOMAIN"
echo ""
echo "📋 Logs:"
echo "   Flask : tail -f /tmp/flask.log"
echo "   Email : tail -f /tmp/email.log"
echo "   Vite  : tail -f /tmp/vite.log"
echo "   ngrok : tail -f /tmp/ngrok.log"
echo "======================================"
