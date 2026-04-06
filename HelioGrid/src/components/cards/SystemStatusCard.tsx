import { Activity, AlertCircle, CheckCircle, WifiOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { useEnergySystem } from '../../contexts/EnergySystemContext';
import { useState, useEffect, useRef } from 'react';

export function SystemStatusCard() {
  const { systemTemp, systemCondition, anomalyLevel } = useEnergySystem();

  const [networkLatency, setNetworkLatency]   = useState<number | null>(null);
  const [networkStatus,  setNetworkStatus]    = useState<'online' | 'offline' | 'checking'>('checking');
  const [internetStatus, setInternetStatus]   = useState<'online' | 'offline' | 'checking'>('checking');
  const [uptime,         setUptime]           = useState(0);
  const [downtime,       setDowntime]         = useState(0);
  const [anomalyCounts,  setAnomalyCounts]    = useState({ normal: 0, warning: 0, critical: 0, total: 0, dropout: 0, spike: 0, drift: 0 });
  const [sensorStatus,   setSensorStatus]    = useState<{
    pzem_grid: boolean; pzem_inverter: boolean; pzem017_b1: boolean;
    pzem017_b2: boolean; dht: boolean; rtc: boolean; rtcTime: string | null;
    arduino: boolean;
  }>({
    pzem_grid: false, pzem_inverter: false, pzem017_b1: false,
    pzem017_b2: false, dht: false, rtc: false, rtcTime: null,
    arduino: false,
  });
  const uptimeRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const downtimeRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSensorStatus = async () => {
    try {
      const res  = await fetch('/api/status', { cache: 'no-store' });
      const data = await res.json();
      const hw   = data?.hardware ?? {};
      const rtc  = data?.rtc_ds3231 ?? {};
      setSensorStatus({
        pzem_grid:     hw?.grid_pzem      ?? false,
        pzem_inverter: hw?.inverter_pzem  ?? false,
        pzem017_b1:    hw?.pzem017_b1     ?? false,
        pzem017_b2:    hw?.pzem017_b2     ?? false,
        dht:           hw?.dht_sensor     ?? false,
        arduino:       hw?.arduino        ?? false,
        rtc:           rtc?.responding    ?? false,
        rtcTime:       rtc?.time          ?? null,
      });
    } catch {
      // keep previous status on error
    }
  };

  const fetchAnomalyCounts = async () => {
    try {
      // [FIX-BUG1] Use /api/anomaly-events (flat array, camelCase aliases).
      // /api/anomaly-logs returns {logs:[]} with snake_case 'type' field.
      // /api/anomaly-events returns flat array with 'type' column directly.
      // Old code checked l.fault_type ?? l.anomaly_type — neither field exists!
      // Flask DB column is 'type' (mapped from fault_type in INSERT).
      const res  = await fetch('/api/anomaly-events?limit=200', { cache: 'no-store' });
      const data = await res.json();
      const allLogs: { severity?: string; type?: string; source?: string }[] =
        Array.isArray(data) ? data : (data.logs ?? []);
      // Keep System Status counters aligned with backend/MySQL records (no frontend source filtering).
      const logs = allLogs;
      // [FIX] Flask inserts Title Case ("Critical","Warning") — compare lowercase
      const warning  = logs.filter(l => l.severity?.toLowerCase() === 'warning').length;
      const critical = logs.filter(l =>
        l.severity?.toLowerCase() === 'critical' || l.severity?.toLowerCase() === 'high').length;
      const normal   = logs.length - warning - critical;
      // [FIX-BUG1] Fault type counts — use 'type' field (DB column name)
      // Engine outputs: "Dropout", "Spike High", "Spike Low", "Drift High", "Drift Low"
      const dropout  = logs.filter(l => (l.type ?? '').toLowerCase().includes('dropout')).length;
      const spike    = logs.filter(l => (l.type ?? '').toLowerCase().includes('spike')).length;
      const drift    = logs.filter(l => (l.type ?? '').toLowerCase().includes('drift')).length;
      setAnomalyCounts({ normal: Math.max(0, normal), warning, critical, total: logs.length, dropout, spike, drift });
    } catch {
      // keep previous counts on error
    }
  };

  const measureLatency = async () => {
    const start = performance.now();
    try {
      await fetch('/api/system/health', {
        method:  'HEAD',
        cache:   'no-store',
        signal:  AbortSignal.timeout(3000),
      });
      const ms = Math.round(performance.now() - start);
      setNetworkLatency(ms);
      setNetworkStatus('online');
      if (downtimeRef.current) { clearInterval(downtimeRef.current); downtimeRef.current = null; }
      if (!uptimeRef.current) {
        uptimeRef.current = setInterval(() => setUptime(s => s + 1), 1000);
      }
    } catch {
      setNetworkLatency(null);
      setNetworkStatus('offline');
      setDowntime(0);
      if (uptimeRef.current) { clearInterval(uptimeRef.current); uptimeRef.current = null; setUptime(0); }
      if (!downtimeRef.current) {
        downtimeRef.current = setInterval(() => setDowntime(s => s + 1), 1000);
      }
    }
  };

  const checkInternet = async () => {
    try {
      await fetch('https://www.google.com/generate_204', {
        method: 'HEAD', cache: 'no-store', mode: 'no-cors',
        signal: AbortSignal.timeout(3000),
      });
      setInternetStatus('online');
    } catch {
      setInternetStatus('offline');
    }
  };

  useEffect(() => {
    measureLatency();
    checkInternet();
    fetchAnomalyCounts();
    fetchSensorStatus();
    const localInterval    = setInterval(measureLatency,    5000);
    const internetInterval = setInterval(checkInternet,    15000);
    const anomalyInterval  = setInterval(fetchAnomalyCounts, 30000);
    const sensorInterval   = setInterval(fetchSensorStatus,  10000);
    return () => {
      clearInterval(localInterval);
      clearInterval(internetInterval);
      clearInterval(anomalyInterval);
      clearInterval(sensorInterval);
      if (uptimeRef.current)   clearInterval(uptimeRef.current);
      if (downtimeRef.current) clearInterval(downtimeRef.current);
    };
  }, []);

  const formatDuration = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const getLatencyQuality = (ms: number | null) => {
    if (ms === null) return { label: 'Offline',   color: 'text-red-600'    };
    if (ms < 50)     return { label: 'Excellent', color: 'text-green-600'  };
    if (ms < 150)    return { label: 'Good',      color: 'text-green-500'  };
    if (ms < 300)    return { label: 'Fair',      color: 'text-yellow-600' };
    return             { label: 'Poor',      color: 'text-red-500'    };
  };

  const latencyQuality = getLatencyQuality(networkLatency);
  const sensorsActive  = systemTemp > 0;

  const anomalyLevelNumeric =
    anomalyLevel === 'critical' ? 100 :
    anomalyLevel === 'warning'  ? 60  : 0;

  const anomalyCount = Math.floor(anomalyLevelNumeric / 20);

  const getSystemStatus = () => {
    if (!sensorsActive)                                 return 'No Data';
    if (anomalyLevel === 'critical' || systemTemp >= 60) return 'Critical';
    if (anomalyLevel === 'warning'  || systemTemp >= 50) return 'Warning';
    if (systemCondition.toLowerCase().includes('shutdown')) return 'Shutdown';
    if (systemCondition.toLowerCase().includes('failsafe') || systemCondition.toLowerCase().includes('fail-safe')) return 'Fail-Safe';
    return 'Normal';
  };

  const systemStatus = getSystemStatus();

  const getTempStatus = (temp: number) => {
    if (!sensorsActive) return 'No Data';
    if (temp >= 60)     return 'Critical';
    if (temp >= 50)     return 'Warning';
    return 'Normal';
  };

  // ── Temp color — text and bar both change with temperature ─────────────────
  const getTempTextColor = (temp: number) => {
    if (!sensorsActive) return 'text-slate-400';
    if (temp >= 60)     return 'text-red-600';
    if (temp >= 50)     return 'text-orange-500';
    return 'text-green-600';
  };

  const getTempBarColor = (temp: number) => {
    if (temp >= 60)     return 'bg-red-500';
    if (temp >= 50)     return 'bg-orange-500';
    return 'bg-green-500';
  };

  return (
    <Card className="border-slate-200 shadow-md bg-white">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-green-50">
              <Activity className="w-4 h-4 text-green-600" />
            </div>
            <span className="text-slate-900 font-medium">System Status</span>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full ${
            networkStatus === 'online'  ? 'bg-green-500' :
            networkStatus === 'offline' ? 'bg-red-500'   : 'bg-yellow-400'
          }`} />
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">

        {/* Overall Status & Condition */}
        <div className={`bg-gradient-to-br rounded-lg border p-4 ${
          systemStatus === 'Critical'  ? 'from-red-50 to-rose-50 border-red-200' :
          systemStatus === 'Warning'   ? 'from-yellow-50 to-amber-50 border-yellow-200' :
          systemStatus === 'Shutdown'  ? 'from-slate-50 to-slate-100 border-slate-300' :
          systemStatus === 'Fail-Safe' ? 'from-orange-50 to-amber-50 border-orange-200' :
          systemStatus === 'No Data'   ? 'from-slate-50 to-slate-100 border-slate-200' :
          'from-green-50 to-emerald-50 border-green-200'
        }`}>
          <div className="grid grid-cols-2 gap-6 mb-3">
            <div className={`text-xs font-medium ${
              systemStatus === 'Critical'  ? 'text-red-700' :
              systemStatus === 'Warning'   ? 'text-yellow-700' :
              systemStatus === 'No Data'   ? 'text-slate-500' :
              'text-green-700'
            }`}>Overall Status</div>
            <div className={`text-xs font-medium ${
              systemStatus === 'Critical'  ? 'text-red-700' :
              systemStatus === 'Warning'   ? 'text-yellow-700' :
              systemStatus === 'No Data'   ? 'text-slate-500' :
              'text-green-700'
            }`}>Condition</div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className={`text-lg mb-1 ${
                systemStatus === 'Critical'  ? 'text-red-900' :
                systemStatus === 'Warning'   ? 'text-yellow-900' :
                systemStatus === 'No Data'   ? 'text-slate-500' :
                'text-green-900'
              }`}>{systemStatus}</div>
              <div className={`text-xs ${
                systemStatus === 'Critical'  ? 'text-red-600' :
                systemStatus === 'Warning'   ? 'text-yellow-600' :
                systemStatus === 'No Data'   ? 'text-slate-400' :
                'text-green-600'
              }`}>
                {systemStatus === 'No Data'   ? 'Awaiting sensor data' :
                 systemStatus === 'Critical'  ? 'Immediate attention required' :
                 systemStatus === 'Warning'   ? 'Monitor closely' :
                 'All sensors operational'}
              </div>
            </div>
            <div>
              <div className={`text-sm mb-1 ${
                systemStatus === 'Critical'  ? 'text-red-900' :
                systemStatus === 'Warning'   ? 'text-yellow-900' :
                systemStatus === 'No Data'   ? 'text-slate-500' :
                'text-green-900'
              }`}>{systemCondition}</div>
              <div className={`text-xs ${
                systemStatus === 'Critical'  ? 'text-red-500' :
                systemStatus === 'Warning'   ? 'text-yellow-600' :
                systemStatus === 'No Data'   ? 'text-slate-400' :
                'text-green-600'
              }`}>
                {systemStatus === 'Shutdown'  ? 'Emergency Shutdown — All relays OFF' :
                 systemStatus === 'Fail-Safe' ? 'Island mode active' :
                 'System operational'}
              </div>
            </div>
          </div>
        </div>

        {/* Network & Temperature */}
        <div className="grid grid-cols-2 gap-4">

          {/* Network Section */}
          <div className="space-y-2">
            <div className="text-xs text-slate-600 font-medium mb-2">Network</div>
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                networkStatus === 'online'  ? 'bg-green-500' :
                networkStatus === 'offline' ? 'bg-red-500'   : 'bg-yellow-400'
              }`}>
                {networkStatus === 'offline'
                  ? <WifiOff className="w-3.5 h-3.5 text-white" />
                  : <CheckCircle className="w-3.5 h-3.5 text-white" />
                }
              </div>
              <span className="text-sm font-semibold text-slate-900">
                {networkStatus === 'online'  ? 'Connected' :
                 networkStatus === 'offline' ? 'Offline'   : 'Checking…'}
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">Local Ping</span>
                <span className={`font-medium ${latencyQuality.color}`}>
                  {networkLatency !== null ? `${networkLatency} ms` : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">Signal</span>
                <span className={`font-medium ${latencyQuality.color}`}>{latencyQuality.label}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">Internet</span>
                <span className={`font-medium ${
                  internetStatus === 'online'  ? 'text-green-600' :
                  internetStatus === 'offline' ? 'text-red-500'   : 'text-slate-400'
                }`}>
                  {internetStatus === 'online'  ? 'Online'  :
                   internetStatus === 'offline' ? 'Offline' : '…'}
                </span>
              </div>
              {networkStatus === 'online' && uptime > 0 && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Uptime</span>
                  <span className="font-medium text-green-600">{formatDuration(uptime)}</span>
                </div>
              )}
              {networkStatus === 'offline' && downtime > 0 && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Down for</span>
                  <span className="font-medium text-red-500">{formatDuration(downtime)}</span>
                </div>
              )}
            </div>

            {networkStatus === 'offline' && (
              <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                ⚠️ Cannot reach Flask API. Showing last known data.
              </div>
            )}
            {internetStatus === 'offline' && networkStatus === 'online' && (
              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-700">
                ⚠️ No internet. Local network only.
              </div>
            )}
          </div>

          {/* Temperature Section */}
          <div className="space-y-2">
            <div className="text-xs text-slate-600 font-medium mb-2">Temperature</div>
            <div className="mb-2">
              <span className="text-sm text-slate-600">Device Temp</span>
            </div>
            {/* Temperature value — color changes with heat */}
            <div className={`text-5xl font-bold mb-3 transition-colors duration-500 ${getTempTextColor(systemTemp)}`}>
              {systemTemp.toFixed(0)}°C
            </div>
            <div className="space-y-2">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${getTempBarColor(systemTemp)}`}
                  style={{ width: `${Math.min((systemTemp / 80) * 100, 100)}%` }}
                />
              </div>
              <div className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                systemTemp >= 60 ? 'bg-red-100 text-red-700'       :
                systemTemp >= 50 ? 'bg-orange-100 text-orange-700' :
                                   'bg-green-100 text-green-700'
              }`}>
                {getTempStatus(systemTemp)}
              </div>
            </div>
          </div>
        </div>

        {/* Anomalies Detected */}
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-3 h-3 text-white" />
              </div>
              <span className="text-xs text-blue-700 font-medium truncate">Anomalies Detected (24h)</span>
            </div>
            <div className="text-2xl font-bold text-blue-900 flex-shrink-0 ml-2">{anomalyCounts.total}</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md bg-green-50 border border-green-200 p-2 text-center min-w-0">
              <div className="text-lg text-green-700 font-semibold leading-tight">{anomalyCounts.normal}</div>
              <div className="text-[10px] text-green-600 font-medium uppercase tracking-wide leading-tight mt-0.5 truncate">Normal</div>
            </div>
            <div className="rounded-md bg-yellow-50 border border-yellow-200 p-2 text-center min-w-0">
              <div className="text-lg text-yellow-700 font-semibold leading-tight">{anomalyCounts.warning}</div>
              <div className="text-[10px] text-yellow-600 font-medium uppercase tracking-wide leading-tight mt-0.5 truncate">Warning</div>
            </div>
            <div className="rounded-md bg-red-50 border border-red-200 p-2 text-center min-w-0">
              <div className="text-lg text-red-700 font-semibold leading-tight">{anomalyCounts.critical}</div>
              <div className="text-[10px] text-red-600 font-medium uppercase tracking-wide leading-tight mt-0.5 truncate">Critical</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <div className="rounded-md bg-slate-100 border border-slate-200 p-2 text-center min-w-0">
              <div className="text-lg text-slate-600 font-semibold leading-tight">{anomalyCounts.dropout}</div>
              <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wide leading-tight mt-0.5 truncate">Dropout</div>
            </div>
            <div className="rounded-md bg-orange-50 border border-orange-200 p-2 text-center min-w-0">
              <div className="text-lg text-orange-600 font-semibold leading-tight">{anomalyCounts.spike}</div>
              <div className="text-[10px] text-orange-500 font-medium uppercase tracking-wide leading-tight mt-0.5 truncate">Spike</div>
            </div>
            <div className="rounded-md bg-purple-50 border border-purple-200 p-2 text-center min-w-0">
              <div className="text-lg text-purple-600 font-semibold leading-tight">{anomalyCounts.drift}</div>
              <div className="text-[10px] text-purple-500 font-medium uppercase tracking-wide leading-tight mt-0.5 truncate">Drift</div>
            </div>
          </div>
          <div className="text-xs text-blue-500 mt-2 text-center">
            {anomalyCounts.total === 0 ? 'No anomalies detected' : `Total: ${anomalyCounts.total} logged events`}
          </div>
        </div>

        {/* Active Sensors */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600 font-medium">Active Sensors:</span>
            <span className={`text-xs font-medium flex items-center gap-1 ${
              Object.values(sensorStatus).every(v => v === true || (typeof v === 'string' && v !== null))
                ? 'text-green-600' : 'text-orange-500'
            }`}>
              <CheckCircle className="w-3 h-3" />
              {[sensorStatus.pzem_grid, sensorStatus.pzem_inverter,
                sensorStatus.pzem017_b1, sensorStatus.arduino,
                sensorStatus.dht, sensorStatus.rtc].filter(Boolean).length} / 6 Online
            </span>
          </div>
          <div className="space-y-2">
            {([
              { label: 'PZEM-004T #1 (Grid AC — /dev/ttyGridPZEM)',          ok: sensorStatus.pzem_grid },
              { label: 'PZEM-004T #2 (Inverter AC — /dev/ttyInverterPZEM)', ok: sensorStatus.pzem_inverter },
              { label: 'PZEM-017 (Battery DC — /dev/ttyBatteryPZEM RS485)', ok: sensorStatus.pzem017_b1 },
              { label: 'WCS1500 ×4 + Volt Divider (Solar — Arduino A0–A4)', ok: sensorStatus.arduino },
              { label: 'DHT22 GPIO27 (Device Temperature)',                  ok: sensorStatus.dht },
              { label: `RTC DS3231${sensorStatus.rtcTime ? ` — ${sensorStatus.rtcTime}` : ''}`, ok: sensorStatus.rtc },
            ] as { label: string; ok: boolean }[]).map(({ label, ok }) => (
              <div key={label} className="flex items-center gap-2 text-xs">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ok ? 'bg-green-500' : 'bg-red-400 animate-pulse'}`} />
                <span className={ok ? 'text-slate-700' : 'text-red-500'}>{label}</span>
                {!ok && <span className="ml-auto text-[10px] text-red-400 font-medium">Offline</span>}
              </div>
            ))}
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
