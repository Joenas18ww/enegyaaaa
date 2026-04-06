import { Sun, CheckCircle, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { useEnergySystem } from '../../contexts/EnergySystemContext';
import { useMemo } from 'react';

import solarImg from '4panels.jpg';

// JAM72D40-590/MB datasheet: Imp = 13.28A (not 13.4 — that was 550W spec)
const PANEL_IMP   = 13.28;

const getManilaHour = (): number => {
  const manila = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })
  );
  return manila.getHours();
};
const isSolarHarvestTime = (): boolean => {
  const h = getManilaHour();
  return h >= 6 && h < 18;
};

const STRING_VARIANCE_WARN = 0.25;
const STRING_FAULT_AMP     = 2.0;
const PANEL_THRESH_GOOD    = 10.0;
const PANEL_THRESH_WARNING = 5.0;
const PANEL_THRESH_STORM   = 1.5;

const getPVHealth = (current: number, isDay: boolean): number | null => {
  if (!isDay) return null;
  return Math.min(100, Math.round((current / PANEL_IMP) * 100));
};

type PanelStatus = 'good' | 'warning' | 'critical' | 'nodata';

interface DerivedPanel {
  id: number;
  name: string;
  string: 1 | 2;          // 2S2P: String 1 = PV-01+PV-02, String 2 = PV-03+PV-04
  voltage: number;
  current: number;
  power: number;
  health: number | null;
  status: PanelStatus;
  faultReason?: string;
  isNight: boolean;
  isNoData: boolean;
}

