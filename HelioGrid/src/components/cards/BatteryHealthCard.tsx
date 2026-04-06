import { Battery, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { useEnergySystem } from '../../contexts/EnergySystemContext';

// ── Battery cell card — matches KioskLCD renderBatteryDetail individual cell style ──
function BatteryBox({
  label, addr, voltage, current, soc, online,
}: {
  label: string; addr: string; voltage: number;
  current: number; soc: number; online: boolean;
}) {
  const border  = !online ? '#cbd5e1' : soc>=80 ? '#34d399' : soc>=50 ? '#facc15' : soc>=20 ? '#fb923c' : '#f87171';
  const sColor  = !online ? '#94a3b8' : soc>=80 ? '#16a34a' : soc>=50 ? '#ca8a04' : soc>=20 ? '#ea580c' : '#dc2626';
  const sLabel  = !online ? 'Offline'  : soc>=80 ? 'Excellent' : soc>=50 ? 'Good' : soc>=20 ? 'Fair' : 'Critical';
  const cClass  = !online ? '#94a3b8'  : current>0.5 ? '#16a34a' : current<-0.5 ? '#2563eb' : '#94a3b8';
  const cLabel  = !online ? '—' : current>0.5 ? '▲ Chg' : current<-0.5 ? '▼ Dis' : '— Idle';

  return (
    <div style={{
      background:'#fff', border:`1.5px solid ${border}`,
      borderRadius:8, padding:'7px 8px',
      boxShadow:`0 1px 5px ${border}33`,
      opacity: !online ? 0.45 : 1,
      display:'flex', flexDirection:'column', gap:5,
    }}>
      {/* Row 1: label + status */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <div style={{ width:6, height:6, borderRadius:'50%', background:border, flexShrink:0 }}/>
          <span style={{ fontSize:11, fontWeight:700, color:'#475569', lineHeight:1 }}>{label}</span>
          <span style={{ fontSize:9,  fontWeight:400, color:'#94a3b8', fontFamily:'monospace', lineHeight:1 }}>{addr}</span>
        </div>
        <span style={{ fontSize:10, fontWeight:600, color:sColor, lineHeight:1 }}>{sLabel}</span>
      </div>

      {/* Row 2: SOC number LEFT, label+bar RIGHT */}
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ fontSize:'1.85rem', fontWeight:900, color:sColor, lineHeight:1, flexShrink:0 }}>
          {online ? soc.toFixed(0) : '—'}
        </span>
        <div style={{ flex:1, display:'flex', flexDirection:'column', gap:3 }}>
          <span style={{ fontSize:9, color:'#94a3b8', lineHeight:1 }}>{online ? '% SOC' : 'Offline'}</span>
          <div style={{ height:5, borderRadius:99, background:'#e2e8f0', overflow:'hidden' }}>
            <div style={{
              height:'100%', borderRadius:99,
              width:`${online ? soc : 0}%`,
              background:`linear-gradient(90deg,${border}99,${border})`,
              transition:'width .7s',
            }}/>
          </div>
        </div>
      </div>

      {/* Row 3: Voltage | Current — side by side */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
        <div style={{ background:`${border}18`, border:`1px solid ${border}55`, borderRadius:5, padding:'4px 7px' }}>
          <div style={{ fontSize:9, color:'#94a3b8', lineHeight:1, marginBottom:2 }}>Voltage</div>
          <div style={{ display:'flex', alignItems:'baseline', gap:2 }}>
            <span style={{ fontSize:13, fontWeight:700, color:sColor, lineHeight:1 }}>{online ? voltage.toFixed(2) : '—'}</span>
            <span style={{ fontSize:9, color:'#94a3b8' }}>V</span>
          </div>
        </div>
        <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:5, padding:'4px 7px' }}>
          <div style={{ fontSize:9, color:cClass, lineHeight:1, marginBottom:2 }}>{cLabel}</div>
          <div style={{ display:'flex', alignItems:'baseline', gap:2 }}>
            <span style={{ fontSize:13, fontWeight:700, color:cClass, lineHeight:1 }}>
              {online ? `${current>=0?'+':''}${current.toFixed(2)}` : '—'}
            </span>
            <span style={{ fontSize:9, color:'#94a3b8' }}>A</span>
          </div>
        </div>
      </div>

      {/* Row 4: footer */}
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'#94a3b8' }}>
        <span>12V</span><span>100Ah</span><span>{online?'Lead Acid':'Offline'}</span>
      </div>
    </div>
  );
}


