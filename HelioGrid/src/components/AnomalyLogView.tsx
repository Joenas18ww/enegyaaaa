// AnomalyLogView_patched.tsx — v2 (Engine-aware)
// PATCHES APPLIED:
//   [ENGINE-v2] friendlyLabel: direct VoltageAnomalyEngine output match first
//   [ENGINE-v2] Table: added ΔV + Confirms columns (anomaly_delta, confirm_count)
//   [ENGINE-v2] CSV: anomaly_source, anomaly_delta, confirm_count exported
//
//   [FIX-1] Response Time column added (Objective 3b) — shows ms from detection to relay action
//   [FIX-2] Status lifecycle colors: Resolved=green, Warning=yellow, Monitoring=amber, Active=red
//   [FIX-3] Buzzer column — WARNING rows always show OFF (buzzer is Critical-only)
//   [FIX-4] CSV export includes responseTimeMs, detectedAt, actionAt columns
//   [FIX-5] Summary stats: avg response time card added
//   [FIX-6] friendlySource() — maps raw DB source to "Grid Sensor", "Inverter Sensor", etc.
//   [FIX-7] friendlyLabel() — maps type+severity to Spike/Drift/Dropout format
//   [FIX-8] Table: "Event" → "Anomaly Label", "Source" → "Sensor"; CSV updated to match

