#!/bin/bash
echo "======================================"
echo "🚀 Starting HelioGrid System..."
echo "======================================"

# Config Paths
BASE_DIR="/home/r-pi/HILEOGRID/HelioGrid"
API_DIR="$BASE_DIR/src/backend/api"
SENSORS_DIR="$BASE_DIR/src/backend/sensors"
EMAIL_DIR="$BASE_DIR/src/backend/email"
NGROK_DOMAIN="nonprotecting-abstersive-thaddeus.ngrok-free.dev"

# 1. Kill existing processes para malinis ang ports
echo "🧹 Cleaning up old processes..."
pkill -9 -f "flask_unified|email_service|vite|ngrok" 2>/dev/null
for PORT in 5000 5001 3000; do 
    kill -9 $(lsof -ti tcp:$PORT 2>/dev/null) 2>/dev/null
done
sleep 2

# 2. Start Flask (kasama ang PYTHONPATH para sa sensors)
echo "⚡ Starting Flask (port 5000)..."
cd "$API_DIR"
echo ""
echo "======================================"
echo "✅ HelioGrid is running!"
echo ""
echo "🏠 Local:    http://raspberrypi.local:3000"
echo "🗄️  Database: http://raspberrypi.local/phpmyadmin"
echo "🌐 Remote:   https://$NGROK_DOMAIN"
echo ""
echo "📋 Logs Command:"
echo "   View Flask : tail -f /tmp/flask.log"
echo "   View Email : tail -f /tmp/email.log"
echo "   View Vite  : tail -f /tmp/vite.log"
echo "======================================"

PYTHONPATH="$SENSORS_DIR" python3 flask_unified_complete.py > /tmp/flask.log 2>&1 &

# Health check para sa Flask
for i in $(seq 1 10); do
  sleep 1
  if curl -s http://localhost:5000/api/system/health > /dev/null 2>&1; then
    echo "   ✅ Flask is ready!"
    break
  fi
  [ $i -eq 10 ] && echo "   ⚠️ Flask is taking too long, check /tmp/flask.log"
done

# 3. Start Email Service
echo "📧 Starting Email Service (port 5001)..."
cd "$EMAIL_DIR"
python3 email_service_app.py > /tmp/email.log 2>&1 &
sleep 2

# 4. Start Vite (Frontend)
echo "🌐 Starting Vite (port 3000)..."
cd "$BASE_DIR"
VITE_NGROK=true npm run dev -- --host 0.0.0.0 > /tmp/vite.log 2>&1 &

# 5. Start ngrok
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
echo "📋 Logs Command:"
echo "   View Flask : tail -f /tmp/flask.log"
echo "   View Email : tail -f /tmp/email.log"
echo "   View Vite  : tail -f /tmp/vite.log"
echo "======================================"
