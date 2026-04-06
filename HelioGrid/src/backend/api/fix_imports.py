import sys
import os

# Get correct paths
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(CURRENT_DIR)
SENSORS_DIR = os.path.join(BACKEND_DIR, 'sensors')
CONFIG_DIR = os.path.join(BACKEND_DIR, 'config')

print(f"Current dir: {CURRENT_DIR}")
print(f"Backend dir: {BACKEND_DIR}")
print(f"Sensors dir: {SENSORS_DIR}")
print(f"Config dir: {CONFIG_DIR}")

# Add to path
sys.path.insert(0, SENSORS_DIR)
sys.path.insert(0, CONFIG_DIR)

# Test imports
try:
    from Grid import PZEM004TReader
    print("✅ Grid imported")
    
    from Inverter import InverterPZEMReader
    print("✅ Inverter imported")
    
    from Battery import PZEM017BatteryReader
    print("✅ Battery imported")
    
    # Test PZEM connection
    grid_pzem = PZEM004TReader(port='/dev/ttyUSB0', slave_addr=0x01)
    if grid_pzem.serial_connection:
        print("✅ PZEM connected!")
        data = grid_pzem.read_all()
        print(f"📊 Voltage: {data.get('voltage')}V")
        print(f"📊 Frequency: {data.get('frequency')}Hz")
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