export function BatteryHealthCard() {
  const {
    batteryVoltage,
    batteryCurrent,
    battery1Voltage,
    battery1Current,
    battery2Voltage,
    battery2Current,
    batteryAnomalyDetails,
  } = useEnergySystem();

  // ── Per-cell SOC (12V Lead Acid each) ────────────────────────────────────
  const calcCellSOC = (v: number): number => {
    if (v >= 12.7) return 100; if (v >= 12.5) return 90; if (v >= 12.3) return 80;
    if (v >= 12.1) return 70;  if (v >= 12.0) return 60; if (v >= 11.9) return 50;
    if (v >= 11.8) return 40;  if (v >= 11.6) return 30; if (v >= 11.5) return 20;
    if (v >= 11.0) return 10;  return 0;
  };

  // ── Pack SOC (24V series = sum of two 12V) ────────────────────────────────
  const calcPackSOC = (v: number): number => {
    if (v >= 25.4) return 100; if (v >= 24.8) return 90; if (v >= 24.6) return 80;
    if (v >= 24.2) return 70;  if (v >= 24.0) return 60; if (v >= 23.8) return 50;
    if (v >= 23.6) return 40;  if (v >= 23.2) return 30; if (v >= 23.0) return 20;
    if (v >= 22.0) return 10;  return 0;
  };

  const b1v = battery1Voltage > 0 ? battery1Voltage : 0;
  const b1i = battery1Current ?? 0;   // raw signed: + = charging, - = discharging
  const b2v = battery2Voltage > 0 ? battery2Voltage : 0;
  const b2i = battery2Current ?? 0;   // raw signed

  const b1Online = b1v > 2.0;
  const b2Online = b2v > 2.0;

  const b1SOC = calcCellSOC(b1v);
  const b2SOC = calcCellSOC(b2v);

  // Pack = SERIES: voltage SUM (~24V), current AVERAGE (same path)
  const activeCells = (b1Online ? 1 : 0) + (b2Online ? 1 : 0);
  const packVoltage = activeCells === 2 ? b1v + b2v
                    : activeCells === 1 ? (b1Online ? b1v : b2v)
                    : 0;
  const packCurrent = activeCells === 2 ? (b1i + b2i) / 2
                    : activeCells === 1 ? (b1Online ? b1i : b2i)
                    : 0;
  const packSOC     = activeCells === 2 ? calcPackSOC(packVoltage)
                    : activeCells === 1 ? calcPackSOC(b1Online ? b1v : b2v)
                    : 0;

  const hasBatteryData = activeCells > 0;
  const isCharging     = packCurrent > 0;
  const batteryPower   = (packVoltage * Math.abs(packCurrent)).toFixed(1);

  // ── [FIX] Charge/discharge row — use raw signed b1i/b2i, NOT Math.abs(batteryCurrent)
  // chargeA  = avg of positive contributions per cell
  // dischargeA = avg of negative contributions per cell (shown as positive)
  const chargeA    = activeCells > 0
    ? ((b1Online ? Math.max(0, b1i) : 0) + (b2Online ? Math.max(0, b2i) : 0)) / activeCells
    : 0;
  const dischargeA = activeCells > 0
    ? ((b1Online ? Math.max(0, -b1i) : 0) + (b2Online ? Math.max(0, -b2i) : 0)) / activeCells
    : 0;
  const netA = chargeA - dischargeA;

  // ── Bars — 24V range (21.0V=0% → 25.4V=100%) ────────────────────────────
  const voltPct = Math.max(0, Math.min(100, ((packVoltage - 21.0) / (25.4 - 21.0)) * 100));
  const currPct = Math.max(0, Math.min(100, (Math.abs(packCurrent) / 100) * 100));

  // ── Color helpers ─────────────────────────────────────────────────────────
  const getHealthColor = (soc: number, online = true) => {
    if (!online || !hasBatteryData) return 'text-slate-400';
    if (soc >= 80) return 'text-green-500';
    if (soc >= 50) return 'text-yellow-500';
    if (soc >= 20) return 'text-orange-500';
    return 'text-red-500';
  };
  const getHealthBg = (soc: number) => {
    if (!hasBatteryData) return 'from-slate-400 to-slate-500';
    if (soc >= 80) return 'from-green-500 to-emerald-600';
    if (soc >= 50) return 'from-yellow-500 to-orange-600';
    if (soc >= 20) return 'from-orange-500 to-red-600';
    return 'from-red-500 to-rose-600';
  };
  const getHealthStatus = (soc: number) => {
    if (!hasBatteryData) return 'No Data';
    if (soc >= 80) return 'Excellent';
    if (soc >= 50) return 'Good';
    if (soc >= 20) return 'Fair';
    return 'Critical';
  };
  const getVoltageStatus = (v: number) => {
    if (!hasBatteryData) return 'No Data';
    if (v >= 24.6) return 'Normal';
    if (v >= 23.0) return 'Fair';
    return 'Low';
  };
  const getVoltageStatusColor = (v: number) => {
    if (!hasBatteryData) return 'text-slate-400';
    if (v >= 24.6) return 'text-green-600';
    if (v >= 23.0) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <Card className="border-slate-200 shadow-lg hover:shadow-xl transition-all duration-300 h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm sm:text-base">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-green-100">
              <Battery className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
            </div>
            <span>Battery Health</span>
          </div>
          <div className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full ${
            !hasBatteryData ? 'bg-slate-400'
            : isCharging ? 'bg-green-500 animate-pulse' : 'bg-blue-500 animate-pulse'
          }`} />
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* Pack SOC */}
        <div className="text-center">
          <div className={`text-4xl sm:text-5xl font-bold ${getHealthColor(packSOC)} mb-2`}>
            {packSOC.toFixed(0)}%
          </div>
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r ${getHealthBg(packSOC)} shadow-md`}>
            <div className={`w-2 h-2 rounded-full bg-white ${hasBatteryData ? 'animate-pulse' : ''}`} />
            <span className="text-xs font-medium text-white">
              {getHealthStatus(packSOC)} · Pack SOC
            </span>
          </div>
        </div>

        {/* Pack Voltage — 24V series */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm text-slate-600 font-medium">Pack Voltage (Lead Acid 24V)</span>
            <span className={`text-xs font-semibold ${getVoltageStatusColor(packVoltage)}`}>
              {getVoltageStatus(packVoltage)}
            </span>
          </div>
          <div className="flex items-end gap-2">
            <div className={`text-2xl sm:text-3xl ${!hasBatteryData ? 'text-slate-400' : ''}`}>
              {packVoltage.toFixed(2)}
            </div>
            <div className="text-sm text-slate-500 mb-1 font-medium">V · 100Ah</div>
          </div>
          <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden">
            <div className={`h-full transition-all duration-300 ${
              !hasBatteryData ? 'bg-slate-400'
              : packVoltage >= 24.6 ? 'bg-green-500'
              : packVoltage >= 23.0 ? 'bg-yellow-500' : 'bg-red-500'
            }`} style={{ width: `${hasBatteryData ? voltPct : 0}%` }} />
          </div>
          <div className="flex justify-between text-xs text-slate-400">
            <span>21.0V (0%)</span><span>23.8V (50%)</span><span>25.4V (100%)</span>
          </div>
        </div>

        {/* Pack Current */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm text-slate-600 font-medium">Pack Current</span>
            <span className={`text-xs font-semibold ${
              !hasBatteryData ? 'text-slate-400'
              : isCharging ? 'text-green-600' : 'text-blue-600'
            }`}>
              {!hasBatteryData ? 'No Data' : isCharging ? '⚡ Charging' : '🔋 Discharging'}
            </span>
          </div>
          <div className="flex items-end gap-2">
            <div className={`text-2xl sm:text-3xl ${
              !hasBatteryData ? 'text-slate-400'
              : isCharging ? 'text-green-600' : 'text-blue-600'
            }`}>
              {isCharging && hasBatteryData ? '+' : ''}{packCurrent.toFixed(2)}
            </div>
            <div className="text-sm text-slate-500 mb-1 font-medium">A</div>
          </div>
          <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden">
            <div className={`h-full transition-all duration-300 ${
              !hasBatteryData ? 'bg-slate-400'
              : isCharging ? 'bg-green-500' : 'bg-blue-500'
            }`} style={{ width: `${hasBatteryData ? currPct : 0}%` }} />
          </div>
          {/* [FIX] Charge ↑ / Discharge ↓ / Net — computed from raw signed b1i/b2i */}
          {hasBatteryData && (
            <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 text-xs">
              <span className="text-green-600 font-medium">↑ {chargeA.toFixed(2)}A</span>
              <span className="text-slate-300">|</span>
              <span className="text-blue-600 font-medium">↓ {dischargeA.toFixed(2)}A</span>
              <span className="text-slate-300">|</span>
              <span className={`font-semibold ${netA >= 0 ? 'text-green-700' : 'text-blue-700'}`}>
                Net: {netA >= 0 ? '+' : ''}{netA.toFixed(2)}A
              </span>
            </div>
          )}
          <div className="text-xs text-slate-400">Max ±100A · INA219 × 2</div>
        </div>

        {/* ── Individual Batteries — kiosk-style SVG battery boxes ── */}
        <div>
          <div className="text-xs text-slate-500 font-medium mb-2">Individual Batteries (1S Single)</div>
          <div className="grid grid-cols-2 gap-3">
            <BatteryBox
              label="Battery 1"
              addr="0x41"
              voltage={b1v}
              current={b1i}
              soc={b1SOC}
              online={b1Online}
            />
            <BatteryBox
              label="Battery 2"
              addr="0x44"
              voltage={b2v}
              current={b2i}
              soc={b2SOC}
              online={b2Online}
            />
          </div>
        </div>

        {/* Power */}
        <div className="pt-3 border-t border-slate-200">
          <span className="text-xs sm:text-sm text-slate-600 font-medium">
            {!hasBatteryData ? 'Power' : isCharging ? '⚡ Charging Power' : '🔋 Discharge Power'}
          </span>
          <div className={`mt-2 flex items-center justify-center p-4 rounded-lg bg-gradient-to-br border-2 shadow-sm ${
            !hasBatteryData ? 'from-slate-50 to-slate-100 border-slate-300'
            : isCharging ? 'from-green-50 to-emerald-50 border-green-300'
            : 'from-blue-50 to-cyan-50 border-blue-300'
          }`}>
            <div className="flex items-end gap-2">
              <Zap className={`w-6 h-6 mb-1 ${!hasBatteryData ? 'text-slate-400' : isCharging ? 'text-green-600' : 'text-blue-600'}`} />
              <span className={`text-3xl sm:text-4xl font-bold ${!hasBatteryData ? 'text-slate-400' : isCharging ? 'text-green-700' : 'text-blue-700'}`}>
                {batteryPower}
              </span>
              <span className={`text-lg mb-1 font-semibold ${!hasBatteryData ? 'text-slate-400' : isCharging ? 'text-green-600' : 'text-blue-600'}`}>W</span>
            </div>
          </div>
          <div className="text-xs text-slate-500 text-center mt-1">
            B1: {b1v.toFixed(2)}V / {b1i >= 0 ? '+' : ''}{b1i.toFixed(2)}A · B2: {b2v.toFixed(2)}V / {b2i >= 0 ? '+' : ''}{b2i.toFixed(2)}A
          </div>
        </div>

        {/* Anomalies */}
        {batteryAnomalyDetails && batteryAnomalyDetails.length > 0 && (
          <div className="pt-2 border-t border-slate-200">
            <div className="rounded-lg p-2 bg-red-50 border border-red-200 space-y-1">
              <div className="text-[11px] font-semibold text-red-800">⚠ Battery Anomalies</div>
              {batteryAnomalyDetails.map((msg, i) => (
                <div key={i} className="text-[10px] text-red-700">{msg}</div>
              ))}
            </div>
          </div>
        )}

        {/* Sensor Info */}
        <div className="pt-2 border-t border-slate-200">
          <div className={`rounded-lg p-2 border flex items-center gap-2 ${hasBatteryData ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
            <div className={`w-2 h-2 rounded-full shrink-0 ${hasBatteryData ? 'bg-green-500 animate-pulse' : 'bg-slate-400'}`} />
            <div className="text-xs">
              <span className={`font-semibold ${hasBatteryData ? 'text-blue-900' : 'text-amber-900'}`}>
                📡 INA219 × 2 · 24V 100Ah (2× 12V Series)
              </span>
              {!hasBatteryData && <span className="text-amber-800 font-semibold ml-2">⚠ No Data</span>}
            </div>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
