import { Activity, Workflow } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { useEnergySystem } from '../../contexts/EnergySystemContext';
import type { AnomalyLevel } from '../../contexts/EnergySystemContext';

// ═══════════════════════════════════════════════════════════
// ICONS
// ═══════════════════════════════════════════════════════════
function SolarIcon({ active, size = 48 }: { active: boolean; size?: number }) {
  const c = active ? '#f59e0b' : '#d1d5db';
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      {active && [0,45,90,135,180,225,270,315].map((a, i) => (
        <line key={i}
          x1={40 + Math.cos(a * Math.PI / 180) * 11} y1={13 + Math.sin(a * Math.PI / 180) * 11}
          x2={40 + Math.cos(a * Math.PI / 180) * 16} y2={13 + Math.sin(a * Math.PI / 180) * 16}
          stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
      ))}
      <circle cx="40" cy="13" r="7" fill={active ? '#fde68a' : '#e5e7eb'}
        style={active ? { filter: 'drop-shadow(0 0 5px #fbbf24)' } : undefined} />
      <rect x="8" y="27" width="64" height="40" rx="3"
        fill={active ? '#fffbeb' : '#f9fafb'} stroke={c} strokeWidth="2" />
      {[0,1,2].map(col => [0,1].map(row => (
        <rect key={`${col}${row}`} x={11 + col * 20} y={30 + row * 17} width={17} height={14} rx="2"
          fill={active ? '#fef3c7' : '#f3f4f6'} stroke={c} strokeWidth="0.9" strokeOpacity="0.7" />
      )))}
      <line x1="22" y1="67" x2="17" y2="74" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <line x1="58" y1="67" x2="63" y2="74" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <line x1="13" y1="74" x2="67" y2="74" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function InverterIcon({ active, size = 48 }: { active: boolean; size?: number }) {
  const c = active ? '#8b5cf6' : '#d1d5db';
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      <rect x="8" y="6" width="64" height="62" rx="5"
        fill={active ? '#f5f3ff' : '#f9fafb'} stroke={c} strokeWidth="2"
        style={active ? { filter: `drop-shadow(0 0 6px ${c}30)` } : undefined} />
      <rect x="13" y="11" width="38" height="22" rx="2"
        fill={active ? '#ede9fe' : '#f3f4f6'} stroke={c} strokeWidth="1" strokeOpacity="0.6" />
      {active && <polyline points="15,29 20,20 26,26 32,17 38,23 44,18 48,21"
        stroke="#8b5cf6" strokeWidth="1.8" fill="none" strokeLinecap="round" />}
      <circle cx="60" cy="15" r="5" fill={active ? '#10b981' : '#e5e7eb'}
        style={active ? { filter: 'drop-shadow(0 0 3px #10b981)' } : undefined} />
      <circle cx="60" cy="28" r="5" fill={active ? '#8b5cf6' : '#e5e7eb'}>
        {active && <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />}
      </circle>
      <text x="22" y="73" fill={active ? '#f59e0b' : '#9ca3af'} fontSize="9" fontFamily="monospace" fontWeight="900">DC</text>
      <text x="34" y="73" fill="#9ca3af" fontSize="9" fontFamily="monospace">→</text>
      <text x="44" y="73" fill={active ? c : '#9ca3af'} fontSize="9" fontFamily="monospace" fontWeight="900">AC</text>
    </svg>
  );
}

function BatteryIcon({
  active, soc, charging, discharging, full, size = 48,
}: {
  active: boolean; soc: number; charging: boolean; discharging: boolean; full: boolean; size?: number;
}) {
  const fillColor = soc > 50 ? '#10b981' : soc > 20 ? '#f59e0b' : '#ef4444';
  const c = active ? fillColor : '#d1d5db';
  const fillW = Math.round(52 * (soc / 100));
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      <rect x="5" y="20" width="62" height="40" rx="4"
        fill={active ? '#f0fdf4' : '#f9fafb'} stroke={c} strokeWidth="2"
        style={active ? { filter: `drop-shadow(0 0 5px ${fillColor}30)` } : undefined} />
      <rect x="67" y="30" width="8" height="20" rx="2" fill={active ? c : '#e5e7eb'} />
      <rect x="8" y="23" width={fillW} height="34" rx="2" fill={active ? fillColor : '#e5e7eb'} />
      {[1,2].map(i => (
        <line key={i} x1={8 + i * 18} y1="23" x2={8 + i * 18} y2="57" stroke="white" strokeWidth="1.5" />
      ))}
      <text x="36" y="43" textAnchor="middle" fill={active ? 'white' : '#9ca3af'}
        fontSize="12" fontFamily="monospace" fontWeight="900">{soc}%</text>
      {full     && active && <text x="36" y="55" textAnchor="middle" fill="#10b981" fontSize="8" fontFamily="monospace">✦FULL</text>}
      {charging && active && !full && <text x="36" y="55" textAnchor="middle" fill="white" fontSize="8" fontFamily="monospace">⚡CHG</text>}
      {discharging && active && <text x="36" y="55" textAnchor="middle" fill="#fbbf24" fontSize="8" fontFamily="monospace">DSCH</text>}
    </svg>
  );
}

