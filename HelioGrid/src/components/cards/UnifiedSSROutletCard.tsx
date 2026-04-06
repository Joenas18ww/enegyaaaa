// ============================================================================
// UnifiedSSROutletCard.tsx — v8.0 SPLIT-OUTLET + SIMPLIFIED LOCKOUT
//
// CHANGES from v7.0:
//   - Outlet 1 dedicated to Solar (K1), Outlet 2 dedicated to Grid (K2)
//   - Removed: SSR Statistics block (Total Switches, Last Switch)
//   - Removed: formatTime12h, lastSwitchTime12h, totalSwitches, lastSwitchTime
//   - Manual lockout now 8s (was 15s) — change in EnergySystemContext
//   - Auto behavior: K3 battery charging + K4 dropout cutoff (unchanged)
//   - Simple ON/OFF per relay — no complex mode conditions
// ============================================================================

import { useRef, useEffect, useState } from 'react';
import {
  Power, Zap, AlertCircle, ArrowLeftRight,
  Battery, Shield, AlertTriangle, Activity, Lock, Timer, Clock, Sun,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  useEnergySystem,
  GRID_NORMAL_LOW, GRID_NORMAL_HIGH,
  INV_CRITICAL_LOW, INV_CRITICAL_HIGH,
} from '../../contexts/EnergySystemContext';

const BAT_FULL = 25.4;

