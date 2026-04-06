import { AlertTriangle, CheckCircle, Mail, Clock, Filter, Download, Search, Bell, Zap, Sun, Battery, Grid3x3, TrendingUp, Shield, AlertCircle, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { useState, useEffect } from 'react';
import { useEnergySystem } from '../contexts/EnergySystemContext';
import type { AnomalyLogEntry } from '../contexts/EnergySystemContext';

interface Notification {
  id:           number;
  timestamp:    string;
  date:         string;
  time:         string;
  faultType:    string;
  severity:     'critical' | 'warning' | 'info';
  source:       string;
  affectedLoad: string;
  systemAction: string;
  gridVoltage:  string;
  solarPower:   string;
  batterySOC:   string;
  resolution:   string;
  emailStatus:  'Sent' | 'Failed' | 'Queued' | 'N/A';
}

// [FIX-BUG4] Friendly label — same mapping as AnomalyLogView
function friendlyLabel(type: string, severity: string): string {
  const t = (type ?? '').toLowerCase().trim();
  const isCrit = severity === 'Critical' || severity === 'High';
  if (t === 'dropout')    return '⚡ Dropout';
  if (t === 'spike high') return '📈 Spike — High Voltage';
  if (t === 'spike low')  return '📉 Spike — Low Voltage';
  if (t === 'drift high') return '↗ Drift — High Voltage';
  if (t === 'drift low')  return '↘ Drift — Low Voltage';
  if (t.includes('dropout'))  return '⚡ Dropout';
  if (t.includes('spike'))    return t.includes('low') ? '📉 Spike — Low Voltage' : '📈 Spike — High Voltage';
  if (t.includes('drift'))    return t.includes('low') ? '↘ Drift — Low Voltage' : '↗ Drift — High Voltage';
  if (t.includes('thermal') || t.includes('temp')) return isCrit ? '🌡 Thermal Shutdown' : '🌡 High Temperature';
  return type ? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'System Event';
}

export function NotificationsView() {
  const { anomalyLogs, emailServiceHealth, refreshData } = useEnergySystem();
  // Finalization mode: anomaly logs stay read-only in UI while anomaly engine is under active changes.
  const anomalyEngineHold = (import.meta.env.VITE_ANOMALY_ENGINE_HOLD ?? 'true').toLowerCase() !== 'false';
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Keep notifications aligned with backend/MySQL anomaly records (no frontend source filtering).
  const notifications: Notification[] = anomalyLogs.map((log: AnomalyLogEntry) => {
    const date = new Date(log.timestamp);

    // Map the context's severity string to our local union
    const severityRaw = log.severity?.toLowerCase() ?? '';
    const severity: Notification['severity'] =
      severityRaw === 'critical' || severityRaw === 'high'   ? 'critical' :
      severityRaw === 'warning'  || severityRaw === 'medium' ? 'warning'  : 'info';
    // Note: battery_warning, battery_full, solar_panel → 'info' (no buzzer, email only)

    return {
      id:           log.id,
      timestamp:    log.timestamp,
      date:         date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time:         date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      faultType:    friendlyLabel(log.type, log.severity),  // [FIX-BUG4] use friendly label
      severity,
      source:       log.source,
      affectedLoad: (log.source ?? '').toLowerCase().includes('grid')    ? 'All Loads'    :
                    (log.source ?? '').toLowerCase().includes('battery') ? 'System'       :
                    (log.source ?? '').toLowerCase().includes('solar') || (log.source ?? '').toLowerCase().includes('panel') ? 'PV Array (2S2P)' : 'System',
      systemAction: log.systemAction,
      gridVoltage:  log.gridVoltage,
      solarPower:   log.solarPower,
      batterySOC:   log.battery,
      resolution:   log.status === 'Resolved'   ? 'System stabilized and returned to normal operation' :
                    log.status === 'Monitoring' ? 'Actively monitoring system parameters'              :
                    'Alert logged',
      emailStatus:  log.emailStatus,
    };
  });

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'border-l-red-500 bg-red-50';
      case 'warning':  return 'border-l-yellow-500 bg-yellow-50';
      case 'info':     return 'border-l-blue-500 bg-blue-50';
      default:         return 'border-l-slate-500 bg-slate-50';
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <span className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-full border border-red-300">Critical</span>;
      case 'warning':
        return <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded-full border border-yellow-300">Warning</span>;
      case 'info':
        return <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full border border-blue-300">Info</span>;
      default:
        return <span className="px-2 py-1 text-xs bg-slate-100 text-slate-700 rounded-full">Unknown</span>;
    }
  };

  const getEmailStatusIcon = (status: string) => {
    if (status === 'Sent')   return <CheckCircle className="w-4 h-4 text-green-600" />;
    if (status === 'Failed') return <AlertTriangle className="w-4 h-4 text-red-600" />;
    return <Clock className="w-4 h-4 text-yellow-600" />;
  };

  const getSourceIcon = (source: string) => {
    if (source.includes('Grid'))                          return <Zap      className="w-4 h-4 text-blue-600"   />;
    if (source.includes('Solar') || source.includes('Panel')) return <Sun className="w-4 h-4 text-yellow-600" />;
    if (source.includes('Battery'))                       return <Battery  className="w-4 h-4 text-green-600"  />;
    if (source.includes('Outlet'))                        return <Grid3x3  className="w-4 h-4 text-purple-600" />;
    return                                                       <Shield   className="w-4 h-4 text-slate-600"  />;
  };

  // [FIX-AUTOREFRESH] Auto-refresh anomaly logs every 30s for live sync across pages
  useEffect(() => {
    const id = setInterval(() => { refreshData(); }, 30_000);
    return () => clearInterval(id);
  }, [refreshData]);

  const filteredNotifications = notifications.filter(notif => {
    const matchesSeverity = filterSeverity === 'all' || notif.severity === filterSeverity;
    const matchesSearch   = searchQuery === '' ||
      notif.faultType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      notif.source.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSeverity && matchesSearch;
  });

  const exportToCSV = () => {
    const headers = ['Timestamp', 'Fault Type', 'Severity', 'Source', 'System Action', 'Resolution', 'Email Status'];
    const rows = notifications.map(n => [
      n.timestamp, n.faultType, n.severity, n.source, n.systemAction, n.resolution, n.emailStatus,
    ]);
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url  = window.URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `anomaly-alerts-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshData();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const criticalCount = notifications.filter(n => n.severity === 'critical').length;
  const warningCount  = notifications.filter(n => n.severity === 'warning').length;
  const infoCount     = notifications.filter(n => n.severity === 'info').length;
  const sentCount     = notifications.filter(n => n.emailStatus === 'Sent').length;
  const failedCount   = notifications.filter(n => n.emailStatus === 'Failed').length;

  return (
    <div className="min-h-screen p-3 sm:p-4 lg:p-6 xl:p-8 space-y-4 sm:space-y-6">
      {/* Header with Email Service Status */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 sm:space-y-2">
            <h1 className="text-xl sm:text-2xl lg:text-3xl">Anomaly Alerts &amp; Notifications</h1>
            <p className="text-xs sm:text-sm lg:text-base text-slate-600">
              Real-time system fault detection and automated response tracking
            </p>
            {anomalyEngineHold && (
              <p className="inline-block text-xs sm:text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                HOLD MODE: Anomaly engine is read-only habang fina-finalize ang system.
              </p>
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Email Service Status Banner */}
        <Card className={`border-l-4 ${emailServiceHealth ? 'border-l-green-500 bg-green-50' : 'border-l-red-500 bg-red-50'}`}>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${emailServiceHealth ? 'bg-green-100' : 'bg-red-100'}`}>
                <Mail className={`w-5 h-5 ${emailServiceHealth ? 'text-green-600' : 'text-red-600'}`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">Email Service Status:</span>
                  {emailServiceHealth ? (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-sm text-green-700 font-medium">Online &amp; Active</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-sm text-red-700 font-medium">❌ Offline</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-600 mt-1">
                  {emailServiceHealth
                    ? `${sentCount} emails sent successfully, ${failedCount} failed`
                    : 'Email notifications are currently unavailable. Alerts are being logged locally.'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card className="border-slate-200 shadow-md">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-slate-600">Total Alerts</p>
                <p className="text-2xl sm:text-3xl text-slate-900 mt-1">{notifications.length}</p>
              </div>
              <div className="p-3 bg-slate-100 rounded-lg">
                <Bell className="w-5 h-5 sm:w-6 sm:h-6 text-slate-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-red-200 shadow-md">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-red-600">Critical</p>
                <p className="text-2xl sm:text-3xl text-red-700 mt-1">{criticalCount}</p>
              </div>
              <div className="p-3 bg-red-100 rounded-lg">
                <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-yellow-200 shadow-md">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-yellow-600">Warnings</p>
                <p className="text-2xl sm:text-3xl text-yellow-700 mt-1">{warningCount}</p>
              </div>
              <div className="p-3 bg-yellow-100 rounded-lg">
                <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-200 shadow-md">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-blue-600">Info</p>
                <p className="text-2xl sm:text-3xl text-blue-700 mt-1">{infoCount}</p>
              </div>
              <div className="p-3 bg-blue-100 rounded-lg">
                <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card className="border-slate-200 shadow-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg">Filter &amp; Search</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs sm:text-sm text-slate-600 mb-1 block">Search Alerts</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by fault type or source..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="text-xs sm:text-sm text-slate-600 mb-1 block">Filter by Severity</label>
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <select
                  value={filterSeverity}
                  onChange={e => setFilterSeverity(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Severities</option>
                  <option value="critical">Critical Only</option>
                  <option value="warning">Warning Only</option>
                  <option value="info">Info Only</option>
                </select>
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              <Download className="w-4 h-4" />
              Export to CSV
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="text-sm text-slate-600">
        Showing {filteredNotifications.length} of {notifications.length} alerts
      </div>

      {/* Notifications List */}
      <div className="space-y-3 sm:space-y-4">
        {filteredNotifications.length === 0 ? (
          <Card className="border-slate-200 shadow-md">
            <CardContent className="p-8 text-center">
              <Bell className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600">No anomaly alerts found</p>
              <p className="text-xs text-slate-500 mt-1">The system is operating normally</p>
            </CardContent>
          </Card>
        ) : (
          filteredNotifications.map(notif => (
            <Card key={notif.id} className={`border-l-4 shadow-lg hover:shadow-xl transition-all ${getSeverityColor(notif.severity)}`}>
              <CardContent className="p-3 sm:p-4 lg:p-5">
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="mt-1">{getSourceIcon(notif.source)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h3 className="text-base sm:text-lg text-slate-900 flex-1">{notif.faultType}</h3>
                          {getSeverityBadge(notif.severity)}
                        </div>
                        <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-600">
                          <Clock className="w-3 h-3" />
                          <span>{notif.date} at {notif.time}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Main Info Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Left: Details */}
                    <div className="space-y-2 text-xs sm:text-sm">
                      <div className="flex items-start gap-2">
                        <span className="text-slate-500 w-28 flex-shrink-0">Source:</span>
                        <span className="text-slate-900 font-medium">{notif.source}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-slate-500 w-28 flex-shrink-0">Affected Load:</span>
                        <span className="text-slate-900">{notif.affectedLoad}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-slate-500 w-28 flex-shrink-0">System Action:</span>
                        <span className="text-blue-700 font-medium">{notif.systemAction}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-slate-500 w-28 flex-shrink-0">Resolution:</span>
                        <span className="text-green-700">{notif.resolution}</span>
                      </div>
                    </div>

                    {/* Right: Sensor Data */}
                    <div>
                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        <div className="bg-white p-2 sm:p-3 rounded-lg border border-slate-200">
                          <div className="flex items-center gap-1 mb-1">
                            <Zap className="w-3 h-3 text-blue-600" />
                            <span className="text-[0.65rem] sm:text-xs text-slate-500">Grid Voltage</span>
                          </div>
                          <div className="text-base sm:text-lg text-slate-900">{notif.gridVoltage}</div>
                        </div>
                        <div className="bg-white p-2 sm:p-3 rounded-lg border border-slate-200">
                          <div className="flex items-center gap-1 mb-1">
                            <Sun className="w-3 h-3 text-yellow-600" />
                            <span className="text-[0.65rem] sm:text-xs text-slate-500">Solar Power</span>
                          </div>
                          <div className="text-base sm:text-lg text-slate-900">{notif.solarPower}</div>
                        </div>
                        <div className="bg-white p-2 sm:p-3 rounded-lg border border-slate-200">
                          <div className="flex items-center gap-1 mb-1">
                            <Battery className="w-3 h-3 text-green-600" />
                            <span className="text-[0.65rem] sm:text-xs text-slate-500">Battery SOC</span>
                          </div>
                          <div className="text-base sm:text-lg text-slate-900">{notif.batterySOC}</div>
                        </div>
                        <div className="bg-white p-2 sm:p-3 rounded-lg border border-slate-200">
                          <div className="flex items-center gap-1 mb-1">
                            <Mail className="w-3 h-3 text-slate-600" />
                            <span className="text-[0.65rem] sm:text-xs text-slate-500">Email Status</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {getEmailStatusIcon(notif.emailStatus)}
                            <span className="text-xs sm:text-sm text-slate-900">{notif.emailStatus}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Email Notification Info */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200 shadow-lg">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Mail className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <h4 className="text-sm sm:text-base text-blue-900 mb-2">📧 Email Notification System</h4>
              <div className="space-y-2 text-xs sm:text-sm text-blue-800">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <span><strong>Critical (Grid AC / Inverter AC):</strong> 3 consecutive readings → Buzzer 5s + Email</span>
                </div>


                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  <span><strong>Warning level:</strong> Dashboard display only — no buzzer, no email</span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <span>All alerts logged locally on Raspberry Pi 4B for backup</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