function derivePanels(
  solarVoltage: number,
  solarCurrent: number,
  solarPower: number,
  stringCurrents?: number[],
): DerivedPanel[] {
  const voltageOffsets = [-0.2, +0.3, -0.3, +0.2];
  const isDay = isSolarHarvestTime();

  const hasLiveSensorData = solarVoltage > 0 || solarCurrent > 0;

  if (!hasLiveSensorData) {
    return [0, 1, 2, 3].map((i) => ({
      id: i + 1, name: `PV-0${i + 1}`, string: i < 2 ? 1 : 2,
      voltage: 0, current: 0, power: 0,
      health: null, status: 'nodata',
      faultReason: undefined,
      isNight: false, isNoData: true,
    }));
  }

  const currents: number[] = (stringCurrents && stringCurrents.length === 4)
    ? stringCurrents.map(c => Math.max(0, parseFloat(c.toFixed(2))))
    : [0, 1, 2, 3].map(i => {
        const offsets = [+0.15, -0.20, +0.10, -0.05];
        return Math.max(0, parseFloat((solarCurrent / 4 + offsets[i]).toFixed(2)));
      });

  // 2S2P topology:
  //   String A = PV01 (i0) + PV02 (i1) — series, same current flows through both
  //   String B = PV03 (i2) + PV04 (i3) — series, same current flows through both
  //   Healthy: i0 ≈ i1, i2 ≈ i3 (series physics)
  //   String current = avg of pair (noise cancellation)
  const ia = (currents[0] + currents[1]) / 2.0;  // String A current
  const ib = (currents[2] + currents[3]) / 2.0;  // String B current

  // Intra-string mismatch: deviation within a series pair
  // If |i0 - i1| is large → one panel in String A has a problem (bypass diode, shading, degradation)
  const intraA = ia > 0 ? Math.abs(currents[0] - currents[1]) / ia : 0;
  const intraB = ib > 0 ? Math.abs(currents[2] - currents[3]) / ib : 0;

  // Inter-string mismatch: String A vs String B
  // If |ia - ib| is large → one entire string is underperforming
  const avgString = (ia + ib) / 2.0;
  const interMismatch = avgString > 0 ? Math.abs(ia - ib) / avgString : 0;

  // 2S2P: each panel sees half the array voltage (series connection)
  const panelBaseV = solarVoltage > 0 ? solarVoltage / 2 : 0;

  return [0, 1, 2, 3].map((i) => {
    const panelCurrent = Math.max(0, parseFloat(currents[i].toFixed(2)));
    const voltage      = Math.max(0, parseFloat((panelBaseV + voltageOffsets[i]).toFixed(1)));
    const power        = parseFloat((voltage * panelCurrent).toFixed(1));
    const health       = getPVHealth(panelCurrent, isDay);

    // Which string does this panel belong to?
    const isStringA  = i < 2;
    const strCurrent = isStringA ? ia : ib;      // this panel's string average
    const intraDev   = isStringA ? intraA : intraB; // this panel's intra-string deviation

    if (!isDay) {
      return {
        id: i + 1, name: `PV-0${i + 1}`, string: i < 2 ? 1 : 2,
        voltage, current: panelCurrent, power,
        health: null, status: 'good', isNight: true, isNoData: false,
      };
    }

    let status: PanelStatus = 'good';
    let faultReason: string | undefined;

    if (panelCurrent < 0.1) {
      const othersActive = currents.filter((_, j) => j !== i && currents[j] > STRING_FAULT_AMP).length;
      if (othersActive > 0) {
        status = 'critical';
        faultReason = 'String fault — no output while others active';
      } else {
        status = 'critical';
        faultReason = 'No output during harvest hours';
      }
    } else if (panelCurrent < PANEL_THRESH_STORM) {
      status = 'critical';
      faultReason = `Very low current ${panelCurrent.toFixed(1)}A (storm/heavy rain)`;
    } else if (intraDev > STRING_VARIANCE_WARN && strCurrent > 1.0) {
      // Intra-string fault: this panel deviates from its series partner
      status = 'warning';
      faultReason = `Intra-string mismatch ${Math.round(intraDev * 100)}% vs S${i < 2 ? 1 : 2} partner (shading/cell fault)`;
    } else if (interMismatch > STRING_VARIANCE_WARN && strCurrent > 1.0) {
      // Inter-string fault: this panel's entire string is underperforming
      const lowString = ia < ib ? 'A' : 'B';
      if ((isStringA && ia < ib) || (!isStringA && ib < ia)) {
        status = 'warning';
        faultReason = `String ${lowString} ${Math.round(interMismatch * 100)}% below String ${lowString === 'A' ? 'B' : 'A'} (shading/soiling)`;
      }
    } else if (panelCurrent < PANEL_THRESH_WARNING) {
      status = 'warning';
      faultReason = `Low current ${panelCurrent.toFixed(1)}A (heavy cloud/rain)`;
    } else if (panelCurrent < PANEL_THRESH_GOOD) {
      status = 'warning';
    }

    return {
      id: i + 1, name: `PV-0${i + 1}`, string: i < 2 ? 1 : 2,
      voltage, current: panelCurrent, power,
      health, status, faultReason, isNight: false, isNoData: false,
    };
  });
}

function getColors(status: PanelStatus) {
  switch (status) {
    case 'good':
      return {
        boxBg:      'rgba(49, 207, 10, 0.75)',
        accentCol:  'text-emerald-400',
        barCol:     'bg-emerald-500',
        dotCol:     'bg-emerald-500',
        statusText: 'Optimal',
      };
    case 'warning':
      return {
        boxBg:      'rgba(120, 53, 15, 0.8)',
        accentCol:  'text-amber-400',
        barCol:     'bg-amber-500',
        dotCol:     'bg-amber-500',
        statusText: 'Low Output',
      };
    case 'critical':
      return {
        boxBg:      'rgba(153, 27, 27, 0.8)',
        accentCol:  'text-red-400',
        barCol:     'bg-red-600',
        dotCol:     'bg-red-500',
        statusText: 'Fault',
      };
    case 'nodata':
    default:
      return {
        boxBg:      'rgba(30, 41, 59, 0.90)',
        accentCol:  'text-slate-400',
        barCol:     'bg-slate-600',
        dotCol:     'bg-slate-500',
        statusText: 'No Data',
      };
  }
}

const POSITIONS = [
  { x: '26%', y: '30%' },
  { x: '42%', y: '30%' },
  { x: '58%', y: '30%' },
  { x: '74%', y: '30%' },
];