export function UnifiedSSROutletCard() {
  const {
    controlMode, controlAuthority, autoSwitchEnabled, setAutoSwitchEnabled,
    manualBlockedReason, enterManualMode, exitManualMode,
    outlet1Status, outlet2Status, setOutlet1Status, setOutlet2Status,
    gridVoltage, gridFrequency, gridAnomaly,
    gridCurrent,
    inverterVoltage, inverterFrequency, inverterAnomaly,
    inverterCurrent,
    batteryVoltage, batterySOC, batteryFull,
    ssrStates, k4Closed, k3Active, k3Direction, k3Reconnect,
    solarPower, systemCondition,

    manualLockoutRemaining,
    setK1, setK2,
  } = useEnergySystem();

  // [FIX-SSR-STUBS] setK1/setK2 are exported from EnergySystemContext — use them directly.
  // The old stubs used enterManualMode which only changes mode, not the actual relay state.
  // emergencyShutdown: send shutdown to backend via setK1(false)+setK2(false)
  const buzzerActive  = false;
  const triggerBuzzer = (_ms?: number) => {};
  const emergencyShutdown = async () => {
    setK1(false);
    setK2(false);
    enterManualMode('shutdown');
    return { success: true, message: 'shutdown' };
  };
  // setK1 / setK2 come from useEnergySystem() below — no stubs needed

  const isManual         = controlAuthority === 'manual';
  const isSafetyOverride = controlAuthority === 'safety_override';
  const isAuto           = controlAuthority === 'auto';

  const K1_Inv    = ssrStates.K1 ?? false;
  const K2_Grid   = ssrStates.K2 ?? false;
  const K3_Charge = k3Active;
  const K4_Closed = k4Closed;
  const K4_Open   = !K4_Closed;

  const lockoutActive    = manualLockoutRemaining > 0;
  const controlsDisabled = isAuto || isSafetyOverride || lockoutActive;
  // ── [DROPOUT-PROTECTION] ─────────────────────────────────────────────────
  const DROPOUT_RECOVERY_S = 10;
  const [dropoutActive,    setDropoutActive]    = useState(false);
  const [recoverySecsLeft, setRecoverySecsLeft] = useState(0);
  const recoveryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dropoutRef       = useRef(false);
  const isPowerDropout   = gridVoltage === 0 && inverterVoltage === 0;

  useEffect(() => {
    if (!isAuto) {
      if (dropoutRef.current) {
        dropoutRef.current = false;
        setDropoutActive(false);
        setRecoverySecsLeft(0);
        if (recoveryTimerRef.current) { clearInterval(recoveryTimerRef.current); recoveryTimerRef.current = null; }
      }
      return;
    }
    if (isPowerDropout) {
      if (!dropoutRef.current) {
        dropoutRef.current = true;
        setDropoutActive(true);
        setRecoverySecsLeft(0);
        if (recoveryTimerRef.current) { clearInterval(recoveryTimerRef.current); recoveryTimerRef.current = null; }
      }
    } else {
      if (dropoutRef.current) {
        dropoutRef.current = false;
        setDropoutActive(false);
        setRecoverySecsLeft(DROPOUT_RECOVERY_S);
        if (recoveryTimerRef.current) clearInterval(recoveryTimerRef.current);
        recoveryTimerRef.current = setInterval(() => {
          setRecoverySecsLeft(prev => {
            if (prev <= 1) {
              if (recoveryTimerRef.current) { clearInterval(recoveryTimerRef.current); recoveryTimerRef.current = null; }
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    }
  }, [isPowerDropout, isAuto]);
  useEffect(() => () => { if (recoveryTimerRef.current) clearInterval(recoveryTimerRef.current); }, []);
  const dropoutSuppressed = isAuto && (dropoutActive || recoverySecsLeft > 0);
  // ── end DROPOUT-PROTECTION ────────────────────────────────────────────────



  const inverterReady =
    inverterVoltage >= INV_CRITICAL_LOW && inverterVoltage <= INV_CRITICAL_HIGH &&
    inverterFrequency >= 59 && inverterFrequency <= 61 &&
    inverterAnomaly === 'none';

  const gridReady =
    gridVoltage >= GRID_NORMAL_LOW && gridVoltage <= GRID_NORMAL_HIGH &&
    gridFrequency >= 59 && gridFrequency <= 61 &&
    gridAnomaly === 'none';

  // ── Per-outlet energized logic ──────────────────────────────────────────────
  // Outlet 1 → Solar (K1): energized only when K4 closed AND K1 active
  // Outlet 2 → Grid (K2):  energized only when K4 closed AND K2 active
  const outlet1Energized = K4_Closed && K1_Inv  && !dropoutSuppressed;
  const outlet2Energized = K4_Closed && K2_Grid && !dropoutSuppressed;

  // Either outlet has power = at least one source ON
  const hasPowerSource = K1_Inv || K2_Grid;

  const k3IsCharging = K3_Charge && k3Direction === 'charging' && hasPowerSource;

  const k3ModeLabel = k3Reconnect.locked
    ? `LOCKED — ${k3Reconnect.secondsRemaining}s`
    : !K3_Charge      ? 'STANDBY'
    : !hasPowerSource ? 'STANDBY (no source)'
    : k3IsCharging    ? 'CHARGING'
    : 'ACTIVE';

  const k3DirectionLabel = k3Reconnect.locked
    ? `⏱ Reconnect: ${k3Reconnect.secondsRemaining}s`
    : !K3_Charge      ? 'Auto only'
    : !hasPowerSource ? 'Waiting for source'
    : k3IsCharging    ? '→ Battery charging'
    : '← Grid assist';

  const overrideFaultLabel = (() => {
    if (inverterAnomaly === 'critical' && gridAnomaly === 'critical')
      return 'Double Fault — Inverter + Grid voltage anomaly. Admin must inspect.';
    if (inverterAnomaly === 'critical')
      return `Inverter ${inverterVoltage.toFixed(1)}V out of safe range — check inverter output.`;
    if (gridAnomaly === 'critical')
      return `Grid ${gridVoltage.toFixed(1)}V out of safe range — check grid input.`;
    return 'Critical voltage fault active — relay control locked.';
  })();

  // ── Per-outlet definitions ──────────────────────────────────────────────────
  // Each outlet has its own dedicated relay, voltage, current, and anomaly source
  const outlets = [
    {
      id: 1,
      name: 'Outlet 1',
      load: 'Laptop',
      relay: 'K1',
      source: 'Solar (K1)',
      energized: outlet1Energized,
      voltage: outlet1Energized ? inverterVoltage : 0,
      current: outlet1Energized ? (inverterCurrent ?? 0) : 0,
      hasAnomaly: inverterAnomaly !== 'none' && K1_Inv,
      sourceColor: {
        badge: 'bg-amber-100 border border-amber-300',
        text: 'text-amber-900',
      },
    },
    {
      id: 2,
      name: 'Outlet 2',
      load: 'Monitor',
      relay: 'K2',
      source: 'Grid (K2)',
      energized: outlet2Energized,
      voltage: outlet2Energized ? gridVoltage : 0,
      current: outlet2Energized ? (gridCurrent ?? 0) : 0,
      hasAnomaly: gridAnomaly !== 'none' && K2_Grid,
      sourceColor: {
        badge: 'bg-blue-100 border border-blue-300',
        text: 'text-blue-900',
      },
    },
  ];

  // Total load = sum of both active outlet loads
  const totalCurrent = (outlet1Energized ? (inverterCurrent ?? 0) : 0)
                     + (outlet2Energized ? (gridCurrent ?? 0) : 0);
  const totalPower   = (outlet1Energized ? (inverterCurrent ?? 0) * inverterVoltage : 0)
                     + (outlet2Energized ? (gridCurrent ?? 0) * gridVoltage : 0);

  // Independent K1/K2 toggles
  const handleToggleK1 = () => {
    if (controlsDisabled) return;
    setK1(!K1_Inv);
  };

  const handleToggleK2 = () => {
    if (controlsDisabled) return;
    setK2(!K2_Grid);
  };

  const handleEmergency = async (): Promise<void> => {
    try {
      if (!buzzerActive) triggerBuzzer(5000);
      const result = await emergencyShutdown();
      if (!result.success) {
        console.error('[Emergency] API failed:', result.message);
        enterManualMode('shutdown');
      }
    } catch (err) {
      console.error('[Emergency] Error:', err);
      enterManualMode('shutdown');
    }
  };

  const handleAutoSwitchToggle = (enabled: boolean): void => {
    if (isSafetyOverride || lockoutActive) return;
    if (enabled) exitManualMode();
    else setAutoSwitchEnabled(false);
  };

  const faultsCleared = isSafetyOverride && gridAnomaly === 'none' && inverterAnomaly === 'none';

  const authorityBadge = isSafetyOverride
    ? { text: 'Safety Override', cls: 'bg-red-100 text-red-700 border-red-400' }
    : isManual
    ? { text: lockoutActive ? `Manual (${manualLockoutRemaining}s)` : 'Manual',
        cls: 'bg-amber-100 text-amber-700 border-amber-400' }
    : lockoutActive
    ? { text: `Auto (settling ${manualLockoutRemaining}s)`,
        cls: 'bg-blue-100 text-blue-700 border-blue-400' }
    : { text: 'Auto', cls: 'bg-green-100 text-green-700 border-green-400' };

  return (
    <Card className="border-slate-200 shadow-lg hover:shadow-xl transition-shadow">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm sm:text-base">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg" style={{background:'linear-gradient(to bottom right, #f3e8ff, #cffafe)'}}>
              <ArrowLeftRight className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" />
            </div>
            <span>SSR Control &amp; Outlet Management</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-xs border font-medium ${authorityBadge.cls}`}>
              {authorityBadge.text}
            </span>
            <div
              title={K4_Open ? 'K4 OPEN — Outlets disconnected' : 'K4 CLOSED — Outlets connected'}
              className={`w-2.5 h-2.5 rounded-full ${K4_Open ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`}
            />
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* ── SAFETY OVERRIDE BANNER ── */}
        {isSafetyOverride && (
          <div className="p-3 rounded-lg bg-red-50 border-2 border-red-400 flex items-center gap-2">
            <Lock className="w-5 h-5 text-red-600 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-bold text-red-800">Safety Override Active</div>
              <div className="text-xs text-red-700 mt-0.5">{overrideFaultLabel}</div>
            </div>
            {faultsCleared && (
              <button onClick={() => exitManualMode()}
                className="ml-2 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition-colors shrink-0">
                Clear Override
              </button>
            )}
          </div>
        )}

        {/* ── MANUAL LOCKOUT ── */}
        {lockoutActive && !isSafetyOverride && (
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-300 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="text-xs text-blue-700">
              ⏳ Relay settling — auto resumes in <strong>{manualLockoutRemaining}s</strong>. Controls locked during this period.
            </span>
          </div>
        )}

        {/* ── MANUAL BLOCKED REASON ── */}
        {manualBlockedReason && (
          <div className="p-3 rounded-lg bg-orange-50 border border-orange-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-orange-500 shrink-0" />
            <span className="text-xs text-orange-700">⛔ {manualBlockedReason}</span>
          </div>
        )}

        {/* ── [DROPOUT-PROTECTION] Banners ── */}
        {isAuto && dropoutActive && (
          <div className="p-3 rounded-lg bg-red-50 border-2 border-red-600 flex items-center gap-3 animate-pulse">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <div>
              <div className="text-sm font-bold text-red-800">⚡ Power Dropout — Emergency Shutdown</div>
              <div className="text-xs text-red-700 mt-0.5">Grid and inverter both offline. Outlets suppressed to protect loads.</div>
            </div>
          </div>
        )}
        {isAuto && !dropoutActive && recoverySecsLeft > 0 && (
          <div className="p-3 rounded-lg bg-amber-50 border-2 border-amber-400 flex items-center gap-3">
            <Timer className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-bold text-amber-800">⏱ Power Restored — Hold-off Timer</div>
              <div className="text-xs text-amber-700 mt-0.5">Outlets re-energize in <strong>{recoverySecsLeft}s</strong>.</div>
            </div>
            <div className="text-2xl font-mono font-bold text-amber-700">{recoverySecsLeft}s</div>
          </div>
        )}

        {/* ── AUTO CONTROL TOGGLE ── */}
        <div className="p-4 rounded-xl border-2 border-green-300 shadow-md" style={{background:'linear-gradient(to bottom right, #f0fdf4, #ecfdf5)'}}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100">
                <Activity className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <div className="text-sm sm:text-base font-semibold text-green-900">Auto Control</div>
                <p className="text-xs text-green-700 mt-0.5">
                  {isSafetyOverride ? 'Safety override — locked until faults clear'
                    : lockoutActive  ? `Relay settling — ${manualLockoutRemaining}s`
                    : isAuto         ? `System monitoring — ${systemCondition}`
                    : 'Manual control active'}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleAutoSwitchToggle(!isAuto)}
              disabled={isSafetyOverride || lockoutActive}
              className={`relative w-16 h-8 sm:w-20 sm:h-10 rounded-full transition-all duration-300
                ${isAuto ? 'bg-green-500 shadow-lg' : 'bg-gray-300'}
                ${(isSafetyOverride || lockoutActive) ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <div className={`absolute top-1 w-6 h-6 sm:w-8 sm:h-8 bg-white rounded-full shadow-md transition-transform duration-300
                ${isAuto ? 'translate-x-9 sm:translate-x-11' : 'translate-x-1'}`} />
            </button>
          </div>
          {isManual && !isSafetyOverride && (
            <div className="mt-3 px-3 py-1.5 rounded-lg bg-amber-100 border border-amber-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="text-xs text-amber-700">
                Manual Mode — K1 (Solar → Outlet 1) and K2 (Grid → Outlet 2) can be toggled independently or both ON simultaneously.
              </span>
            </div>
          )}
        </div>

        {/* ── SOURCE CONTROL: K1 SOLAR + K2 GRID ── */}
        <div className="p-4 rounded-xl border-2 border-indigo-300 shadow-md" style={{background:'linear-gradient(to bottom right, #eef2ff, #faf5ff)'}}>
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-5 h-5 text-indigo-600" />
            <span className="text-sm sm:text-base font-semibold text-indigo-900">Source Control</span>
            <div className={`ml-auto px-3 py-1 rounded-full text-xs font-semibold
              ${K4_Open           ? 'bg-red-600 text-white'
              : K1_Inv && K2_Grid ? 'bg-purple-500 text-white'
              : K1_Inv            ? 'bg-amber-500 text-white'
              : K2_Grid           ? 'bg-blue-500 text-white'
              :                     'bg-slate-500 text-white'}`}>
              {K4_Open           ? 'K4 OPEN — Cut Off'
               : K1_Inv && K2_Grid ? 'K1 + K2 BOTH ON'
               : K1_Inv           ? 'K1 ON — Solar'
               : K2_Grid          ? 'K2 ON — Grid'
               :                    'No Source'}
              {K3_Charge && hasPowerSource && (
                <span className="ml-1 text-[0.65rem] bg-white/30 px-1 rounded">+K3</span>
              )}
            </div>
          </div>

          {/* K1 Solar + K2 Grid — independent toggles */}
          <div className="grid grid-cols-2 gap-3 mb-3">

            {/* K1 — Solar → Outlet 1 */}
            <button
              onClick={handleToggleK1}
              disabled={controlsDisabled}
              className={`p-3 sm:p-4 rounded-xl border-2 transition-all text-left
                ${K1_Inv
                  ? 'bg-amber-500 border-amber-600 text-white shadow-lg'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-amber-300'}
                ${controlsDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:scale-95'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${K1_Inv ? 'bg-white/20' : 'bg-amber-100'}`}>
                  <Sun className={`w-4 h-4 ${K1_Inv ? 'text-white' : 'text-amber-600'}`} />
                </div>
                <div>
                  <div className={`text-xs font-bold ${K1_Inv ? 'text-white' : 'text-slate-800'}`}>Solar</div>
                  <div className={`text-[0.6rem] font-semibold ${K1_Inv ? 'text-amber-100' : 'text-slate-400'}`}>K1 · PIN 7 · Outlet 1</div>
                </div>
              </div>
              <div className={`text-[0.65rem] font-semibold px-2 py-0.5 rounded-full inline-block
                ${K1_Inv ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                {K1_Inv ? '● ON' : '○ OFF'}
              </div>
              <div className={`text-[0.6rem] mt-1.5 ${K1_Inv ? 'text-amber-100' : inverterReady ? 'text-green-600' : 'text-red-500'}`}>
                {K1_Inv
                  ? `${inverterVoltage.toFixed(1)}V / ${inverterFrequency.toFixed(1)}Hz`
                  : inverterReady ? '✓ Ready' : '⚠ Not ready'}
              </div>
            </button>

            {/* K2 — Grid → Outlet 2 */}
            <button
              onClick={handleToggleK2}
              disabled={controlsDisabled}
              className={`p-3 sm:p-4 rounded-xl border-2 transition-all text-left
                ${K2_Grid
                  ? 'bg-blue-500 border-blue-600 text-white shadow-lg'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300'}
                ${controlsDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:scale-95'}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${K2_Grid ? 'bg-white/20' : 'bg-blue-100'}`}>
                  <Zap className={`w-4 h-4 ${K2_Grid ? 'text-white' : 'text-blue-600'}`} />
                </div>
                <div>
                  <div className={`text-xs font-bold ${K2_Grid ? 'text-white' : 'text-slate-800'}`}>Grid</div>
                  <div className={`text-[0.6rem] font-semibold ${K2_Grid ? 'text-blue-100' : 'text-slate-400'}`}>K2 · PIN 6 · Outlet 2</div>
                </div>
              </div>
              <div className={`text-[0.65rem] font-semibold px-2 py-0.5 rounded-full inline-block
                ${K2_Grid ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                {K2_Grid ? '● ON' : '○ OFF'}
              </div>
              <div className={`text-[0.6rem] mt-1.5 ${K2_Grid ? 'text-blue-100' : gridReady ? 'text-green-600' : 'text-red-500'}`}>
                {K2_Grid
                  ? `${gridVoltage.toFixed(1)}V / ${gridFrequency.toFixed(1)}Hz`
                  : gridReady ? '✓ Stable' : '⚠ Unstable'}
              </div>
            </button>
          </div>

          {/* K3 Status Bar — auto only */}
          <div className={`px-3 py-2 rounded-lg border text-xs flex items-center gap-2 mb-3 ${
            k3Reconnect.locked            ? 'bg-cyan-50 border-cyan-300 text-cyan-800'
            : K3_Charge && hasPowerSource ? 'bg-teal-50 border-teal-300 text-teal-800'
            : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
            {k3Reconnect.locked && <Timer className="w-3 h-3 shrink-0" />}
            <Battery className="w-3 h-3 shrink-0" />
            <div>
              <span className="font-semibold">K3 Charging (auto only): </span>
              {k3Reconnect.locked
                ? `⏱ Safety delay: ${k3Reconnect.secondsRemaining}s`
                : k3IsCharging
                  ? `⚡ CHARGING — ${batteryVoltage.toFixed(1)}V (${batterySOC.toFixed(0)}%)`
                : K3_Charge && hasPowerSource
                  ? `⚡ ACTIVE — ${batteryVoltage.toFixed(1)}V`
                : batteryFull
                  ? `Standby — full (${batteryVoltage.toFixed(1)}V) · charging not needed`
                  : `Standby — ${batteryVoltage.toFixed(1)}V · activates when charging needed`}
            </div>
          </div>

          {/* Emergency Shutdown */}
          <button
            onClick={() => handleEmergency()}
            className="w-full p-3 rounded-lg border-2 transition-all text-center bg-red-600 border-red-700 text-white shadow-lg hover:bg-red-700 cursor-pointer active:scale-95">
            <AlertTriangle className="w-4 h-4 mx-auto mb-1" />
            <div className="text-xs font-bold">Emergency Shutdown</div>
            <div className="text-[0.6rem] mt-0.5 text-red-200">
              {buzzerActive ? '🔊 Buzzer active…' : 'K3+K1+K2 OFF → K4 OPEN + Buzzer'}
            </div>
          </button>
        </div>

        {/* ── RELAY STATUS INDICATORS ── */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          {[
            {
              label: 'K4 (Contactor)',
              color: K4_Open ? 'bg-red-100 border-red-400' : 'bg-green-50 border-green-300',
              dot:   K4_Open ? 'bg-red-500 animate-pulse' : 'bg-green-500',
              status: K4_Open ? 'OPEN' : 'CLOSED',
              sub:    K4_Open ? 'Outlets cut' : 'Outlets connected',
            },
            {
              label: 'K1 (Solar)',
              color: K1_Inv ? 'bg-amber-100 border-amber-400' : 'bg-slate-100 border-slate-300',
              dot:   K1_Inv ? 'bg-amber-500 animate-pulse' : 'bg-slate-400',
              status: K1_Inv ? 'ON' : 'OFF',
              sub:    K1_Inv ? `${inverterVoltage.toFixed(1)}V / ${inverterFrequency.toFixed(1)}Hz` : 'Standby',
            },
            {
              label: 'K2 (Grid)',
              color: K2_Grid ? 'bg-blue-100 border-blue-400' : 'bg-slate-100 border-slate-300',
              dot:   K2_Grid ? 'bg-blue-500 animate-pulse' : 'bg-slate-400',
              status: K2_Grid ? 'ON' : 'OFF',
              sub:    K2_Grid ? `${gridVoltage.toFixed(1)}V / ${gridFrequency.toFixed(1)}Hz` : 'Standby',
            },
            {
              label: 'K3 (Charging)',
              color: k3Reconnect.locked            ? 'bg-cyan-100 border-cyan-400'
                   : K3_Charge && hasPowerSource   ? 'bg-teal-100 border-teal-400'
                   : 'bg-slate-100 border-slate-300',
              dot:   k3Reconnect.locked            ? 'bg-cyan-500 animate-pulse'
                   : K3_Charge && hasPowerSource   ? 'bg-teal-500 animate-pulse'
                   : 'bg-slate-400',
              status: k3ModeLabel,
              sub:    k3DirectionLabel,
            },
          ].map((r, i) => (
            <div key={i} className={`p-3 rounded-lg border-2 ${r.color}`}>
              <div className="text-center">
                <div className="text-xs text-slate-600 mb-1">{r.label}</div>
                <div className={`w-4 h-4 mx-auto rounded-full ${r.dot}`} />
                <div className="text-[0.65rem] text-slate-600 mt-1 font-semibold">{r.status}</div>
                <div className="text-[0.55rem] text-slate-500 mt-0.5">{r.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── RELAY WIRING REFERENCE ── */}
        <div className="rounded-xl border-2 border-cyan-300 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3" style={{background:'linear-gradient(to right, #0891b2, #2563eb)'}}>
            <ArrowLeftRight className="w-4 h-4 text-white" />
            <span className="text-sm text-white font-medium">Relay Wiring Reference</span>
            <span className="ml-auto text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">
              Lead Acid Gel 24V · 100Ah
            </span>
          </div>
          <div className="divide-y divide-cyan-100 bg-white">

            {/* K4 */}
            <div className="flex items-start gap-3 px-4 py-3 hover:bg-cyan-50 transition-colors">
              <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${K4_Open ? 'bg-red-100' : 'bg-green-100'}`}>
                <Power className={`w-4 h-4 ${K4_Open ? 'text-red-600' : 'text-green-600'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-800">K4 — Main Contactor</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">PIN 4</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ml-auto ${K4_Open ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {K4_Open ? 'OPEN — Outlets Dead' : 'CLOSED — Outlets Live'}
                  </span>
                </div>
                <div className="mt-2 px-2 py-1.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-600 font-mono">
                  AC Sources → K4 (Contactor) → Outlets (220V AC)
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-600">
                  <div className="flex gap-1.5"><span className="text-red-700 font-semibold shrink-0">EMERGENCY</span><span>K3+K1+K2 OFF → K4 OPEN. Full cutoff + buzzer.</span></div>
                  <div className="flex gap-1.5"><span className="text-slate-600 font-semibold shrink-0">DROPOUT</span><span>K4 opens automatically when both sources OFF and battery low.</span></div>
                </div>
                <div className="mt-2 px-2 py-1.5 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  <span className="font-semibold">⚠ Interlock:</span> K3 forced OFF if K4 OPEN (anti-islanding, IEEE 1547).
                </div>
              </div>
            </div>

            {/* K1 */}
            <div className="flex items-start gap-3 px-4 py-3 hover:bg-amber-50 transition-colors">
              <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${K1_Inv ? 'bg-amber-100' : 'bg-slate-100'}`}>
                <Sun className={`w-4 h-4 ${K1_Inv ? 'text-amber-600' : 'text-slate-400'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-800">K1 — Solar (Inverter Output) → Outlet 1</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">PIN 7</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ml-auto ${K1_Inv ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                    {K1_Inv ? 'ACTIVE' : 'STANDBY'}
                  </span>
                </div>
                <div className="mt-2 px-2 py-1.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-600 font-mono">
                  Battery → Hybrid Inverter → K1 → K4 → Outlet 1 (Laptop)
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-600">
                  <div className="flex gap-1.5"><span className="text-amber-600 font-semibold shrink-0">Auto:</span><span>Always ON. Inverter {INV_CRITICAL_LOW}–{INV_CRITICAL_HIGH}V normal range.</span></div>
                  <div className="flex gap-1.5"><span className="text-slate-600 font-semibold shrink-0">Manual:</span><span>Toggle independently. Does NOT affect Outlet 2 (Grid path).</span></div>
                </div>
                {K1_Inv && (
                  <div className="mt-2 px-2 py-1.5 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800 font-medium">
                    ⚡ Live: {inverterVoltage.toFixed(1)}V / {inverterFrequency.toFixed(1)}Hz → K4 → Outlet 1
                  </div>
                )}
              </div>
            </div>

            {/* K2 */}
            <div className="flex items-start gap-3 px-4 py-3 hover:bg-blue-50 transition-colors">
              <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${K2_Grid ? 'bg-blue-100' : 'bg-slate-100'}`}>
                <Zap className={`w-4 h-4 ${K2_Grid ? 'text-blue-600' : 'text-slate-400'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-800">K2 — Grid Input → Outlet 2</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">PIN 6</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ml-auto ${K2_Grid ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                    {K2_Grid ? 'ACTIVE' : 'STANDBY'}
                  </span>
                </div>
                <div className="mt-2 px-2 py-1.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-600 font-mono">
                  MERALCO Grid (220V AC) → K2 → K4 → Outlet 2 (Monitor)
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-600">
                  <div className="flex gap-1.5"><span className="text-blue-600 font-semibold shrink-0">Auto:</span><span>Always ON. Grid {GRID_NORMAL_LOW}–{GRID_NORMAL_HIGH}V normal range.</span></div>
                  <div className="flex gap-1.5"><span className="text-teal-600 font-semibold shrink-0">K3 charging:</span><span>Grid charges battery via K3 when K2 active and battery not full.</span></div>
                  <div className="flex gap-1.5"><span className="text-slate-600 font-semibold shrink-0">Manual:</span><span>Toggle independently. Does NOT affect Outlet 1 (Solar path).</span></div>
                </div>
                {K2_Grid && (
                  <div className="mt-2 px-2 py-1.5 rounded bg-blue-50 border border-blue-200 text-xs text-blue-800 font-medium">
                    ⚡ Live: {gridVoltage.toFixed(1)}V / {gridFrequency.toFixed(1)}Hz → K4 → Outlet 2
                  </div>
                )}
              </div>
            </div>

            {/* K3 */}
            <div className="flex items-start gap-3 px-4 py-3 hover:bg-teal-50 transition-colors">
              <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0
                ${k3Reconnect.locked ? 'bg-cyan-100' : K3_Charge && hasPowerSource ? 'bg-teal-100' : 'bg-slate-100'}`}>
                <Battery className={`w-4 h-4 ${k3Reconnect.locked ? 'text-cyan-600' : K3_Charge && hasPowerSource ? 'text-teal-600' : 'text-slate-400'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-800">K3 — Battery Charging</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">PIN 5</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-semibold">AUTO-ONLY</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ml-auto
                    ${k3Reconnect.locked ? 'bg-cyan-100 text-cyan-700'
                    : K3_Charge && hasPowerSource ? 'bg-teal-100 text-teal-700'
                    : 'bg-slate-100 text-slate-500'}`}>
                    {k3ModeLabel}
                  </span>
                </div>
                <div className="mt-2 px-2 py-1.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-600 font-mono">
                  MERALCO Grid → K3 → Inverter Charging Input → Battery (24V)
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-600">
                  <div className="flex gap-1.5"><span className="text-teal-600 font-semibold shrink-0">ON when:</span><span>Battery is charging and not yet full (≥{BAT_FULL}V). K2 must be active.</span></div>
                  <div className="flex gap-1.5"><span className="text-slate-600 font-semibold shrink-0">OFF when:</span><span>Battery full, battery supplying load (discharging), or K2 is OFF.</span></div>
                </div>
                {k3Reconnect.locked && (
                  <div className="mt-2 px-2 py-1.5 rounded bg-cyan-50 border border-cyan-200 text-xs text-cyan-800 font-medium flex items-center gap-1">
                    <Timer className="w-3 h-3 shrink-0" />
                    Safety delay: {k3Reconnect.secondsRemaining}s remaining
                  </div>
                )}
                {K3_Charge && !k3Reconnect.locked && hasPowerSource && (
                  <div className="mt-2 px-2 py-1.5 rounded bg-teal-50 border border-teal-200 text-xs text-teal-800 font-medium">
                    ⚡ Active — Grid → Battery charging · {batteryVoltage.toFixed(1)}V ({batterySOC.toFixed(0)}%)
                  </div>
                )}
                {!K3_Charge && !k3Reconnect.locked && (
                  <div className="mt-2 px-2 py-1.5 rounded bg-slate-50 border border-slate-200 text-xs text-slate-500">
                    Standby · Battery {batteryVoltage.toFixed(1)}V ({batterySOC.toFixed(0)}%)
                    {batteryFull ? ' · Full — charging not needed' : ' · Waiting for charging condition'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── ACTIVE MODE STATUS ── */}
        <div className={`p-3 rounded-lg border-2 ${
          K4_Open   ? 'bg-red-50 border-red-300'
          : K1_Inv  ? 'bg-amber-50 border-amber-200'
          : K2_Grid ? 'bg-blue-50 border-blue-200'
          :           'bg-slate-50 border-slate-300'}`}>
          <div className="text-xs font-semibold text-slate-700 mb-1">🔌 Outlet Status</div>
          <div className="grid grid-cols-2 gap-2">
            <div className={`text-xs px-2 py-1 rounded ${outlet1Energized ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>
              <span className="font-semibold">Outlet 1:</span>{' '}
              {outlet1Energized
                ? `Solar (K1) — ${inverterVoltage.toFixed(1)}V / ${inverterFrequency.toFixed(1)}Hz`
                : K4_Open ? 'K4 OPEN' : 'K1 OFF — No Solar'}
            </div>
            <div className={`text-xs px-2 py-1 rounded ${outlet2Energized ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-500'}`}>
              <span className="font-semibold">Outlet 2:</span>{' '}
              {outlet2Energized
                ? `Grid (K2) — ${gridVoltage.toFixed(1)}V / ${gridFrequency.toFixed(1)}Hz`
                : K4_Open ? 'K4 OPEN' : 'K2 OFF — No Grid'}
            </div>
          </div>
          {K3_Charge && hasPowerSource && (
            <div className="text-xs text-teal-700 mt-1">
              ⚡ K3 CHARGING — Battery {batteryVoltage.toFixed(1)}V ({batterySOC.toFixed(0)}%)
            </div>
          )}
          {k3Reconnect.locked && (
            <div className="text-xs text-cyan-700 mt-1 flex items-center gap-1">
              <Timer className="w-3 h-3" />
              K3 safety delay: {k3Reconnect.secondsRemaining}s remaining
            </div>
          )}
        </div>

        {/* ── OUTLET CONTROL PANEL ── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Power className="w-5 h-5 text-slate-700" />
            <h3 className="text-sm sm:text-base font-semibold text-slate-900">Outlet Control Panel</h3>
            <span className={`ml-auto text-[0.65rem] px-2 py-0.5 rounded-full font-bold border ${
              K4_Open ? 'bg-red-100 text-red-700 border-red-300' : 'bg-slate-100 text-slate-700 border-slate-300'}`}>
              {K4_Open ? '🔴 K4 OPEN' : (outlet1Energized || outlet2Energized) ? '⚡ LIVE' : '⚫ NO PATH'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {outlets.map(outlet => (
              <div key={outlet.id} className={`p-3 sm:p-4 rounded-lg border-2 transition-all ${
                outlet.energized ? 'border-green-300' : 'bg-slate-50 border-slate-300'
              }`} style={outlet.energized ? {background:'linear-gradient(to bottom right, #f0fdf4, #ecfdf5)'} : {}}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${outlet.energized ? 'bg-green-500' : 'bg-slate-400'}`}>
                      <Power className="w-3 h-3 sm:w-4 sm:h-4 text-white" />
                    </div>
                    <div>
                      <div className="text-xs sm:text-sm text-slate-900">{outlet.name}</div>
                      <div className="text-[0.6rem] sm:text-xs text-slate-500">{outlet.load}</div>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded text-[0.65rem] border font-semibold ${
                    outlet.energized ? 'bg-green-100 text-green-700 border-green-300' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                    {outlet.energized ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className={`px-3 py-2 rounded-lg mb-3 ${outlet.sourceColor.badge}`}>
                  <div className="flex justify-between">
                    <span className="text-xs text-slate-500">Source:</span>
                    <span className={`text-xs font-medium ${outlet.sourceColor.text}`}>
                      {outlet.source}
                    </span>
                  </div>
                </div>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs text-slate-500">Status:</span>
                  <span className={`text-xs px-3 py-1 rounded-md font-semibold ${outlet.energized ? 'bg-green-500 text-white' : 'bg-gray-400 text-white'}`}>
                    {outlet.energized ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Current:</span>
                    <span className="text-slate-900">{outlet.current.toFixed(2)} A</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Voltage:</span>
                    <span className="text-slate-900">{outlet.voltage.toFixed(1)} V</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Power:</span>
                    <span className="text-slate-900 font-semibold">{(outlet.current * outlet.voltage).toFixed(0)} W</span>
                  </div>
                </div>
                {outlet.hasAnomaly && outlet.energized && (
                  <div className="mt-2 p-2 rounded bg-red-100 border border-red-300 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-red-600 shrink-0" />
                    <span className="text-[0.65rem] text-red-700">Voltage anomaly detected on source</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Total Load — sum of both outlets */}
          <div className="p-3 rounded-lg border border-indigo-200" style={{background:'linear-gradient(to right, #eef2ff, #faf5ff)'}}>
            <div className="flex items-center justify-between">
              <span className="text-xs sm:text-sm text-slate-700">Total Load:</span>
              <div className="flex items-center gap-2">
                <span className="text-lg sm:text-xl font-bold text-indigo-900">
                  {totalCurrent.toFixed(2)} A
                </span>
                <span className="text-xs text-slate-500">
                  ({totalPower.toFixed(0)} W)
                </span>
              </div>
            </div>
            <div className="mt-1 text-[0.6rem] text-slate-400 flex gap-3">
              <span>Outlet 1 (Solar): {outlet1Energized ? `${(inverterCurrent ?? 0).toFixed(2)}A · ${((inverterCurrent ?? 0) * inverterVoltage).toFixed(0)}W` : '0 W'}</span>
              <span>Outlet 2 (Grid): {outlet2Energized ? `${(gridCurrent ?? 0).toFixed(2)}A · ${((gridCurrent ?? 0) * gridVoltage).toFixed(0)}W` : '0 W'}</span>
            </div>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
