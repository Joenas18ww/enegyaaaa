"""
Main Entry Point
Hybrid Smart Energy System - Raspberry Pi 4 Backend
"""

import sys
import signal
import time
import os
from threading import Thread
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(Path(__file__).parent.parent.parent, '.env'))
    print("✅ .env file loaded")
except ImportError:
    print("⚠️  python-dotenv not installed")

sys.path.insert(0, str(Path(__file__).parent))

try:
    from api.flask_unified_complete import app as flask_app
    print("✅ flask_server.py found")
except ImportError as e:
    print(f"⚠️  flask_server not found: {e}")
    flask_app = None


class EnergySystemBackend:
    def __init__(self):
        self.running = False
        self.services = []
        print("=" * 60)
        print("  HYBRID SMART ENERGY SYSTEM - BACKEND")
        print("  Raspberry Pi 4 - Campus Resilience Monitoring")
        print("=" * 60)
        self.check_database()

    def check_database(self):
        print("🔍 Checking database connection...")
        try:
            import mysql.connector
            conn = mysql.connector.connect(
                host=os.getenv("MYSQL_HOST", "localhost"),
                port=int(os.getenv("MYSQL_PORT", "3306")),
                user=os.getenv("MYSQL_USER", "root"),
                password=os.getenv("MYSQL_PASSWORD", ""),
                database=os.getenv("MYSQL_DATABASE", "smart_energy_db")
            )
            conn.close()
            print("✅ Database Connection: SUCCESS")
        except Exception as e:
            print(f"❌ Database Connection FAILED: {e}")
            sys.exit(1)

    def start_services(self):
        print("\n[STARTUP] Initializing services...")
        print("[SERVICE] ✓ Background services initialized (mock mode)")

    def start_api_server(self):
        print("\n[API] Starting API server...")
        if flask_app:
            try:
                print("[API] 🌐 Flask server starting on http://0.0.0.0:5000")
                print("[API] 🔗 Frontend URL: http://localhost:5000/api")
                flask_app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)
            except Exception as e:
                print(f"[API] ❌ Error: {e}")
                sys.exit(1)
        else:
            print("[API] ❌ flask_server.py not found in api/ folder")

    def shutdown(self, signum=None, frame=None):
        print("\n[SHUTDOWN] Stopping all services...")
        self.running = False
        print("[SHUTDOWN] ✅ Backend stopped gracefully")
        sys.exit(0)

    def run(self):
        signal.signal(signal.SIGINT, self.shutdown)
        signal.signal(signal.SIGTERM, self.shutdown)
        self.running = True
        self.start_services()
        print("\n[SYSTEM] ✅ Backend fully operational")
        print("[SYSTEM] ⌨️  Press Ctrl+C to stop")
        print("\n" + "=" * 60 + "\n")
        self.start_api_server()


def main():
    if sys.version_info < (3, 7):
        print("❌ Python 3.7+ required")
        sys.exit(1)

    missing = []
    for pkg, imp in [("flask","flask"),("flask_cors","flask_cors"),
                     ("python-dotenv","dotenv"),("mysql-connector-python","mysql.connector")]:
        try:
            __import__(imp)
        except ImportError:
            missing.append(pkg)

    if missing:
        print("❌ Missing packages:", missing)
        print("🔧 pip install " + " ".join(missing))
        sys.exit(1)

    backend = EnergySystemBackend()
    backend.run()


if __name__ == "__main__":
    main()
