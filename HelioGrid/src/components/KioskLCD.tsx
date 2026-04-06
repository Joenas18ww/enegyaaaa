// ============================================================================
// KioskLCD.tsx — PATCHED v1.1
//
// v1.1 CHANGES:
//   [FIX-SOLAR-RATED-W] Updated hardcoded 2320W references to 2360W
//     for new JAM72D40-590/MB panels (4×590W = 2360W).
//     Line 602: dcPBarPct — was dividing by 2320 → now 2360.
//               Solar progress bar was clipping at 2320W, missing top 40W.
//     Line 714: Label "~2320 W max" → "~2360 W max", midpoint "1160" → "1180".
//   All other thresholds imported from EnergySystemContext (single source of truth).
// ============================================================================
import {
  Battery, Sun, Zap, Activity, Clock, AlertTriangle,
  Thermometer, Wifi, Shield, ChevronLeft, TrendingUp,
  TrendingDown, ArrowLeftRight, Palette, Power, AlertCircle,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import {
  BarChart, Bar, ComposedChart, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts';
import {
  useEnergySystem,
  BAT_WARNING_LOW, BAT_FULL, BAT_CRITICAL_LOW,
  GRID_NORMAL_LOW, GRID_NORMAL_HIGH, GRID_CRITICAL_LOW, GRID_CRITICAL_HIGH, GRID_FREQ_CRIT,
  INV_CRITICAL_LOW, INV_CRITICAL_HIGH,
  SOLAR_CRITICAL_LOW, SOLAR_WARNING_LOW,
} from '../contexts/EnergySystemContext';
import * as api from '../utils/api';
import solarImg from '../assets/4panels.jpg';

type ViewType = 'main' | 'grid' | 'solar' | 'battery' | 'panels' | 'graph' | 'ssr' | 'theme';
type ControlModeType = 'solar' | 'grid' | 'shutdown' | 'failsafe';

interface Theme { id: string; name: string; gradient: string; borderColor: string; textColor: string; }

const themes: Theme[] = [
  { id: 'default',  name: 'Ocean Blue',      gradient: 'from-slate-950 via-blue-950 to-slate-950',   borderColor: 'border-blue-700',   textColor: 'text-blue-400' },
  { id: 'sunset',   name: 'Sunset Orange',   gradient: 'from-slate-950 via-orange-950 to-slate-950', borderColor: 'border-orange-700', textColor: 'text-orange-400' },
  { id: 'forest',   name: 'Forest Green',    gradient: 'from-slate-950 via-green-950 to-slate-950',  borderColor: 'border-green-700',  textColor: 'text-green-400' },
  { id: 'midnight', name: 'Midnight Purple', gradient: 'from-slate-950 via-purple-950 to-slate-950', borderColor: 'border-purple-700', textColor: 'text-purple-400' },
];

// All thresholds imported from EnergySystemContext — single source of truth
// GRID_NORMAL_LOW=210, GRID_NORMAL_HIGH=241, GRID_CRITICAL_LOW=200, GRID_CRITICAL_HIGH=245
// BAT_WARNING_LOW=23, BAT_FULL=25.4, BAT_CRITICAL_LOW=21.6
// INV_CRITICAL_LOW=207, INV_CRITICAL_HIGH=253
// SOLAR_CRITICAL_LOW=464, SOLAR_WARNING_LOW=1392

const slideUpStyle = `
  @keyframes slideUp {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  @keyframes slideDown {
    from { transform: translateY(-60%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  .animate-slide-up   { animation: slideUp   0.32s cubic-bezier(0.22,1,0.36,1) both; }
  .animate-slide-down { animation: slideDown 0.28s cubic-bezier(0.22,1,0.36,1) both; }
  html,body,#root { margin:0;padding:0;width:100vw;height:100vh;overflow:hidden;background:#000; }
  .scroll-blue::-webkit-scrollbar { width: 3px; }
  .scroll-blue::-webkit-scrollbar-track { background: transparent; }
  .scroll-blue::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.4); border-radius: 99px; }
  .scroll-blue::-webkit-scrollbar-thumb:hover { background: rgba(59,130,246,0.65); }
`;

export function KioskLCD() {
  const systemData = useEnergySystem();

  const [currentView, setCurrentView]               = useState<ViewType>('main');
  const [animClass, setAnimClass]                   = useState('animate-slide-up');
  const [selectedTheme, setSelectedTheme]           = useState<Theme>(themes[0]);
  const [isDataLoaded, setIsDataLoaded]             = useState(false);
  const [localOutlet1Status, setLocalOutlet1Status] = useState(false);
  const [localOutlet2Status, setLocalOutlet2Status] = useState(false);
  const [graphSlide, setGraphSlide]                 = useState(0);
  const [historyData, setHistoryData]               = useState<any[]>([]);
  const [balanceData, setBalanceData]               = useState<any[]>([]);
  const [consumptionData, setConsumptionData]       = useState<any[]>([]);
  const [totals, setTotals]                         = useState({ solar: 0, grid: 0, battery: 0 });
  const [touchStartX, setTouchStartX]               = useState<number | null>(null);

  const navigateTo = (view: ViewType) => {
    setAnimClass(view === 'main' ? 'animate-slide-down' : 'animate-slide-up');
    setCurrentView(view);
  };

  // [SIMPLIFY] Screensaver scenario removed for now to reduce kiosk conflicts
  // while anomaly engine + monitoring + SSR management are being prioritized.

  useEffect(() => {
    const hasAnyLiveMetric =
      Number(systemData.gridVoltage ?? 0) > 0 ||
      Number(systemData.inverterVoltage ?? 0) > 0 ||
      Number(systemData.solarVoltage ?? 0) > 0 ||
      Number(systemData.batteryVoltage ?? 0) > 0;
    if (hasAnyLiveMetric) setIsDataLoaded(true);
  }, [systemData.gridVoltage, systemData.inverterVoltage, systemData.solarVoltage, systemData.batteryVoltage]);

  // [FIX-OUTLET] Sync outlet status from context whenever it changes
  useEffect(() => {
    setLocalOutlet1Status(systemData.outlet1Status);
    setLocalOutlet2Status(systemData.outlet2Status);
  }, [systemData.outlet1Status, systemData.outlet2Status]);

  const acVoltage_raw   = systemData.inverterVoltage ?? 0;
  const acCurrent_raw   = systemData.inverterCurrent ?? 0;
  const solarPower_raw: number = Number(systemData.solarPower ?? 0);  // [BUG-FIX] Number()
  const battCurrentSigned_raw = Number(systemData.batteryCurrent ?? 0);
  const battCurrent_raw = Math.abs(battCurrentSigned_raw);
  const battVoltage_raw = systemData.batteryVoltage  ?? 0;
  const serverTime      = systemData.serverTime      ?? '';

  // ── Single unified history fetch ─────────────────────────────────────────────
  useEffect(() => {
    const run = (): void => {
      api.getSensorHistory(24)
        .then(history => {
          const fixTs2 = (ts: string) => ts.includes('T') || ts.includes('+') ? ts : ts + '+08:00';
          const now = new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
          if (history && history.length > 0) {
            const rows = (history as any[]).slice().reverse();
            // Voltage + Current Trends (shared historyData)
            const voltChart = rows.map((raw: any) => {
              const time = new Date(fixTs2(raw.timestamp)).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
              const gridV = Number(raw.grid_voltage ?? 0), invV = Number(raw.inverter_voltage ?? 0);
              const batV  = Number(raw.battery_pack_voltage ?? 0), solV = Number(raw.solar_dc_voltage ?? 0);
              const gridFreq = Number(raw.grid_frequency ?? 60), invFreq = Number(raw.inverter_frequency ?? 60);
              const solPwr = Number(raw.solar_dc_power ?? 0), invI = Number(raw.inverter_current ?? 0);
              const solI = Number(raw.solar_dc_current ?? 0), batI = Number(raw.battery_pack_current ?? 0);
              const gA = gridV <= 0 ? 'none' : (gridV < GRID_CRITICAL_LOW || gridV > GRID_CRITICAL_HIGH || Math.abs(gridFreq - 60) > GRID_FREQ_CRIT) ? 'critical' : (gridV < GRID_NORMAL_LOW || gridV > GRID_NORMAL_HIGH) ? 'warning' : 'none';
              const iA = invV <= 0 ? 'none' : (invV < INV_CRITICAL_LOW || invV > INV_CRITICAL_HIGH) ? 'critical' : (invFreq < 59 || invFreq > 61) ? 'warning' : 'none';
              const bA = batV <= 0 ? 'none' : (batV < 21.0 || batV > 25.4) ? 'critical' : batV < 23.0 ? 'warning' : 'none';
              const sA = solPwr < 1 ? 'none' : solPwr < SOLAR_CRITICAL_LOW ? 'critical' : solPwr < SOLAR_WARNING_LOW ? 'warning' : 'none';
              const hasAnom = gA !== 'none' || iA !== 'none' || bA !== 'none' || sA !== 'none';
              const anomSev = (gA === 'critical' || iA === 'critical' || bA === 'critical' || sA === 'critical') ? 'critical' : 'warning';
              const maxV = Math.max(gridV, invV, solV, batV, 0);
              const gridI = gridV > 0 && raw.grid_power ? parseFloat((Number(raw.grid_power) / gridV).toFixed(2)) : 0;
              const maxC = Math.max(gridI, invI, Math.abs(batI), solI, 0);
              return {
                time, batteryVoltage: batV, gridVoltage: gridV, inverterVoltage: invV, solarVoltage: solV,
                solarPowerW: solPwr, totalLoad: invV * invI,
                gridCurrent: gridI, solarCurrent: parseFloat(solI.toFixed(2)),
                batteryCurrent: parseFloat(Math.abs(batI).toFixed(2)), inverterCurrent: parseFloat(invI.toFixed(2)),
                anomaly: hasAnom, anomalySeverity: anomSev,
                voltageAnomalyY: hasAnom ? (maxV > 0 ? maxV + 10 : 15) : null,
                currentAnomalyY: hasAnom ? (maxC > 0 ? maxC + 0.3 : 0.5) : null,
              };
            });
            // Energy Balance
            const balChart = rows.map((raw: any) => {
              const time = new Date(fixTs2(raw.timestamp)).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
              const sp = Number(raw.solar_dc_power ?? 0), gp = Number(raw.grid_power ?? 0);
              const iv = Number(raw.inverter_voltage ?? 0), ic = Number(raw.inverter_current ?? 0);
              return { time, solarSupply: parseFloat(sp.toFixed(1)), gridSupply: parseFloat(gp.toFixed(1)), totalSupply: parseFloat((sp + gp).toFixed(1)), totalLoad: parseFloat((iv * ic).toFixed(1)) };
            });
            // Consumption
            const conChart = rows.map((raw: any) => {
              const time = new Date(fixTs2(raw.timestamp)).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
              const sp = Number(raw.solar_dc_power ?? 0), gp = Number(raw.grid_power ?? 0);
              const bv = Number(raw.battery_pack_voltage ?? 0), bi = Number(raw.battery_pack_current ?? 0);
              return { time, Solar: parseFloat(sp.toFixed(1)), Grid: parseFloat(gp.toFixed(1)), Battery: parseFloat((bi < 0 ? Math.abs(bi) * bv : 0).toFixed(1)) };
            });
            const ih = 5 / 3600;
            setHistoryData(voltChart);
            setBalanceData(balChart);
            setConsumptionData(conChart);
            setTotals({
              solar:   parseFloat(conChart.reduce((s: number, d: any) => s + d.Solar   * ih, 0).toFixed(2)),
              grid:    parseFloat(conChart.reduce((s: number, d: any) => s + d.Grid    * ih, 0).toFixed(2)),
              battery: parseFloat(conChart.reduce((s: number, d: any) => s + d.Battery * ih, 0).toFixed(2)),
            });
          } else {
            const batDis = battCurrentSigned_raw < 0 ? Math.abs(battCurrentSigned_raw) * battVoltage_raw : 0;
            setHistoryData([{ time: now, batteryVoltage: 0, gridVoltage: 0, inverterVoltage: 0, solarVoltage: 0, solarPowerW: 0, totalLoad: 0, gridCurrent: 0, solarCurrent: 0, batteryCurrent: 0, inverterCurrent: 0, anomaly: false, voltageAnomalyY: null, currentAnomalyY: null }]);
            setBalanceData([{ time: now, solarSupply: parseFloat(solarPower_raw.toFixed(1)), gridSupply: 0, totalSupply: parseFloat(solarPower_raw.toFixed(1)), totalLoad: parseFloat((acVoltage_raw * acCurrent_raw).toFixed(1)) }]);
            setConsumptionData([{ time: now, Solar: parseFloat(solarPower_raw.toFixed(1)), Grid: 0, Battery: parseFloat(batDis.toFixed(1)) }]);
          }
        })
        .catch((err) => {
          // [FIX-GRAPH] On error, keep last good data — don't wipe charts blank.
          // Only reset to empty arrays on very first load (when data is still []).
          console.warn('[KioskLCD] History fetch failed, keeping last data:', err);
        });
    };
    run();
    const iv = setInterval(run, 30_000);
    return () => clearInterval(iv);
  }, []);

  // ── Live sensor values ───────────────────────────────────────────────────────
  const gridVoltage: number   = Number(systemData.gridVoltage   ?? 0);  // [BUG-FIX] Number() — string from Flask kills bar width
  const gridCurrent: number   = Number(systemData.gridCurrent   ?? 0);
  const gridFrequency: number = Number(systemData.gridFrequency ?? 0);
  const solarVoltage: number      = Number(systemData.solarVoltage      ?? 0);  // [BUG-FIX] Number() wrap
  const solarCurrent: number      = Number(systemData.solarCurrent      ?? 0);
  const acVoltage: number         = Number(systemData.inverterVoltage   ?? 0);
  const acCurrent: number         = Number(systemData.inverterCurrent   ?? 0);
  const inverterFrequency: number = Number(systemData.inverterFrequency ?? 0);
  const batteryHealth: number     = Number(systemData.batterySOC        ?? 0);  // [PATCH] single source of truth for SOC
  const batteryVoltage: number    = Number(systemData.batteryVoltage    ?? 0);
  const batteryCurrent: number    = Math.abs(Number(systemData.batteryCurrent ?? 0));
  const systemTemp: number        = Number(systemData.systemTemp        ?? 0);
  const solarPower: number        = Number(systemData.solarPower        ?? 0);  // [BUG-FIX] Number() wrap
  const contactorClosed   = systemData.contactorClosed   ?? true;
  const k3Active          = systemData.k3Active          ?? false;
  const tempAnomaly       = systemData.tempAnomaly       ?? 'none';
  const batteryAnomaly    = systemData.batteryAnomaly    ?? 'none';
  const solarAnomaly      = systemData.solarAnomaly      ?? 'none';

  // [PZEM017] dual DC meter fields
  const batteryChargeA    = systemData.batteryChargeA    ?? 0;
  const batteryDischargeA = systemData.batteryDischargeA ?? 0;
  const batterySource     = systemData.batterySource     ?? 'PZEM-017';
  const isPZEM017         = batterySource === 'PZEM-017';

  const controlAuthority       = systemData.controlAuthority;
  const controlMode            = systemData.controlMode;
  const lastSwitchTime         = systemData.lastSwitchTime         ?? '—';
  const totalSwitches          = systemData.totalSwitches          ?? 0;
  const autoSwitchEnabled      = systemData.autoSwitchEnabled;
  const manualBlockedReason    = systemData.manualBlockedReason;
  const systemCondition        = systemData.systemCondition;
  const manualLockoutRemaining = systemData.manualLockoutRemaining ?? 0;

  // ── SSR hardware truth — synced with UnifiedSSROutletCard (uses ssrStates directly) ──
  const K1_Solar      = systemData.ssrStates?.K1 ?? (controlMode === 'solar');
  const K2_Grid       = systemData.ssrStates?.K2 ?? (controlMode === 'grid' || controlMode === 'failsafe');
  const K3_GridAssist = k3Active;
  const SSR4_Closed   = contactorClosed && controlMode !== 'shutdown';
  const outletEnergized = SSR4_Closed && (K1_Solar || K2_Grid);

  // ── [PATCH] Real active source voltage & current for outlets ────────────────
  // Both outlets share the same source (K1=Solar/Inverter, K2=Grid)
  const activeSourceVoltage = K1_Solar ? acVoltage : K2_Grid ? gridVoltage : 0;
  const activeSourceCurrent = K1_Solar ? acCurrent : K2_Grid ? gridCurrent : 0;

  // ── K3 grid assist label ─────────────────────────────────────────────────────
  const manilaHour    = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })).getHours();
  const isHarvestTime = manilaHour >= 6 && manilaHour < 18;
  const k3IsCharging    = K3_GridAssist && isHarvestTime && batteryHealth >= 95 && solarPower > SOLAR_WARNING_LOW;
  // [FIX-RPI-LOAD] No grid + battery sustaining scenarios
  const noGrid      = (systemData.gridAnomaly ?? 'none') === 'critical' || gridVoltage === 0;
  const batLow      = batteryVoltage > 0 && batteryVoltage < BAT_WARNING_LOW;  // 24V: <23.0V
  const batDepleted = batteryVoltage > 0 && batteryVoltage < BAT_CRITICAL_LOW; // 24V: <21.6V

  const k3ModeLabel   = !K3_GridAssist ? 'STANDBY'
    : k3IsCharging ? 'GRID CHARGING'
    : !isHarvestTime ? 'GRID ASSISTING ← Night'
    : solarPower < SOLAR_CRITICAL_LOW ? 'GRID ASSISTING ← Cloudy'
    : batteryVoltage < BAT_WARNING_LOW ? 'GRID ASSISTING ← Bat Low'
    : 'GRID ASSISTING ← Grid';

  // [FIX] Thresholds aligned to system: critical=60°C, warning=50°C (was 70/60/45)
  const getTempStatus = (t: number) =>
    t >= 60 ? { color: 'text-red-500',   bg: 'bg-red-500/30' }
    : t >= 50 ? { color: 'text-amber-400', bg: 'bg-amber-500/30' }
    :           { color: 'text-green-400',  bg: 'bg-green-500/30' };

  // [FIX] Use PZEM-004T grid power directly — V×I was string type causing bar bugs
  const gridPowerW: number = Number(systemData.gridPower ?? 0);               // [BUG-FIX] Number() — PZEM-004T direct W
  const gridPower: string  = gridPowerW.toFixed(1);                           // string for display only
  const gridStatus  = gridVoltage >= GRID_NORMAL_LOW && gridVoltage <= GRID_NORMAL_HIGH ? 'Stable' : gridVoltage > 0 ? 'Unstable' : 'No Power';
  // [PATCH] batteryStatus now uses batteryHealth (systemData.batterySOC) — single source of truth
  const batteryStatus = batteryHealth >= 80 ? 'Excellent' : batteryHealth >= 60 ? 'Good' : batteryHealth >= 40 ? 'Fair' : batteryHealth >= 20 ? 'Low' : 'Critical';

  const getAuthorityBadge = () => {
    if (controlAuthority === 'safety_override') return { text: 'Safety Override', cls: 'bg-red-600/80 text-white border-red-500' };
    if (controlAuthority === 'manual')          return { text: 'Manual Control',  cls: 'bg-amber-600/80 text-white border-amber-500' };
    return                                             { text: 'Auto',            cls: 'bg-green-600/50 text-green-200 border-green-600' };
  };

  const TOTAL_SLIDES = 4;
  const handleTouchStart = (e: React.TouchEvent) => setTouchStartX(e.touches[0].clientX);
  const handleTouchEnd   = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) {
      if (diff > 0 && graphSlide < TOTAL_SLIDES - 1) setGraphSlide(s => s + 1);
      if (diff < 0 && graphSlide > 0)                setGraphSlide(s => s - 1);
    }
    setTouchStartX(null);
  };

  const toggleOutlet = (id: number): void => {
    if (!SSR4_Closed || (!K1_Solar && !K2_Grid)) return;
    if (id === 1) {
      const next = !localOutlet1Status;
      setLocalOutlet1Status(next);
      systemData.setOutlet1Status(next);
    } else {
      const next = !localOutlet2Status;
      setLocalOutlet2Status(next);
      systemData.setOutlet2Status(next);
    }
  };

  const handleModeChange_ssr = (mode: 'solar' | 'grid' | 'shutdown'): void => {
    if (controlAuthority === 'auto') return;
    if (controlAuthority === 'safety_override') return;
    if (manualLockoutRemaining > 0) return;
    systemData.enterManualMode(mode);
  };

  const handleAutoSwitchToggle = (enableAuto: boolean): void => {
    if (controlAuthority === 'safety_override' || manualLockoutRemaining > 0) return;
    if (enableAuto) {
      systemData.exitManualMode();
    } else {
      systemData.setAutoSwitchEnabled(false);
    }
  };

  const handleToggleK1_ssr = (): void => {
    if (controlAuthority === 'auto' || controlAuthority === 'safety_override' || manualLockoutRemaining > 0) return;
    systemData.setK1(!K1_Solar);
  };

  const handleToggleK2_ssr = (): void => {
    if (controlAuthority === 'auto' || controlAuthority === 'safety_override' || manualLockoutRemaining > 0) return;
    systemData.setK2(!K2_Grid);
  };

  const handleEmergency_ssr = async (): Promise<void> => {
    // Match UnifiedSSROutletCard: setK1+setK2 false, then enterManualMode shutdown
    systemData.setK1(false);
    systemData.setK2(false);
    systemData.enterManualMode('shutdown');
    try {
      await fetch('/api/ssr/emergency', { method: 'POST' });
    } catch (err) {
      console.error('[Kiosk] Emergency cutoff failed:', err);
    }
  };

  // ============================================================================
  // MAIN MENU
  // ============================================================================
  const renderMainMenu = () => {
    return (
      <div className="relative h-full p-3 sm:p-4 md:p-6 flex flex-col text-white">
        <div className="flex items-center justify-between pb-2 sm:pb-3 border-b border-blue-700/50">
          <div className="flex items-center gap-2">
            <div className="h-6 sm:h-8 md:h-10 w-6 sm:w-8 md:w-10 bg-blue-500 rounded-full flex items-center justify-center">
              <Zap className="w-3 sm:w-4 md:w-5 h-3 sm:h-4 md:h-5 text-white"/>
            </div>
            <span className="text-4xl text-slate-100">HelioGrid</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className={`flex items-center gap-1 px-1.5 py-1 rounded-lg border ${getTempStatus(systemTemp).bg} ${systemTemp >= 60 ? 'border-red-500/40' : systemTemp >= 50 ? 'border-orange-500/40' : 'border-green-500/40'}`}>
              <Thermometer className={`w-4 h-5 sm:w-4 sm:h-5 ${getTempStatus(systemTemp).color}`}/>
              <span className={`text-2xl ${getTempStatus(systemTemp).color}`}>{systemTemp.toFixed(1)}°C</span>
            </div>
            <button onClick={() => navigateTo('theme')} className="p-1.5 sm:p-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 transition-all active:scale-100">
              <Palette className="w-5 h-5 sm:w-6 sm:h-6 text-purple-300"/>
            </button>
            <Wifi className="w-5 h-5 sm:w-6 sm:h-6 text-green-400"/>
            <div className="flex items-center gap-1 text-2xl">
              <Clock className="w-5 h-5 sm:w-5 sm:h-5"/>
              <span className="hidden sm:inline">{serverTime
                ? new Date(serverTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                : new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-2 gap-2 sm:gap-3 md:gap-4 py-3">
          {/* GRID — main: Voltage, subtitle: Hz + status */}
          <button onClick={() => navigateTo('grid')} className="bg-gradient-to-br from-blue-900/60 to-cyan-800/30 hover:from-blue-800/70 hover:to-cyan-700/40 backdrop-blur-sm rounded-lg border border-blue-700/40 p-3 sm:p-4 flex flex-col shadow-lg transition-all active:scale-95 cursor-pointer">
            <div className="flex items-center gap-1 sm:gap-2 mb-2"><Zap className="w-7 h-7 sm:w-5 sm:h-5 text-blue-400 flex-shrink-0"/><span className="text-2xl text-blue-200">Grid Monitoring</span></div>
            <div className="flex-1 flex items-center justify-center"><div className="text-center">
              <div className={`text-7xl sm:text-5xl md:text-6xl leading-none mb-1 ${systemData.gridAnomaly === 'critical' ? 'text-red-400' : systemData.gridAnomaly === 'warning' ? 'text-yellow-400' : 'text-blue-400'}`}>{gridVoltage.toFixed(0)}V</div>
              <div className={`text-lg ${systemData.gridAnomaly === 'critical' ? 'text-red-400' : systemData.gridAnomaly === 'warning' ? 'text-yellow-400' : 'text-green-400'}`}>
                {systemData.gridAnomaly === 'critical' ? '✗ Critical' : systemData.gridAnomaly === 'warning' ? '⚠ Warning' : gridVoltage > 0 ? '✓ Normal' : '— No Power'}
              </div>
            </div></div>
          </button>
          {/* SOLAR — main: Power (W), subtitle: Array Voltage */}
          <button onClick={() => navigateTo('solar')} className="bg-gradient-to-br from-amber-900/60 to-yellow-800/30 hover:from-amber-800/70 hover:to-yellow-700/40 backdrop-blur-sm rounded-lg border border-yellow-700/40 p-3 sm:p-4 flex flex-col shadow-lg transition-all active:scale-95 cursor-pointer">
            <div className="flex items-center gap-1 sm:gap-2 mb-2"><Sun className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400 flex-shrink-0"/><span className="text-2xl text-yellow-200">Solar Monitoring</span></div>
            <div className="flex-1 flex items-center justify-center"><div className="text-center">
              <div className={`text-7xl sm:text-5xl md:text-6xl leading-none mb-1 ${solarAnomaly === 'critical' ? 'text-red-400' : solarAnomaly === 'warning' ? 'text-yellow-300' : 'text-yellow-400'}`}>
                {solarPower >= 1000 ? `${(solarPower / 1000).toFixed(2)}kW` : `${solarPower.toFixed(0)}W`}
              </div>
              <div className={`text-lg ${solarAnomaly === 'critical' ? 'text-red-400' : solarAnomaly === 'warning' ? 'text-yellow-300' : solarPower > 0 ? 'text-green-400' : 'text-slate-400'}`}>
                {solarAnomaly === 'critical' ? '✗ Critical' : solarAnomaly === 'warning' ? '⚠ Low Output' : solarPower > 0 ? '✓ Producing' : '— Night'}
              </div>
            </div></div>
          </button>
          {/* BATTERY — main: SOC %, subtitle: Pack Voltage */}
          <button onClick={() => navigateTo('battery')} className="bg-gradient-to-br from-green-900/60 to-emerald-800/30 hover:from-green-800/70 hover:to-emerald-700/40 backdrop-blur-sm rounded-lg border border-green-700/40 p-3 sm:p-4 flex flex-col shadow-lg transition-all active:scale-95 cursor-pointer">
            <div className="flex items-center gap-1 sm:gap-2 mb-2"><Battery className="w-4 h-4 sm:w-5 sm:h-5 text-green-400 flex-shrink-0"/><span className="text-2xl text-green-200">Battery Health</span></div>
            <div className="flex-1 flex items-center justify-center"><div className="text-center">
              <div className={`text-7xl sm:text-5xl md:text-6xl leading-none mb-1 ${batteryAnomaly === 'critical' ? 'text-red-400' : batteryAnomaly === 'warning' ? 'text-yellow-400' : 'text-green-400'}`}>{batteryHealth.toFixed(0)}%</div>
              <div className={`text-lg ${batteryAnomaly === 'critical' ? 'text-red-400' : batteryAnomaly === 'warning' ? 'text-yellow-400' : 'text-green-400'}`}>
                {batteryAnomaly === 'critical' ? '✗ Critical' : batteryAnomaly === 'warning' ? '⚠ Low' : batteryVoltage > 0 ? '✓ ' + batteryStatus : '— No Data'}
              </div>
            </div></div>
          </button>
          {/* PANELS — main: Avg Health %, subtitle: array spec */}
          <button onClick={() => navigateTo('panels')} className="bg-gradient-to-br from-orange-900/60 to-red-800/30 hover:from-orange-800/70 hover:to-red-700/40 backdrop-blur-sm rounded-lg border border-orange-700/40 p-3 sm:p-4 flex flex-col shadow-lg transition-all active:scale-95 cursor-pointer">
            <div className="flex items-center gap-1 sm:gap-2 mb-2"><Sun className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400 flex-shrink-0"/><span className="text-2xl text-orange-200">Solar Panels</span></div>
            <div className="flex-1 flex items-center justify-center"><div className="text-center">
              {(() => {
                const ctxC = systemData.stringCurrents;
                const PANEL_IMP = 13.28;  // JAM72D40-590/MB Imp
                const isDay = (() => { const h = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Manila'})).getHours(); return h>=6&&h<18; })();
                const hasSolar = solarVoltage > 0 || solarCurrent > 0;
                const currents = (ctxC && ctxC.length === 4) ? ctxC : [solarCurrent/4, solarCurrent/4, solarCurrent/4, solarCurrent/4];
                const avgHealth = hasSolar && isDay
                  ? Math.round(currents.reduce((s,c) => s + Math.min(100, (c/PANEL_IMP)*100), 0) / 4)
                  : null;
                const healthColor = avgHealth === null ? 'text-slate-400' : avgHealth >= 70 ? 'text-orange-400' : avgHealth >= 40 ? 'text-yellow-400' : 'text-red-400';
                return (<>
                  <div className={`text-7xl sm:text-5xl md:text-6xl leading-none mb-1 ${healthColor}`}>
                    {avgHealth !== null ? `${avgHealth}%` : isDay ? '—%' : 'Night'}
                  </div>
                  <div className="text-lg text-orange-300/80">
                    {avgHealth === null ? (isDay ? '— No Sensor' : '— Night Mode') : avgHealth >= 70 ? '✓ Optimal' : avgHealth >= 40 ? '⚠ Warning' : '✗ Critical'}
                  </div>
                </>);
              })()}
            </div></div>
          </button>
        </div>

        <button onClick={() => navigateTo('graph')} className="mb-2 bg-gradient-to-br from-purple-900/60 to-pink-800/30 hover:from-purple-800/70 hover:to-pink-700/40 backdrop-blur-sm rounded-lg border border-purple-700/40 p-3 flex items-center justify-between shadow-lg transition-all active:scale-95 cursor-pointer">
          <div className="flex items-center gap-2"><Activity className="w-7 h-7 text-purple-400"/><span className="text-2xl text-purple-200">Real-time Graph</span></div>
          <div className="text-lg text-purple-300">Tap to view →</div>
        </button>
        <button onClick={() => navigateTo('ssr')} className="mb-2 bg-gradient-to-br from-cyan-900/60 to-indigo-800/30 hover:from-cyan-800/70 hover:to-indigo-700/40 backdrop-blur-sm rounded-lg border border-cyan-700/40 p-3 flex items-center justify-between shadow-lg transition-all active:scale-95 cursor-pointer">
          <div className="flex items-center gap-2"><ArrowLeftRight className="w-7 h-7 text-cyan-400"/><span className="text-2xl text-cyan-200">SSR Control</span></div>
          <div className="text-lg text-cyan-300">Manage outlets →</div>
        </button>

        <div className="backdrop-blur-sm rounded-lg px-2 sm:px-3 py-1.5 flex items-center justify-between border border-blue-700/20">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
              controlAuthority === 'safety_override' ? 'bg-red-500 animate-pulse' :
              controlAuthority === 'manual'          ? 'bg-amber-400 animate-pulse' :
              systemData.anomalyLevel === 'critical' ? 'bg-red-500 animate-pulse' :
              systemData.anomalyLevel === 'warning'  ? 'bg-yellow-400 animate-pulse' :
              SSR4_Closed                            ? 'bg-green-500 animate-pulse' :
                                                      'bg-red-500'
            }`}/>
            <span className={`text-lg ${
              controlAuthority === 'safety_override' ? 'text-red-300' :
              controlAuthority === 'manual'          ? 'text-amber-300' :
              systemData.anomalyLevel === 'critical' ? 'text-red-300' :
              systemData.anomalyLevel === 'warning'  ? 'text-yellow-300' :
              SSR4_Closed                            ? 'text-green-300' :
                                                      'text-red-300'
            }`}>{systemCondition}</span>
          </div>
          <div className={`absolute left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-xs border ${getAuthorityBadge().cls}`}>{getAuthorityBadge().text}</div>
          <div className="text-lg text-blue-400">v2.1.4</div>
        </div>
      </div>
    );
  };
  // ============================================================================
  // GRID DETAIL
  // ============================================================================
  const renderGridDetail = () => {
    const hasGridData = gridVoltage > 0;
    const gridAnom    = systemData.gridAnomaly ?? 'none';
    const gVoltStatus = !hasGridData ? 'No Data' : gridAnom === 'critical' ? 'Critical' : gridAnom === 'warning' ? 'Warning' : gridStatus;
    const gCurrStatus = !hasGridData ? 'No Data' : gridCurrent <= 5 ? 'Normal' : 'High';
    const gFreqStatus = !hasGridData ? 'No Data' : gridFrequency >= 59.5 && gridFrequency <= 60.5 ? 'Stable' : 'Unstable';
    const vBarPct  = hasGridData ? Math.max(2, Math.min(100, (gridVoltage  / 250)  * 100)) : 0;  // min 2% so bar visible
    const cBarPct  = hasGridData && gridCurrent > 0 ? Math.max(2, Math.min(100, (gridCurrent / 10) * 100)) : 0;
    const gPBarPct = hasGridData && gridPowerW  > 0 ? Math.max(2, Math.min(100, (gridPowerW  / 2500) * 100)) : 0;

    return (
      <div className="relative h-full p-3 sm:p-4 flex flex-col text-white overflow-hidden">
        <div className="relative flex items-center justify-between pb-3 border-b border-blue-600/60 flex-shrink-0">
          <button onClick={() => navigateTo('main')} className="flex items-center gap-1 text-blue-300 hover:text-blue-200 transition-colors">
            <ChevronLeft className="w-7 h-7"/><span className="text-3xl">Back</span>
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
            <Zap className="w-8 h-8 text-blue-400"/>
            <span className="text-3xl">Grid Monitoring</span>
          </div>
          <div className={`w-3 h-3 rounded-full ${!hasGridData ? 'bg-slate-400' : gridAnom === 'none' ? 'bg-green-500 animate-pulse' : gridAnom === 'warning' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500 animate-pulse'}`}/>
        </div>
        <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-3 pt-3 min-h-0">
          <div style={{ border: `2px solid ${!hasGridData ? '#475569' : gridAnom === 'none' ? '#60a5fa' : gridAnom === 'warning' ? '#facc15' : '#f87171'}`, boxShadow: `0 0 12px ${!hasGridData ? 'rgba(71,85,105,0.3)' : gridAnom === 'none' ? 'rgba(96,165,250,0.4)' : 'rgba(248,113,113,0.4)'}` }} className="rounded-xl bg-slate-800/70 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><Zap className={`w-6 h-6 ${!hasGridData ? 'text-slate-500' : gridAnom === 'none' ? 'text-blue-400' : gridAnom === 'warning' ? 'text-yellow-400' : 'text-red-400'}`}/><span style={{fontSize:'1.9rem',fontWeight:700}}>Voltage</span></div>
              <span className={`text-2xl font-semibold ${!hasGridData ? 'text-slate-400' : gridAnom === 'none' ? 'text-green-400' : gridAnom === 'warning' ? 'text-yellow-400' : 'text-red-400'}`}>{gVoltStatus}</span>
            </div>
            <div className="flex items-end gap-2">
              <span style={{fontSize:'4.5rem',lineHeight:1,fontWeight:700}} className={`${!hasGridData ? 'text-slate-500' : gridAnom === 'none' ? 'text-blue-400' : gridAnom === 'warning' ? 'text-yellow-400' : 'text-red-400'}`}>{gridVoltage.toFixed(1)}</span>
              <span style={{fontSize:'2.2rem',marginBottom:'0.4rem',fontWeight:600}} className={`${!hasGridData ? 'text-slate-500' : 'text-blue-300'}`}>V</span>
              {hasGridData && (gridVoltage > 230 ? <TrendingUp className="w-6 h-6 text-green-400 ml-auto mb-1"/> : gridVoltage < 230 ? <TrendingDown className="w-6 h-6 text-red-400 ml-auto mb-1"/> : null)}
            </div>
            <div>
              <div className="h-5 bg-slate-700 rounded-full overflow-hidden mb-2"><div className={`h-full rounded-full transition-all duration-700`} style={{ width: `${vBarPct}%`, background: !hasGridData ? '#475569' : gridAnom === 'none' ? 'linear-gradient(to right,#1d4ed8,#60a5fa)' : gridAnom === 'warning' ? 'linear-gradient(to right,#a16207,#facc15)' : 'linear-gradient(to right,#b91c1c,#f87171)' }}/></div>
              <div className="flex justify-between text-slate-500" style={{fontSize:'1.3rem'}}><span>0V</span><span>200V</span><span>250V max</span></div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-700/40 pt-2"><span className="text-2xl text-slate-400 font-medium">Nom. Range</span><span style={{fontSize:'1.5rem',fontWeight:700}} className="text-blue-300">200 – 240V</span></div>
          </div>
          <div style={{ border: `2px solid ${!hasGridData ? '#475569' : '#c084fc'}`, boxShadow: `0 0 12px ${!hasGridData ? 'rgba(71,85,105,0.3)' : 'rgba(192,132,252,0.4)'}` }} className="rounded-xl bg-slate-800/70 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><Activity className={`w-6 h-6 ${!hasGridData ? 'text-slate-500' : 'text-purple-400'}`}/><span style={{fontSize:'1.9rem',fontWeight:700}}>Current</span></div>
              <span className={`text-2xl font-semibold ${!hasGridData ? 'text-slate-400' : gridCurrent <= 5 ? 'text-green-400' : 'text-yellow-400'}`}>{gCurrStatus}</span>
            </div>
            <div className="flex items-end gap-2">
              <span style={{fontSize:'4.5rem',lineHeight:1,fontWeight:700}} className={`${!hasGridData ? 'text-slate-500' : 'text-purple-400'}`}>{gridCurrent.toFixed(2)}</span>
              <span style={{fontSize:'2.2rem',marginBottom:'0.4rem',fontWeight:600}} className={`${!hasGridData ? 'text-slate-500' : 'text-purple-300'}`}>A</span>
            </div>
            <div>
              <div className="h-5 bg-slate-700 rounded-full overflow-hidden mb-2"><div className={`h-full rounded-full transition-all duration-700`} style={{ width: `${cBarPct}%`, background: !hasGridData ? '#475569' : gridCurrent <= 5 ? 'linear-gradient(to right,#6b21a8,#c084fc)' : 'linear-gradient(to right,#a16207,#facc15)' }}/></div>
              <div className="flex justify-between text-slate-500" style={{fontSize:'1.3rem'}}><span>0A</span><span>5A</span><span>10A max</span></div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-700/40 pt-2"><span className="text-2xl text-slate-400 font-medium">Max Load</span><span style={{fontSize:'1.5rem',fontWeight:700}} className="text-purple-300">10A</span></div>
          </div>
          <div style={{ border: `2px solid ${!hasGridData ? '#475569' : gridFrequency >= 59.5 && gridFrequency <= 60.5 ? '#818cf8' : '#facc15'}`, boxShadow: `0 0 12px rgba(129,140,248,0.4)` }} className="rounded-xl bg-slate-800/70 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><Activity className={`w-6 h-6 ${!hasGridData ? 'text-slate-500' : 'text-indigo-400'}`}/><span style={{fontSize:'1.9rem',fontWeight:700}}>Frequency</span></div>
              <span className={`text-2xl font-semibold ${!hasGridData ? 'text-slate-400' : gridFrequency >= 59.5 && gridFrequency <= 60.5 ? 'text-green-400' : 'text-yellow-400'}`}>{gFreqStatus}</span>
            </div>
            <div className="flex items-end gap-2">
              <span style={{fontSize:'4.5rem',lineHeight:1,fontWeight:700}} className={`${!hasGridData ? 'text-slate-500' : 'text-indigo-400'}`}>{gridFrequency.toFixed(1)}</span>
              <span style={{fontSize:'2.2rem',marginBottom:'0.4rem',fontWeight:600}} className={`${!hasGridData ? 'text-slate-500' : 'text-indigo-300'}`}>Hz</span>
            </div>
            <div>
              <div className="h-5 bg-slate-700 rounded-full overflow-hidden mb-2"><div className={`h-full rounded-full transition-all duration-700`} style={{ width: `${Math.min(100, ((gridFrequency - 55) / 10) * 100)}%`, background: !hasGridData ? '#475569' : gridFrequency >= 59.5 && gridFrequency <= 60.5 ? 'linear-gradient(to right,#3730a3,#818cf8)' : 'linear-gradient(to right,#a16207,#facc15)' }}/></div>
              <div className="flex justify-between text-slate-500" style={{fontSize:'1.3rem'}}><span>55Hz</span><span>60Hz</span><span>65Hz max</span></div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-700/40 pt-2"><span className="text-2xl text-slate-400 font-medium">Nom. Freq</span><span style={{fontSize:'1.5rem',fontWeight:700}} className="text-indigo-300">60 Hz</span></div>
          </div>
          <div style={{ border: `2px solid ${!hasGridData ? '#475569' : '#22d3ee'}`, boxShadow: `0 0 12px rgba(34,211,238,0.4)` }} className="rounded-xl bg-slate-800/70 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><Zap className={`w-6 h-6 ${!hasGridData ? 'text-slate-500' : 'text-cyan-400'}`}/><span style={{fontSize:'1.9rem',fontWeight:700}}>Power Draw</span></div>
              <span className={`text-2xl font-semibold ${!hasGridData ? 'text-slate-400' : gridPowerW > 0 ? 'text-green-400' : 'text-slate-400'}`}>{!hasGridData ? 'No Data' : gridPowerW > 0 ? 'Active' : 'Idle'}</span>
            </div>
            <div className="flex items-end gap-2">
              <span style={{fontSize:'4.5rem',lineHeight:1,fontWeight:700}} className={`${!hasGridData ? 'text-slate-500' : 'text-white'}`}>{gridPower}</span>
              <span style={{fontSize:'2.2rem',marginBottom:'0.4rem',fontWeight:600}} className={`${!hasGridData ? 'text-slate-500' : 'text-cyan-300'}`}>W</span>
            </div>
            <div>
              <div className="h-5 bg-slate-700 rounded-full overflow-hidden mb-2"><div className={`h-full rounded-full transition-all duration-700`} style={{ width: `${gPBarPct}%`, background: !hasGridData ? '#475569' : 'linear-gradient(to right,#0e7490,#22d3ee)' }}/></div>
              <div className="flex justify-between text-slate-500" style={{fontSize:'1.3rem'}}><span>0W</span><span>1250W</span><span>~2500W max</span></div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-700/40 pt-2"><span className="text-2xl text-slate-400 font-medium">PZEM-004T</span><span style={{fontSize:'1.5rem',fontWeight:700}} className="text-cyan-300">{(gridPowerW / 1000).toFixed(3)} kW</span></div>
          </div>
        </div>
        <div className="text-lg text-slate-500 text-center pt-2 mt-1 border-t border-slate-700/40 flex-shrink-0">📡 PZEM-004T Sensor</div>
      </div>
    );
  };
// ============================================================================
// SOLAR DETAIL — MAX KIOSK SIZE for 7" LCD
// Font scale: labels 1.5rem · units 1.8rem · values 3.4–4rem · titles 2rem
// ============================================================================
  const renderSolarDetail = () => {
    const hasSolarData    = solarVoltage > 0 || solarCurrent > 0 || Number(systemData.solarPower ?? 0) > 0;  // [BUG-FIX]
    const hasInverterData = acVoltage > 0 || acCurrent > 0;
    const solarAnom  = systemData.solarAnomaly   ?? 'none';
    const invAnom    = systemData.inverterAnomaly ?? 'none';
    // [BUG-FIX] Number() wrap — Flask returns power as string; without it .toFixed() crashes → blank bars.
    const _rawDcP     = Number(systemData.solarPower   ?? 0);
    const _rawAcP     = Number(systemData.inverterPower ?? 0);
    const dcPower:    number = _rawDcP > 0
      ? _rawDcP
      : (solarVoltage > 0 && solarCurrent > 0)
        ? parseFloat((solarVoltage * solarCurrent).toFixed(2))
        : 0;
    const acPowerNum: number = _rawAcP > 0
      ? _rawAcP
      : (acVoltage > 0 && acCurrent > 0)
        ? parseFloat((acVoltage * acCurrent).toFixed(2))
        : 0;
    const totalOutputW = dcPower + acPowerNum;
    // Progress bar: min 2% so bar is always visible when there's real data, max 100%
    const DC_MAX_W = 2360;  // 4×590W JAM72D40
    const AC_MAX_W = 3200;  // EcoSolax SP-3200
    const dcPBarRaw  = (dcPower / DC_MAX_W) * 100;
    const acPBarRaw  = (acPowerNum / AC_MAX_W) * 100;
    const dcPBarPct  = hasSolarData    && dcPower    > 0 ? Math.max(2, Math.min(100, dcPBarRaw)) : 0;
    const acPBarPct  = hasInverterData && acPowerNum > 0 ? Math.max(2, Math.min(100, acPBarRaw)) : 0;
    // MPPT efficiency: (dcPower / DC_MAX_W) * 100 — more accurate than context solarEfficiency which uses Flask's 2320W
    const mpptEff    = hasSolarData && dcPower > 0 ? Math.min(100, (dcPower / DC_MAX_W) * 100).toFixed(1) : '0';
    const acEff      = dcPower > 0 && acPowerNum > 0 ? Math.min(100, (acPowerNum / dcPower) * 100).toFixed(1) : '0';
    const dcStatusTxt = !hasSolarData ? 'No Data' : solarAnom === 'critical' ? 'Critical' : solarAnom === 'warning' ? 'Warning' : 'Normal';
    const acStatusTxt = !hasInverterData ? 'No Data' : invAnom === 'critical' ? 'Critical' : invAnom === 'warning' ? 'Warning' : 'Stable';

    // Shared style tokens — all maximized for 7" kiosk readability
    const S = {
      headerTitle:  { fontSize: '2rem',   lineHeight: 1 },
      backBtn:      { fontSize: '2rem',   lineHeight: 1 },
      panelTitle:   { fontSize: '1.9rem', fontWeight: 700, lineHeight: 1 },
      statusBadge:  { fontSize: '1.5rem', fontWeight: 600 },
      label:        { fontSize: '1.45rem', lineHeight: 1 },
      subLabel:     { fontSize: '1.1rem' },
      value:        { fontSize: '3.8rem', lineHeight: 1, fontWeight: 700 },
      unit:         { fontSize: '1.9rem', marginBottom: '0.3rem', fontWeight: 600 },
      powerValue:   { fontSize: '3.4rem', lineHeight: 1, fontWeight: 700 },
      powerUnit:    { fontSize: '1.7rem', marginBottom: '0.25rem' },
      barLabel:     { fontSize: '1.2rem' },
      footerLabel:  { fontSize: '1.4rem' },
      footerValue:  { fontSize: '2.4rem', lineHeight: 1, fontWeight: 700 },
      footerUnit:   { fontSize: '1.5rem', marginBottom: '0.15rem' },
      totalLabel:   { fontSize: '1.65rem' },
      totalValue:   { fontSize: '3.4rem', lineHeight: 1, fontWeight: 700 },
      totalUnit:    { fontSize: '1.8rem' },
      totalSub:     { fontSize: '1.25rem' },
      sensorLine:   { fontSize: '1.1rem' },
    };

    return (
      <div className="relative h-full p-3 sm:p-4 flex flex-col text-white overflow-hidden">

        {/* HEADER */}
        <div className="relative flex items-center justify-between pb-3 border-b border-yellow-600/60 flex-shrink-0">
          <button
            onClick={() => navigateTo('main')}
            className="flex items-center gap-1 text-yellow-300 hover:text-yellow-200 transition-colors"
          >
            <ChevronLeft className="w-10 h-10"/>
            <span style={S.backBtn}>Back</span>
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
            <Sun className="w-10 h-10 text-yellow-400"/>
            <span style={S.headerTitle}>Solar Monitoring</span>
          </div>
          <div className={`w-4 h-4 rounded-full ${
            !hasSolarData && !hasInverterData ? 'bg-slate-400'
            : solarAnom === 'none' && invAnom === 'none' ? 'bg-green-500 animate-pulse'
            : (solarAnom === 'critical' || invAnom === 'critical') ? 'bg-red-500 animate-pulse'
            : 'bg-yellow-500 animate-pulse'
          }`}/>
        </div>

        {/* MAIN PANELS */}
        <div className="flex-1 flex gap-3 pt-3 min-h-0">

          {/* DC OUTPUT */}
          <div
            style={{
              border: `2px solid ${
                !hasSolarData      ? '#475569'
                : solarAnom === 'critical' ? '#ef4444'
                : solarAnom === 'warning'  ? '#f97316'
                : '#fbbf24'
              }`,
              boxShadow: `0 0 14px ${
                !hasSolarData      ? 'rgba(71,85,105,0.3)'
                : solarAnom === 'critical' ? 'rgba(239,68,68,0.5)'
                : solarAnom === 'warning'  ? 'rgba(249,115,22,0.5)'
                : 'rgba(251,191,36,0.4)'
              }`,
            }}
            className="flex-1 rounded-xl bg-slate-800/70 p-4 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sun className={`w-8 h-8 ${!hasSolarData ? 'text-slate-500' : 'text-amber-400'}`}/>
                <span style={S.panelTitle} className="text-slate-200">DC Output</span>
              </div>
              <span style={S.statusBadge} className={
                !hasSolarData ? 'text-slate-400'
                : solarAnom === 'none' ? 'text-green-400'
                : solarAnom === 'warning' ? 'text-yellow-400'
                : 'text-red-400'
              }>{dcStatusTxt}</span>
            </div>

            <div className="flex-1 flex items-center">
              <div className="grid grid-cols-2 gap-3 w-full">
                <div>
                  <div style={S.label} className="text-slate-400 mb-1">Voltage</div>
                  <div className="flex items-end gap-1">
                    <span style={S.value} className={!hasSolarData ? 'text-slate-500' : 'text-amber-400'}>{solarVoltage.toFixed(1)}</span>
                    <span style={S.unit} className={!hasSolarData ? 'text-slate-500' : 'text-amber-300'}>V</span>
                  </div>
                  <div style={S.subLabel} className="text-slate-500 mt-1">Vmp 88.9V · Voc 104.7V (2S)</div>
                </div>
                <div>
                  <div style={S.label} className="text-slate-400 mb-1">Current</div>
                  <div className="flex items-end gap-1">
                    <span style={S.value} className={!hasSolarData ? 'text-slate-500' : 'text-amber-400'}>{solarCurrent.toFixed(2)}</span>
                    <span style={S.unit} className={!hasSolarData ? 'text-slate-500' : 'text-amber-300'}>A</span>
                  </div>
                  <div style={S.subLabel} className="text-slate-500 mt-1">2P · Imp 26.6A · Isc 27.9A</div>
                </div>
              </div>
            </div>

            <div className="flex-1 flex items-center">
              <div className="w-full">
                <div className="flex items-center justify-between mb-2">
                  <span style={S.label} className="text-slate-400">DC Power</span>
                  <div className="flex items-end gap-1">
                    <span style={S.powerValue} className={!hasSolarData ? 'text-slate-500' : 'text-amber-400'}>{dcPower.toFixed(1)}</span>
                    <span style={S.powerUnit} className={!hasSolarData ? 'text-slate-500' : 'text-amber-300'}>W</span>
                  </div>
                </div>
                {/* Progress bar — h-6 for visibility, min 2% enforced in dcPBarPct */}
                <div className="h-6 rounded-full mb-1 relative" style={{ background: 'rgba(51,65,85,0.9)', border: '1px solid rgba(148,163,184,0.2)' }}>
                  <div
                    className={`h-full rounded-full transition-all duration-700`}
                    style={{
                      width: `${dcPBarPct}%`,
                      background: !hasSolarData || dcPower === 0
                        ? 'rgba(71,85,105,0.6)'
                        : solarAnom === 'critical'
                        ? 'linear-gradient(to right, #b91c1c, #ef4444)'
                        : solarAnom === 'warning'
                        ? 'linear-gradient(to right, #c2410c, #f97316)'
                        : 'linear-gradient(to right, #d97706, #fbbf24)',
                      boxShadow: dcPower > 0
                        ? solarAnom === 'critical' ? '0 0 14px rgba(239,68,68,0.9)'
                        : solarAnom === 'warning'  ? '0 0 14px rgba(249,115,22,0.9)'
                        : '0 0 14px rgba(251,191,36,0.85)'
                        : 'none',
                    }}
                  />
                </div>
                <div className="flex justify-between" style={S.barLabel}>
                  <span className="text-slate-500">0 W</span>
                  <span className="text-slate-500">{DC_MAX_W / 2} W</span>
                  <span className="text-slate-500">{DC_MAX_W} W</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-amber-700/40 pt-2">
              <span style={S.footerLabel} className="text-slate-400">MPPT Efficiency</span>
              <div className="flex items-end gap-1">
                <span style={S.footerValue} className={!hasSolarData ? 'text-slate-500' : 'text-amber-300'}>{mpptEff}</span>
                <span style={S.footerUnit} className={!hasSolarData ? 'text-slate-500' : 'text-amber-300'}>%</span>
              </div>
            </div>
          </div>

          {/* INVERTER AC */}
          <div
            style={{
              border: `2px solid ${
                !hasInverterData   ? '#475569'
                : invAnom === 'critical' ? '#ef4444'
                : invAnom === 'warning'  ? '#f97316'
                : '#60a5fa'
              }`,
              boxShadow: `0 0 14px ${
                !hasInverterData   ? 'rgba(71,85,105,0.3)'
                : invAnom === 'critical' ? 'rgba(239,68,68,0.5)'
                : invAnom === 'warning'  ? 'rgba(249,115,22,0.5)'
                : 'rgba(96,165,250,0.4)'
              }`,
            }}
            className="flex-1 rounded-xl bg-slate-800/70 p-4 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className={`w-8 h-8 ${!hasInverterData ? 'text-slate-500' : 'text-blue-400'}`}/>
                <span style={S.panelTitle} className="text-slate-200">Inverter AC</span>
              </div>
              <span style={S.statusBadge} className={
                !hasInverterData ? 'text-slate-400'
                : invAnom === 'none' ? 'text-green-400'
                : invAnom === 'warning' ? 'text-yellow-400'
                : 'text-red-400'
              }>{acStatusTxt}</span>
            </div>

            <div className="flex-1 flex items-center">
              <div className="grid grid-cols-2 gap-3 w-full">
                <div>
                  <div style={S.label} className="text-slate-400 mb-1">Voltage</div>
                  <div className="flex items-end gap-1">
                    <span style={S.value} className={!hasInverterData ? 'text-slate-500' : invAnom === 'critical' ? 'text-red-400' : invAnom === 'warning' ? 'text-yellow-400' : 'text-blue-400'}>{acVoltage.toFixed(1)}</span>
                    <span style={S.unit} className={!hasInverterData ? 'text-slate-500' : 'text-blue-200'}>V</span>
                  </div>
                  <div style={S.subLabel} className="text-slate-500 mt-1">Nom 230V · Max 253V</div>
                </div>
                <div>
                  <div style={S.label} className="text-slate-400 mb-1">Current</div>
                  <div className="flex items-end gap-1">
                    <span style={S.value} className={!hasInverterData ? 'text-slate-500' : 'text-blue-400'}>{acCurrent.toFixed(2)}</span>
                    <span style={S.unit} className={!hasInverterData ? 'text-slate-500' : 'text-blue-200'}>A</span>
                  </div>
                  <div style={S.subLabel} className="text-slate-500 mt-1">Nom ~13.9A @ 230V</div>
                </div>
              </div>
            </div>

            <div className="flex-1 flex items-center">
              <div className="w-full">
                <div className="flex items-center justify-between mb-2">
                  <span style={S.label} className="text-slate-400">AC Power</span>
                  <div className="flex items-end gap-1">
                    <span style={S.powerValue} className={!hasInverterData ? 'text-slate-500' : 'text-blue-400'}>{acPowerNum.toFixed(1)}</span>
                    <span style={S.powerUnit} className={!hasInverterData ? 'text-slate-500' : 'text-blue-200'}>W</span>
                  </div>
                </div>
                {/* Progress bar — h-6, min 2% enforced in acPBarPct */}
                <div className="h-6 rounded-full mb-1 relative" style={{ background: 'rgba(51,65,85,0.9)', border: '1px solid rgba(148,163,184,0.2)' }}>
                  <div
                    className={`h-full rounded-full transition-all duration-700`}
                    style={{
                      width: `${acPBarPct}%`,
                      background: !hasInverterData || acPowerNum === 0
                        ? 'rgba(71,85,105,0.6)'
                        : invAnom === 'critical'
                        ? 'linear-gradient(to right, #b91c1c, #ef4444)'
                        : invAnom === 'warning'
                        ? 'linear-gradient(to right, #c2410c, #f97316)'
                        : 'linear-gradient(to right, #1d4ed8, #60a5fa)',
                      boxShadow: acPowerNum > 0
                        ? invAnom === 'critical' ? '0 0 14px rgba(239,68,68,0.9)'
                        : invAnom === 'warning'  ? '0 0 14px rgba(249,115,22,0.9)'
                        : '0 0 14px rgba(96,165,250,0.9)'
                        : 'none',
                    }}
                  />
                </div>
                <div className="flex justify-between" style={S.barLabel}>
                  <span className="text-slate-500">0 W</span>
                  <span className="text-slate-500">{AC_MAX_W / 2} W</span>
                  <span className="text-slate-500">{AC_MAX_W} W</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-blue-700/40 pt-2">
              <div className="flex items-end gap-2">
                <span style={S.footerLabel} className="text-slate-400">Frequency</span>
                <span style={S.footerValue} className={!hasInverterData ? 'text-slate-500' : 'text-blue-400'}>
                  {acCurrent > 0 || acVoltage > 0 ? inverterFrequency.toFixed(1) : '0.0'}
                </span>
                <span style={S.footerUnit} className="text-slate-400">Hz</span>
              </div>
              <div className="flex items-end gap-2">
                <span style={S.footerLabel} className="text-slate-400">AC Eff</span>
                <span style={S.footerValue} className={!hasInverterData ? 'text-slate-500' : 'text-blue-400'}>{acEff}</span>
                <span style={S.footerUnit} className={!hasInverterData ? 'text-slate-500' : 'text-blue-200'}>%</span>
              </div>
            </div>
          </div>
        </div>

        {/* TOTAL SOLAR OUTPUT */}
        <div className="pt-2 mt-2 border-t border-yellow-700/40 flex-shrink-0">
          <div className="flex items-center justify-between">
            <span style={S.totalLabel} className="text-slate-300">Total Solar Output</span>
            <div className="flex items-center gap-3">
              <div className="flex items-end gap-1">
                <span style={S.totalValue} className={!hasSolarData && !hasInverterData ? 'text-slate-500' : 'text-amber-400'}>
                  {totalOutputW.toFixed(1)}
                </span>
                <span style={S.totalUnit} className="text-amber-300">W</span>
              </div>
              <span style={S.totalSub} className="text-slate-400">
                DC {dcPower.toFixed(1)} W + AC {acPowerNum.toFixed(1)} W
              </span>
            </div>
          </div>
        </div>

        {/* SENSOR LINE */}
        <div style={S.sensorLine} className="text-slate-500 text-center pt-1.5 border-t border-slate-700/40 flex-shrink-0">
          📡 WCS1500 ×4 (Per-Panel DC) + PZEM-004T (AC Inverter)
        </div>
      </div>
    );
  };
 // ============================================================================
// renderBatteryDetail() — scroll fix applied
// REPLACE the entire renderBatteryDetail() in your KioskLCD.tsx with this
// ============================================================================
  const renderBatteryDetail = () => {
    const batteryBank2Voltage   = (systemData as any).batteryBank2Voltage   ?? 0;
    const batteryBankBAvailable = (systemData as any).batteryBankBAvailable ?? false;
    const batteryCapacityAh     = (systemData as any).batteryCapacityAh     ?? 100;
    const batteryAnomalyDetails = (systemData as any).batteryAnomalyDetails ?? [] as string[];

    const is200Ah       = batteryBankBAvailable;
    const capacityLabel = is200Ah ? '200Ah' : '100Ah';
    const bankLabel     = is200Ah ? 'Dual' : 'Single';
    const pzemCount     = is200Ah ? '2' : '1';
    const cellCount     = is200Ah ? '4× 12V' : '2× 12V';

    // INA219 dual: 0x41=B1, 0x44=B2 — each measures its own 12V cell directly
    const b1v = (systemData as any).battery1Voltage ?? 0;
    const b1i = (systemData as any).battery1Current ?? 0;
    const b2v = (systemData as any).battery2Voltage ?? 0;
    const b2i = (systemData as any).battery2Current ?? 0;
    const b1_ok = b1v > 2.0;
    const b2_ok = b2v > 2.0;

    // 12V Lead Acid SOC lookup per cell
    const calcCellSOC = (v: number): number => {
      if (v >= 12.7) return 100; if (v >= 12.5) return 90; if (v >= 12.3) return 80;
      if (v >= 12.1) return 70;  if (v >= 12.0) return 60; if (v >= 11.9) return 50;
      if (v >= 11.8) return 40;  if (v >= 11.6) return 30; if (v >= 11.5) return 20;
      if (v >= 11.0) return 10;  return 0;
    };

    const hasBattData = b1_ok || b2_ok || batteryVoltage > 0 || Math.abs(batteryCurrent) > 0;
    const isCharging  = systemData.batteryCurrent > 0;
    const packSOC     = batteryHealth;
    const batPower    = (batteryVoltage * Math.abs(batteryCurrent)).toFixed(1);
    // Pack voltage = SERIES SUM (24V system: B1+B2)
    const packVoltageDisplay = (b1_ok || b2_ok)
      ? (b1_ok && b2_ok ? b1v + b2v : b1_ok ? b1v : b2v)
      : batteryVoltage;
    // Voltage bar: 24V range 21.0V (0%) → 25.4V (100%)
    const voltPct     = Math.max(0, Math.min(100, ((packVoltageDisplay - 21.0) / (25.4 - 21.0)) * 100));
    const b1SOCPct    = calcCellSOC(b1v);
    const b2SOCPct    = calcCellSOC(b2v);
    const batCurrentMax = is200Ah ? 200 : 100;
    const currPct     = Math.max(0, Math.min(100, (Math.abs(batteryCurrent) / batCurrentMax) * 100));

    // 24V series pack SOC lookup (B1V + B2V = ~24V)
    const calcPackSOC24 = (v: number): number => {
      if (v >= 25.4) return 100; if (v >= 24.8) return 90; if (v >= 24.6) return 80;
      if (v >= 24.2) return 70;  if (v >= 24.0) return 60; if (v >= 23.8) return 50;
      if (v >= 23.6) return 40;  if (v >= 23.2) return 30; if (v >= 23.0) return 20;
      if (v >= 22.0) return 10;  return 0;
    };

    // Compute pack SOC from 24V series voltage (more accurate than averaging 12V cell SOCs)
    const computedPackSOC = (b1_ok || b2_ok)
      ? calcPackSOC24(packVoltageDisplay)
      : packSOC;

    const ringColor = !hasBattData ? '#475569'
      : computedPackSOC >= 80 ? '#34d399'
      : computedPackSOC >= 50 ? '#facc15'
      : computedPackSOC >= 20 ? '#fb923c'
      : '#f87171';
    const ringGlow = !hasBattData ? 'rgba(71,85,105,0.3)'
      : computedPackSOC >= 80 ? 'rgba(52,211,153,0.45)'
      : computedPackSOC >= 50 ? 'rgba(250,204,21,0.45)'
      : computedPackSOC >= 20 ? 'rgba(251,146,60,0.45)'
      : 'rgba(248,113,113,0.45)';
    const socTextClass = !hasBattData ? 'text-slate-400'
      : computedPackSOC >= 80 ? 'text-emerald-400'
      : computedPackSOC >= 50 ? 'text-yellow-400'
      : computedPackSOC >= 20 ? 'text-orange-400'
      : 'text-red-400';
    const socStatus = !hasBattData ? 'No Data'
      : computedPackSOC >= 80 ? 'Excellent'
      : computedPackSOC >= 50 ? 'Good'
      : computedPackSOC >= 20 ? 'Fair'
      : 'Critical';
    const voltStatus = !hasBattData ? 'No Data'
      : packVoltageDisplay >= 24.6 ? 'Normal'
      : packVoltageDisplay >= 23.0 ? 'Fair'
      : 'Low';
    const currStatus = !hasBattData ? 'No Data' : isCharging ? 'Charging' : 'Discharging';

    const VW = 240, VH = 420;
    const NW = 80, NH = 20, NR = 10;
    const BW = 220, BH = 370, BR = 26;
    const bx = (VW - BW) / 2, by = NH + 2;
    const nx = (VW - NW) / 2, ny = 0;
    const PAD = 12;
    const fillMaxH = BH - PAD * 2;
    const fillH    = Math.max(0, (computedPackSOC / 100) * fillMaxH);
    const fillY    = by + PAD + (fillMaxH - fillH);
    const fillX    = bx + PAD;
    const fillW    = BW - PAD * 2;
    const segments = [20, 40, 60, 80].map(pct => ({
      y: by + PAD + fillMaxH * (1 - pct / 100),
      active: computedPackSOC >= pct,
    }));

    const bankASOC = computedPackSOC;
    const bankBSOC = is200Ah ? (() => {
      const bv = batteryBank2Voltage;
      if (bv >= 25.4) return 100;
      if (bv >= 24.8) return 90;
      if (bv >= 24.6) return 80;
      if (bv >= 24.2) return 70;
      if (bv >= 24.0) return 60;
      if (bv >= 23.8) return 50;
      if (bv >= 23.6) return 40;
      if (bv >= 23.2) return 30;
      if (bv >= 23.0) return 20;
      if (bv >= 22.0) return 10;
      if (bv >= 21.6) return 5;
      return 0;
    })() : 0;

    type CellDef = { label: string; name: string; voltage: number; current: number; soc: number; online: boolean; };
    const cellDefs: CellDef[] = [
      { label: 'B1', name: 'Battery 1 (0x41)', voltage: b1v, current: b1i, soc: b1SOCPct, online: b1_ok },
      { label: 'B2', name: 'Battery 2 (0x44)', voltage: b2v, current: b2i, soc: b2SOCPct, online: b2_ok },
    ];

    // 12V Lead Acid thresholds (single cell, INA219)
    const getCellBorder = (soc: number, online: boolean) =>
      !online ? '#334155' : soc >= 80 ? '#34d399' : soc >= 50 ? '#facc15' : soc >= 20 ? '#fb923c' : '#f87171';
    const getCellStatusColor = (soc: number, online: boolean) =>
      !online ? 'text-slate-600' : soc >= 80 ? 'text-emerald-400' : soc >= 50 ? 'text-yellow-400' : soc >= 20 ? 'text-orange-400' : 'text-red-400';
    const getCellStatus = (soc: number, online: boolean) =>
      !online ? 'Offline' : soc >= 80 ? 'Excellent' : soc >= 50 ? 'Good' : soc >= 20 ? 'Fair' : 'Critical';

    return (
      <div className="relative h-full p-3 sm:p-4 flex flex-col text-white overflow-hidden">

        {/* Header */}
        <div className="relative flex items-center justify-between pb-3 border-b border-green-600/60 flex-shrink-0">
          <button onClick={() => navigateTo('main')} className="flex items-center gap-1 text-green-300 hover:text-green-200 transition-colors">
            <ChevronLeft className="w-7 h-7" /><span className="text-3xl">Back</span>
          </button>
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
            <Battery className="w-7 h-7 text-green-400" />
            <span className="text-3xl">Battery Health · {capacityLabel}</span>
          </div>
          <div className={`w-3 h-3 rounded-full ${
            batteryAnomaly === 'critical' ? 'bg-red-500 animate-pulse'
            : batteryAnomaly === 'warning' ? 'bg-yellow-400 animate-pulse'
            : !hasBattData ? 'bg-slate-400'
            : isCharging ? 'bg-green-500 animate-pulse'
            : 'bg-blue-500 animate-pulse'
          }`} />
        </div>

        {/* K3 banner */}
        {k3Active && (
          <div className="mt-2 flex-shrink-0 px-3 py-1.5 rounded-lg bg-teal-900/40 border border-teal-600/50 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
            <span className="text-base text-teal-300">
              K3 GRID ASSIST ACTIVE — {k3ModeLabel} ({batteryVoltage.toFixed(1)}V · switched {lastSwitchTime})
            </span>
          </div>
        )}

        {/* Anomaly banner */}
        {batteryAnomalyDetails.length > 0 && (
          <div className="mt-2 flex-shrink-0 px-3 py-1.5 rounded-lg bg-red-900/40 border border-red-600/50">
            <div className="text-xs font-semibold text-red-400 mb-1">⚠ Battery Anomalies</div>
            {batteryAnomalyDetails.map((msg: string, i: number) => (
              <div key={i} className="text-xs text-red-300">{msg}</div>
            ))}
          </div>
        )}

        {/* Two-column layout */}
        <div className="flex-1 flex gap-3 pt-3 min-h-0">

          {/* LEFT: Battery SVG */}
          <div
            className="flex-1 rounded-xl bg-slate-800/70 p-2 flex flex-col"
            style={{ border: `2px solid ${ringColor}`, boxShadow: `0 0 18px ${ringGlow}` }}
          >
            <div className="flex items-center justify-between flex-shrink-0 px-1 pt-1 pb-0">
              <div className="flex items-center gap-1.5">
                <Battery className={`w-5 h-5 ${socTextClass}`} />
                <span className="text-2xl text-slate-300 font-semibold">Pack SOC</span>
              </div>
              <span className={`text-lg font-semibold ${socTextClass}`}>{socStatus}</span>
            </div>

            <div className="flex-1 flex items-stretch min-h-0 w-full">
              <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet"
                style={{ width: '100%', height: '100%', overflow: 'visible', display: 'block' }}>
                <defs>
                  <clipPath id="battBodyClip">
                    <rect x={bx} y={by} width={BW} height={BH} rx={BR} ry={BR} />
                  </clipPath>
                  <linearGradient id="liquidGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ringColor} stopOpacity="1" />
                    <stop offset="100%" stopColor={ringColor} stopOpacity="0.55" />
                  </linearGradient>
                  <filter id="battGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                <rect x={nx} y={ny} width={NW} height={NH + BR / 2} rx={NR} ry={NR} fill="#1e293b" stroke={ringColor} strokeWidth="2" />
                <rect x={bx} y={by} width={BW} height={BH} rx={BR} ry={BR} fill="#0f172a" stroke={ringColor} strokeWidth="3" filter="url(#battGlow)" />
                {computedPackSOC > 0 && (
                  <rect x={fillX} y={fillY} width={fillW} height={Math.max(1, fillH)}
                    rx={Math.min(12, BR - 4)} ry={Math.min(12, BR - 4)}
                    fill="url(#liquidGrad)" clipPath="url(#battBodyClip)"
                    style={{ transition: 'y 1s cubic-bezier(0.4,0,0.2,1), height 1s cubic-bezier(0.4,0,0.2,1)' }}
                  />
                )}
                {/* segments removed — clean look */}
                {isCharging && hasBattData && (
                  <text x={VW / 2} y={by + BH * 0.50 + 14} textAnchor="middle" fontSize="80" fill="rgba(255,255,255,0.20)">⚡</text>
                )}
                <text x={VW / 2} y={by + BH * 0.36} textAnchor="middle" dominantBaseline="middle"
                  fontSize="64" fontWeight="bold" fill={hasBattData ? 'white' : '#475569'}
                >{computedPackSOC.toFixed(0)}%</text>
                <text x={VW / 2} y={by + BH * 0.36 + 64} textAnchor="middle" fontSize="24"
                  fill={hasBattData ? 'rgba(255,255,255,0.55)' : '#334155'}>{socStatus}</text>
                <text x={VW / 2} y={by + BH * 0.36 + 96} textAnchor="middle" fontSize="20"
                  fill={!hasBattData ? '#334155' : isCharging ? '#34d399' : '#93c5fd'}
                >{!hasBattData ? '— No Data' : isCharging ? '▲ Charging' : '▼ Discharging'}</text>
                <text x={VW / 2} y={by + BH - 52} textAnchor="middle" fontSize="18" fill="rgba(255,255,255,0.35)">Pack Power</text>
                <text x={VW / 2} y={by + BH - 20} textAnchor="middle" fontSize="38" fontWeight="bold"
                  fill={!hasBattData ? '#475569' : isCharging ? '#34d399' : '#60a5fa'}
                >{batPower} W</text>
              </svg>
            </div>

            <div className="flex-shrink-0 flex justify-center pt-1 border-t border-green-700/30">
              <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${
                isPZEM017 ? 'bg-green-900/60 text-green-400 border-green-700/50' : 'bg-amber-900/60 text-amber-400 border-amber-700/50'
              }`}>
              📡 INA219 × 2 · 24V {capacityLabel} ({cellCount} Lead Acid {bankLabel})
              </span>
            </div>
          </div>

          {/* RIGHT: Battery data — fills entire box, no wasted space */}
          <div
            className="flex-1 rounded-xl bg-slate-800/70 flex flex-col min-h-0"
            style={{
              border: `2px solid ${!hasBattData ? '#475569' : '#4ade80'}`,
              boxShadow: `0 0 12px ${!hasBattData ? 'rgba(71,85,105,0.3)' : 'rgba(74,222,128,0.3)'}`,
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Battery className={`w-5 h-5 ${!hasBattData ? 'text-slate-500' : 'text-green-400'}`} />
                <span className="text-lg text-slate-200 font-semibold">Individual Batteries</span>
              </div>
              <span className="text-sm text-slate-400">({is200Ah ? '2S × 2 Banks' : '1S Single'})</span>
            </div>

            {/* Individual cells — flex-1 so they grow */}
            <div className="grid grid-cols-2 gap-2 px-4 flex-1 min-h-0">
              {cellDefs.map(({ label, name, voltage, current, soc, online }) => {
                const cellBorder   = getCellBorder(soc, online);
                const cellSocClass = online && hasBattData ? getCellStatusColor(soc, online) : 'text-slate-600';
                const currColor    = !online ? 'text-slate-600' : current > 0.5 ? 'text-emerald-400' : current < -0.5 ? 'text-blue-400' : 'text-slate-400';
                const currLabel    = !online ? '—' : current > 0.5 ? '▲ Charging' : current < -0.5 ? '▼ Discharging' : '— Idle';
                return (
                  <div key={label}
                    className={`rounded-xl bg-slate-900/70 flex flex-col p-3 transition-opacity duration-300 ${!online ? 'opacity-30' : ''}`}
                    style={{ border: `2px solid ${cellBorder}55`, boxShadow: `0 0 10px ${cellBorder}22` }}
                  >
                    {/* Cell header */}
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cellBorder }} />
                        <span className="text-sm font-bold text-slate-200">{name}</span>
                      </div>
                      <span className={`text-xs font-semibold ${getCellStatusColor(soc, online)}`}>
                        {getCellStatus(soc, online)}
                      </span>
                    </div>
                    {/* SOC big number */}
                    <div className="flex-1 flex flex-col items-center justify-center">
                      <div className={`font-black leading-none ${cellSocClass}`}
                        style={{ fontSize: '3.2rem', textShadow: `0 0 20px ${cellBorder}80` }}>
                        {online && hasBattData ? soc.toFixed(0) : '—'}
                      </div>
                      <div className="text-base text-slate-400 font-semibold">
                        {online ? '% SOC' : 'Offline'}
                      </div>
                    </div>
                    {/* SOC bar */}
                    <div className="h-1.5 bg-slate-700/80 rounded-full overflow-hidden mb-2">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${online && hasBattData ? soc : 0}%`,
                          background: `linear-gradient(90deg, ${cellBorder}99, ${cellBorder})`,
                        }} />
                    </div>
                    {/* Voltage row */}
                    <div className="flex items-center justify-between rounded-lg px-2 py-1.5 mb-1.5"
                      style={{ background: `${cellBorder}18`, border: `1px solid ${cellBorder}40` }}>
                      <span className="text-sm text-slate-400">Voltage</span>
                      <div className="flex items-baseline gap-1">
                        <span className={`font-bold leading-none ${getCellStatusColor(soc, online)}`} style={{ fontSize: '1.6rem' }}>
                          {online && hasBattData ? voltage.toFixed(2) : '—'}
                        </span>
                        <span className="text-sm text-slate-400">V</span>
                      </div>
                    </div>
                    {/* Current row — NEW */}
                    <div className="flex items-center justify-between rounded-lg px-2 py-1.5"
                      style={{ background: 'rgba(30,41,59,0.8)', border: '1px solid rgba(100,116,139,0.3)' }}>
                      <span className={`text-xs ${currColor}`}>{currLabel}</span>
                      <div className="flex items-baseline gap-1">
                        <span className={`font-bold leading-none ${currColor}`} style={{ fontSize: '1.4rem' }}>
                          {online && hasBattData ? `${current >= 0 ? '+' : ''}${current.toFixed(2)}` : '—'}
                        </span>
                        <span className="text-xs text-slate-400">A</span>
                      </div>
                    </div>
                    {/* Footer info */}
                    <div className="flex justify-between text-xs text-slate-600 pt-1">
                      <span>12V</span><span>100Ah</span><span>{online ? 'Lead Acid' : 'Offline'}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pack Voltage */}
            <div className="px-4 pt-3 pb-2 border-t border-green-700/30 mt-2 flex-shrink-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-slate-400">Pack Voltage <span className="text-sm text-slate-500">(Lead Acid 24V)</span></span>
                <span className={`text-sm font-semibold ${
                  !hasBattData ? 'text-slate-400' : packVoltageDisplay >= 24.6 ? 'text-green-400' : packVoltageDisplay >= 23.0 ? 'text-yellow-400' : 'text-red-400'
                }`}>{voltStatus}</span>
              </div>
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className={`font-bold leading-none ${!hasBattData ? 'text-slate-500' : 'text-blue-400'}`} style={{ fontSize: '3.5rem' }}>{packVoltageDisplay.toFixed(2)}</span>
                <span className={`text-sm font-semibold ${!hasBattData ? 'text-slate-500' : 'text-blue-300'}`}>V</span>
                <span className="text-sm text-slate-500">· {capacityLabel}</span>
              </div>
              <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden mb-1">
                <div className="h-full rounded-full transition-all duration-700" style={{
                  width: `${voltPct}%`,
                  background: !hasBattData ? '#334155'
                    : packVoltageDisplay >= 24.6 ? 'linear-gradient(90deg,#065f46,#34d399)'
                    : packVoltageDisplay >= 23.0 ? 'linear-gradient(90deg,#78350f,#fbbf24)'
                    : 'linear-gradient(90deg,#7f1d1d,#f87171)',
                }} />
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>21.0V <span className="text-slate-600">(0%)</span></span>
                <span>23.8V <span className="text-slate-600">(50%)</span></span>
                <span>25.4V <span className="text-slate-600">(100%)</span></span>
              </div>
            </div>

            {/* Pack Current */}
            <div className="px-4 pt-2 pb-3 border-t border-green-700/30 flex-shrink-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-slate-400">Pack Current</span>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${
                    !hasBattData ? 'text-slate-400' : isCharging ? 'text-emerald-400' : 'text-blue-400'
                  }`}>{currStatus}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded border font-semibold bg-amber-900/60 text-amber-400 border-amber-700/50">
                    📡 INA219 × 2
                  </span>
                </div>
              </div>
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className={`font-bold leading-none ${
                  !hasBattData ? 'text-slate-500' : isCharging ? 'text-green-400' : 'text-blue-400'
                }`} style={{ fontSize: '3.5rem' }}>{isCharging && hasBattData ? '+' : hasBattData ? '−' : ''}{batteryCurrent.toFixed(2)}</span>
                <span className={`text-sm font-semibold ${!hasBattData ? 'text-slate-500' : isCharging ? 'text-green-300' : 'text-blue-300'}`}>A</span>
              </div>
              {hasBattData && (
                <div className="flex items-center gap-2 py-1 px-2 rounded-lg bg-slate-700/40 mb-1.5 text-sm">
                  <span className="text-green-400 font-medium">↑ {batteryChargeA.toFixed(2)}A</span>
                  <span className="text-slate-600">|</span>
                  <span className="text-blue-400 font-medium">↓ {batteryDischargeA.toFixed(2)}A</span>
                  <span className="text-slate-600">|</span>
                  <span className="text-slate-300 font-medium">
                    Net: {(batteryChargeA - batteryDischargeA) >= 0 ? '+' : ''}{(batteryChargeA - batteryDischargeA).toFixed(2)}A
                  </span>
                </div>
              )}
              <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden mb-1">
                <div className="h-full rounded-full transition-all duration-700" style={{
                  width: `${currPct}%`,
                  background: !hasBattData ? '#475569'
                    : isCharging ? 'linear-gradient(90deg,#065f46,#34d399)'
                    : 'linear-gradient(90deg,#1e3a5f,#60a5fa)',
                }} />
              </div>
              <div className="text-xs text-slate-500">Max ±100A · INA219 × 2</div>
            </div>

          </div>{/* end right card */}
        </div>{/* end two-col */}

        {/* Footer */}
        <div className="text-lg text-slate-500 text-center pt-1.5 mt-1 border-t border-slate-700/40 flex-shrink-0">
          📡 INA219 × 2 · 24V {capacityLabel} Lead Acid ({cellCount} {bankLabel})
        </div>
      </div>
    );
  };

  // ============================================================================
  // PANELS DETAIL
  // ============================================================================
  const renderPanelsDetail = () => {
    const PANEL_IMP = 13.28;  // JAM72D40-590/MB Imp (was 13.4 — 550W spec, wrong)
    const PANEL_ISC = 13.94;  // JAM72D40-590/MB Isc (was 14.2 — 550W spec, wrong)
    const getManilaHour = (): number => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })).getHours();
    const isDay = (() => { const h = getManilaHour(); return h >= 6 && h < 18; })();
    const hasLiveSensorData = solarVoltage > 0 || solarCurrent > 0;
    const ctxStringCurrents = systemData.stringCurrents;
    const currents: number[] = (() => {
      if (!hasLiveSensorData) return [0, 0, 0, 0];
      if (ctxStringCurrents && ctxStringCurrents.length === 4) return ctxStringCurrents.map((c: number) => Math.max(0, parseFloat(c.toFixed(2))));
      const offsets = [+0.15, -0.20, +0.10, -0.05];
      return offsets.map(o => Math.max(0, parseFloat((solarCurrent / 4 + o).toFixed(2))));
    })();
    const voltageOffsets = [-0.2, +0.3, -0.3, +0.2];
    const STRING_VARIANCE_WARN = 0.25, STRING_FAULT_AMP = 2.0, PANEL_THRESH_GOOD = 10.0, PANEL_THRESH_WARNING = 5.0, PANEL_THRESH_STORM = 1.5;

    // 2S2P topology:
    //   String A = PV-01 (i0) + PV-02 (i1) — series, same current flows through both
    //   String B = PV-03 (i2) + PV-04 (i3) — series, same current flows through both
    const ia = (currents[0] + currents[1]) / 2.0;  // String A current
    const ib = (currents[2] + currents[3]) / 2.0;  // String B current

    // Intra-string: deviation within series pair → detects per-panel fault
    const intraA = ia > 0 ? Math.abs(currents[0] - currents[1]) / ia : 0;
    const intraB = ib > 0 ? Math.abs(currents[2] - currents[3]) / ib : 0;

    // Inter-string: String A vs String B → detects whole-string fault
    const avgString = (ia + ib) / 2.0;
    const interMismatch = avgString > 0 ? Math.abs(ia - ib) / avgString : 0;

    // 2S2P: each panel sees half the total array voltage (series connection)
    // String 1 = PV-01 + PV-02, String 2 = PV-03 + PV-04
    type PanelEntry = { id: number; name: string; string: 1 | 2; voltage: number; current: number; power: number; health: number | null; status: 'good' | 'warning' | 'critical' | 'nodata'; faultReason?: string; isNight: boolean; isNoData: boolean; };
    const panels: PanelEntry[] = [0, 1, 2, 3].map((i) => {
      const panelCurrent = currents[i];
      // Per-panel voltage = total array voltage / 2 (series connection)
      const panelBaseV = solarVoltage > 0 ? solarVoltage / 2 : 0;
      const voltage = Math.max(0, parseFloat((panelBaseV + voltageOffsets[i]).toFixed(1)));
      const power = parseFloat((voltage * panelCurrent).toFixed(1));
      const health: number | null = (isDay && hasLiveSensorData) ? Math.min(100, Math.round((panelCurrent / PANEL_IMP) * 100)) : null;
      const panelName = `PV-0${i + 1}`;
      const strNum: 1 | 2 = i < 2 ? 1 : 2;
      const isStringA  = i < 2;
      const strCurrent = isStringA ? ia : ib;
      const intraDev   = isStringA ? intraA : intraB;

      if (!hasLiveSensorData) return { id: i+1, name: panelName, string: strNum, voltage: 0, current: 0, power: 0, health: null, status: 'nodata', faultReason: 'No sensor connected', isNight: false, isNoData: true };
      if (!isDay) return { id: i+1, name: panelName, string: strNum, voltage, current: panelCurrent, power, health: null, status: 'good', faultReason: undefined, isNight: true, isNoData: false };
      let status: 'good' | 'warning' | 'critical' = 'good';
      let faultReason: string | undefined;

      if (solarAnomaly === 'critical') {
        status = 'critical'; faultReason = 'Array <464W (storm/extreme cloud)';
      } else if (panelCurrent < 0.1) {
        const othersActive = currents.filter((_, j) => j !== i && currents[j] > STRING_FAULT_AMP).length;
        status = 'critical'; faultReason = othersActive > 0 ? 'String fault — no output while others active' : 'No output during harvest hours';
      } else if (panelCurrent < PANEL_THRESH_STORM) {
        status = 'critical'; faultReason = `Low current ${panelCurrent.toFixed(1)}A (storm/heavy rain)`;
      } else if (intraDev > STRING_VARIANCE_WARN && strCurrent > 1.0) {
        // Intra-string: this panel deviates from its series partner → per-panel fault
        status = 'warning'; faultReason = `Intra-string mismatch ${Math.round(intraDev * 100)}% vs S${strNum} partner (shading/cell fault)`;
      } else if (interMismatch > STRING_VARIANCE_WARN && strCurrent > 1.0) {
        // Inter-string: this panel's string is weaker than the other string
        const lowStr = ia < ib ? 'A' : 'B';
        if ((isStringA && ia < ib) || (!isStringA && ib < ia)) {
          status = 'warning'; faultReason = `String ${lowStr} ${Math.round(interMismatch * 100)}% below String ${lowStr === 'A' ? 'B' : 'A'} (shading/soiling)`;
        }
      } else if (solarAnomaly === 'warning' || panelCurrent < PANEL_THRESH_WARNING) {
        status = 'warning'; if (panelCurrent < PANEL_THRESH_WARNING) faultReason = `Low current ${panelCurrent.toFixed(1)}A (heavy cloud/rain)`;
      } else if (panelCurrent < PANEL_THRESH_GOOD) { status = 'warning'; }

      return { id: i+1, name: `PV-0${i+1}`, string: strNum, voltage, current: panelCurrent, power, health, status, faultReason, isNight: false, isNoData: false };
    });
    const good = panels.filter(p => p.status === 'good' && !p.isNoData).length;
    const warn = panels.filter(p => p.status === 'warning').length;
    const crit = panels.filter(p => p.status === 'critical').length;
    const dotColor = !hasLiveSensorData ? 'bg-slate-500' : !isDay ? 'bg-slate-500' : solarAnomaly === 'critical' ? 'bg-red-500 shadow-[0_0_10px_#ef4444]' : solarAnomaly === 'warning' ? 'bg-amber-500 shadow-[0_0_10px_#f59e0b]' : 'bg-green-500 shadow-[0_0_10px_#22c55e]';
    const positions = 
    [{ x: '28%', y: '23%' }, 
    { x: '43%', y: '23%' }, 
    { x: '58%', y: '23%' }, 
    { x: '73%', y: '23%' }];
    return (
      <div className="relative h-full w-full overflow-hidden bg-slate-950 font-sans text-white select-none flex flex-col">
        <div className="absolute inset-0 z-0 pointer-events-none opacity-20"><img src={solarImg} alt="Solar View" className="w-full h-full object-cover"/></div>
        {(!isDay || !hasLiveSensorData) && (<div className="absolute inset-0 z-0 pointer-events-none bg-slate-950/50"/>)}
        <div className="relative z-20 p-3 flex items-center justify-between border-b border-blue-500/30 flex-shrink-0" style={{ background: 'linear-gradient(to bottom, #0a0f2e 0%, #032b6b 100%)' }}>
          <button onClick={() => navigateTo('main')} className="flex items-center gap-1 text-yellow-600"><ChevronLeft className="w-7 h-7"/><span className="text-2xl uppercase tracking-tight">Back</span></button>
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2"><Sun className="w-7 h-7 text-yellow-600"/><span className="text-2xl">Solar Panels</span>{!hasLiveSensorData && <span className="text-sm text-slate-400 ml-1">— No Sensor</span>}{hasLiveSensorData && !isDay && <span className="text-sm text-slate-400 ml-1">— Night Mode</span>}</div>
          <div className={`w-3 h-3 rounded-full animate-pulse ${dotColor}`}/>
        </div>
        <div className="relative flex-1 z-10">
          {panels.map((panel, index) => {
            const pos = positions[index] || { x: '50%', y: '50%' };
            if (panel.isNoData) return (
              <div key={panel.id} className="absolute flex flex-col p-3 shadow-2xl z-30 rounded-xl border border-white/10 backdrop-blur-md" style={{ left: pos.x, top: pos.y, transform: 'translate(-50%,-50%)', backgroundColor: 'rgba(30,41,59,0.90)', width: '240px', minHeight: '110px' }}>
                <div className="flex justify-between items-center mb-1"><div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-slate-500"/><span className="text-[10px] font-black text-white/90 uppercase tracking-tighter italic">{panel.name}</span><span className="text-[8px] text-white/40 font-mono ml-1">S{panel.string}</span></div><span className="text-[7px] font-black uppercase px-2 py-0.5 rounded-full bg-black/40 border border-white/5 text-slate-400">No Data</span></div>
                <div className="flex items-end gap-2 my-1"><span className="text-5xl font-black italic tracking-tighter leading-none text-slate-500">&#8212;</span><span className="text-2xl font-bold text-slate-500 mb-1">A</span></div>
                <div className="space-y-1 mb-2"><div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden border border-white/5"><div className="h-full bg-slate-600 w-0"/></div><div className="flex justify-between items-center px-0.5"><span className="text-[7px] text-white/30 font-black uppercase tracking-widest">PV Health</span><span className="text-[9px] font-black text-slate-500">—</span></div></div>
                <div className="px-1.5 py-0.5 rounded bg-black/50 border border-white/10"><span className="text-[7px] font-bold text-slate-400">No sensor connected</span></div>
              </div>
            );
            const isG = panel.status === 'good', isW = panel.status === 'warning';
            const boxBg = panel.isNight ? 'rgba(30,41,59,0.85)' : isG ? 'rgba(49,207,10,0.75)' : isW ? 'rgba(120,53,15,0.8)' : 'rgba(153,27,27,0.8)';
            const ac = panel.isNight ? 'text-slate-400' : isG ? 'text-emerald-400' : isW ? 'text-amber-400' : 'text-red-400';
            const bar = panel.isNight ? 'bg-slate-600' : isG ? 'bg-emerald-500' : isW ? 'bg-amber-500' : 'bg-red-600';
            const statusLabel = panel.isNight ? 'Night Mode' : isG ? 'Optimal' : isW ? 'Warning' : 'Critical';
            return (
              <div key={panel.id} className="absolute flex flex-col p-3 transition-all duration-700 shadow-2xl z-30 rounded-xl border border-white/10 backdrop-blur-md" style={{ left: pos.x, top: pos.y, transform: 'translate(-50%,-50%)', backgroundColor: boxBg, width: '280px', minHeight: panel.faultReason ? '130px' : '110px' }}>
                <div className="flex justify-between items-center mb-1"><div className="flex items-center gap-1.5"><div className={`w-1.5 h-1.5 rounded-full ${bar} ${panel.isNight ? '' : 'animate-pulse'}`}/><span className="text-[10px] font-black text-white/90 uppercase tracking-tighter italic">{panel.name}</span><span className="text-[8px] text-white/40 font-mono ml-1">S{panel.string}</span></div><span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full bg-black/40 border border-white/5 ${ac}`}>{statusLabel}</span></div>
                <div className="flex items-end gap-2 my-1"><div className={`text-5xl font-black italic tracking-tighter leading-none ${panel.isNight ? 'text-slate-300' : 'text-white'}`}>{panel.current.toFixed(2)}</div><span className={`text-2xl font-bold mb-1 ${panel.isNight ? 'text-slate-400' : ac}`}>A</span></div>
                {panel.faultReason && (<div className="mb-1 px-1.5 py-0.5 rounded bg-black/50 border border-white/10"><span className={`text-[7px] font-bold ${ac}`}>{panel.faultReason}</span></div>)}
                <div className="mt-auto space-y-1.5">
                  <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden border border-white/5"><div className={`h-full ${bar} transition-all duration-1000`} style={{ width: panel.isNight ? '0%' : `${Math.min(100, (panel.current / PANEL_ISC) * 100)}%` }}/></div>
                  <div className="flex justify-between items-center px-0.5"><div className="flex items-center gap-2"><span className="text-[7px] text-white/40 font-black uppercase tracking-widest">PV Health</span><div className="w-20 h-[2px] bg-white/5 rounded-full overflow-hidden"><div className={`h-full ${bar} opacity-40`} style={{ width: panel.isNight ? '0%' : `${panel.health ?? 0}%` }}/></div></div><span className={`text-[9px] font-black ${panel.isNight ? 'text-slate-400' : ac}`}>{panel.isNight ? 'Night' : `${panel.health ?? 0}%`}</span></div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="relative z-20 pt-2 pb-5 border-t border-blue-500/30 flex-shrink-0" style={{ background: 'linear-gradient(to bottom, #032b6b 0%, #0a0f2e 100%)' }}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="border-r border-white/10"><div className="text-green-500 text-2xl font-normal leading-none">{!hasLiveSensorData ? 0 : good}</div><div className="text-[10px] text-green-500 font-normal uppercase tracking-[0.2em] mt-1">{!isDay ? 'Night' : 'Optimal'}</div></div>
            <div className="border-r border-white/10"><div className="text-amber-400 text-2xl font-normal leading-none">{!hasLiveSensorData ? 0 : warn}</div><div className="text-[10px] text-amber-400 font-normal uppercase tracking-[0.2em] mt-1">Warning</div></div>
            <div><div className="text-red-500 text-2xl font-normal leading-none">{!hasLiveSensorData ? 0 : crit}</div><div className="text-[10px] text-red-500 font-normal uppercase tracking-[0.2em] mt-1">Critical</div></div>
          </div>
          {!hasLiveSensorData && (<div className="text-center text-[10px] text-slate-500 mt-1 tracking-wide">No sensor — connect WCS1500 / voltage divider</div>)}
        </div>
      </div>
    );
  };

  // ============================================================================
  // GRAPH DETAIL
  // ============================================================================
  const renderGraphDetail = () => {
    return (
      <div
        className="relative h-full flex flex-col text-white overflow-hidden bg-slate-950"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Header: Back left, arrows centered */}
        <div className="relative flex items-center px-3 py-2 border-b border-purple-700/50 flex-shrink-0">
          <button onClick={() => navigateTo('main')} className="flex items-center gap-1 text-purple-300 active:text-purple-100 transition-colors flex-shrink-0">
            <ChevronLeft className="w-6 h-6"/><span className="text-2xl">Back</span>
          </button>
          {/* Arrows + title: truly centered via absolute positioning */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
            <button
              onClick={() => setGraphSlide(s => Math.max(0, s - 1))}
              disabled={graphSlide === 0}
              className="flex items-center justify-center w-11 h-9 rounded-xl bg-violet-700/70 border border-violet-500/60 text-violet-100 text-3xl font-bold disabled:opacity-20 active:bg-violet-600 transition-colors select-none"
            >←</button>
            <span className="text-xl text-purple-300 font-semibold w-44 text-center select-none whitespace-nowrap">
              {graphSlide === 0 ? 'Voltage Trends' : graphSlide === 1 ? 'Current Trends' : graphSlide === 2 ? 'Energy Balance' : 'Consumption'}
            </span>
            <button
              onClick={() => setGraphSlide(s => Math.min(TOTAL_SLIDES - 1, s + 1))}
              disabled={graphSlide === TOTAL_SLIDES - 1}
              className="flex items-center justify-center w-11 h-9 rounded-xl bg-violet-700/70 border border-violet-500/60 text-violet-100 text-3xl font-bold disabled:opacity-20 active:bg-violet-600 transition-colors select-none"
            >→</button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-visible">
          {/* Slide 0 — Voltage Trends */}
          {graphSlide === 0 && (
            <div className="h-full flex flex-col p-2 pb-1 bg-slate-950 overflow-hidden">
              <div className="grid grid-cols-4 gap-1.5 mb-2 flex-shrink-0">
                {[
                  { label: 'Grid V',     val: `${gridVoltage.toFixed(0)}V`,    anom: systemData.gridAnomaly     ?? 'none', color: 'text-blue-300',  bg: 'bg-blue-900/40',  border: 'border-blue-700/50' },
                  { label: 'Inverter V', val: `${acVoltage.toFixed(0)}V`,      anom: systemData.inverterAnomaly ?? 'none', color: 'text-pink-400',  bg: 'bg-pink-900/40',  border: 'border-pink-700/50' },
                  { label: 'Battery V',  val: `${batteryVoltage.toFixed(1)}V`, anom: systemData.batteryAnomaly  ?? 'none', color: 'text-green-300', bg: 'bg-green-900/40', border: 'border-green-700/50' },
                  { label: 'Solar V',    val: `${solarVoltage.toFixed(1)}V`,   anom: systemData.solarAnomaly    ?? 'none', color: 'text-amber-300', bg: 'bg-amber-900/40', border: 'border-amber-700/50' },
                ].map(r => (<div key={r.label} className={`p-2 rounded-lg border text-center ${r.bg} ${r.border}`}><div className={`text-base mb-0.5 ${r.color}`}>{r.label}{r.anom !== 'none' ? ' ⚠' : ''}</div><div className={`text-xl ${r.anom === 'critical' ? 'text-red-400' : r.anom === 'warning' ? 'text-yellow-400' : r.color}`}>{r.val}</div></div>))}
              </div>
              <div className="flex-1 min-h-0 relative" style={{minHeight:0}}>
                <div className="absolute inset-0">
                {historyData.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-500">
                    <div className="text-sm">⏳ Waiting for history data…</div>
                    <div className="text-xs text-slate-600">Sensor logs populate every 5s</div>
                  </div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={historyData} barGap={1} barCategoryGap="10%" margin={{ top: 12, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
                    <XAxis dataKey="time" stroke="#94a3b8" fontSize={9} angle={-45} textAnchor="end" height={40} tickFormatter={(v: string, idx: number) => idx % 4 === 0 ? v : ''}/>
                    <YAxis stroke="#94a3b8" fontSize={9} domain={[0, 260]} width={28}/>
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '10px' }} formatter={(v: unknown, n: string) => { if (n === '_anomalyV') return [null, null] as any; const vv = typeof v === 'number' && isFinite(v) ? v : 0; return [`${vv.toFixed(1)}V`, n]; }}/>
                    <Legend wrapperStyle={{ fontSize: '9px' }} formatter={(value) => value === '_anomalyV' ? '' : value}/>
                    <Bar dataKey="gridVoltage"     fill="#3b82f6" radius={[2,2,0,0]} name="Grid V"     maxBarSize={12}/>
                    <Bar dataKey="inverterVoltage" fill="#ec4899" radius={[2,2,0,0]} name="Inverter V" maxBarSize={12}/>
                    <Bar dataKey="batteryVoltage"  fill="#22c55e" radius={[2,2,0,0]} name="Battery V"  maxBarSize={12}/>
                    <Bar dataKey="solarVoltage"    fill="#eab308" radius={[2,2,0,0]} name="Solar V"    maxBarSize={12}/>
                    <Line dataKey="voltageAnomalyY" name="_anomalyV" stroke="none" dot={(props: any) => { const { cx, cy, payload } = props; if (!payload?.anomaly || !payload?.anomalySeverity) return <g key={props.key}/>; const isCrit = payload.anomalySeverity === 'critical'; const dotY = Math.min(cy ?? 14, 14); return (<g key={props.key}><circle cx={cx} cy={dotY} r={8} fill={isCrit ? '#ef4444' : '#facc15'} stroke={isCrit ? '#fff' : '#000'} strokeWidth={2}/><text x={cx} y={dotY+1} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight="bold" fill={isCrit ? '#fff' : '#000'}>{isCrit ? '!' : '▲'}</text></g>); }} activeDot={false} legendType="none" isAnimationActive={false}/>
                  </ComposedChart>
                </ResponsiveContainer>
                )}
                </div>
              </div>
              <div className="text-xs text-slate-500 text-center pt-1 flex-shrink-0 flex justify-between items-center">
                <span className="flex items-center gap-2">
                  <span className="flex items-center gap-1"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#ef4444" stroke="#fff" strokeWidth="1.5"/></svg>Critical</span>
                  <span className="flex items-center gap-1"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#facc15" stroke="#92400e" strokeWidth="1.5"/></svg>Warning</span>
                </span>
                <span>PZEM-004T + INA219</span>
              </div>
            </div>
          )}
          {/* Slide 1 — Current Trends */}
          {graphSlide === 1 && (
            <div className="h-full flex flex-col p-2 pb-1 bg-slate-950 overflow-hidden">
              <div className="grid grid-cols-4 gap-1.5 mb-2 flex-shrink-0">
                {[
                  { label: 'Grid A',     val: `${(historyData[historyData.length-1]?.gridCurrent     ?? 0).toFixed(2)}A`, color: 'text-blue-300',  bg: 'bg-blue-900/40',  border: 'border-blue-700/50' },
                  { label: 'Inverter A', val: `${(historyData[historyData.length-1]?.inverterCurrent ?? 0).toFixed(2)}A`, color: 'text-pink-400',  bg: 'bg-pink-900/40',  border: 'border-pink-700/50' },
                  { label: 'Battery A',  val: `${(historyData[historyData.length-1]?.batteryCurrent  ?? 0).toFixed(2)}A`, color: 'text-green-300', bg: 'bg-green-900/40', border: 'border-green-700/50' },
                  { label: 'Solar A',    val: `${(historyData[historyData.length-1]?.solarCurrent    ?? 0).toFixed(2)}A`, color: 'text-amber-300', bg: 'bg-amber-900/40', border: 'border-amber-700/50' },
                ].map(r => (<div key={r.label} className={`p-2 rounded-lg border text-center ${r.bg} ${r.border}`}><div className={`text-base mb-0.5 ${r.color}`}>{r.label}</div><div className={`text-xl ${r.color}`}>{r.val}</div></div>))}
              </div>
              <div className="flex-1 min-h-0 relative" style={{minHeight:0}}>
                <div className="absolute inset-0">
                {historyData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm">Loading data…</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={historyData} barGap={1} barCategoryGap="10%" margin={{ top: 12, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
                    <XAxis dataKey="time" stroke="#94a3b8" fontSize={9} angle={-45} textAnchor="end" height={40} tickFormatter={(v: string, idx: number) => idx % 4 === 0 ? v : ''}/>
                    <YAxis stroke="#94a3b8" fontSize={9} domain={[0, 'auto']} width={32}/>
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '10px' }} formatter={(v: unknown, n: string) => { if (n === '_anomalyA') return [null, null] as any; const vv = typeof v === 'number' && isFinite(v) ? v : 0; return [`${vv.toFixed(2)}A`, n]; }}/>
                    <Legend wrapperStyle={{ fontSize: '9px' }} formatter={(value) => value === '_anomalyA' ? '' : value}/>
                    <Bar dataKey="gridCurrent"     fill="#3b82f6" radius={[2,2,0,0]} name="Grid A"     maxBarSize={12}/>
                    <Bar dataKey="inverterCurrent" fill="#ec4899" radius={[2,2,0,0]} name="Inverter A" maxBarSize={12}/>
                    <Bar dataKey="batteryCurrent"  fill="#22c55e" radius={[2,2,0,0]} name="Battery A"  maxBarSize={12}/>
                    <Bar dataKey="solarCurrent"    fill="#eab308" radius={[2,2,0,0]} name="Solar A"    maxBarSize={12}/>
                    <Line dataKey="currentAnomalyY" name="_anomalyA" stroke="none" dot={(props: any) => { const { cx, cy, payload } = props; if (!payload?.anomaly || !payload?.anomalySeverity) return <g key={props.key}/>; const isCrit = payload.anomalySeverity === 'critical'; const dotY = Math.min(cy ?? 14, 14); return (<g key={props.key}><circle cx={cx} cy={dotY} r={8} fill={isCrit ? '#ef4444' : '#facc15'} stroke={isCrit ? '#fff' : '#000'} strokeWidth={2}/><text x={cx} y={dotY+1} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight="bold" fill={isCrit ? '#fff' : '#000'}>{isCrit ? '!' : '▲'}</text></g>); }} activeDot={false} legendType="none" isAnimationActive={false}/>
                  </ComposedChart>
                </ResponsiveContainer>
                )}
                </div>
              </div>
              <div className="text-xs text-slate-500 text-center pt-1 flex-shrink-0 flex justify-between items-center">
                <span className="flex items-center gap-2">
                  <span className="flex items-center gap-1"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#ef4444" stroke="#fff" strokeWidth="1.5"/></svg>Critical</span>
                  <span className="flex items-center gap-1"><svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#facc15" stroke="#92400e" strokeWidth="1.5"/></svg>Warning</span>
                </span>
                <span>PZEM-004T + INA219</span>
              </div>
            </div>
          )}
          {/* Slide 2 — Energy Balance */}
          {graphSlide === 2 && (
            <div className="h-full flex flex-col p-2 pb-1 bg-slate-950 overflow-hidden">
              <div className="grid grid-cols-3 gap-1.5 mb-1.5 flex-shrink-0">
                <div className="rounded-lg px-2 py-1 text-center" style={{ background: 'rgba(120,53,15,0.45)', border: '1px solid rgba(217,119,6,0.5)' }}><div className="text-xs text-amber-300 mb-0.5">Solar</div><div className="text-xl text-amber-400">{(balanceData[balanceData.length-1]?.solarSupply ?? 0).toFixed(1)}<span className="text-[10px] ml-0.5">W</span></div></div>
                <div className="rounded-lg px-2 py-1 text-center" style={{ background: 'rgba(23,37,84,0.45)',   border: '1px solid rgba(59,130,246,0.5)' }}><div className="text-xs text-blue-300 mb-0.5">Grid</div><div className="text-xl text-blue-400">{(balanceData[balanceData.length-1]?.gridSupply ?? 0).toFixed(1)}<span className="text-[10px] ml-0.5">W</span></div></div>
                <div className="rounded-lg px-2 py-1 text-center" style={{ background: 'rgba(131,24,67,0.45)',  border: '1px solid rgba(236,72,153,0.5)' }}><div className="text-xs text-pink-300 mb-0.5">Load</div><div className="text-xl text-pink-400">{(balanceData[balanceData.length-1]?.totalLoad ?? 0).toFixed(1)}<span className="text-[10px] ml-0.5">W</span></div></div>
              </div>
              <div className="flex-1 min-h-0 relative" style={{minHeight:0}}>
                <div className="absolute inset-0">
                {balanceData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm">Loading data…</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={balanceData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
                    <XAxis dataKey="time" stroke="#94a3b8" fontSize={8} tickFormatter={(v: string, idx: number) => idx % 4 === 0 ? v : ''} height={30}/>
                    <YAxis stroke="#94a3b8" fontSize={9} domain={[0, 'auto']} width={28}/>
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '6px', fontSize: '10px' }} formatter={(v: unknown, n: string) => { const vv = typeof v === 'number' && isFinite(v) ? v : 0; return [`${vv.toFixed(1)}W`, n]; }}/>
                    <Legend wrapperStyle={{ fontSize: '9px' }}/>
                    <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4"/>
                    <Line type="monotone" dataKey="solarSupply" stroke="#fbbf24" strokeWidth={1.5} dot={false} name="Solar"/>
                    <Line type="monotone" dataKey="gridSupply"  stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Grid"/>
                    <Line type="monotone" dataKey="totalSupply" stroke="#10b981" strokeWidth={2}   dot={false} name="Total Supply" strokeDasharray="5 3"/>
                    <Line type="monotone" dataKey="totalLoad"   stroke="#ec4899" strokeWidth={2}   dot={false} name="Total Load"   strokeDasharray="3 3"/>
                  </LineChart>
                </ResponsiveContainer>
                )}
                </div>
              </div>
            </div>
          )}
          {/* Slide 3 — Consumption */}
          {graphSlide === 3 && (
            <div className="h-full flex flex-col p-2 pb-1 bg-slate-950 overflow-hidden">
              <div className="grid grid-cols-3 gap-1.5 mb-1.5 flex-shrink-0">
                <div className="bg-amber-900/40 border border-amber-700/50 rounded-lg px-2 py-1 text-center"><div className="text-xs text-amber-300 mb-0.5">Solar</div><div className="text-xl text-amber-400">{totals.solar.toFixed(1)}<span className="text-[10px] ml-0.5">Wh</span></div></div>
                <div className="bg-blue-900/40  border border-blue-700/50  rounded-lg px-2 py-1 text-center"><div className="text-xs text-blue-300 mb-0.5">Grid</div><div className="text-xl text-blue-400">{totals.grid.toFixed(1)}<span className="text-[10px] ml-0.5">Wh</span></div></div>
                <div className="bg-green-900/40 border border-green-700/50 rounded-lg px-2 py-1 text-center"><div className="text-xs text-green-300 mb-0.5">Battery</div><div className="text-xl text-green-400">{totals.battery.toFixed(1)}<span className="text-[10px] ml-0.5">Wh</span></div></div>
              </div>
              <div className="flex-1 min-h-0 relative" style={{minHeight:0}}>
                <div className="absolute inset-0">
                {consumptionData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm">Loading data…</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={consumptionData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
                    <XAxis dataKey="time" stroke="#94a3b8" fontSize={8} tickFormatter={(v: string, idx: number) => idx % 4 === 0 ? v : ''} height={30}/>
                    <YAxis stroke="#94a3b8" fontSize={9} domain={[0, 'auto']} width={28}/>
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '6px', fontSize: '10px' }} formatter={(v: unknown, n: string) => { const vv = typeof v === 'number' && isFinite(v) ? v : 0; return [`${vv.toFixed(1)}W`, n]; }}/>
                    <Legend wrapperStyle={{ fontSize: '9px' }}/>
                    <Bar dataKey="Battery" stackId="a" fill="#10b981" name="Battery"/>
                    <Bar dataKey="Grid"    stackId="a" fill="#3b82f6" name="Grid"/>
                    <Bar dataKey="Solar"   stackId="a" fill="#fbbf24" radius={[2,2,0,0]} name="Solar"/>
                  </BarChart>
                </ResponsiveContainer>
                )}
                </div>
              </div>
              <div className="text-xs text-slate-500 text-center pt-1 flex-shrink-0">PZEM-004T + INA219 (24V 100Ah Lead Acid)</div>
            </div>
          )}
        </div>
      </div>
    );
  };