const REPLACEMENT_REFS = [
  { range: '75–100%', label: 'Good',        desc: 'Normal operation',                     dotColor: '#10b981', textColor: 'text-emerald-700', bgColor: 'bg-emerald-50 border-emerald-200' },
  { range: '60–74%',  label: 'Monitor',     desc: 'Slight degradation, observe',          dotColor: '#60a5fa', textColor: 'text-blue-700',    bgColor: 'bg-blue-50 border-blue-200'       },
  { range: '40–59%',  label: 'Aging',       desc: 'Clean panels, check connections',      dotColor: '#facc15', textColor: 'text-yellow-700',  bgColor: 'bg-yellow-50 border-yellow-200'   },
  { range: '20–39%',  label: 'Replace Soon',desc: 'Consistent low output after cleaning', dotColor: '#f97316', textColor: 'text-orange-700',  bgColor: 'bg-orange-50 border-orange-200'   },
  { range: '<20%',    label: 'Replace Now', desc: 'Panel no longer viable',               dotColor: '#ef4444', textColor: 'text-red-700',     bgColor: 'bg-red-50 border-red-200'         },
];

export function SolarPanelsStatusCard() {
  const {
    solarVoltage,
    solarCurrent,
    solarPower,
    controlMode,
    contactorClosed,
    stringCurrents,
  } = useEnergySystem();

  const hasLiveSensorData = solarVoltage > 0 || solarCurrent > 0;

  const panels = useMemo(
    () => derivePanels(solarVoltage, solarCurrent, solarPower, stringCurrents),
    [solarVoltage, solarCurrent, solarPower, stringCurrents],
  );

  const isNight = !isSolarHarvestTime();

  // Counts — daytime + live sensor only
  // Uses status (current-based) as primary gate so shading/clouds don't trigger Replace
  const canCount = hasLiveSensorData && !isNight;

  const goodCount    = canCount ? panels.filter(p => !p.isNoData && p.status === 'good').length    : 0;
  const warningCount = canCount ? panels.filter(p => !p.isNoData && p.status === 'warning').length : 0;
  const criticalCount= canCount ? panels.filter(p => !p.isNoData && p.status === 'critical').length: 0;

  // Health-bracket counts:
  // Only flag Monitor/Aging/Replace when panel is status=good (not shaded/faulted)
  // AND health is reliably readable (current > PANEL_THRESH_WARNING so it's not a cloud/shading reading)
  const HEALTH_MIN_CURRENT = 5.0; // below this → shading/cloud, don't count for replacement
  const monitorCount = canCount ? panels.filter(p =>
    !p.isNoData && p.status === 'good' && p.health !== null &&
    p.current >= HEALTH_MIN_CURRENT && p.health >= 60 && p.health < 75
  ).length : 0;
  const agingCount = canCount ? panels.filter(p =>
    !p.isNoData && p.status === 'good' && p.health !== null &&
    p.current >= HEALTH_MIN_CURRENT && p.health >= 20 && p.health < 60
  ).length : 0;
  const replaceCount = canCount ? panels.filter(p =>
    !p.isNoData && p.status === 'good' && p.health !== null &&
    p.current >= HEALTH_MIN_CURRENT && p.health < 20
  ).length : 0;
  const combinedPower = parseFloat(solarPower.toFixed(1));

  const systemOnline =
    controlMode !== 'shutdown' &&
    contactorClosed;

  const systemLabel = !hasLiveSensorData
    ? 'No Sensor'
    : !contactorClosed
    ? 'Safe Mode'
    : controlMode === 'shutdown'
    ? 'Shutdown'
    : isNight
    ? 'Night Mode'
    : 'Array Online';

  const SystemIcon      = systemOnline ? CheckCircle : Activity;

  const systemIconColor = !hasLiveSensorData ? 'text-slate-400' : systemOnline ? 'text-emerald-400' : 'text-amber-400';
  const systemBgColor   = !hasLiveSensorData ? 'bg-slate-500/20 border-slate-500/30' : systemOnline ? 'bg-emerald-500/20 border-emerald-500/30' : 'bg-amber-500/20 border-amber-500/30';
  const systemTextColor = !hasLiveSensorData ? 'text-slate-400' : systemOnline ? 'text-emerald-400' : 'text-amber-300';
  const combinedPowerColor = 'text-amber-400';

  const indicatorDotColor = !hasLiveSensorData || isNight
    ? 'bg-slate-400'
    : replaceCount > 0 ? 'bg-red-500'
    : agingCount   > 0 ? 'bg-yellow-500'
    : monitorCount > 0 ? 'bg-blue-400'
    : 'bg-green-500';

  return (
    <Card className="w-full border-slate-200 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden flex flex-col bg-white">

      {/* ── HEADER ── */}
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base sm:text-lg">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-100">
              <Sun className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600" />
            </div>
            <span>Solar Panels Status</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-600">4 Panels</span>
            <div className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full ${indicatorDotColor} animate-pulse`} />
          </div>
        </CardTitle>
        <p className="text-xs text-slate-600 mt-1">
          Real-time monitoring of individual solar panel health and performance
        </p>
      </CardHeader>

      {/* ── SUMMARY STATS ── */}
      <CardContent className="pb-0 px-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200">
            <div className="text-xs text-green-600 mb-1">Good</div>
            <div className="text-2xl text-green-900">{canCount ? goodCount : '—'}</div>
          </div>
          <div className="p-3 rounded-lg bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200">
            <div className="text-xs text-blue-600 mb-1">Monitor</div>
            <div className="text-2xl text-blue-900">{canCount ? monitorCount : '—'}</div>
          </div>
          <div className="p-3 rounded-lg bg-gradient-to-br from-yellow-50 to-amber-50 border border-yellow-200">
            <div className="text-xs text-yellow-600 mb-1">Aging</div>
            <div className="text-2xl text-yellow-900">{canCount ? agingCount : '—'}</div>
          </div>
          <div className="p-3 rounded-lg bg-gradient-to-br from-red-50 to-rose-50 border border-red-200">
            <div className="text-xs text-red-600 mb-1">Replace</div>
            <div className="text-2xl text-red-900">{canCount ? replaceCount : '—'}</div>
          </div>
        </div>

        {!hasLiveSensorData && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-slate-100 border border-slate-300 text-center">
            <span className="text-xs text-slate-500">No sensor data — connect WCS1500 / voltage divider</span>
          </div>
        )}
        {hasLiveSensorData && isNight && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-slate-100 border border-slate-200 text-center">
            <span className="text-xs text-slate-500">Night mode — health readings available 6AM–6PM PHT</span>
          </div>
        )}
      </CardContent>

      {/* ── MAP AREA ── */}
      <CardContent className="p-0 relative w-full overflow-hidden" style={{ height: '650px' }}>
        <div className="absolute inset-0 z-0">
          <img
            src={solarImg}
            alt="Solar Installation"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.src =
                '4panels.jpg'; // Fallback to local image if public path fails (for Vite)
            }}
          />
        </div>

        <div className={`absolute inset-0 z-1 transition-all duration-700 ${
          !hasLiveSensorData || isNight
            ? 'bg-slate-950/50'
            : 'bg-slate-950/10'
        }`} />

        <div className="relative z-10 w-full h-full">
          {panels.map((panel, index) => {
            const pos    = POSITIONS[index];
            const colors = getColors(panel.status);

            // ── NO DATA CARD (current only, no V/W) ──
            if (panel.isNoData) {
              return (
                <div
                  key={panel.id}
                  className="absolute w-[180px] sm:w-[200px] max-w-[90vw] flex flex-col p-3 shadow-2xl z-30 rounded-xl border border-white/10 backdrop-blur-md"
                  style={{
                    left: pos.x,
                    top: pos.y,
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: 'rgba(30, 41, 59, 0.90)',
                    minHeight: '90px',
                  }}
                >
                  {/* Header row */}
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                      <span className="text-[10px] font-black text-white/90 uppercase tracking-tighter italic">
                        {panel.name}
                      </span>
                    </div>
                    <span className="text-[7px] font-black uppercase px-2 py-0.5 rounded-full bg-black/40 border border-white/5 text-slate-400">
                      No Data
                    </span>
                  </div>

                  {/* Current only — big display */}
                  <div className="flex items-end gap-2 mb-2">
                    <div className="text-5xl font-black italic tracking-tighter leading-none text-slate-500">
                      —
                    </div>
                    <span className="text-2xl font-bold text-slate-500 mb-1">A</span>
                  </div>

                  {/* Health bar */}
                  <div className="space-y-1 mb-2">
                    <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden border border-white/5">
                      <div className="h-full bg-slate-600 w-0" />
                    </div>
                    <div className="flex justify-between items-center px-0.5">
                      <span className="text-[7px] text-white/30 font-black uppercase tracking-widest">PV Health</span>
                      <span className="text-[9px] font-black text-slate-500">—</span>
                    </div>
                  </div>

                  {/* Reason — bottom */}
                  <div className="px-1.5 py-0.5 rounded bg-black/50 border border-white/10">
                    <span className="text-[7px] font-bold text-slate-400">No sensor connected</span>
                  </div>
                </div>
              );
            }

            // ── NORMAL CARD (current only, no V/W shown) ──
            return (
              <div
                key={panel.id}
                className="absolute w-[200px] flex flex-col p-3 transition-all duration-700 shadow-2xl z-30 rounded-xl border border-white/10 backdrop-blur-md"
                style={{
                  left: pos.x,
                  top: pos.y,
                  transform: 'translate(-50%, -50%)',
                  backgroundColor: panel.isNight ? 'rgba(30, 41, 59, 0.85)' : colors.boxBg,
                  minHeight: panel.faultReason ? '115px' : '90px',
                }}
              >
                {/* Header row */}
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      panel.isNight ? 'bg-slate-400' : colors.dotCol
                    } ${panel.isNight ? '' : 'animate-pulse'}`} />
                    <span className="text-[10px] font-black text-white/90 uppercase tracking-tighter italic">
                      {panel.name}
                    </span>
                    <span className="text-[8px] text-white/40 font-mono ml-1">
                      S{panel.string}
                    </span>
                  </div>
                  <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full bg-black/40 border border-white/5 ${
                    panel.isNight ? 'text-slate-300' : colors.accentCol
                  }`}>
                    {panel.isNight ? 'Night Mode' : colors.statusText}
                  </span>
                </div>

                {/* Current — big display only */}
                <div className="flex items-end gap-2 mb-2">
                  <div className={`text-5xl font-black italic tracking-tighter leading-none ${
                    panel.isNight ? 'text-slate-300' : 'text-white'
                  }`}>
                    {panel.current.toFixed(2)}
                  </div>
                  <span className={`text-2xl font-bold mb-1 ${
                    panel.isNight ? 'text-slate-400' : colors.accentCol
                  }`}>A</span>
                </div>

                {/* Fault reason if any */}
                {panel.faultReason && (
                  <div className="mb-2 px-1.5 py-0.5 rounded bg-black/50 border border-white/10">
                    <span className={`text-[7px] font-bold ${colors.accentCol}`}>
                      {panel.faultReason}
                    </span>
                  </div>
                )}

                {/* Health bar */}
                <div className="mt-auto space-y-1">
                  <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden border border-white/5">
                    <div
                      className={`h-full ${panel.isNight ? 'bg-slate-500' : colors.barCol} transition-all duration-1000`}
                      style={{
                        width: panel.isNight
                          ? '0%'
                          : `${Math.min(100, (panel.current / PANEL_IMP) * 100)}%`
                      }}
                    />
                  </div>
                  <div className="flex justify-between items-center px-0.5">
                    <span className="text-[7px] text-white/40 font-black uppercase tracking-widest">PV Health</span>
                    <span className={`text-[9px] font-black ${panel.isNight ? 'text-slate-400' : colors.accentCol}`}>
                      {panel.isNight ? 'Night' : `${panel.health ?? 0}%`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── HUD OVERLAY ── */}
        <div className="absolute bottom-6 left-6 right-6 z-20 flex justify-between items-center p-5 rounded-3xl bg-slate-900/85 backdrop-blur-md border border-white/10 shadow-2xl">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-2xl border ${systemBgColor}`}>
              <SystemIcon className={`w-6 h-6 ${systemIconColor}`} />
            </div>
            <div>
              <span className={`text-[10px] font-black uppercase italic tracking-[0.2em] block ${systemTextColor}`}>
                System Status
              </span>
              <span className={`font-bold text-lg uppercase ${systemTextColor}`}>
                {systemLabel}
              </span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-white/40 font-black uppercase block tracking-widest mb-1">
              Array Output
            </span>
            <div className={`text-5xl font-black italic leading-none tracking-tighter ${combinedPowerColor}`}>
              {hasLiveSensorData ? combinedPower : '—'}
              <span className="text-xl font-normal ml-2 text-white/70">W</span>
            </div>
            <div className="text-[9px] text-white/30 tracking-widest mt-0.5">
              {hasLiveSensorData
                ? `${solarVoltage.toFixed(1)}V · ${solarCurrent.toFixed(2)}A · 2S2P 4×590W 2.36kW`
                : 'No sensor connected · 2S2P 4×590W 2.36kW'}
            </div>
          </div>
        </div>
      </CardContent>

      {/* ── FOOTER — Two cards: Voltage (blue left) + Power (amber right) ── */}
      <div className="px-6 pt-4 pb-4 border-t border-slate-100">
        <div className="grid grid-cols-2 gap-3">

          {/* LEFT — Total Voltage (blue) */}
          <div className="p-4 rounded-lg bg-gradient-to-br from-blue-50 to-cyan-50 border-2 border-blue-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sun className="w-5 h-5 text-blue-500" />
                <span className="text-sm text-blue-900">Total Voltage</span>
              </div>
              <div className="flex items-end gap-1">
                <span className="text-2xl sm:text-3xl text-blue-900">
                  {hasLiveSensorData ? solarVoltage.toFixed(1) : '—'}
                </span>
                <span className="text-sm text-blue-500 mb-1">V</span>
              </div>
            </div>
          </div>

          {/* RIGHT — Total Power (amber) */}
          <div className="p-4 rounded-lg bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sun className="w-5 h-5 text-amber-600" />
                <span className="text-sm text-amber-900">Total Power</span>
              </div>
              <div className="flex items-end gap-1">
                <span className="text-2xl sm:text-3xl text-amber-900">
                  {hasLiveSensorData ? combinedPower.toFixed(1) : '—'}
                </span>
                <span className="text-sm text-amber-600 mb-1">W</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── REFERENCE CARD ── */}
      <div className="px-6 pb-6 pt-3">
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">Panel Health Reference</span>
            <span className="text-[10px] text-slate-400">Based on 590W Imp = 13.28A</span>
          </div>
          <div className="divide-y divide-slate-100">
            {REPLACEMENT_REFS.map((ref) => (
              <div key={ref.range} className={`flex items-center gap-3 px-4 py-2.5 ${ref.bgColor} border-l-0`}>
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: ref.dotColor }}
                />
                <span className="text-[11px] font-bold text-slate-600 w-16 flex-shrink-0">{ref.range}</span>
                <span className={`text-[11px] font-semibold w-24 flex-shrink-0 ${ref.textColor}`}>{ref.label}</span>
                <span className="text-[10px] text-slate-500 leading-tight">{ref.desc}</span>
              </div>
            ))}
          </div>
          <div className="px-4 py-2 bg-slate-50 border-t border-slate-200">
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Health % is daytime only (6AM–6PM PHT). Clean panels first before deciding replacement.
              If health stays below 40% for 14+ consecutive clear days after cleaning, panel replacement is recommended.
              K3 Grid Assist activates at &lt;24.0V · Stops at ≥28.4V · Contactor opens at &lt;21.0V (deep discharge).
            </p>
          </div>
        </div>
      </div>

    </Card>
  );
}