function GridIcon({ active, size = 48 }: { active: boolean; size?: number }) {
  const c = active ? '#3b82f6' : '#d1d5db';
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      {active && <polygon points="43,2 36,14 41,14 33,26 44,12 39,12"
        fill="#3b82f6" style={{ filter: 'drop-shadow(0 0 4px #3b82f6)' }} />}
      <line x1="40" y1="4" x2="40" y2="72" stroke={c} strokeWidth="2.5" />
      <line x1="12" y1="18" x2="68" y2="18" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <line x1="16" y1="32" x2="64" y2="32" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="22" y1="46" x2="58" y2="46" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="40" y1="18" x2="12" y2="50" stroke={c} strokeWidth="1" strokeOpacity="0.5" />
      <line x1="40" y1="18" x2="68" y2="50" stroke={c} strokeWidth="1" strokeOpacity="0.5" />
      <line x1="40" y1="72" x2="28" y2="76" stroke={c} strokeWidth="2" strokeLinecap="round" />
      <line x1="40" y1="72" x2="52" y2="76" stroke={c} strokeWidth="2" strokeLinecap="round" />
      {[[12,18],[68,18],[16,32],[64,32]].map(([x,y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill={active ? '#dbeafe' : '#f3f4f6'} stroke={c} strokeWidth="1" />
      ))}
    </svg>
  );
}

