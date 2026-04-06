import { TrendingUp, Zap, BarChart2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { BarChart, Bar, ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useEnergySystem } from '../../contexts/EnergySystemContext';
import React, { useState, useEffect } from 'react';
import * as api from '../../utils/api';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================
// Flat structure matching Flask sensor_logs DB columns (SELECT * returns flat rows)
interface SensorHistoryRecord {
  timestamp: string;
  // Grid
  grid_voltage:         number;
  grid_frequency:       number;
  grid_current:         number;
  grid_power:           number;
  grid_power_factor:    number;
  // Solar
  solar_dc_voltage:     number;
  solar_dc_current:     number;
  solar_dc_power:       number;
  // Battery
  battery_pack_voltage: number;
  battery_pack_current: number;
  battery_pack_soc:     number;
  battery_charge_a?:    number;
  battery_discharge_a?: number;
  // Inverter
  inverter_voltage:     number;
  inverter_current:     number;
  inverter_power:       number;
  inverter_frequency:   number;
  // System
  system_temp:          number;
  ssr1_state:           boolean;
  ssr2_state:           boolean;
  ssr3_state:           boolean;
  ssr4_state:           boolean;
}

// ============================================================================
// HELPER — ALIGNED TO EXACT ANOMALY RULES (same logic as EnergySystemContext)
// ============================================================================

const classifyGridAnomaly = (voltage: number): 'none' | 'warning' | 'critical' => {
  // [FIX-BUG3] 0V = Dropout — always critical in historical chart.
  // Flask ghost guard already zeroes residual-capacitance ghost readings before DB write,
  // so 0V in sensor_logs = real dropout or genuine no-power. Flag it as critical.
  // Night/no-data: solar is 0 at night but GRID is still live — 0V grid means real dropout.
  if (voltage === 0) return 'critical';
  if (voltage < 200 || voltage > 245) return 'critical';
  if (voltage < 210 || voltage > 241) return 'warning';
  return 'none';
};

const classifyInverterAnomaly = (voltage: number): 'none' | 'warning' | 'critical' => {
  // [FIX-BUG3] 0V = Inverter Dropout — always critical.
  if (voltage === 0) return 'critical';
  if (voltage < 207 || voltage > 253) return 'critical';
  if (voltage < 210 || voltage > 241) return 'warning';
  return 'none';
};

const getSeverityLabel = (
  gridA: string, inverterA: string
): 'critical' | 'warning' => {
  if (gridA === 'critical' || inverterA === 'critical') return 'critical';
  return 'warning';
};

const describeAnomaly = (
  gridA: string, inverterA: string
): string => {
  const parts: string[] = [];
  if (gridA !== 'none') parts.push(`Grid ${gridA}`);
  if (inverterA !== 'none') parts.push(`Inverter ${inverterA}`);
  return parts.join(' · ') || 'Anomaly';
};

// ============================================================================
// CARD 1 — Real-Time Monitoring (original PowerHistoryCard)
// ============================================================================

export function PowerHistoryCard() {
  const {
    gridVoltage, solarVoltage, solarCurrent, solarPower,
    batteryVoltage, batteryCurrent,
    // INA219 dual DC meter fields
    batteryChargeA, batteryDischargeA, batterySource,
    inverterVoltage, inverterCurrent,
    gridAnomaly, inverterAnomaly,
  } = useEnergySystem();

  const safeGridVoltage     = gridVoltage     ?? 0;
  const safeSolarVoltage    = solarVoltage    ?? 0;
  const safeSolarCurrent    = solarCurrent    ?? 0;
  const safeSolarPower      = solarPower      ?? 0;
  const safeBatteryVoltage  = batteryVoltage  ?? 0;
  const safeBatteryCurrent  = batteryCurrent  ?? 0;
  const safeInverterVoltage = inverterVoltage ?? 0;
  const safeInverterCurrent = inverterCurrent ?? 0;
  const safeGridCurrent     = 0;

  // INA219 safe fallbacks
  const safeBatteryChargeA    = batteryChargeA    ?? 0;
  const safeBatteryDischargeA = batteryDischargeA ?? 0;
  const safeBatterySource     = batterySource     ?? 'INA219';
  const isINA219              = safeBatterySource === 'INA219';

  const [historyData, setHistoryData] = useState<any[]>([]);
  const [anomalies, setAnomalies]     = useState<any[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const history = await api.getSensorHistory(24);

        if (history && history.length > 0) {
          const chartData = (history as any[]).map((raw: any) => {
            const record = raw as SensorHistoryRecord;
            const fixTs = (ts: string) => ts.includes('T') || ts.includes('+') ? ts : ts + '+08:00';
            const timestamp = new Date(fixTs(record.timestamp));
            const time = timestamp.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true });

            const gridV    = Number((record as any).grid_voltage         ?? 0);
            const gridFreq = Number((record as any).grid_frequency       ?? 0);
            const gridPwr  = Number((record as any).grid_power) || 0;
            const invV     = Number((record as any).inverter_voltage     ?? 0);
            const invI     = Number((record as any).inverter_current     ?? 0);
            const invFreq  = Number((record as any).inverter_frequency   ?? 0);
            const batV     = Number((record as any).battery_pack_voltage ?? 0);
            const batI     = Number((record as any).battery_pack_current ?? 0);
            const solV     = Number((record as any).solar_dc_voltage     ?? 0);
            const solI     = Number((record as any).solar_dc_current     ?? 0);
            const solPwr   = Number((record as any).solar_dc_power) || 0;

            const gridA     = classifyGridAnomaly(gridV);
            const inverterA = classifyInverterAnomaly(invV);
            const hasAnomaly = gridA !== 'none' || inverterA !== 'none';

            const maxVoltage = Math.max(gridV, invV, solV, batV, 0);
            const maxCurrent = Math.max(
              (gridV && gridPwr) ? gridPwr / gridV : 0,
              invI, Math.abs(batI), solI, 0
            );

            return {
              time,
              gridVoltage:     gridV,
              solarVoltage:    solV,
              batteryVoltage:  batV,
              inverterVoltage: invV,
              gridCurrent:     (gridV && gridPwr) ? gridPwr / gridV : 0,
              solarCurrent:    solI,
              batteryCurrent:  Math.abs(batI),
              inverterCurrent: invI,
              anomaly:         hasAnomaly,
              anomalySeverity: hasAnomaly ? getSeverityLabel(gridA, inverterA) : null,
              anomalyDesc:     hasAnomaly ? describeAnomaly(gridA, inverterA) : null,
              gridAnomaly: gridA, inverterAnomaly: inverterA,
              voltageAnomalyY: maxVoltage > 0 ? maxVoltage + 8 : 15,
              currentAnomalyY: maxCurrent > 0 ? maxCurrent + 0.3 : 0.5,
            };
          }).reverse();

          setHistoryData(chartData);
          setAnomalies(
            chartData.filter((d: any) => d.anomaly).map((d: any) => ({
              time: d.time, type: d.anomalyDesc, severity: d.anomalySeverity,
              gridV: d.gridVoltage, invV: d.inverterVoltage, batV: d.batteryVoltage,
            }))
          );
        } else {
          const gridA     = classifyGridAnomaly(safeGridVoltage);
          const inverterA = classifyInverterAnomaly(safeInverterVoltage);
          const hasAnomaly = gridA !== 'none' || inverterA !== 'none';

          setHistoryData([{
            time:            new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' }),
            gridVoltage:     safeGridVoltage,   solarVoltage:    safeSolarVoltage,
            batteryVoltage:  safeBatteryVoltage, inverterVoltage: safeInverterVoltage,
            gridCurrent:     safeGridCurrent,   solarCurrent:    safeSolarCurrent,
            batteryCurrent:  Math.abs(safeBatteryCurrent), inverterCurrent: safeInverterCurrent,
            anomaly:         hasAnomaly,
            anomalySeverity: hasAnomaly ? getSeverityLabel(gridA, inverterA) : null,
            anomalyDesc:     hasAnomaly ? describeAnomaly(gridA, inverterA) : null,
            gridAnomaly: gridA, inverterAnomaly: inverterA,
            voltageAnomalyY: Math.max(safeGridVoltage, safeInverterVoltage, safeSolarVoltage, safeBatteryVoltage, 0) + 5,
            currentAnomalyY: Math.max(safeGridCurrent, safeInverterCurrent, safeSolarCurrent, Math.abs(safeBatteryCurrent), 0) + 0.2,
          }]);
          setAnomalies([]);
        }
      } catch (error) {
        console.error('Error fetching sensor history:', error);
        setHistoryData([{
          time:            new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' }),
          gridVoltage:     safeGridVoltage,   solarVoltage:    safeSolarVoltage,
          batteryVoltage:  safeBatteryVoltage, inverterVoltage: safeInverterVoltage,
          gridCurrent:     safeGridCurrent,   solarCurrent:    safeSolarCurrent,
          batteryCurrent:  Math.abs(safeBatteryCurrent), inverterCurrent: safeInverterCurrent,
          anomaly: false, gridAnomaly: 'none', inverterAnomaly: 'none', voltageAnomalyY: 10, currentAnomalyY: 0.2,
        }]);
        setAnomalies([]);
      }
    };

    fetchHistory();
    const interval = setInterval(fetchHistory, 30000);
    return () => clearInterval(interval);
  // [FIX-GRAPH] Empty deps — history fetch runs once on mount + 30s interval only.
  // Live sensor values (gridVoltage, batteryVoltage, etc.) must NOT be in deps:
  // they change every 2s poll → triggers re-fetch → race condition → blank graph.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = historyData;

  return (
    <Card className="border-slate-200 shadow-lg hover:shadow-xl transition-all duration-300">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base sm:text-lg">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-sky-600" />
            <span>Real-Time Monitoring</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>Live</span>
          </div>
        </CardTitle>
        <p className="text-xs text-slate-600 mt-1">
          Monitor solar power, grid, battery health • Voltage/Current Trends + Anomaly Marks
        </p>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* Inverter AC Output Status */}
        <div className="p-4 rounded-lg bg-gradient-to-br from-pink-50 to-purple-50 border-2 border-pink-300">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-pink-600" />
              <span className="text-sm text-pink-900">Inverter AC Output</span>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs flex items-center gap-1 ${
              inverterAnomaly === 'none'    ? 'bg-green-600 text-white' :
              inverterAnomaly === 'warning' ? 'bg-yellow-600 text-white' :
                                              'bg-red-600 text-white'
            }`}>
              <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              {inverterAnomaly === 'none' ? 'Stable' : inverterAnomaly === 'warning' ? 'Warning' : 'Critical'}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-lg p-3">
              <div className="text-xs text-slate-600 mb-1">Voltage</div>
              <div className="flex items-end gap-1">
                <span className="text-2xl text-pink-900">{safeInverterVoltage.toFixed(0)}</span>
                <span className="text-sm text-pink-600 mb-1">V</span>
              </div>
            </div>
            <div className="bg-white rounded-lg p-3">
              <div className="text-xs text-slate-600 mb-1">Current</div>
              <div className="flex items-end gap-1">
                <span className="text-2xl text-pink-900">{safeInverterCurrent.toFixed(1)}</span>
                <span className="text-sm text-pink-600 mb-1">A</span>
              </div>
            </div>
            <div className="bg-white rounded-lg p-3">
              <div className="text-xs text-slate-600 mb-1">AC Power</div>
              <div className="flex items-end gap-1">
                <span className="text-2xl text-pink-900">{(safeInverterVoltage * safeInverterCurrent).toFixed(1)}</span>
                <span className="text-sm text-pink-600 mb-1">W</span>
              </div>
            </div>
          </div>
        </div>

        {/* Current Readings */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
          <div className={`p-2 rounded-lg border ${gridAnomaly === 'none' ? 'bg-blue-50 border-blue-200' : gridAnomaly === 'warning' ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
            <div className={`text-xs mb-1 ${gridAnomaly === 'none' ? 'text-blue-600' : gridAnomaly === 'warning' ? 'text-yellow-600' : 'text-red-600'}`}>Grid V {gridAnomaly !== 'none' && '⚠'}</div>
            <div className="flex items-end gap-1">
              <span className={`text-base sm:text-lg ${gridAnomaly === 'none' ? 'text-blue-900' : gridAnomaly === 'warning' ? 'text-yellow-900' : 'text-red-900'}`}>{safeGridVoltage.toFixed(0)}</span>
              <span className={`text-xs mb-0.5 ${gridAnomaly === 'none' ? 'text-blue-600' : gridAnomaly === 'warning' ? 'text-yellow-600' : 'text-red-600'}`}>V</span>
            </div>
          </div>
          <div className="p-2 rounded-lg bg-blue-50 border border-blue-200">
            <div className="text-xs text-blue-600 mb-1">Grid A</div>
            <div className="flex items-end gap-1">
              <span className="text-base sm:text-lg text-blue-900">{safeGridCurrent.toFixed(1)}</span>
              <span className="text-xs text-blue-600 mb-0.5">A</span>
            </div>
          </div>
          <div className="p-2 rounded-lg border bg-amber-50 border-amber-200">
            <div className="text-xs mb-1 text-amber-600">Solar V</div>
            <div className="flex items-end gap-1">
              <span className="text-base sm:text-lg text-amber-900">{safeSolarVoltage.toFixed(1)}</span>
              <span className="text-xs mb-0.5 text-amber-600">V</span>
            </div>
          </div>
          <div className="p-2 rounded-lg bg-amber-50 border border-amber-200">
            <div className="text-xs text-amber-600 mb-1">Solar A</div>
            <div className="flex items-end gap-1">
              <span className="text-base sm:text-lg text-amber-900">{safeSolarCurrent.toFixed(2)}</span>
              <span className="text-xs text-amber-600 mb-0.5">A</span>
            </div>
          </div>
          <div className="p-2 rounded-lg border bg-green-50 border-green-200">
            <div className="text-xs mb-1 text-green-600">Battery V</div>
            <div className="flex items-end gap-1">
              <span className="text-base sm:text-lg text-green-900">{safeBatteryVoltage.toFixed(1)}</span>
              <span className="text-xs mb-0.5 text-green-600">V</span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">24V Lead Acid Gel</div>
          </div>

          {/* Battery A card — net current + sensor badge + charge/discharge sub-row */}
          <div className="p-2 rounded-lg bg-green-50 border border-green-200">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs text-green-600">Battery A</div>
              <span className={`text-[9px] px-1 py-0.5 rounded  leading-none ${
                isINA219 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
              
              </span>
            </div>
            <div className="flex items-end gap-1">
              <span className="text-base sm:text-lg text-green-900">{Math.abs(safeBatteryCurrent).toFixed(2)}</span>
              <span className="text-xs text-green-600 mb-0.5">A</span>
            </div>
            {isINA219 && (
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[9px] text-green-600 font-medium">↑{safeBatteryChargeA.toFixed(1)}A</span>
                <span className="text-[9px] text-slate-300">/</span>
                <span className="text-[9px] text-blue-600 font-medium">↓{safeBatteryDischargeA.toFixed(1)}A</span>
              </div>
            )}
            <div className="text-xs text-slate-500 mt-0.5">100Ah</div>
          </div>
        </div>

        {/* Voltage Trends Chart */}
        <div>
          <div className="text-xs text-slate-600 mb-2 flex items-center gap-2">
            <Zap className="w-3 h-3 text-slate-600" />
            <span>Voltage Trends (24 Hours)</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" /><span>= Critical voltage</span></span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400" /><span>= Warning voltage</span></span>
          </div>
          <ResponsiveContainer width="100%" height={200} className="sm:h-[250px]">
            <ComposedChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 11 }} interval={typeof window !== 'undefined' && window.innerWidth < 640 ? 3 : 2} />
              <YAxis stroke="#64748b" tick={{ fontSize: 11 }} domain={[0, 250]} label={{ value: 'Voltage (V)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#64748b' } }} />
              <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value: unknown, name: string) => { if (name === '_gridFlag' || name === '_invFlag') return null as any; const v = typeof value === 'number' && isFinite(value) ? value : 0; return [name === 'Battery' ? `${v.toFixed(1)}V (24V Lead Acid Gel)` : `${v.toFixed(1)}V`, name]; }} />
              <Legend wrapperStyle={{ fontSize: '11px' }} formatter={(value) => (value === '_gridFlag' || value === '_invFlag') ? null : value} />
              <Bar dataKey="batteryVoltage"  fill="#10b981" radius={[4,4,0,0]} name="Battery"  />
              <Bar dataKey="gridVoltage"     fill="#3b82f6" radius={[4,4,0,0]} name="Grid"     />
              <Bar dataKey="inverterVoltage" fill="#ec4899" radius={[4,4,0,0]} name="Inverter" />
              <Bar dataKey="solarVoltage"    fill="#d97706" radius={[4,4,0,0]} name="Solar"    />
              {/* Anomaly flags pinned to top of Grid bar */}
              <Line dataKey="gridVoltage" name="_gridFlag" stroke="none" legendType="none" isAnimationActive={false} activeDot={false}
                dot={(props: any) => {
                  const { cx, cy, payload } = props;
                  if (!payload?.anomaly || payload.gridAnomaly === 'none') return <g key={`gf-${props.index}`} />;
                  const isCrit = payload.gridAnomaly === 'critical';
                  // Pin dot to top of chart area when bar is 0 (cy at bottom, dot would clip)
                  const dotY = (payload.gridVoltage === 0 || cy < 20) ? 12 : cy - 6;
                  return (
                    <g key={`gf-${props.index}`}>
                      <circle cx={cx} cy={dotY} r={6} fill={isCrit ? '#ef4444' : '#facc15'} stroke="#fff" strokeWidth={1.5} />
                      <text x={cx} y={dotY} textAnchor="middle" dominantBaseline="middle" fontSize={8} fontWeight="bold" fill={isCrit ? '#fff' : '#000'}>{isCrit ? '!' : '▲'}</text>
                    </g>
                  );
                }}
              />
              {/* Anomaly flags pinned to top of Inverter bar */}
              <Line dataKey="inverterVoltage" name="_invFlag" stroke="none" legendType="none" isAnimationActive={false} activeDot={false}
                dot={(props: any) => {
                  const { cx, cy, payload } = props;
                  if (!payload?.anomaly || payload.inverterAnomaly === 'none') return <g key={`if-${props.index}`} />;
                  const isCrit = payload.inverterAnomaly === 'critical';
                  // Pin dot to top of chart area when bar is 0 (cy at bottom, dot would clip)
                  const dotY = (payload.inverterVoltage === 0 || cy < 20) ? 22 : cy - 6;
                  return (
                    <g key={`if-${props.index}`}>
                      <circle cx={cx} cy={dotY} r={6} fill={isCrit ? '#ef4444' : '#facc15'} stroke="#fff" strokeWidth={1.5} />
                      <text x={cx} y={dotY} textAnchor="middle" dominantBaseline="middle" fontSize={8} fontWeight="bold" fill={isCrit ? '#fff' : '#000'}>{isCrit ? '!' : '▲'}</text>
                    </g>
                  );
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Current Trends Chart */}
        <div>
          <div className="text-xs text-slate-600 mb-2 flex items-center gap-2">
            <Zap className="w-3 h-3 text-slate-600" />
            <span>Current Trends (24 Hours)</span>
          </div>
          <ResponsiveContainer width="100%" height={200} className="sm:h-[250px]">
            <ComposedChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 11 }} interval={typeof window !== 'undefined' && window.innerWidth < 640 ? 3 : 2} />
              <YAxis stroke="#64748b" tick={{ fontSize: 11 }} domain={[0, 'auto']} label={{ value: 'Current (A)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#64748b' } }} />
              <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value: unknown, name: string) => { if (name === '_gridCurrFlag' || name === '_invCurrFlag') return null as any; const v = typeof value === 'number' && isFinite(value) ? value : 0; return [name === 'Battery' ? `${v.toFixed(2)}A (100Ah Lead Acid Gel)` : `${v.toFixed(2)}A`, name]; }} />
              <Legend wrapperStyle={{ fontSize: '11px' }} formatter={(value) => (value === '_gridCurrFlag' || value === '_invCurrFlag') ? null : value} />
              <Bar dataKey="batteryCurrent"  fill="#10b981" radius={[4,4,0,0]} name="Battery"  />
              <Bar dataKey="gridCurrent"     fill="#3b82f6" radius={[4,4,0,0]} name="Grid"     />
              <Bar dataKey="inverterCurrent" fill="#ec4899" radius={[4,4,0,0]} name="Inverter" />
              <Bar dataKey="solarCurrent"    fill="#d97706" radius={[4,4,0,0]} name="Solar"    />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Footer — dynamic sensor label */}
        <div className="text-xs text-slate-500 flex items-center justify-between">
          <span>Real-time updates via Flask API · Refreshes every 30s</span>
          <span>
            {isINA219
              ? '📡 PZEM-004T + INA219 × 2 (dual DC meter)'
              : '📡 PZEM-004T + INA219 × 2 (24V 100Ah Lead Acid 2S)'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// CARD 2 — Energy Balance: Supply vs. Demand (Line Graph)
// ============================================================================

export function EnergyBalanceCard() {
  const {
    solarPower, gridVoltage, inverterVoltage, inverterCurrent,
  } = useEnergySystem();

  // [FIX-STACKING] Keep live values in a ref so the fetch closure always
  // reads the latest value WITHOUT being listed in useEffect deps.
  // Listing live sensor values in deps caused the 30s interval to restart on
  // every 2s poll cycle — creating stacked intervals and duplicate chart data.
  const liveRef = React.useRef({ solarPower, gridVoltage, inverterVoltage, inverterCurrent });
  liveRef.current = { solarPower, gridVoltage, inverterVoltage, inverterCurrent };

  const [balanceData, setBalanceData] = useState<any[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const history = await api.getSensorHistory(24);

        if (history && history.length > 0) {
          const chartData = (history as any[]).map((raw: any) => {
            const record   = raw as SensorHistoryRecord;
            const time     = new Date((ts=>(ts.includes('T')||ts.includes('+')?ts:ts+'+08:00'))(record.timestamp)).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
            const solarPwr = Number(raw.solar_dc_power) || 0;
            const gridPwr  = Number(raw.grid_power) || 0;
            const invV         = Number(raw.inverter_voltage  ?? 0);
            const invI         = Number(raw.inverter_current  ?? 0);
            const totalLoad    = invV * invI;
            const totalSupply  = solarPwr + gridPwr;
            return {
              time,
              solarSupply:  parseFloat(solarPwr.toFixed(1)),
              gridSupply:   parseFloat(gridPwr.toFixed(1)),
              totalSupply:  parseFloat(totalSupply.toFixed(1)),
              totalLoad:    parseFloat(totalLoad.toFixed(1)),
              balance:      parseFloat((totalSupply - totalLoad).toFixed(1)),
            };
          }).reverse();
          setBalanceData(chartData);
        } else {
          // fallback: use latest live values from ref (not stale closure)
          const { solarPower: sp, inverterVoltage: iv2, inverterCurrent: ic } = liveRef.current;
          const invPwr = (iv2 ?? 0) * (ic ?? 0);
          const supply = (sp ?? 0);
          const time   = new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
          setBalanceData([{
            time,
            solarSupply: parseFloat((sp ?? 0).toFixed(1)),
            gridSupply:  0,
            totalSupply: parseFloat(supply.toFixed(1)),
            totalLoad:   parseFloat(invPwr.toFixed(1)),
            balance:     parseFloat((supply - invPwr).toFixed(1)),
          }]);
        }
      } catch (err) {
        console.error('EnergyBalanceCard fetch error:', err);
        setBalanceData([]);
      }
    };

    fetchHistory();
    const iv = setInterval(fetchHistory, 30000);
    return () => clearInterval(iv);
  }, []); // [FIX-STACKING] stable empty deps — live values read from ref above

  const latest  = balanceData[balanceData.length - 1] ?? {};
  const surplus = (latest.balance ?? 0) >= 0;

  return (
    <Card className="border-slate-200 shadow-lg hover:shadow-xl transition-all duration-300">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base sm:text-lg">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-sky-600" />
            <span>Energy Balance: Supply vs. Demand</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>Live</span>
          </div>
        </CardTitle>
        <p className="text-xs text-slate-600 mt-1">
          Visual comparison of input power (Solar + Grid) vs. total output load
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-gradient-to-br from-amber-50 to-white border border-amber-200">
            <div className="text-xs text-amber-600 mb-1">Solar Supply</div>
            <div className="flex items-end gap-1">
              <span className="text-xl text-amber-900">{(latest.solarSupply ?? 0).toFixed(1)}</span>
              <span className="text-xs text-amber-600 mb-0.5">W</span>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-gradient-to-br from-blue-50 to-white border border-blue-200">
            <div className="text-xs text-blue-600 mb-1">Grid Supply</div>
            <div className="flex items-end gap-1">
              <span className="text-xl text-blue-900">{(latest.gridSupply ?? 0).toFixed(1)}</span>
              <span className="text-xs text-blue-600 mb-0.5">W</span>
            </div>
          </div>
          <div className={`p-3 rounded-xl border ${surplus ? 'bg-gradient-to-br from-green-50 to-white border-green-200' : 'bg-gradient-to-br from-red-50 to-white border-red-200'}`}>
            <div className={`text-xs mb-1 ${surplus ? 'text-green-600' : 'text-red-600'}`}>{surplus ? 'Surplus' : 'Deficit'}</div>
            <div className="flex items-end gap-1">
              <span className={`text-xl ${surplus ? 'text-green-900' : 'text-red-900'}`}>{Math.abs(latest.balance ?? 0).toFixed(1)}</span>
              <span className={`text-xs mb-0.5 ${surplus ? 'text-green-600' : 'text-red-600'}`}>W</span>
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs text-slate-600 mb-2 flex items-center gap-2">
            <TrendingUp className="w-3 h-3 text-slate-600" />
            <span>Supply vs. Demand — 24 Hours</span>
          </div>
          <ResponsiveContainer width="100%" height={200} className="sm:h-[250px]">
            <LineChart data={balanceData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 11 }} interval={typeof window !== 'undefined' && window.innerWidth < 640 ? 3 : 2} />
              <YAxis stroke="#64748b" tick={{ fontSize: 11 }} domain={[0, 'auto']} label={{ value: 'Power (W)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#64748b' } }} />
              <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value: unknown, name: string) => { const v = typeof value === 'number' && isFinite(value) ? value : 0; return [`${v.toFixed(1)} W`, name]; }} />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="solarSupply"  stroke="#d97706" strokeWidth={2}   dot={false} name="Solar Supply"  />
              <Line type="monotone" dataKey="gridSupply"   stroke="#3b82f6" strokeWidth={2}   dot={false} name="Grid Supply"   />
              <Line type="monotone" dataKey="totalSupply"  stroke="#10b981" strokeWidth={2.5} dot={false} name="Total Supply" strokeDasharray="5 3" />
              <Line type="monotone" dataKey="totalLoad"    stroke="#ec4899" strokeWidth={2.5} dot={false} name="Total Load"   strokeDasharray="3 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="text-xs text-slate-500 flex items-center justify-between">
          <span>Real-time updates via Flask API · Refreshes every 30s</span>
          <span>📡 PZEM-004T + INA219 × 2</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// CARD 2 — Energy Balance: Supply vs. Demand (Line Graph)
// ============================================================================

export function EnergyhistoryCard() {
  const {
    solarPower, gridVoltage, inverterVoltage, inverterCurrent,
  } = useEnergySystem();

  // [FIX-STACKING] Ref mirror — live values readable inside fetch without being deps
  const liveRef2 = React.useRef({ solarPower, gridVoltage, inverterVoltage, inverterCurrent });
  liveRef2.current = { solarPower, gridVoltage, inverterVoltage, inverterCurrent };

  const [balanceData, setBalanceData] = useState<any[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const history = await api.getSensorHistory(24);

        if (history && history.length > 0) {
          const chartData = (history as any[]).map((raw: any) => {
            const record   = raw as SensorHistoryRecord;
            const time     = new Date((ts=>(ts.includes('T')||ts.includes('+')?ts:ts+'+08:00'))(record.timestamp)).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
            const solarPwr = Number(record.solar_dc_power) || 0;
            const gridPwr  = Number(record.grid_power) || 0;
            const invV     = Number(record.inverter_voltage    ?? 0);
            const invI     = Number(record.inverter_current    ?? 0);
            const totalLoad   = invV * invI;
            const totalSupply = solarPwr + gridPwr;
            return {
              time,
              solarSupply:  parseFloat(solarPwr.toFixed(1)),
              gridSupply:   parseFloat(gridPwr.toFixed(1)),
              totalSupply:  parseFloat(totalSupply.toFixed(1)),
              totalLoad:    parseFloat(totalLoad.toFixed(1)),
              balance:      parseFloat((totalSupply - totalLoad).toFixed(1)),
            };
          }).reverse();
          setBalanceData(chartData);
        } else {
          const { solarPower: sp, inverterVoltage: iv2, inverterCurrent: ic } = liveRef2.current;
          const invPwr = (iv2 ?? 0) * (ic ?? 0);
          const supply = (sp ?? 0);
          const time   = new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
          setBalanceData([{
            time,
            solarSupply: parseFloat((sp ?? 0).toFixed(1)),
            gridSupply:  0,
            totalSupply: parseFloat(supply.toFixed(1)),
            totalLoad:   parseFloat(invPwr.toFixed(1)),
            balance:     parseFloat((supply - invPwr).toFixed(1)),
          }]);
        }
      } catch (err) {
        console.error('EnergyBalanceCard fetch error:', err);
        setBalanceData([]);
      }
    };

    fetchHistory();
    const iv = setInterval(fetchHistory, 30000);
    return () => clearInterval(iv);
  }, []); // [FIX-STACKING] stable empty deps — live values read from ref above

  const latest  = balanceData[balanceData.length - 1] ?? {};
  const surplus = (latest.balance ?? 0) >= 0;

  return (
    <Card className="border-slate-200 shadow-lg hover:shadow-xl transition-all duration-300">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base sm:text-lg">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-sky-600" />
            <span>Energy Balance: Supply vs. Demand</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>Live</span>
          </div>
        </CardTitle>
        <p className="text-xs text-slate-600 mt-1">
          Visual comparison of input power (Solar + Grid) vs. total output load
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-gradient-to-br from-amber-50 to-white border border-amber-200">
            <div className="text-xs text-amber-600 mb-1">Solar Supply</div>
            <div className="flex items-end gap-1">
              <span className="text-xl text-amber-900">{(latest.solarSupply ?? 0).toFixed(1)}</span>
              <span className="text-xs text-amber-600 mb-0.5">W</span>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-gradient-to-br from-blue-50 to-white border border-blue-200">
            <div className="text-xs text-blue-600 mb-1">Grid Supply</div>
            <div className="flex items-end gap-1">
              <span className="text-xl text-blue-900">{(latest.gridSupply ?? 0).toFixed(1)}</span>
              <span className="text-xs text-blue-600 mb-0.5">W</span>
            </div>
          </div>
          <div className={`p-3 rounded-xl border ${surplus ? 'bg-gradient-to-br from-green-50 to-white border-green-200' : 'bg-gradient-to-br from-red-50 to-white border-red-200'}`}>
            <div className={`text-xs mb-1 ${surplus ? 'text-green-600' : 'text-red-600'}`}>{surplus ? 'Surplus' : 'Deficit'}</div>
            <div className="flex items-end gap-1">
              <span className={`text-xl ${surplus ? 'text-green-900' : 'text-red-900'}`}>{Math.abs(latest.balance ?? 0).toFixed(1)}</span>
              <span className={`text-xs mb-0.5 ${surplus ? 'text-green-600' : 'text-red-600'}`}>W</span>
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs text-slate-600 mb-2 flex items-center gap-2">
            <TrendingUp className="w-3 h-3 text-slate-600" />
            <span>Supply vs. Demand — 24 Hours</span>
          </div>
          <ResponsiveContainer width="100%" height={200} className="sm:h-[250px]">
            <LineChart data={balanceData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 11 }} interval={typeof window !== 'undefined' && window.innerWidth < 640 ? 3 : 2} />
              <YAxis stroke="#64748b" tick={{ fontSize: 11 }} domain={[0, 'auto']} label={{ value: 'Power (W)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#64748b' } }} />
              <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value: unknown, name: string) => { const v = typeof value === 'number' && isFinite(value) ? value : 0; return [`${v.toFixed(1)} W`, name]; }} />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="solarSupply"  stroke="#d97706" strokeWidth={2}   dot={false} name="Solar Supply"  />
              <Line type="monotone" dataKey="gridSupply"   stroke="#3b82f6" strokeWidth={2}   dot={false} name="Grid Supply"   />
              <Line type="monotone" dataKey="totalSupply"  stroke="#10b981" strokeWidth={2.5} dot={false} name="Total Supply" strokeDasharray="5 3" />
              <Line type="monotone" dataKey="totalLoad"    stroke="#ec4899" strokeWidth={2.5} dot={false} name="Total Load"   strokeDasharray="3 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="text-xs text-slate-500 flex items-center justify-between">
          <span>Real-time updates via Flask API · Refreshes every 30s</span>
          <span>📡 PZEM-004T + INA219 × 2</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// CARD 3 — Cumulative Consumption Profile (Stacked Bar)
// ============================================================================

export function CumulativeConsumptionCard() {
  const {
    solarPower, batteryVoltage, batteryCurrent,
  } = useEnergySystem();

  // [FIX-STACKING] Ref mirror so live values don't force interval restart
  const liveRef3 = React.useRef({ solarPower, batteryVoltage, batteryCurrent });
  liveRef3.current = { solarPower, batteryVoltage, batteryCurrent };

  const [consumptionData, setConsumptionData] = useState<any[]>([]);
  const [totals, setTotals] = useState({ solar: 0, grid: 0, battery: 0 });

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const history = await api.getSensorHistory(24);

        if (history && history.length > 0) {
          const chartData = (history as any[]).map((raw: any) => {
            const record = raw as SensorHistoryRecord;
            const time   = new Date((ts=>(ts.includes('T')||ts.includes('+')?ts:ts+'+08:00'))(record.timestamp)).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
            const solPwr  = Number(raw.solar_dc_power) || 0;
            const gridPwr = Number(raw.grid_power) || 0;
            const batV    = Number(raw.battery_pack_voltage) || 0;
            const batI    = Number(raw.battery_pack_current) || 0;
            const batDischarge = batI < 0 ? Math.abs(batI) * batV : 0;
            return {
              time,
              Solar:   parseFloat(solPwr.toFixed(1)),
              Grid:    parseFloat(gridPwr.toFixed(1)),
              Battery: parseFloat(batDischarge.toFixed(1)),
            };
          }).reverse();

          setConsumptionData(chartData);

          // Compute Wh: each DB record = ~5s interval → 5/3600 hours per sample
          const intervalHours = 5 / 3600;
          const solarWh   = parseFloat(chartData.reduce((s: number, d: any) => s + d.Solar   * intervalHours, 0).toFixed(2));
          const gridWh    = parseFloat(chartData.reduce((s: number, d: any) => s + d.Grid    * intervalHours, 0).toFixed(2));
          const batteryWh = parseFloat(chartData.reduce((s: number, d: any) => s + d.Battery * intervalHours, 0).toFixed(2));
          setTotals({ solar: solarWh, grid: gridWh, battery: batteryWh });
        } else {
          const { solarPower: sp, batteryVoltage: bv, batteryCurrent: bc } = liveRef3.current;
          const batV   = bv ?? 0;
          const batI   = bc ?? 0;
          const batDis = batI < 0 ? Math.abs(batI) * batV : 0;
          const time   = new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
          setConsumptionData([{
            time,
            Solar:   parseFloat((sp ?? 0).toFixed(1)),
            Grid:    0,
            Battery: parseFloat(batDis.toFixed(1)),
          }]);
          setTotals({ solar: 0, grid: 0, battery: 0 });
        }
      } catch (err) {
        console.error('CumulativeConsumptionCard fetch error:', err);
        setConsumptionData([]);
      }
    };

    fetchHistory();
    const iv = setInterval(fetchHistory, 30000);
    return () => clearInterval(iv);
  }, []); // [FIX-STACKING] stable empty deps — live values read from ref above

  const totalWh    = totals.solar + totals.grid + totals.battery || 1;
  const solarPct   = Math.round((totals.solar   / totalWh) * 100);
  const gridPct    = Math.round((totals.grid    / totalWh) * 100);
  const batteryPct = Math.round((totals.battery / totalWh) * 100);

  return (
    <Card className="border-slate-200 shadow-lg hover:shadow-xl transition-all duration-300">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base sm:text-lg">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 sm:w-5 sm:h-5 text-sky-600" />
            <span>Cumulative Consumption Profile</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>Live</span>
          </div>
        </CardTitle>
        <p className="text-xs text-slate-600 mt-1">
          Breakdown of energy usage — Battery, Grid, and Solar contributions
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-gradient-to-br from-amber-50 to-white border border-amber-200">
            <div className="text-xs text-amber-600 mb-1">Solar</div>
            <div className="flex items-end gap-1">
              <span className="text-xl text-amber-900">{totals.solar.toFixed(1)}</span>
              <span className="text-xs text-amber-600 mb-0.5">Wh</span>
            </div>
            <div className="mt-1 text-xs text-amber-700">{solarPct}% of total</div>
            <div className="mt-1.5 h-1.5 rounded-full bg-amber-100 overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full transition-all duration-500" style={{ width: `${solarPct}%` }} />
            </div>
          </div>
          <div className="p-3 rounded-xl bg-gradient-to-br from-blue-50 to-white border border-blue-200">
            <div className="text-xs text-blue-600 mb-1">Grid</div>
            <div className="flex items-end gap-1">
              <span className="text-xl text-blue-900">{totals.grid.toFixed(1)}</span>
              <span className="text-xs text-blue-600 mb-0.5">Wh</span>
            </div>
            <div className="mt-1 text-xs text-blue-700">{gridPct}% of total</div>
            <div className="mt-1.5 h-1.5 rounded-full bg-blue-100 overflow-hidden">
              <div className="h-full bg-blue-400 rounded-full transition-all duration-500" style={{ width: `${gridPct}%` }} />
            </div>
          </div>
          <div className="p-3 rounded-xl bg-gradient-to-br from-green-50 to-white border border-green-200">
            <div className="text-xs text-green-600 mb-1">Battery</div>
            <div className="flex items-end gap-1">
              <span className="text-xl text-green-900">{totals.battery.toFixed(1)}</span>
              <span className="text-xs text-green-600 mb-0.5">Wh</span>
            </div>
            <div className="mt-1 text-xs text-green-700">{batteryPct}% of total</div>
            <div className="mt-1.5 h-1.5 rounded-full bg-green-100 overflow-hidden">
              <div className="h-full bg-green-400 rounded-full transition-all duration-500" style={{ width: `${batteryPct}%` }} />
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs text-slate-600 mb-2 flex items-center gap-2">
            <Zap className="w-3 h-3 text-slate-600" />
            <span>Energy Usage Breakdown — 24 Hours</span>
          </div>
          <ResponsiveContainer width="100%" height={200} className="sm:h-[250px]">
            <BarChart data={consumptionData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 11 }} interval={typeof window !== 'undefined' && window.innerWidth < 640 ? 3 : 2} />
              <YAxis stroke="#64748b" tick={{ fontSize: 11 }} domain={[0, 'auto']} label={{ value: 'Power (W)', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#64748b' } }} />
              <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value: unknown, name: string) => { const v = typeof value === 'number' && isFinite(value) ? value : 0; return [`${v.toFixed(1)} W`, name]; }} />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Bar dataKey="Battery" stackId="a" fill="#10b981" name="Battery" />
              <Bar dataKey="Grid"    stackId="a" fill="#3b82f6" name="Grid"    />
              <Bar dataKey="Solar"   stackId="a" fill="#d97706" radius={[4,4,0,0]} name="Solar" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="text-xs text-slate-500 flex items-center justify-between">
          <span>Real-time updates via Flask API · Refreshes every 30s</span>
          <span>📡 PZEM-004T + INA219 × 2 (24V 100Ah Lead Acid 2S)</span>
        </div>
      </CardContent>
    </Card>
  );
}