// ============================================================================
// SSR DETAIL
// [PATCH-OUTLETS] Outlet current/voltage now uses real sensor data from active source
//                 instead of hardcoded 1.2A / 0.8A values.
//                 activeSourceVoltage & activeSourceCurrent computed at top of component.
// ============================================================================
const renderSSRDetail = () => {
  const invV_ssr = systemData.inverterVoltage ?? 0;
  const gridAnom = systemData.gridAnomaly ?? "none";
  const invAnom = systemData.inverterAnomaly ?? "none";
  const isManual = controlAuthority === "manual";
  const isSafetyOverride = controlAuthority === "safety_override";
  const isAuto = controlAuthority === "auto";

  // [FIX-GAP-3] True when safety_override active but ALL critical faults cleared
  const faultsCleared =
    isSafetyOverride &&
    (systemData.gridAnomaly ?? "none") !== "critical" &&
    (systemData.inverterAnomaly ?? "none") !== "critical" &&
    (systemData.batteryAnomaly ?? "none") !== "critical" &&
    (systemData.tempAnomaly ?? "none") !== "critical";

  // [FIX-RPI-LOAD] solarReady — battery must NOT be low (aligned with EnergySystemContext)
  const batLowSSR =
    (systemData.batteryVoltage ?? 0) > 0 &&
    (systemData.batteryVoltage ?? 0) < BAT_WARNING_LOW;
  const solarReady =
    !batLowSSR && (systemData.inverterVoltage ?? 0) >= INV_CRITICAL_LOW;
  const gridReady =
    gridVoltage >= GRID_NORMAL_LOW && gridVoltage <= GRID_NORMAL_HIGH;

  // [v8.0-SPLIT] Outlet 1 dedicated to Solar (K1), Outlet 2 dedicated to Grid (K2)
  // Each outlet is energized only when K4 closed AND its own relay is ON
  const outlet1Energized = SSR4_Closed && K1_Solar;
  const outlet2Energized = SSR4_Closed && K2_Grid;

  const ssrOutlets = [
    {
      id: 1,
      name: "Outlet 1",
      status: outlet1Energized,
      source: "Solar (K1)",
      hasAnomaly: invAnom !== "none" && K1_Solar,
      load: "Laptop",
      current: outlet1Energized ? acCurrent : 0,
      voltage: outlet1Energized ? acVoltage : 0,
    },
    {
      id: 2,
      name: "Outlet 2",
      status: outlet2Energized,
      source: "Grid (K2)",
      hasAnomaly: gridAnom !== "none" && K2_Grid,
      load: "Monitor",
      current: outlet2Energized ? gridCurrent : 0,
      voltage: outlet2Energized ? gridVoltage : 0,
    },
  ];

  return (
    <div className="relative h-full p-2 sm:p-3 flex flex-col text-white overflow-auto scroll-blue">
      {/* ── HEADER ── */}
      <div className="relative flex items-center justify-between pb-1.5 border-b border-cyan-700/50 flex-shrink-0">
        <button
          onClick={() => navigateTo("main")}
          className="flex items-center gap-1 text-cyan-300 hover:text-cyan-200 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-xl">Back</span>
        </button>
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4 text-cyan-400" />
          <span className="text-xl">SSR Control</span>
        </div>
        <div
          className={`w-2.5 h-2.5 rounded-full ${isSafetyOverride ? "bg-red-500 animate-pulse" : isManual ? "bg-amber-400 animate-pulse" : !SSR4_Closed ? "bg-red-500" : "bg-green-500 animate-pulse"}`}
        />
      </div>

      <div className="flex-1 flex flex-col gap-2 py-1.5 overflow-y-auto scroll-blue min-h-0">
        {/* K4 contactor */}
        <div
          className={`px-2 py-1.5 rounded-lg border flex items-center gap-2 ${SSR4_Closed ? "bg-green-900/30 border-green-600/40" : "bg-red-900/40 border-red-600/60"}`}
        >
          <Shield
            className={`w-4 h-4 ${SSR4_Closed ? "text-green-400" : "text-red-400"} flex-shrink-0`}
          />
          <div className="flex-1">
            <div
              className={`text-sm font-semibold ${SSR4_Closed ? "text-green-300" : "text-red-300"}`}
            >
              K4 Contactor —{" "}
              {SSR4_Closed
                ? "CLOSED (Normal)"
                : "OPEN (Shutdown / Safe Mode)"}
            </div>
            <div className="text-xs text-slate-400">
              {SSR4_Closed && noGrid && batDepleted
                ? `🔴 No Grid + Battery Depleted (${batteryVoltage.toFixed(1)}V) — Battery Sustaining Load`
                : SSR4_Closed && noGrid && batLow
                  ? `⚠️ No Grid + Battery Low (${batteryVoltage.toFixed(1)}V) — Battery Sustaining Load`
                  : SSR4_Closed && noGrid
                    ? `Grid Outage — Battery Sustaining Load (${batteryVoltage.toFixed(1)}V)`
                    : SSR4_Closed
                      ? "Battery connected — outlets energized via selected source"
                      : "Battery disconnected — all loads cut (Load Cut Off mode)"}
            </div>
          </div>
        </div>

        {/* Alerts */}
        {isSafetyOverride && (
          <div className="px-2 py-1.5 rounded-lg bg-red-900/50 border border-red-500/60 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <div className="flex-1">
              {faultsCleared ? (
                <span className="text-xs text-green-300 font-semibold">
                  ✅ All faults cleared — safe to resume auto control.
                </span>
              ) : (
                <span className="text-xs text-red-300">
                  Safety Override Active — Manual control locked until all
                  faults clear
                </span>
              )}
            </div>
            {faultsCleared && (
              <button
                onClick={() => systemData.exitManualMode()}
                className="ml-2 px-2 py-1 rounded-lg bg-gradient-to-br from-green-900/80 to-emerald-800/60 hover:from-green-800/90 hover:to-emerald-700/70 border border-green-500/60 text-green-300 text-xs font-semibold transition-all active:scale-95 shrink-0 shadow-[0_0_8px_rgba(34,197,94,0.3)]"
              >
                Clear Override
              </button>
            )}
          </div>
        )}
        {manualBlockedReason && (
          <div className="px-2 py-1.5 rounded-lg bg-orange-900/40 border border-orange-500/50 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-orange-400 flex-shrink-0" />
            <span className="text-xs text-orange-300">
              {manualBlockedReason}
            </span>
          </div>
        )}
        {manualLockoutRemaining > 0 && !isSafetyOverride && (
          <div className="px-2 py-1.5 rounded-lg bg-blue-900/30 border border-blue-600/40 flex items-center gap-2">
            <Clock className="w-3 h-3 text-blue-400 flex-shrink-0" />
            <span className="text-xs text-blue-300">
              ⏳ Relay settling — auto-switch resumes in{" "}
              <span className="font-bold text-blue-200">
                {manualLockoutRemaining}s
              </span>
              . Mode buttons locked.
            </span>
          </div>
        )}

        {/* Auto-switching toggle */}
        <div className="p-2 rounded-xl bg-gradient-to-br from-green-900/40 to-emerald-800/30 border-2 border-green-600/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-lg bg-green-700/50">
                <Activity className="w-3 h-3 text-green-300" />
              </div>
              <div>
                <div className="text-sm font-semibold text-green-200">
                  Auto-Switching
                </div>
                <p className="text-xs text-green-300 mt-0.5">
                  {isSafetyOverride
                    ? "Safety override — locked"
                    : manualLockoutRemaining > 0
                      ? `Settling after command — ${manualLockoutRemaining}s`
                      : isManual
                        ? "Manual control — auto suspended"
                        : "System monitors & switches automatically"}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleAutoSwitchToggle(!isAuto)}
              disabled={isSafetyOverride}
              className={`relative w-12 h-6 rounded-full transition-colors duration-300 flex-shrink-0 ${isAuto ? "bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.5)]" : "bg-gray-600"} ${isSafetyOverride ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <span
                className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-300 block"
                style={{ left: isAuto ? "25px" : "2px" }}
              />
            </button>
          </div>
        </div>

        {isManual && !isSafetyOverride && (
          <div className="px-2 py-1.5 rounded-lg bg-amber-900/30 border border-amber-600/50 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-xs text-amber-300">
              Manual Mode — for testing/maintenance only. Auto-timeout: 30 min
            </span>
          </div>
        )}

        {/* Source control: K1 Solar + K2 Grid independent toggles */}
        <div className="p-2 rounded-lg bg-gradient-to-br from-indigo-900/40 to-purple-900/30 border border-indigo-600/40">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Shield className="w-3 h-3 text-indigo-400" />
              <span className="text-sm text-indigo-200">Source Control</span>
            </div>
            <div
              className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                !SSR4_Closed
                  ? "bg-red-600 text-white"
                  : K1_Solar && K2_Grid
                    ? "bg-purple-500 text-white"
                    : K1_Solar
                      ? "bg-amber-600 text-white"
                      : K2_Grid
                        ? "bg-blue-600 text-white"
                        : "bg-slate-600 text-white"
              }`}
            >
              {!SSR4_Closed
                ? "🔴 K4 Open — Cut Off"
                : K1_Solar && K2_Grid
                  ? "☀️⚡ K1 + K2 BOTH ON"
                  : K1_Solar
                    ? "☀️ K1 ON — Solar"
                    : K2_Grid
                      ? "⚡ K2 ON — Grid"
                      : "⏸ No Active Source"}
            </div>
          </div>

          {/* K1 Solar + K2 Grid side-by-side */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            {/* K1 — Solar */}
            <button
              onClick={handleToggleK1_ssr}
              disabled={
                isAuto || isSafetyOverride || manualLockoutRemaining > 0
              }
              className={`p-2 rounded-xl border-2 transition-all text-left
                  ${K1_Solar ? "bg-amber-500 border-amber-600 text-white shadow-lg" : "bg-slate-800/60 border-slate-600 text-slate-300 hover:border-amber-500"}
                  ${isAuto || isSafetyOverride || manualLockoutRemaining > 0 ? "opacity-50 cursor-not-allowed" : "cursor-pointer active:scale-95"}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Sun
                  className={`w-4 h-4 ${K1_Solar ? "text-white" : "text-amber-400"}`}
                />
                <div>
                  <div className="text-xs font-bold">Solar</div>
                  <div
                    className={`text-xs ${K1_Solar ? "text-amber-100" : "text-slate-500"}`}
                  >
                    K1 · PIN 7
                  </div>
                </div>
              </div>
              <div
                className={`text-xs font-bold px-1.5 py-0.5 rounded-full inline-block ${K1_Solar ? "bg-white/20 text-white" : "bg-slate-700 text-slate-400"}`}
              >
                {K1_Solar ? "● ON" : "○ OFF"}
              </div>
              <div
                className={`text-xs mt-1 ${K1_Solar ? "text-amber-100" : solarReady ? "text-green-400" : "text-red-400"}`}
              >
                {K1_Solar
                  ? `${(systemData.inverterVoltage ?? 0).toFixed(1)}V / ${(systemData.inverterFrequency ?? 0).toFixed(1)}Hz`
                  : solarReady
                    ? "✓ Ready"
                    : "⚠ Check inv"}
              </div>
            </button>

            {/* K2 — Grid */}
            <button
              onClick={handleToggleK2_ssr}
              disabled={
                isAuto || isSafetyOverride || manualLockoutRemaining > 0
              }
              className={`p-2 rounded-xl border-2 transition-all text-left
                  ${K2_Grid ? "bg-blue-500 border-blue-600 text-white shadow-lg" : "bg-slate-800/60 border-slate-600 text-slate-300 hover:border-blue-500"}
                  ${isAuto || isSafetyOverride || manualLockoutRemaining > 0 ? "opacity-50 cursor-not-allowed" : "cursor-pointer active:scale-95"}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Zap
                  className={`w-4 h-4 ${K2_Grid ? "text-white" : "text-blue-400"}`}
                />
                <div>
                  <div className="text-xs font-bold">Grid</div>
                  <div
                    className={`text-xs ${K2_Grid ? "text-blue-100" : "text-slate-500"}`}
                  >
                    K2 · PIN 6
                  </div>
                </div>
              </div>
              <div
                className={`text-xs font-bold px-1.5 py-0.5 rounded-full inline-block ${K2_Grid ? "bg-white/20 text-white" : "bg-slate-700 text-slate-400"}`}
              >
                {K2_Grid ? "● ON" : "○ OFF"}
              </div>
              <div
                className={`text-xs mt-1 ${K2_Grid ? "text-blue-100" : gridReady ? "text-green-400" : "text-red-400"}`}
              >
                {K2_Grid
                  ? `${gridVoltage.toFixed(1)}V / ${gridFrequency.toFixed(1)}Hz`
                  : gridReady
                    ? "✓ Stable"
                    : "⚠ Unstable"}
              </div>
            </button>
          </div>

          {isAuto && !isSafetyOverride && (
            <button
              onClick={() => handleAutoSwitchToggle(false)}
              disabled={manualLockoutRemaining > 0}
              className={`mb-2 w-full py-1.5 rounded-lg border border-amber-500/50 bg-amber-900/30 text-amber-300 text-xs transition-all active:scale-95 ${manualLockoutRemaining > 0 ? "opacity-50 cursor-not-allowed" : "hover:bg-amber-900/50"}`}
            >
              Switch to Manual Mode
            </button>
          )}

          <div
            className={`px-2 py-1.5 rounded-lg border text-xs flex items-center gap-2 ${K3_GridAssist ? "bg-teal-900/40 border-teal-600/50 text-teal-300" : "bg-slate-800/40 border-slate-600/40 text-slate-500"}`}
          >
            <Battery className="w-3 h-3 flex-shrink-0" />
            <span>
              {K3_GridAssist
                ? `K3 CHARGING ACTIVE — ${k3ModeLabel} (${batteryVoltage.toFixed(1)}V · ${batteryHealth.toFixed(0)}% SOC)`
                : `K3 CHARGING STANDBY — ${batteryVoltage.toFixed(1)}V · Auto-only: ON when charging needed, OFF when full or battery supplying load`}
            </span>
          </div>

          {/* Emergency Cutoff */}
          <button
            onClick={() => handleEmergency_ssr()}
            className="mt-2 w-full p-2 rounded-lg border-2 transition-all text-center bg-red-600 border-red-700 text-white shadow-lg hover:bg-red-700 cursor-pointer active:scale-95"
          >
            <AlertTriangle className="w-4 h-4 mx-auto mb-0.5" />
            <div className="text-sm font-bold">Emergency Shutdown</div>
            <div className="text-xs mt-0.5 text-red-200">
              K3+K1+K2 OFF → K4 OPEN + Buzzer
            </div>
          </button>
        </div>

        {/* Relay status grid */}
        <div className="grid grid-cols-4 gap-1.5">
          {[
            {
              label: "K4",
              color: SSR4_Closed
                ? "bg-green-500 animate-pulse"
                : "bg-red-500 animate-pulse",
              bg: SSR4_Closed
                ? "bg-green-900/30 border-green-600"
                : "bg-red-900/40 border-red-500",
              text: SSR4_Closed ? "CLOSED" : "OPEN",
              sub: "DC Contactor",
            },
            {
              label: "K1",
              color: K1_Solar ? "bg-amber-500 animate-pulse" : "bg-slate-600",
              bg: K1_Solar
                ? "bg-amber-900/40 border-amber-500"
                : "bg-slate-800/40 border-slate-600",
              text: K1_Solar ? "ON ✓" : "OFF",
              sub: "Solar Path",
            },
            {
              label: "K2",
              color: K2_Grid ? "bg-blue-500 animate-pulse" : "bg-slate-600",
              bg: K2_Grid
                ? "bg-blue-900/40 border-blue-500"
                : "bg-slate-800/40 border-slate-600",
              text: K2_Grid ? "ON ✓" : "OFF",
              sub: "Grid Path",
            },
            {
              label: "K3",
              color: K3_GridAssist
                ? "bg-teal-500 animate-pulse"
                : "bg-slate-600",
              bg: K3_GridAssist
                ? "bg-teal-900/40 border-teal-500"
                : "bg-slate-800/40 border-slate-600",
              text: K3_GridAssist
                ? k3IsCharging
                  ? "CHARGING"
                  : "ACTIVE"
                : "STBY",
              sub: "Auto-only",
            },
          ].map(({ label, color, bg, text, sub }) => (
            <div key={label} className={`p-1.5 rounded-lg border-2 ${bg}`}>
              <div className="text-center">
                <div className="text-xs text-slate-300 mb-1 font-semibold">
                  {label}
                </div>
                <div className={`w-3 h-3 mx-auto rounded-full ${color}`} />
                <div className="text-xs text-slate-200 mt-1 font-semibold">
                  {text}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Outlet control panel */}
        <div className="flex flex-col flex-1 min-h-0 gap-1.5">
          <div className="flex items-center gap-2 flex-shrink-0">
            <Power className="w-4 h-4 text-slate-300" />
            <span className="text-base font-semibold text-slate-200">
              Outlet Control Panel
            </span>
            <span
              className={`ml-auto text-xs px-2 py-0.5 rounded-full font-bold border ${
                !SSR4_Closed
                  ? "bg-red-900/50 text-red-400 border-red-600/50"
                  : outlet1Energized || outlet2Energized
                    ? "bg-slate-700/60 text-slate-200 border-slate-500/50"
                    : "bg-slate-700/60 text-slate-400 border-slate-500/50"
              }`}
            >
              {!SSR4_Closed
                ? "🔴 K4 OPEN"
                : outlet1Energized || outlet2Energized
                  ? "⚡ LIVE"
                  : "⚫ NO PATH"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
            {ssrOutlets.map((outlet) => {
              const isEnergized = outlet.status;
              const isSolar = outlet.source.includes("Solar");
              const isGrid = outlet.source.includes("Grid");
              return (
                <div
                  key={outlet.id}
                  className={`flex flex-col rounded-xl border-2 transition-all overflow-hidden ${
                    isEnergized
                      ? "border-green-500/60"
                      : "border-slate-600"
                  }`}
                  style={
                    isEnergized
                      ? {
                          boxShadow: "0 0 12px rgba(74,222,128,0.2)",
                          borderColor: "rgb(134 239 172 / 0.7)",
                        }
                      : {}
                  }
                >
                  {/* Header — name + ON/OFF, mirrors UnifiedSSROutletCard */}
                  <div className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={`p-1.5 rounded-lg ${isEnergized ? "bg-green-500" : "bg-slate-500"}`}
                      >
                        <Power className="w-3.5 h-3.5 text-white" />
                      </div>
                      <div>
                        <div
                          className={`text-sm font-semibold text-slate-100`}
                        >
                          {outlet.name}
                        </div>
                        <div className={`text-xs text-slate-400`}>
                          {outlet.load}
                        </div>
                      </div>
                    </div>
                    {/* ON/OFF badge — exact mirror of UnifiedSSROutletCard */}
                    <span
                      className={`px-2 py-1 rounded text-xs border font-semibold ${
                        isEnergized
                          ? "bg-green-500/30 text-green-300 border-green-500/60"
                          : "bg-slate-700 text-slate-400 border-slate-600"
                      }`}
                    >
                      {isEnergized ? "ON" : "OFF"}
                    </span>
                  </div>

                  {/* Body */}
                  <div className="flex-1 flex flex-col justify-between px-3 pb-3 gap-2">
                    {/* Source badge — mirrors UnifiedSSROutletCard sourceColor */}
                    <div
                      className={`px-2 py-1.5 rounded-lg ${
                        isSolar
                          ? "bg-amber-900/50 border border-amber-500/40"
                          : isGrid
                            ? "bg-blue-900/50 border border-blue-500/40"
                            : "bg-slate-700/50 border border-slate-500/40"
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span
                          className={`text-xs text-slate-400`}
                        >
                          Source:
                        </span>
                        <span
                          className={`text-sm font-semibold ${
                            isSolar
                              ? "text-amber-300"
                              : isGrid
                                ? "text-blue-300"
                                : "text-slate-400"
                          }`}
                        >
                          {outlet.source}
                        </span>
                      </div>
                    </div>

                    {/* Status — ACTIVE green / INACTIVE gray, exact mirror */}
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs text-slate-400`}
                      >
                        Status:
                      </span>
                      <span
                        className={`text-sm px-3 py-1 rounded-md font-semibold text-white ${isEnergized ? "bg-green-500" : "bg-slate-500"}`}
                      >
                        {isEnergized ? "ACTIVE" : "INACTIVE"}
                      </span>
                    </div>

                    {/* Metrics */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">
                          Current:
                        </span>
                        <span
                          className={`font-medium ${isEnergized ? "text-slate-200" : "text-slate-300"}`}
                        >
                          {outlet.current.toFixed(2)} A
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">
                          Voltage:
                        </span>
                        <span
                          className={`font-medium ${isEnergized ? "text-slate-200" : "text-slate-300"}`}
                        >
                          {outlet.voltage.toFixed(1)} V
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400">
                          Power:
                        </span>
                        <span
                          className={`font-bold ${isEnergized ? "text-slate-200" : "text-slate-300"}`}
                        >
                          {(outlet.current * outlet.voltage).toFixed(0)} W
                        </span>
                      </div>
                    </div>

                    {outlet.hasAnomaly && isEnergized && (
                      <div className="p-1.5 rounded bg-red-900/50 border border-red-500/60 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                        <span className="text-xs text-red-300 font-medium">
                          Voltage anomaly on source
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// THEME SELECTOR
// ============================================================================
const renderThemeSelector = () => (
  <div className="relative h-full p-3 sm:p-4 md:p-6 flex flex-col text-white overflow-auto">
    <div className="flex items-center justify-between pb-3 border-b border-purple-700/50">
      <button
        onClick={() => navigateTo("main")}
        className="flex items-center gap-1 text-purple-300 hover:text-purple-200 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        <span className="text-xs sm:text-sm">Back</span>
      </button>
      <div className="flex items-center gap-2">
        <Palette className="w-5 h-5 text-purple-400" />
        <span className="text-sm sm:text-base">Display Theme</span>
      </div>
      <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
    </div>
    <div className="flex-1 flex flex-col justify-center py-4">
      <div className="text-center mb-6">
        <h3 className="text-lg sm:text-xl mb-2">Choose Display Theme</h3>
        <p className="text-xs sm:text-sm text-slate-400">
          Select a color theme for your LCD display
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {themes.map((theme) => (
          <button
            key={theme.id}
            onClick={() => {
              setSelectedTheme(theme);
              navigateTo("main");
            }}
            className={`p-4 rounded-xl border-2 transition-all ${selectedTheme.id === theme.id ? "border-white shadow-2xl scale-105" : "border-slate-600 hover:border-slate-400"}`}
          >
            <div
              className={`h-24 sm:h-32 rounded-lg bg-gradient-to-br ${theme.gradient} mb-3 flex items-center justify-center`}
            >
              <div className={`text-2xl sm:text-3xl ${theme.textColor}`}>
                {theme.id === "default"
                  ? "Ocean"
                  : theme.id === "sunset"
                    ? "Sunset"
                    : theme.id === "forest"
                      ? "Forest"
                      : "Midnight"}
              </div>
            </div>
            <div className="text-sm sm:text-base mb-1">{theme.name}</div>
            {selectedTheme.id === theme.id && (
              <div className="text-xs text-green-400">Active</div>
            )}
          </button>
        ))}
      </div>
      <div className="mt-6 p-3 rounded-lg bg-purple-900/30 border border-purple-600/40">
        <p className="text-xs text-center text-purple-200">
          Theme will be applied to the LCD display background
        </p>
      </div>
    </div>
  </div>
);

// ============================================================================
// RENDER
// ============================================================================
const renderView = () => {
  switch (currentView) {
    case "grid":
      return renderGridDetail();
    case "solar":
      return renderSolarDetail();
    case "battery":
      return renderBatteryDetail();
    case "panels":
      return renderPanelsDetail();
    case "graph":
      return renderGraphDetail();
    case "ssr":
      return renderSSRDetail();
    case "theme":
      return renderThemeSelector();
    default:
      return renderMainMenu();
  }
};

return (
  <>
    <style>{slideUpStyle}</style>
    <div
      className={`w-full h-full bg-gradient-to-br ${selectedTheme.gradient} overflow-hidden relative`}
    >
      <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.05)_50%)] bg-[length:100%_4px] pointer-events-none z-10" />
      <div key={currentView} className={`absolute inset-0 z-20 ${animClass}`}>
        {renderView()}
      </div>
    </div>
  </>
);
}