function ServerRackIcon({ active, size = 48 }: { active: boolean; size?: number }) {
  const c = active ? '#0ea5e9' : '#d1d5db';
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
      <rect x="5" y="4" width="70" height="72" rx="4"
        fill={active ? '#f0f9ff' : '#f9fafb'} stroke={c} strokeWidth="2"
        style={active ? { filter: `drop-shadow(0 0 6px ${c}30)` } : undefined} />
      <rect x="5"  y="4"  width="7" height="72" rx="2" fill={active ? '#e0f2fe' : '#f3f4f6'} stroke={c} strokeWidth="0.8" strokeOpacity="0.5" />
      <rect x="68" y="4"  width="7" height="72" rx="2" fill={active ? '#e0f2fe' : '#f3f4f6'} stroke={c} strokeWidth="0.8" strokeOpacity="0.5" />
      {[0,1,2,3].map(i => (
        <g key={i}>
          <rect x="14" y={8 + i * 16} width="52" height="13" rx="2"
            fill={active ? 'white' : '#f9fafb'} stroke={c} strokeWidth="0.8" strokeOpacity="0.5" />
          {active && [0,2].map(d => (
            <rect key={d} x={17 + d * 7} y={8 + i * 16 + 4} width={3} height={5} rx="0.5"
              fill={i === 2 ? '#f59e0b' : '#10b981'} opacity="0.7">
              <animate attributeName="opacity" values="0.7;0.15;0.7"
                dur={`${0.9 + d * 0.3 + i * 0.2}s`} repeatCount="indefinite" />
            </rect>
          ))}
          <circle cx="62" cy={8 + i * 16 + 6.5} r="2.5"
            fill={active ? (i === 2 ? '#f59e0b' : '#10b981') : '#e5e7eb'}
            style={active ? { filter: `drop-shadow(0 0 3px ${i === 2 ? '#f59e0b' : '#10b981'})` } : undefined} />
        </g>
      ))}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// FLOW LINE — bidirectional support
// ═══════════════════════════════════════════════════════════
function FlowLine({
  pathId, x1, y1, x2, y2, color, colorDot, active, speed = 1.6, delay = 0, thickness = 2.5, label,
}: {
  pathId: string;
  x1: number; y1: number; x2: number; y2: number;
  color: string; colorDot?: string;
  active: boolean; speed?: number; delay?: number; thickness?: number;
  label?: string;
}) {
  const cd  = colorDot ?? color;
  const len  = Math.sqrt((x2-x1)**2 + (y2-y1)**2);
  const beam = len * 0.22;
  const mx   = (x1+x2)/2;
  const my   = (y1+y2)/2;

  if (!active) return (
    <line x1={x1} y1={y1} x2={x2} y2={y2}
      stroke="#cbd5e1" strokeWidth={thickness} strokeLinecap="round"
      strokeDasharray="5 5" strokeOpacity="0.6" />
  );

  return (
    <g>
      <defs><path id={pathId} d={`M${x1},${y1} L${x2},${y2}`} /></defs>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={thickness*6}  strokeOpacity="0.04" strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={thickness*3}  strokeOpacity="0.08" strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={thickness*0.5} strokeOpacity="0.25" strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={cd} strokeWidth={thickness*1.5} strokeLinecap="round"
        strokeDasharray={`${beam} ${len}`}
        style={{ filter: `drop-shadow(0 0 5px ${color}) drop-shadow(0 0 12px ${color}90)` }}>
        <animate attributeName="stroke-dashoffset"
          from={len+beam} to={-(len+beam)}
          dur={`${speed}s`} begin={`${delay}s`} repeatCount="indefinite" />
      </line>
      <circle r={thickness*2.2} fill={cd}
        style={{ filter: `drop-shadow(0 0 8px ${color}) drop-shadow(0 0 16px ${color})` }}>
        <animateMotion dur={`${speed}s`} begin={`${delay}s`} repeatCount="indefinite">
          <mpath href={`#${pathId}`} />
        </animateMotion>
      </circle>
      {label && (
        <text x={mx} y={my - 8} textAnchor="middle" fontSize="8"
          fontFamily="monospace" fontWeight="700" fill={cd} opacity="0.9"
          style={{ filter: `drop-shadow(0 0 3px ${color})` }}>
          {label}
        </text>
      )}
    </g>
  );
}

// ── Manila harvest time helper ───────────────────────────────────────────────
const getManilaHour = (): number => {
  const manila = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  return manila.getHours();
};
const isSolarHarvestTime = (): boolean => { const h = getManilaHour(); return h >= 6 && h < 18; };

// ── Solar condition label from power/anomaly ─────────────────────────────────
function getSolarCondition(power: number, anomaly: AnomalyLevel, isHarvest: boolean): string {
  if (!isHarvest) return 'NIGHT';
  if (power <= 0)  return 'STANDBY';
  if (anomaly === 'critical') return 'STORM';
  if (anomaly === 'warning')  return 'CLOUDY';
  return 'ACTIVE';
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export function EnergyFlowHub() {
  const {
    ssrStates, contactorClosed, k3Active, k3Direction, k3Reconnect, controlMode, systemCondition,
    gridVoltage, gridFrequency, gridPower, gridCurrent,
    inverterPower, inverterCurrent, solarPower,
    batteryVoltage, batteryCurrent, batterySOC, batteryFull,
    battery1Voltage: _ina_b1v, battery2Voltage: _ina_b2v,
    solarAnomaly, gridAnomaly,
  } = useEnergySystem();


  // ── SSR mapping — hardware truth ─────────────────────────────────────
  // K1 / SSR1 = Solar/Inverter path relay     → ssrStates.SSR1 (K1)
  // K2 / SSR2 = Grid bypass relay             → ssrStates.SSR2 (K2)
  // K3        = Grid Assist / Charging relay → k3Active (auto only, ATS output)
  // K4 / SSR4 = DC Battery Contactor          → contactorClosed (RPI GPIO)
  const K1_Solar    = ssrStates?.K1 ?? false;   // K1: Solar/Inverter path ON
  const K2_Grid     = ssrStates?.K2 ?? false;   // K2: Grid bypass ON
  const K3_GridAssist = k3Active ?? false;           // K3: Grid Assist / Charging (auto)
  const SSR4_Closed = contactorClosed && controlMode !== 'shutdown'; // K4: DC contactor

  // ── Safety ────────────────────────────────────────────────────────────
  const batCritical  = batteryVoltage > 0 && batteryVoltage < 21.0;
  const gridHasReading = gridVoltage > 10;
  const gridVoltageOK  = !gridHasReading || (gridVoltage >= 200 && gridVoltage <= 245);
  const gridHealthy    = gridVoltageOK && (gridAnomaly as AnomalyLevel) !== 'critical';
  const isHarvest    = isSolarHarvestTime();

  // ── Solar node condition (time+power based, NOT SSR) ─────────────────
  const solarCondition  = getSolarCondition(solarPower, solarAnomaly as AnomalyLevel, isHarvest);
  const solarNodeActive = isHarvest && solarPower > 0;

  // ── Flow: PV → Inverter ──────────────────────────────────────────────
  const flowSolarToInv = K1_Solar && isHarvest && solarPower > 0;

  // ── Flow: Battery ────────────────────────────────────────────────────
  const isCharging    = SSR4_Closed && !batCritical && (batteryCurrent ?? 0) > 0.05;
  const isDischarging = SSR4_Closed && !batCritical && (batteryCurrent ?? 0) < -0.05;

  // ── Scenario: Solar weak/zero → K3 Grid Assist → Grid + Solar → Inverter → Battery + Load
  // batChargeSolar: solar contributing to charge — can be active even with K3 ON
  //   (both solar + grid feeding inverter simultaneously)
  const batChargeSolar = isCharging && K1_Solar && flowSolarToInv;
  // batChargeGrid: K3 ON — grid assists via inverter path → battery
  const batChargeGrid  = isCharging && K3_GridAssist;
  // flowInvToBat: battery receiving charge from either source (or both)
  const flowInvToBat  = batChargeSolar || batChargeGrid;
  // flowBatToInv: battery discharging → inverter → load
  const flowBatToInv  = isDischarging && K1_Solar;
  const batFullGlow   = SSR4_Closed && !batCritical && batteryFull;

  // ── Flow: Inverter → Load ─────────────────────────────────────────────
  // Active whenever inverter is producing: solar → load, battery → load, or battery full + solar → load
  // Battery full case: isCharging≈0 so flowInvToBat=false, but solar still powers load via inverter
  const invActuallyOn   = (inverterPower ?? 0) > 5 || (inverterCurrent ?? 0) > 0.05;
  const flowInvToServer = K1_Solar && !K2_Grid && SSR4_Closed && invActuallyOn;

  // ── Flow: Grid → Load bypass ──────────────────────────────────────────
  const gridActuallyOn   = (gridPower ?? 0) > 5 || (gridCurrent ?? 0) > 0.05;
  // [FIX-FLOW] Grid has no current sensor — base flow on voltage presence + K2 ON
  const flowGridToServer = K2_Grid && gridVoltageOK && SSR4_Closed && gridHasReading;

  // ── Flow: K3 paths — Grid Assist only (no net metering) ─────────────
  // Grid → Inverter → Battery  (K3 assist — supplements solar or charges battery)
  const flowGridToInv  = K3_GridAssist && gridVoltageOK && K1_Solar && gridHasReading;
  const flowInvToGrid  = false;  // No net metering — no export to grid
  const flowGridAssist = flowGridToInv;
  const flowGridCharge = false;  // No net metering

  const outletsOn = flowInvToServer || flowGridToServer;

  // ── Animation speeds ∝ real watts ────────────────────────────────────
  const spd = (w: number, max = 3000) => Math.max(0.6, Math.min(2.5, 2.5 - (w / max) * 1.9));
  const speedSolar   = spd(solarPower   ?? 0, 3000);
  const speedBat     = spd(Math.abs((batteryCurrent ?? 0) * batteryVoltage), 2000);
  const speedInvLoad = spd(inverterPower ?? 0, 3000);
  const speedGrid    = spd((gridVoltage ?? 0) > 0 ? 500 : 0, 3000);  // [FIX-FLOW] no current sensor, use fixed estimate

  // ── Battery SOC — 24V Lead Acid 2S (2× 12V 100Ah series) ─────────────
  // [FIX-SOC-PACK] Priority: INA219 b1v+b2v → 24V table → batterySOC fallback
  // calcSOC range corrected to match ina.py: 21.0V(0%) → 25.4V(100%)
  const batV    = batteryVoltage ?? 0;
  const _b1v_hub = _ina_b1v ?? 0;
  const _b2v_hub = _ina_b2v ?? 0;
  const _b1ok_hub = _b1v_hub > 2.0;
  const _b2ok_hub = _b2v_hub > 2.0;
  const _packV_hub = _b1ok_hub && _b2ok_hub ? _b1v_hub + _b2v_hub
                   : _b1ok_hub ? _b1v_hub
                   : _b2ok_hub ? _b2v_hub
                   : batV;
  const calcSOC = (v: number) => {
    // [FIX] Corrected range: 21.0V(0%) → 25.4V(100%) — matches ina.py calculate_pack_soc()
    // Was 21.6–26.4V which gave wrong SOC values vs actual battery state
    if (v >= 25.4) return 100; if (v >= 24.8) return 90; if (v >= 24.6) return 80;
    if (v >= 24.2) return 70;  if (v >= 24.0) return 60; if (v >= 23.8) return 50;
    if (v >= 23.6) return 40;  if (v >= 23.2) return 30; if (v >= 23.0) return 20;
    if (v >= 22.0) return 10;  return 0;
  };
  const batSoc = (_b1ok_hub || _b2ok_hub)
    ? calcSOC(_packV_hub)
    : batterySOC > 0 ? batterySOC : calcSOC(batV);

  const modeColor = controlMode === 'solar' ? '#d97706' : controlMode === 'grid' ? '#2563eb' : '#dc2626';
  const modeLabel = controlMode === 'solar' ? 'Solar Priority' : controlMode === 'grid' ? 'Grid Fallback' : 'Safe Mode';

  const condBg = systemCondition?.includes('Load Cut Off') || systemCondition?.includes('Shutdown') || systemCondition?.includes('Critical')
    ? 'bg-red-50 border-red-200 text-red-700'
    : systemCondition?.includes('Warning') || systemCondition?.includes('Grid Assist')
    ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
    : 'bg-green-50 border-green-200 text-green-700';
  const condDot = systemCondition?.includes('Load Cut Off') || systemCondition?.includes('Shutdown') || systemCondition?.includes('Critical')
    ? 'bg-red-500'
    : systemCondition?.includes('Warning') || systemCondition?.includes('Grid Assist')
    ? 'bg-yellow-500'
    : 'bg-green-500';

  // Layout
  const W = 780, H = 420, CX = 390;
  const solar    = { x: CX,       y: 40  };
  const inverter = { x: CX,       y: 180 };
  const battery  = { x: CX - 250, y: 210 };
  const grid     = { x: CX + 250, y: 210 };
  const server   = { x: CX,       y: 330 };

  const VAL_SIZE  = '24px';
  const UNIT_SIZE = '16px';
  const LBL_SIZE  = '10px';

  const nodeStyle = (active: boolean, bg: string, border: string): React.CSSProperties => ({
    width: '80px', height: '80px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: active ? bg : 'white',
    border: `1.5px solid ${active ? border : '#e2e8f0'}`,
    borderRadius: '12px',
    boxShadow: active ? `0 2px 10px ${border}60` : '0 1px 4px rgba(0,0,0,0.06)',
    transition: 'all 0.5s ease',
  });

  const labelStyle = (active: boolean, color: string): React.CSSProperties => ({
    fontSize: '8px', fontFamily: "'JetBrains Mono',monospace",
    fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase' as const,
    color: active ? color : '#94a3b8',
  });

  const badgeStyle = (active: boolean, bg: string, text: string, border: string): React.CSSProperties => ({
    fontSize: '7px', fontWeight: '700', fontFamily: "'JetBrains Mono',monospace",
    padding: '2px 7px', borderRadius: '10px', lineHeight: '14px',
    display: 'inline-block', whiteSpace: 'nowrap',
    background: active ? bg : '#f3f4f6',
    color: active ? text : '#6b7280',
    border: `1px solid ${active ? border : '#e5e7eb'}`,
    boxSizing: 'border-box' as const,
  });

  // [FIX-BYPASS] Inverter is only active when K1 Solar path is on AND K2 is NOT bypassing
  const inverterActive = K1_Solar && !K2_Grid && SSR4_Closed;

  return (
    <Card className="border-slate-200 shadow-lg bg-white">
      {/* HEADER */}
      <CardHeader className="py-2 px-4">
        <CardTitle className="flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div style={{
              width: '40px', height: '40px', borderRadius: '8px', background: '#f0fdf4',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Workflow size={20} color="#16a34a" strokeWidth={2} />
            </div>
            <span className="text-lg font-medium text-slate-800 truncate">Energy Flow Hub</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className={`hidden sm:flex items-center gap-2 px-4 py-1 rounded-full text-xs font-medium border ${condBg}`}
              style={{ lineHeight: '1.5', whiteSpace: 'nowrap', minWidth: '110px', justifyContent: 'center' }}>
              <div className={`w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0 ${condDot}`} />
              {systemCondition}
            </div>
            <div className="hidden sm:flex items-center gap-2 px-4 py-1 rounded-full text-xs font-medium bg-slate-100 border border-slate-200"
              style={{ lineHeight: '1.5', whiteSpace: 'nowrap', minWidth: '120px', justifyContent: 'center' }}>
              <Activity size={11} color="#64748b" strokeWidth={2} className="flex-shrink-0" />
              <span style={{ color: modeColor }}>{modeLabel}</span>
            </div>
          {/* Mobile — compact single badge */}
          <div className={`flex sm:hidden items-center gap-1.5 px-2 py-1 rounded-full text-[0.6rem] font-medium border ${condBg}`}>
            <div className={`w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0 ${condDot}`} />
            <span style={{ color: 'inherit' }}>{modeLabel}</span>
          </div>
          </div>
        </CardTitle>
      </CardHeader>

      {/* CANVAS */}
      <CardContent className="p-0">
        <div className="relative rounded-b-xl overflow-x-auto bg-white">
          <style>{`
            @keyframes hubBatFull {
              0%,100% { box-shadow: 0 0 8px #10b981, 0 0 18px #10b98150; border-color: #10b981; }
              50%      { box-shadow: 0 0 16px #10b981, 0 0 30px #10b98180; border-color: #34d399; }
            }
          `}</style>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`}
            style={{ display: 'block', overflow: 'visible' }}>

            {/* ── FLOW LINES ── */}

            {/* PV Solar → Inverter: Amber — K1/SSR2 + daytime + solar > 0 */}
            <FlowLine pathId="hub-sol"
              x1={solar.x} y1={solar.y+40} x2={inverter.x} y2={inverter.y-40}
              color="#f59e0b" colorDot="#fbbf24"
              active={flowSolarToInv} speed={speedSolar} delay={0} />

            {/* Inverter → Battery CHARGING: Green=solar, Blue=K3 grid import */}
            <FlowLine pathId="hub-inv-bat"
              x1={inverter.x-40} y1={inverter.y} x2={battery.x+40} y2={battery.y}
              color={batChargeGrid && batChargeSolar ? '#a78bfa' : batChargeGrid ? '#14b8a6' : '#10b981'}
              colorDot={batChargeGrid && batChargeSolar ? '#c4b5fd' : batChargeGrid ? '#2dd4bf' : '#34d399'}
              active={flowInvToBat} speed={speedBat} delay={0.2} label="CHG" />

            {/* Battery → Inverter DISCHARGING: Blue */}
            <FlowLine pathId="hub-bat-inv"
              x1={battery.x+40} y1={battery.y} x2={inverter.x-40} y2={inverter.y}
              color="#60a5fa" colorDot="#93c5fd"
              active={flowBatToInv} speed={speedBat} delay={0.2} label="DSCH" />

            {/* Inverter → Server PATH A Solar: Purple — OFF when K2 Grid bypass active */}
            <FlowLine pathId="hub-inv-srv"
              x1={inverter.x} y1={inverter.y+40} x2={server.x} y2={server.y-40}
              color="#8b5cf6" colorDot="#a78bfa"
              active={flowInvToServer} speed={speedInvLoad} delay={0.1} />

            {/* hub-inv-grd disabled — no net metering */}

            {/* Grid → Inverter → Battery: Teal — K3 grid assist/charging */}
            <FlowLine pathId="hub-grd-inv"
              x1={grid.x-40} y1={grid.y} x2={inverter.x+40} y2={inverter.y}
              color="#14b8a6" colorDot="#2dd4bf"
              active={flowGridToInv} speed={speedGrid} delay={0.15} label="GRID ASSIST" />

            {/* Grid → Server BYPASS: Blue — K2/SSR3 grid bypass (direct, no inverter) */}
            <FlowLine pathId="hub-byp"
              x1={grid.x} y1={grid.y+40} x2={server.x+40} y2={server.y}
              color="#3b82f6" colorDot="#60a5fa"
              active={flowGridToServer} speed={speedGrid} delay={0.1} label="BYPASS" />

            {/* ══════════════ NODES ══════════════ */}

            {/* ── SOLAR ── */}
            <foreignObject x={solar.x-40} y={solar.y-40} width={80} height={120} overflow="visible">
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'4px', overflow:'visible' }}>
                <div style={nodeStyle(solarNodeActive, '#fffbeb', '#fde68a')}>
                  <SolarIcon active={solarNodeActive} size={48} />
                </div>
                <span style={labelStyle(solarNodeActive, '#f59e0b')}>PV Solar</span>
                <div style={badgeStyle(solarNodeActive,
                  solarCondition === 'STORM'  ? '#fee2e2' :
                  solarCondition === 'CLOUDY' ? '#fef3c7' :
                  solarCondition === 'NIGHT'  ? '#f1f5f9' : '#fef9c3',
                  solarCondition === 'STORM'  ? '#991b1b' :
                  solarCondition === 'CLOUDY' ? '#92400e' :
                  solarCondition === 'NIGHT'  ? '#64748b' : '#a16207',
                  solarCondition === 'STORM'  ? '#fca5a5' :
                  solarCondition === 'CLOUDY' ? '#fde68a' :
                  solarCondition === 'NIGHT'  ? '#cbd5e1' : '#fde047',
                )}>
                  {solarCondition}
                </div>
              </div>
            </foreignObject>
            <foreignObject x={solar.x+46} y={solar.y-28} width={140} height={64}>
              <div>
                <div style={{ fontSize:LBL_SIZE, color:'#94a3b8', letterSpacing:'0.08em', textTransform:'uppercase', fontFamily:'monospace', marginBottom:'2px' }}>Solar Output</div>
                <div style={{ display:'flex', alignItems:'baseline', gap:'3px' }}>
                  <span style={{ fontSize:VAL_SIZE, fontWeight:'400', color: solarNodeActive ? '#0f172a' : '#cbd5e1', lineHeight:1 }}>
                    {solarPower?.toFixed(0) ?? '0'}
                  </span>
                  <span style={{ fontSize:UNIT_SIZE, fontWeight:'500', color:'#f59e0b' }}>W</span>
                </div>
                {(solarAnomaly as AnomalyLevel) !== 'none' && solarPower > 0 && (
                  <div style={{ fontSize:'9px', color: (solarAnomaly as AnomalyLevel) === 'critical' ? '#ef4444' : '#f59e0b', marginTop:'2px' }}>
                    ⚠ Solar {solarAnomaly}
                  </div>
                )}
              </div>
            </foreignObject>

            {/* ── BATTERY ── */}
            <foreignObject x={battery.x-40} y={battery.y-40} width={80} height={130} overflow="visible">
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'4px', overflow:'visible', position:'relative' }}>
                <div style={{
                  ...nodeStyle(flowInvToBat || flowBatToInv || batFullGlow, '#f0fdf4', '#bbf7d0'),
                  ...(batFullGlow ? { animation: 'hubBatFull 2s ease-in-out infinite' } : {}),
                }}>
                  <BatteryIcon
                    active={flowInvToBat || flowBatToInv || batFullGlow}
                    soc={batSoc}
                    charging={flowInvToBat}
                    discharging={flowBatToInv}
                    full={batFullGlow}
                    size={48} />
                </div>
                <span style={labelStyle(flowInvToBat || flowBatToInv || batFullGlow, '#10b981')}>Battery</span>
                <div style={badgeStyle(
                  batFullGlow || flowInvToBat || flowBatToInv,
                  batFullGlow    ? '#dcfce7' :
                  batChargeSolar ? '#dcfce7' :
                  batChargeGrid  ? '#ccfbf1' :
                  flowBatToInv   ? '#fef9c3' : '#f3f4f6',
                  batFullGlow    ? '#15803d' :
                  batChargeSolar ? '#15803d' :
                  batChargeGrid  ? '#0f766e' :
                  flowBatToInv   ? '#a16207' : '#6b7280',
                  batFullGlow    ? '#86efac' :
                  batChargeSolar ? '#86efac' :
                  batChargeGrid  ? '#5eead4' :
                  flowBatToInv   ? '#fde047' : '#e5e7eb',
                )}>
                  {batFullGlow    ? 'FULL' :
                   batChargeSolar ? '☀ CHG SOLAR' :
                   batChargeGrid  ? '⚡ CHG GRID' :
                   flowBatToInv   ? 'DISCHARGING' : 'STANDBY'}
                </div>
              </div>
            </foreignObject>
            <foreignObject x={battery.x-40-130} y={battery.y-24} width={122} height={80}>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:LBL_SIZE, color:'#94a3b8', letterSpacing:'0.08em', textTransform:'uppercase', fontFamily:'monospace', marginBottom:'2px' }}>Battery · 24V 100Ah</div>
                <div style={{ display:'flex', alignItems:'baseline', gap:'3px', justifyContent:'flex-end' }}>
                  <span style={{ fontSize:VAL_SIZE, fontWeight:'400', color: SSR4_Closed ? '#0f172a' : '#cbd5e1', lineHeight:1 }}>
                    {batV.toFixed(1)}
                  </span>
                  <span style={{ fontSize:UNIT_SIZE, fontWeight:'500', color:'#10b981' }}>V</span>
                </div>
                <div style={{ fontSize:'9px', color:'#94a3b8', fontFamily:'monospace', marginTop:'2px' }}>{batSoc}% SOC</div>
                <div style={{ fontSize:'9px', fontFamily:'monospace', marginTop:'2px',
                  color: (batteryCurrent ?? 0) > 0.05 ? '#10b981' : (batteryCurrent ?? 0) < -0.05 ? '#60a5fa' : '#94a3b8' }}>
                  {(batteryCurrent ?? 0) > 0.05
                    ? `+${(batteryCurrent ?? 0).toFixed(2)}A ↓`
                    : (batteryCurrent ?? 0) < -0.05
                    ? `${(batteryCurrent ?? 0).toFixed(2)}A ↑`
                    : '0.00A'}
                </div>
              </div>
            </foreignObject>

            {/* ── INVERTER ── [FIX-BYPASS] dim when K2 Grid bypass active */}
            <foreignObject x={inverter.x-40} y={inverter.y-40} width={80} height={120} overflow="visible">
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'4px', overflow:'visible' }}>
                <div style={nodeStyle(inverterActive, '#f5f3ff', '#ddd6fe')}>
                  <InverterIcon active={inverterActive} size={48} />
                </div>
                <span style={labelStyle(inverterActive, '#8b5cf6')}>Inverter</span>
                <div style={badgeStyle(inverterActive, '#ede9fe', '#6d28d9', '#c4b5fd')}>
                  {K2_Grid ? 'BYPASSED' : K1_Solar && SSR4_Closed ? 'ON' : !SSR4_Closed ? 'SHUTDOWN' : 'OFF'}
                </div>
              </div>
            </foreignObject>

            {/* ── GRID ── */}
            <foreignObject x={grid.x-40} y={grid.y-40} width={80} height={120} overflow="visible">
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'4px', overflow:'visible' }}>
                <div style={nodeStyle((K2_Grid || K3_GridAssist) && gridVoltageOK, '#eff6ff', '#bfdbfe')}>
                  <GridIcon active={(K2_Grid || K3_GridAssist) && gridVoltageOK} size={48} />
                </div>
                <span style={labelStyle((K2_Grid || K3_GridAssist) && gridVoltageOK, '#3b82f6')}>Grid AC</span>
                <div style={badgeStyle((K2_Grid || K3_GridAssist) && gridVoltageOK, '#dbeafe', '#1d4ed8', '#93c5fd')}>
                  {(gridAnomaly as AnomalyLevel) === 'critical' ? 'FAULT'   :
                   !gridVoltageOK  ? 'FAULT'   :
                   k3Reconnect?.locked ? `LOCK ${k3Reconnect.secondsRemaining}s` :
                   k3Direction === 'charging' ? '⚡ CHG GRID' :
                   k3Direction === 'assist'   ? 'GRID ASSIST' :
                   K2_Grid         ? 'BYPASS'  :
                   K3_GridAssist     ? 'K3 AUTO' : 'STANDBY'}
                </div>
              </div>
            </foreignObject>
            <foreignObject x={grid.x+46} y={grid.y-32} width={140} height={110}>
              <div>
                <div style={{ fontSize:LBL_SIZE, color:'#94a3b8', letterSpacing:'0.08em', textTransform:'uppercase', fontFamily:'monospace', marginBottom:'2px' }}>Grid</div>
                <div style={{ display:'flex', alignItems:'baseline', gap:'3px', lineHeight:1 }}>
                  <span style={{ fontSize:VAL_SIZE, fontWeight:'400', color: (K2_Grid || K3_GridAssist) && gridVoltageOK ? '#0f172a' : '#cbd5e1' }}>
                    {gridVoltage?.toFixed(0) ?? '0'}
                  </span>
                  <span style={{ fontSize:UNIT_SIZE, fontWeight:'500', color:'#3b82f6' }}>Vac</span>
                </div>
                <div style={{ display:'flex', alignItems:'baseline', gap:'3px', lineHeight:1, marginTop:'2px' }}>
                  <span style={{ fontSize:VAL_SIZE, fontWeight:'400', color: (K2_Grid || K3_GridAssist) && gridVoltageOK ? '#0f172a' : '#cbd5e1' }}>
                    {gridFrequency?.toFixed(1) ?? '0.0'}
                  </span>
                  <span style={{ fontSize:UNIT_SIZE, fontWeight:'500', color:'#3b82f6' }}>Hz</span>
                </div>

                {flowGridAssist && (
                  <div style={{ fontSize:'9px', color:'#2dd4bf', fontFamily:'monospace', marginTop:'3px' }}>↙ GRID ASSISTING</div>
                )}
                {(gridAnomaly as AnomalyLevel) !== 'none' && (
                  <div style={{ fontSize:'9px', color: (gridAnomaly as AnomalyLevel) === 'critical' ? '#ef4444' : '#f59e0b', marginTop:'2px' }}>
                    ⚠ Grid {gridAnomaly}
                  </div>
                )}
              </div>
            </foreignObject>

            {/* ── SERVER ── */}
            <foreignObject x={server.x-40} y={server.y-40} width={80} height={120} overflow="visible">
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'4px', overflow:'visible' }}>
                <div style={nodeStyle(outletsOn, '#f0f9ff', outletsOn ? '#bae6fd' : '#e2e8f0')}>
                  <ServerRackIcon active={outletsOn} size={48} />
                </div>
                <span style={labelStyle(outletsOn, '#0ea5e9')}>Server</span>
                <div style={badgeStyle(outletsOn,
                  !SSR4_Closed ? '#fee2e2' : '#e0f2fe',
                  !SSR4_Closed ? '#b91c1c' : '#0369a1',
                  !SSR4_Closed ? '#fca5a5' : '#7dd3fc')}>
                  {!SSR4_Closed ? 'SHUTDOWN' : flowGridToServer ? 'via BYPASS' : flowInvToServer ? 'via INVERTER' : 'OFFLINE'}
                </div>
              </div>
            </foreignObject>
            <foreignObject x={server.x+46} y={server.y-24} width={140} height={80}>
              <div>
                <div style={{ fontSize:LBL_SIZE, color:'#94a3b8', letterSpacing:'0.08em', textTransform:'uppercase', fontFamily:'monospace', marginBottom:'2px' }}>Consumption</div>
                <div style={{ display:'flex', alignItems:'baseline', gap:'3px' }}>
                  <span style={{ fontSize:VAL_SIZE, fontWeight:'400', color: outletsOn ? '#0f172a' : '#cbd5e1', lineHeight:1 }}>
                    {outletsOn && inverterPower != null ? Math.round(inverterPower * 0.85) : '0'}
                  </span>
                  <span style={{ fontSize:UNIT_SIZE, fontWeight:'500', color:'#0ea5e9' }}>W</span>
                </div>
                {flowGridToServer && (
                  <div style={{ fontSize:'9px', color:'#3b82f6', fontFamily:'monospace', marginTop:'2px' }}>via BYPASS (K2/SSR2)</div>
                )}
                {flowInvToServer && (
                  <div style={{ fontSize:'9px', color:'#8b5cf6', fontFamily:'monospace', marginTop:'2px' }}>via INVERTER (K1/SSR1)</div>
                )}
              </div>
            </foreignObject>

          </svg>
        </div>
      </CardContent>
    </Card>
  );
}