import { AlertTriangle, Download, Shield, Volume2, Clock, RefreshCw, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { useState } from 'react';
import { useEnergySystem } from '../contexts/EnergySystemContext';

export function AnomalyLogView() {
  const { anomalyLogs, refreshData } = useEnergySystem();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState('');

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshData();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleDeleteAll = async () => {
    if (!confirm('Delete ALL anomaly logs? This cannot be undone.')) return;
    setIsDeleting(true);
    try {
      const res = await fetch('/api/anomaly-events', { method: 'DELETE' });
      if (res.ok) { setDeleteMsg('Deleted!'); await refreshData(); }
      else setDeleteMsg('Failed');
    } catch { setDeleteMsg('Error'); }
    setTimeout(() => { setIsDeleting(false); setDeleteMsg(''); }, 2000);
  };

  // ============================================================================
  // [FIX-6] friendlySource — maps raw DB source string → human-readable sensor name
  // ============================================================================
  const friendlySource = (source: string): string => {
    const s = (source ?? '').toLowerCase();
    if (s.includes('grid'))     return 'Grid Sensor';
    if (s.includes('inverter')) return 'Inverter Sensor';
    if (s.includes('battery'))  return 'Battery Sensor';
    if (s.includes('solar') || s.includes('pv')) return 'Solar Sensor';
    if (s.includes('temp') || s.includes('thermal')) return 'Temp Sensor';
    if (s.includes('system'))   return 'System';
    return source || 'System';
  };

  // ============================================================================
  // [ENGINE-v2] friendlyLabel — VoltageAnomalyEngine output arrives as exact strings:
  //   "Dropout", "Spike High", "Spike Low", "Drift High", "Drift Low"
  //   Legacy Flask type strings still supported via fuzzy match (backward-compat).
  // ============================================================================
  const friendlyLabel = (type: string, severity: string, source: string): string => {
    const t   = (type ?? '').toLowerCase().trim();
    const src = (source ?? '').toLowerCase();
    const isCrit = severity === 'Critical' || severity === 'High';

    // ── Engine direct output (exact match first) ──────────────────────────
    if (t === 'dropout')    return '⚡ Dropout';
    if (t === 'spike high') return '📈 Spike — High Voltage';
    if (t === 'spike low')  return '📉 Spike — Low Voltage';
    if (t === 'drift high') return '↗ Drift — High Voltage';
    if (t === 'drift low')  return '↘ Drift — Low Voltage';

    // ── Fuzzy legacy / Flask type strings ────────────────────────────────
    if (t.includes('dropout') || t.includes('no_power') || t.includes('outage') || t.includes('offline')) {
      return '⚡ Dropout';
    }
    if (t.includes('spike')) {
      return (t.includes('low') || t.includes('under')) ? '📉 Spike — Low Voltage' : '📈 Spike — High Voltage';
    }
    if (t.includes('drift')) {
      return (t.includes('low') || t.includes('under')) ? '↘ Drift — Low Voltage' : '↗ Drift — High Voltage';
    }
    if (t.includes('overvoltage') || t.includes('high_volt') || t.includes('high voltage')) {
      return isCrit ? '📈 Spike — High Voltage' : '↗ Drift — High Voltage';
    }
    if (t.includes('undervoltage') || t.includes('low_volt') || t.includes('low voltage')) {
      return isCrit ? '📉 Spike — Low Voltage' : '↘ Drift — Low Voltage';
    }
    if (t.includes('freq')) {
      return isCrit ? '📈 Spike — Frequency' : '↗ Drift — Frequency';
    }
    if (src.includes('battery') || t.includes('battery')) {
      if (t.includes('low') || t.includes('under')) return '⚡ Dropout — Low Voltage';
      return isCrit ? '📈 Spike — High Voltage' : '↗ Drift — High Voltage';
    }
    if (t.includes('temp') || t.includes('thermal')) {
      return isCrit ? '📈 Spike — High Temp' : '↗ Drift — High Temp';
    }
    return type ? type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Unknown Anomaly';
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'Critical': return 'bg-red-100 text-red-700 border-red-300';
      case 'High':     return 'bg-orange-100 text-orange-700 border-orange-300';
      case 'Medium':
      case 'Warning':  return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case 'Low':      return 'bg-blue-100 text-blue-700 border-blue-300';
      default:         return 'bg-slate-100 text-slate-700 border-slate-300';
    }
  };

  // [FIX-2] Status lifecycle colors
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Resolved':   return 'text-green-600';
      case 'Warning':    return 'text-yellow-600';
      case 'Active':     return 'text-red-600';
      case 'Monitoring': return 'text-amber-600';
      default:           return 'text-slate-500';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Resolved':
        return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-300">✓ Resolved</span>;
      case 'Active':
        return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300 animate-pulse">● Active</span>;
      case 'Warning':
        return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 border border-yellow-300">⚠ Warning</span>;
      default:
        return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">◎ Monitoring</span>;
    }
  };

  // [FIX-3] Buzzer only valid ON for Critical — Warning is dashboard-only
  const getBuzzerDisplay = (buzzer: string, severity: string) => {
    const isOn = (buzzer === 'ON' || buzzer === 'true') && severity === 'Critical';
    return (
      <div className="flex items-center gap-1">
        <Volume2 className={`w-3 h-3 ${isOn ? 'text-red-600' : 'text-slate-300'}`} />
        <span className={`text-xs ${isOn ? 'text-red-600' : 'text-slate-400'}`}>
          {isOn ? 'ON' : 'OFF'}
        </span>
      </div>
    );
  };

  // [FIX-1] Response time display
  const formatResponseTime = (ms: number | null | undefined) => {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000)  return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  // ============================================================================
  // [FIX-4] CSV DOWNLOAD — includes new response time fields
  // ============================================================================
  const downloadCSV = () => {
    const headers = [
      'ID', 'Timestamp', 'Detected At', 'Action At', 'Response Time (ms)',
      'Anomaly Label', 'Sensor', 'Anomaly Source', 'Delta V', 'Confirm Count',
      'Severity', 'System Action',
      'Grid Voltage', 'Inverter Voltage',
      'System Temp', 'Email Status', 'Buzzer', 'Status',
    ];

    const csvContent = [
      headers.join(','),
      ...anomalyLogs.map(row => [
        row.id,
        row.timestamp,
        (row as any).detectedAt    ?? row.timestamp,
        (row as any).actionAt      ?? row.timestamp,
        (row as any).responseTimeMs ?? 0,
        `"${friendlyLabel(row.type, row.severity, row.source)}"`,
        `"${friendlySource(row.source)}"`,
        // [FIX] Flask returns camelCase — support both
        (row as any).anomalySource ?? (row as any).anomaly_source ?? '',
        (row as any).anomalyDelta  ?? (row as any).anomaly_delta  ?? '',
        (row as any).confirmCount  ?? (row as any).confirm_count  ?? '',
        row.severity,
        `"${row.systemAction}"`,
        row.gridVoltage,
        (row as any).inverterVoltage ?? 0,
        (row as any).systemTemp ?? 0,
        row.emailStatus,
        row.severity === 'Critical' ? ((row as any).buzzer_fired ? 'ON' : (row.buzzer ?? 'OFF')) : 'OFF',
        row.status,
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `anomaly_logs_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ============================================================================
  // STATISTICS
  // Grid + Inverter AC primary anomalies + Thermal events
  // [FIX-BUG4] Added thermal/temp to filter — thermal shutdowns must appear in log
  const acLogs = anomalyLogs.filter(e => {
    const src = (e.source ?? '').toLowerCase();
    const typ = (e.type  ?? '').toLowerCase();
    return src.includes('grid') || src.includes('inverter')
        || src.includes('thermal') || src.includes('temp')
        || typ.includes('thermal') || typ.includes('shutdown');
  });

  const criticalCount = acLogs.filter(e => e.severity === 'Critical').length;
  const highCount     = acLogs.filter(e => e.severity === 'High').length;
  const warningCount  = acLogs.filter(e => e.severity === 'Warning' || e.severity === 'Medium').length;
  const resolvedCount = acLogs.filter(e => e.status === 'Resolved').length;
  const buzzerCount   = acLogs.filter(e => (e.buzzer === 'ON' || (e as any).buzzer_fired) && e.severity === 'Critical').length;

  // [FIX-5] Avg response time for Critical events only
  const criticalWithTime = acLogs.filter(
    e => e.severity === 'Critical' && (e as any).responseTimeMs != null
  );
  const avgResponseMs = criticalWithTime.length > 0
    ? Math.round(criticalWithTime.reduce((sum, e) => sum + ((e as any).responseTimeMs ?? 0), 0) / criticalWithTime.length)
    : null;

  return (
    <div className="p-3 sm:p-4 lg:p-6 xl:p-8 space-y-4 sm:space-y-6">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1 sm:space-y-2">
          <h1 className="text-xl sm:text-2xl lg:text-3xl">Anomaly Detection Alerts</h1>
          <p className="text-xs sm:text-sm lg:text-base text-slate-600">
            Threshold-based anomaly detection and automated system response history
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}
            className="bg-blue-600 hover:bg-blue-700 text-white border-blue-700">
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`}/>
            Refresh
          </Button>
          <Button variant="outline" onClick={handleDeleteAll} disabled={isDeleting}
            className="bg-red-600 hover:bg-red-700 text-white border-red-700">
            <Trash2 className="w-4 h-4 mr-2"/>
            {deleteMsg || (isDeleting ? 'Deleting...' : 'Delete All')}
          </Button>
          <Button variant="outline" className="sm:w-auto bg-green-600 hover:bg-green-700 text-white border-green-700"
            onClick={downloadCSV}>
            <Download className="w-4 h-4 mr-2"/>Export CSV
          </Button>
        </div>
      </div>

      {/* ANOMALY LOG TABLE */}
      <Card className="border-slate-200 shadow-lg">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base sm:text-lg">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-red-600" />
              <span>Real-Time Anomaly Log</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-slate-600">Live Updates</span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {acLogs.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="w-16 h-16 mx-auto text-green-500 mb-4" />
              <p className="text-lg text-slate-900 mb-2">No Anomalies Detected</p>
              <p className="text-sm text-slate-600">System is operating normally.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-2 text-xs text-slate-600">Timestamp</th>
                    <th className="text-left py-3 px-2 text-xs text-slate-600">Anomaly Label</th>
                    <th className="text-left py-3 px-2 text-xs text-slate-600">Sensor</th>
                    <th className="text-left py-3 px-2 text-xs text-slate-600">ΔV</th>
                    <th className="text-left py-3 px-2 text-xs text-slate-600">Confirms</th>
                    <th className="text-left py-3 px-2 text-xs text-slate-600">Severity</th>
                    <th className="text-left py-3 px-2 text-xs text-slate-600">System Action</th>
                    {/* [FIX-1] Response Time column */}
                    <th className="text-left py-3 px-2 text-xs text-slate-600">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Response
                      </div>
                    </th>
                    <th className="text-left py-3 px-2 text-xs text-slate-600">Grid V</th>
                    <th className="text-left py-3 px-2 text-xs text-slate-600">Inv V</th>
                    <th className="text-left py-3 px-2 text-xs text-slate-600">Email</th>
                    <th className="text-left py-3 px-2 text-xs text-slate-600">Buzzer</th>
                    <th className="text-left py-3 px-2 text-xs text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {acLogs.map((entry) => (
                    <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-2 text-xs text-slate-900 whitespace-nowrap">{entry.timestamp}</td>
                      <td className="py-3 px-2 text-xs text-slate-900 font-medium">
                        {friendlyLabel(entry.type, entry.severity, entry.source)}
                      </td>
                      <td className="py-3 px-2 text-xs text-slate-600">{friendlySource(entry.source)}</td>
                      {/* [ENGINE] ΔV from anomaly_engine */}
                      <td className="py-3 px-2 text-xs font-mono text-slate-700">
                        {((entry as any).anomalyDelta ?? (entry as any).anomaly_delta) != null
                          ? (() => {
                              const dv = parseFloat((entry as any).anomalyDelta ?? (entry as any).anomaly_delta);
                              const sign = dv >= 0 ? '+' : '';
                              const col  = dv < 0 ? 'text-red-600' : 'text-green-600';
                              return <span className={col}>{sign}{dv.toFixed(2)}V</span>;
                            })()
                          : <span className="text-slate-300">—</span>}
                      </td>
                      {/* [ENGINE] confirm_count */}
                      <td className="py-3 px-2 text-xs text-slate-600 font-mono">
                        {((entry as any).confirmCount ?? (entry as any).confirm_count) != null
                          ? `${((entry as any).confirmCount ?? (entry as any).confirm_count)}×`
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="py-3 px-2">
                        <span className={`text-xs px-2 py-1 rounded border ${getSeverityColor(entry.severity)}`}>
                          {entry.severity}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-xs text-slate-700 max-w-xs truncate">{entry.systemAction}</td>
                      {/* [FIX-1] Response time cell */}
                      <td className="py-3 px-2 text-xs font-mono text-slate-700">
                        {formatResponseTime((entry as any).responseTimeMs)}
                      </td>
                      <td className="py-3 px-2 text-xs text-slate-900">{entry.gridVoltage}</td>
                      <td className="py-3 px-2 text-xs text-slate-900">{(entry as any).inverterVoltage ?? '0.0'}</td>
                      <td className="py-3 px-2">
                        <span className={`text-xs ${entry.emailStatus === 'Sent' ? 'text-green-600' : entry.emailStatus === 'Failed' ? 'text-red-600' : 'text-amber-600'}`}>
                          {entry.emailStatus ?? (entry as any).email_status ?? '—'}
                        </span>
                      </td>
                      {/* [FIX-3] Buzzer only ON for Critical */}
                      <td className="py-3 px-2">
                        {getBuzzerDisplay((entry as any).buzzer_fired ? 'ON' : (entry.buzzer ?? 'OFF'), entry.severity)}
                      </td>
                      {/* [FIX-2] Status lifecycle badge */}
                      <td className="py-3 px-2">
                        {getStatusBadge(entry.status)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SUMMARY STATISTICS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 xl:grid-cols-6">
        <Card className="border-slate-200 shadow-lg">
          <CardContent className="p-4">
            <div className="text-xs text-slate-600">Total Anomalies</div>
            <div className="text-2xl text-slate-900 mt-1">{acLogs.length}</div>
            <div className="text-xs text-slate-500 mt-0.5">AC voltage anomalies</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-lg">
          <CardContent className="p-4">
            <div className="text-xs text-slate-600">Critical Events</div>
            <div className="text-2xl text-red-600 mt-1">{criticalCount + highCount}</div>
            <div className="text-xs text-red-500 mt-0.5">{criticalCount} Critical, {highCount} High</div>
          </CardContent>
        </Card>

        <Card className="border-yellow-200 shadow-lg bg-yellow-50">
          <CardContent className="p-4">
            <div className="text-xs text-yellow-700">Warning Events</div>
            <div className="text-2xl text-yellow-600 mt-1">{warningCount}</div>
            <div className="text-xs text-yellow-500 mt-0.5">Dashboard alerts only</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-lg">
          <CardContent className="p-4">
            <div className="text-xs text-slate-600">Auto-Resolved</div>
            <div className="text-2xl text-green-600 mt-1">{resolvedCount}</div>
            <div className="text-xs text-green-500 mt-0.5">
              {acLogs.length > 0 ? ((resolvedCount / acLogs.length) * 100).toFixed(0) : 0}% success rate
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-lg">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Volume2 className="w-4 h-4" />
              <span>Buzzer Triggered</span>
            </div>
            <div className="text-2xl text-red-600 mt-1">{buzzerCount}</div>
            <div className="text-xs text-red-500 mt-0.5">Critical only (5s pulse)</div>
          </CardContent>
        </Card>

        {/* [FIX-5] Avg Response Time card — Objective 3b */}
        <Card className="border-blue-200 shadow-lg bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-blue-700">
              <Clock className="w-4 h-4" />
              <span>Avg Response Time</span>
            </div>
            <div className="text-2xl text-blue-700 mt-1 font-mono">
              {avgResponseMs !== null ? formatResponseTime(avgResponseMs) : '—'}
            </div>
            <div className="text-xs text-blue-500 mt-0.5">
              Detection → relay action (Objective 3b)
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SYSTEM PROTECTION STATUS */}
      <Card className="border-slate-200 shadow-lg">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
            System Protection Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { label: 'Grid Monitoring',    sub: 'Active • PZEM-004T',              },
              { label: 'Inverter Monitoring', sub: 'Active • PZEM-004T',             },
              { label: 'Battery Protection',  sub: 'Active • INA219 + MCCB',         },
              { label: 'Solar PV Monitoring', sub: 'Active • WCS1500 x4',            },
              { label: 'Auto SSR Switching',  sub: 'Active • SSR1-4 (K1-K4)',        },
              { label: 'Alert System',        sub: 'Active • Buzzer (5s) + Email',   },
            ].map(({ label, sub }) => (
              <div key={label} className="p-3 rounded-lg bg-green-50 border border-green-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-green-900">{label}</span>
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                </div>
                <div className="text-xs text-green-700">{sub}</div>
              </div>
            ))}
          </div>

          {/* IEEE / ISO compliance note */}
          <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200">
            <div className="text-xs text-blue-800 font-medium mb-1">Standards Compliance</div>
            <div className="text-xs text-blue-700 space-y-0.5">
              <div>• IEEE 1547 §4.2.3 — K3 anti-islanding + 5-min reconnect timer</div>
              <div>• ISO/IEC 30141 — IoT 3-layer architecture (Sensing → Network → Application)</div>
              <div>• IEC 61000-4-30 — Sensor integrity validation with freeze detection</div>
              <div>• IEC 61215 — Solar PV string mismatch &amp; output monitoring</div>
              <div>• Response time logging active — Objective 3b measurable indicator</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
