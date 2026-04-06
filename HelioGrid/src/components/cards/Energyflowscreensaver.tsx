import { useEffect, useState } from 'react';
import { Zap, Thermometer, Wifi, Clock, Palette } from 'lucide-react';
import { useEnergySystem } from '../../contexts/EnergySystemContext';

interface EnergyFlowScreensaverProps {
  onWake?: () => void;
}

export function EnergyFlowScreensaver({ onWake }: EnergyFlowScreensaverProps) {
  const systemData = useEnergySystem();
  const [time, setTime] = useState('');

  const solarPower      = systemData.solarPower      ?? 0;
  const batteryVoltage  = systemData.batteryVoltage  ?? 0;
  const batteryCurrent  = systemData.batteryCurrent  ?? 0;
  const batteryFull     = systemData.batteryFull     ?? false;
  const acVoltage       = systemData.inverterVoltage ?? 0;
  const acCurrent       = systemData.inverterCurrent ?? 0;
  const inverterPower   = systemData.inverterPower   ?? (acVoltage * acCurrent);
  const gridVoltage     = systemData.gridVoltage     ?? 0;
  const gridFrequency   = systemData.gridFrequency   ?? 60;
  const gridPower       = systemData.gridPower       ?? 0;
  const gridCurrent     = systemData.gridCurrent     ?? 0;
  const systemTemp      = systemData.systemTemp      ?? 25;
  const contactorClosed = systemData.contactorClosed ?? true;
  const k3Active        = systemData.k3Active        ?? false;
  const k3Direction     = systemData.k3Direction;
  const k3Reconnect     = systemData.k3Reconnect;
  const ssrStates       = systemData.ssrStates;
  const controlMode     = systemData.controlMode;
  const solarAnomaly    = systemData.solarAnomaly;
  const gridAnomaly     = systemData.gridAnomaly;

  // [SYNC-HUB] Use K1/K2 fields — matches EnergyFlowHub exactly
  const k1 = ssrStates?.K1 ?? false;
  const k2 = ssrStates?.K2 ?? false;
  const k3 = k3Active;
  const k4 = contactorClosed;

  const SSR4_Closed    = contactorClosed && controlMode !== 'shutdown';
  const batCritical    = batteryVoltage > 0 && batteryVoltage < 21.0;
  const gridHasReading = gridVoltage > 10;
  const gridVoltageOK  = !gridHasReading || (gridVoltage >= 200 && gridVoltage <= 245);
  const gridHealthy    = gridVoltageOK && gridAnomaly !== 'critical';
  const isHarvest      = (() => {
    const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' })).getHours();
    return h >= 6 && h < 18;
  })();

  // [SYNC-HUB] Exact same flow logic as EnergyFlowHub
  const flowSolarToInv = k1 && isHarvest && solarPower > 0;

  const isCharging    = SSR4_Closed && !batCritical && batteryCurrent > 0.05;
  const isDischarging = SSR4_Closed && !batCritical && batteryCurrent < -0.05;

  // [SYNC-HUB] batChargeSolar: solar contributing to charge
  const batChargeSolar = isCharging && k1 && flowSolarToInv;
  // [SYNC-HUB] batChargeGrid: K3 ON — grid assists via inverter path
  const batChargeGrid  = isCharging && k3;
  const flowInvToBat   = batChargeSolar || batChargeGrid;
  const flowBatToInv   = isDischarging && k1;
  const batFullGlow    = SSR4_Closed && !batCritical && batteryFull;

  // [SYNC-HUB] invActuallyOn + gridActuallyOn checks — same as Hub
  const invActuallyOn    = inverterPower > 5 || acCurrent > 0.05;
  const gridActuallyOn   = gridPower > 5 || gridCurrent > 0.05;

  // [SYNC-HUB] NOT active when K2 bypass ON, requires invActuallyOn
  const flowInvToServer  = k1 && !k2 && SSR4_Closed && invActuallyOn;
  // [SYNC-HUB] Grid bypass requires gridActuallyOn
  const flowGridToServer = k2 && gridVoltageOK && SSR4_Closed && gridHasReading;

  // [SYNC-HUB] K3 Grid Assist — grid → inverter → battery
  const flowGridToInv  = k3 && gridVoltageOK && k1 && gridHasReading;
  const flowGridAssist = flowGridToInv;
  const flowGridCharge = false; // No net metering — same as Hub

  const outletsOn = flowInvToServer || flowGridToServer;

  // [SYNC-HUB] inverterActive excludes K2 bypass
  const inverterActive = k1 && !k2 && SSR4_Closed;

  const speedFromWatts = (w: number, max = 3000) =>
    Math.max(0.6, Math.min(2.5, 2.5 - ((w / max) * 1.9)));
  const speedSolar   = speedFromWatts(solarPower, 3000);
  const speedBat     = speedFromWatts(Math.abs(batteryCurrent * batteryVoltage), 2000);
  const speedInvLoad = speedFromWatts(inverterPower, 3000);
  // [SYNC-HUB] Use actual gridPower — same as Hub
  const speedGrid    = speedFromWatts(gridPower, 3000);

  // [FIX-SOC-PACK] Compute pack SOC from INA219 b1v+b2v — same logic as KioskLCD/EnergyFlowHub
  // Replaces direct batterySOC reference (Flask/PZEM path, unreliable when INA219 is source)
  const _b1v_scr  = systemData.battery1Voltage ?? 0;
  const _b2v_scr  = systemData.battery2Voltage ?? 0;
  const _b1ok_scr = _b1v_scr > 2.0;
  const _b2ok_scr = _b2v_scr > 2.0;
  const _packV_scr = _b1ok_scr && _b2ok_scr ? _b1v_scr + _b2v_scr
                   : _b1ok_scr ? _b1v_scr
                   : _b2ok_scr ? _b2v_scr
                   : batteryVoltage;
  const _calcPackSOC_scr = (v: number): number => {
    if (v >= 25.4) return 100; if (v >= 24.8) return 90; if (v >= 24.6) return 80;
    if (v >= 24.2) return 70;  if (v >= 24.0) return 60; if (v >= 23.8) return 50;
    if (v >= 23.6) return 40;  if (v >= 23.2) return 30; if (v >= 23.0) return 20;
    if (v >= 22.0) return 10;  return 0;
  };
  const batSoc = Math.round((_b1ok_scr || _b2ok_scr)
    ? _calcPackSOC_scr(_packV_scr)
    : (systemData.batterySOC ?? 0));

  // [FIX] Thresholds aligned to system: critical=60°C, warning=50°C (was 70/60/45)
  const getTempBg  = (t: number) => t>=60?'rgba(239,68,68,0.3)':t>=50?'rgba(245,158,11,0.3)':'rgba(34,197,94,0.3)';
  const getTempBrd = (t: number) => t>=60?'rgba(239,68,68,0.4)':t>=50?'rgba(245,158,11,0.4)':'rgba(34,197,94,0.4)';
  const getTempClr = (t: number) => t>=60?'#ef4444':t>=50?'#f59e0b':'#4ade80';

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, []);

  const relays = [
    { label:'K4 / SSR4 DC',        status: k4 ? 'CLOSED' : 'OPEN',                          active: k4, color:'#10b981' },
    { label:'K1 / SSR1 Solar',      status: k1 ? 'ON' : 'OFF',                               active: k1, color:'#f59e0b' },
    { label:'K2 / SSR2 Grid',       status: k2 ? 'ON' : 'OFF',                               active: k2, color:'#3b82f6' },
    { label:'K3 Grid Assist Auto',  status: k3Reconnect?.locked ? `LOCK ${k3Reconnect.secondsRemaining}s` : k3 ? (k3Direction === 'charging' ? 'CHG GRID' : k3Direction === 'assist' ? 'ASSIST' : 'K3 AUTO') : 'STBY', active: k3, color:'#14b8a6' },
  ];

  const W = 800, H = 460, CX = 400;
  const solar    = { x: CX,       y: 50  };
  const inverter = { x: CX,       y: 185 };
  const battery  = { x: CX-245,   y: 260 };
  const grid     = { x: CX+245,   y: 260 };
  const server   = { x: CX,       y: 343 };
  const dead = '#1e3a5f';

  return (
    <div onClick={onWake} style={{
      position:'absolute', inset:0, overflow:'hidden',
      fontFamily:'ui-sans-serif,system-ui,sans-serif',
      cursor: onWake ? 'pointer' : 'default',
    }}>
      <div style={{ position:'absolute', inset:0,
        background:'linear-gradient(135deg,#020617 0%,#172554 30%,#0c1a3a 55%,rgba(30,58,138,0.13) 70%,#020617 100%)' }}/>
      <div style={{ position:'absolute', inset:0, pointerEvents:'none',
        background:'radial-gradient(ellipse 80% 60% at 50% 40%,rgba(30,58,138,0.35) 0%,transparent 70%)' }}/>
      <div style={{ position:'absolute',inset:0,pointerEvents:'none',zIndex:2,
        background:'repeating-linear-gradient(to bottom,transparent 0px,transparent 3px,rgba(0,0,0,0.03) 3px,rgba(0,0,0,0.03) 4px)' }}/>
      <div style={{ position:'absolute',inset:0,zIndex:3,pointerEvents:'none',
        background:'radial-gradient(ellipse at center,transparent 55%,rgba(2,6,23,0.45) 100%)' }}/>

      <div style={{
        position:'relative', zIndex:20,
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'10px 16px 10px',
        borderBottom:'1px solid rgba(29,78,216,0.5)',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <div style={{
            height:'32px', width:'32px', borderRadius:'50%', background:'#3b82f6',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
          }}>
            <Zap size={18} color="white" strokeWidth={2}/>
          </div>
          <span style={{ fontSize:'28px', color:'#f1f5f9', fontWeight:400, lineHeight:1 }}>HelioGrid</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
          <div style={{
            display:'flex', alignItems:'center', gap:'4px', padding:'4px 6px', borderRadius:'8px',
            background: getTempBg(systemTemp), border: `1px solid ${getTempBrd(systemTemp)}`,
          }}>
            <Thermometer size={16} color={getTempClr(systemTemp)} strokeWidth={2}/>
            <span style={{ fontSize:'20px', color: getTempClr(systemTemp), fontWeight:500, lineHeight:1 }}>
              {systemTemp.toFixed(1)}°C
            </span>
          </div>
          <div style={{
            padding:'6px', borderRadius:'8px', background:'rgba(168,85,247,0.2)',
            border:'1px solid rgba(168,85,247,0.4)', display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <Palette size={20} color="#d8b4fe" strokeWidth={2}/>
          </div>
          <Wifi size={20} color="#4ade80" strokeWidth={2}/>
          <div style={{ display:'flex', alignItems:'center', gap:'4px' }}>
            <Clock size={18} color="#94a3b8" strokeWidth={2}/>
            <span style={{ fontSize:'20px', color:'#94a3b8', fontWeight:400, lineHeight:1 }}>{time}</span>
          </div>
        </div>
      </div>

      <div style={{ position:'absolute',top:'60px',left:0,right:0,bottom:0,overflow:'hidden' }}>
        <style>{`
          @keyframes ssBlink { 0%,100%{opacity:1} 50%{opacity:.15} }
          @keyframes batFullPulse { 0%,100%{box-shadow:0 0 10px #10b981,0 0 22px #10b98170} 50%{box-shadow:0 0 18px #10b981,0 0 36px #10b981a0} }
        `}</style>

        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
          style={{ position:'absolute',top:0,left:0,width:'100%',height:'100%' }}>

          <defs>
            <path id="p-sol"     d={`M${solar.x},${solar.y+35} L${inverter.x},${inverter.y-35}`}/>
            <path id="p-inv-bat" d={`M${inverter.x-35},${inverter.y+20} L${battery.x+20},${battery.y-35}`}/>
            <path id="p-bat-inv" d={`M${battery.x+20},${battery.y-35} L${inverter.x-35},${inverter.y+20}`}/>
            <path id="p-inv-srv" d={`M${inverter.x},${inverter.y+35} L${server.x},${server.y-35}`}/>
            <path id="p-inv-grd" d={`M${inverter.x+35},${inverter.y+20} L${grid.x-20},${grid.y-35}`}/>
            <path id="p-grd-inv" d={`M${grid.x-20},${grid.y-35} L${inverter.x+35},${inverter.y+20}`}/>
            <path id="p-byp"     d={`M${grid.x},${grid.y+35} L${server.x+35},${server.y}`}/>
          </defs>

          {([
            ['p-sol',     solar.x,       solar.y+35,    inverter.x,    inverter.y-35,  '#f59e0b','#fbbf24', speedSolar,   0,    2, flowSolarToInv,   null         ],
            ['p-inv-bat', inverter.x-35, inverter.y+20, battery.x+20,  battery.y-35,   batChargeGrid && batChargeSolar ? '#a78bfa' : batChargeGrid ? '#14b8a6' : '#10b981', batChargeGrid && batChargeSolar ? '#c4b5fd' : batChargeGrid ? '#2dd4bf' : '#34d399', speedBat, 0.2, 2, flowInvToBat, 'CHG'   ],
            ['p-bat-inv', battery.x+20,  battery.y-35,  inverter.x-35, inverter.y+20,  '#60a5fa','#93c5fd', speedBat,     0.2,  2, flowBatToInv,     'DSCH'       ],
            ['p-inv-srv', inverter.x,    inverter.y+35, server.x,      server.y-35,    '#8b5cf6','#a78bfa', speedInvLoad, 0.1,  2, flowInvToServer,  null         ],
            ['p-grd-inv', grid.x-20,     grid.y-35,     inverter.x+35, inverter.y+20,  '#14b8a6','#2dd4bf', speedGrid,    0.15, 2, flowGridToInv,    'GRID ASSIST'],
            ['p-byp',     grid.x,        grid.y+35,     server.x+35,   server.y,       '#3b82f6','#60a5fa', speedGrid,    0.1,  2, flowGridToServer, 'BYPASS'     ],
          ] as Array<[string,number,number,number,number,string,string,number,number,number,boolean,string|null]>)
            .map(([pid,x1,y1,x2,y2,c,cd,dur,delay,th,active,lbl]) => {
              const len  = Math.sqrt((x2-x1)**2+(y2-y1)**2);
              const beam = len * 0.22;
              const mx   = (x1+x2)/2;
              const my   = (y1+y2)/2;
              if (!active) return (
                <line key={pid} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={dead} strokeWidth={th} strokeLinecap="round"
                  strokeDasharray="5 6" strokeOpacity="0.5"/>
              );
              return (
                <g key={pid}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={th*6}  strokeOpacity="0.03" strokeLinecap="round"/>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={th*3}  strokeOpacity="0.07" strokeLinecap="round"/>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={th*0.5} strokeOpacity="0.2"  strokeLinecap="round"/>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={cd} strokeWidth={th*1.5} strokeLinecap="round"
                    strokeDasharray={`${beam} ${len}`}
                    style={{filter:`drop-shadow(0 0 4px ${c}) drop-shadow(0 0 10px ${c}80)`}}>
                    <animate attributeName="stroke-dashoffset"
                      from={`${len+beam}`} to={`${-(len+beam)}`}
                      dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite"/>
                  </line>
                  <circle r={th*2} fill={cd} style={{filter:`drop-shadow(0 0 6px ${c}) drop-shadow(0 0 14px ${c})`}}>
                    <animateMotion dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite">
                      <mpath href={`#${pid}`}/>
                    </animateMotion>
                  </circle>
                  {lbl && (
                    <text x={mx} y={my-8} textAnchor="middle" fontSize="7"
                      fontFamily="monospace" fontWeight="700" fill={cd} opacity="0.9"
                      style={{filter:`drop-shadow(0 0 3px ${c})`}}>
                      {lbl}
                    </text>
                  )}
                </g>
              );
            })
          }

          {/* ── SOLAR ── */}
          <foreignObject x={solar.x-35} y={solar.y-35} width={70} height={100} overflow="visible">
            <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:'2px' }}>
              <div style={{ width:'70px',height:'70px',display:'flex',alignItems:'center',justifyContent:'center',
                background:flowSolarToInv?'rgba(253,246,178,0.06)':'rgba(10,18,35,0.9)',
                border:`1.5px solid ${flowSolarToInv?'#f59e0b':dead}`, borderRadius:'10px',
                boxShadow:flowSolarToInv?'0 2px 10px rgba(245,158,11,0.3)':'0 1px 3px rgba(0,0,0,0.5)',transition:'all 0.5s ease' }}>
                <svg width="42" height="42" viewBox="0 0 80 80" fill="none">
                  {flowSolarToInv&&[0,45,90,135,180,225,270,315].map((a,i)=>(
                    <line key={i} x1={40+Math.cos(a*Math.PI/180)*11} y1={13+Math.sin(a*Math.PI/180)*11}
                      x2={40+Math.cos(a*Math.PI/180)*16} y2={13+Math.sin(a*Math.PI/180)*16}
                      stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" opacity="0.8"/>
                  ))}
                  <circle cx="40" cy="13" r="7" fill={flowSolarToInv?'#fde68a':'#0f2030'} stroke={flowSolarToInv?'#f59e0b':dead} strokeWidth="1"
                    style={flowSolarToInv?{filter:'drop-shadow(0 0 5px #fbbf24)'}:undefined}/>
                  <rect x="8" y="27" width="64" height="40" rx="3" fill={flowSolarToInv?'rgba(253,251,235,0.06)':'#0a1525'} stroke={flowSolarToInv?'#f59e0b':dead} strokeWidth="2"/>
                  {[0,1,2].map(col=>[0,1].map(row=>(
                    <rect key={`${col}${row}`} x={11+col*20} y={30+row*17} width={17} height={14} rx="2"
                      fill={flowSolarToInv?'rgba(254,243,199,0.1)':'#0f2030'} stroke={flowSolarToInv?'#f59e0b':dead} strokeWidth="0.9" strokeOpacity="0.7"/>
                  )))}
                  <line x1="22" y1="67" x2="17" y2="74" stroke={flowSolarToInv?'#f59e0b':dead} strokeWidth="2" strokeLinecap="round"/>
                  <line x1="58" y1="67" x2="63" y2="74" stroke={flowSolarToInv?'#f59e0b':dead} strokeWidth="2" strokeLinecap="round"/>
                  <line x1="13" y1="74" x2="67" y2="74" stroke={flowSolarToInv?'#f59e0b':dead} strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <span style={{ fontSize:'9px',fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:flowSolarToInv?'#f59e0b':dead }}>PV Solar</span>
              <div style={{ fontSize:'8px',fontWeight:700,padding:'1px 6px',borderRadius:'8px',lineHeight:'14px',whiteSpace:'nowrap',
                background:flowSolarToInv?'rgba(254,249,195,0.1)':'rgba(10,18,35,0.7)',
                color:flowSolarToInv?'#a16207':dead, border:`1px solid ${flowSolarToInv?'#fde047':dead}` }}>
                {flowSolarToInv?'ACTIVE':'STANDBY'}
              </div>
            </div>
          </foreignObject>
          <foreignObject x={solar.x+42} y={solar.y-28} width={170} height={70}>
            <div>
              <div style={{ fontSize:'11px',color:'#475569',letterSpacing:'0.08em',textTransform:'uppercase',fontFamily:'monospace',marginBottom:'2px' }}>Solar Output</div>
              <div style={{ display:'flex',alignItems:'baseline',gap:'3px' }}>
                <span style={{ fontSize:'32px',fontWeight:400,lineHeight:1,fontFamily:'monospace',color:flowSolarToInv?'#f1f5f9':dead }}>{solarPower.toFixed(0)}</span>
                <span style={{ fontSize:'19px',fontWeight:500,fontFamily:'monospace',color:'#f59e0b',textShadow:'0 0 6px #f59e0b50' }}>W</span>
              </div>
            </div>
          </foreignObject>

          {/* ── BATTERY ── */}
          <foreignObject x={battery.x-35} y={battery.y-35} width={70} height={105} overflow="visible">
            <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:'2px', position:'relative' }}>
              {batFullGlow && (
                <div style={{
                  position:'absolute', top:'-2px', left:'-2px',
                  width:'74px', height:'74px', borderRadius:'12px',
                  border:'2px solid #10b981', pointerEvents:'none', zIndex:1,
                  animation:'batFullPulse 2s ease-in-out infinite',
                }}/>
              )}
              <div style={{ width:'70px',height:'70px',display:'flex',alignItems:'center',justifyContent:'center',
                background:(flowInvToBat||flowBatToInv||batFullGlow)?'rgba(240,253,244,0.04)':'rgba(10,18,35,0.9)',
                border:`1.5px solid ${(flowInvToBat||flowBatToInv||batFullGlow)?'#10b981':dead}`, borderRadius:'10px',
                boxShadow:(flowInvToBat||flowBatToInv||batFullGlow)?'0 2px 10px rgba(16,185,129,0.3)':'0 1px 3px rgba(0,0,0,0.5)',
                transition:'all 0.5s ease' }}>
                <svg width="42" height="42" viewBox="0 0 80 80" fill="none">
                  {(()=>{
                    const fc  = batSoc>50?'#10b981':batSoc>20?'#f59e0b':'#ef4444';
                    const act = flowInvToBat||flowBatToInv||batFullGlow;
                    const c   = act?fc:dead;
                    const fw  = Math.round(52*(batSoc/100));
                    return (<>
                      <rect x="5" y="20" width="62" height="40" rx="4"
                        fill="rgba(16,185,129,0.04)" stroke={c} strokeWidth="2"
                        style={act?{filter:`drop-shadow(0 0 4px ${fc}25)`}:undefined}/>
                      <rect x="67" y="30" width="8" height="20" rx="2" fill={act?c:dead}/>
                      <rect x="8" y="23" width={fw} height="34" rx="2" fill={act?fc:dead}/>
                      {[1,2].map(i=>(<line key={i} x1={8+i*18} y1="23" x2={8+i*18} y2="57" stroke="rgba(0,0,0,0.35)" strokeWidth="1.5"/>))}
                      <text x="36" y="43" textAnchor="middle" fill={act?'white':'#334155'}
                        fontSize="12" fontFamily="monospace" fontWeight="900">{batSoc}%</text>
                      {batFullGlow   && <text x="36" y="55" textAnchor="middle" fill="#10b981" fontSize="7" fontFamily="monospace">FULL</text>}
                      {flowInvToBat  && !batFullGlow && <text x="36" y="55" textAnchor="middle" fill="white"   fontSize="7" fontFamily="monospace">CHG</text>}
                      {flowBatToInv  && <text x="36" y="55" textAnchor="middle" fill="#fbbf24" fontSize="7" fontFamily="monospace">DSCH</text>}
                    </>);
                  })()}
                </svg>
              </div>
              <span style={{ fontSize:'9px',fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',
                color:(flowInvToBat||flowBatToInv||batFullGlow)?'#10b981':dead }}>Battery</span>
              <div style={{ fontSize:'8px',fontWeight:700,padding:'1px 6px',borderRadius:'8px',lineHeight:'14px',whiteSpace:'nowrap',
                background: batFullGlow?'rgba(220,252,231,0.12)':flowInvToBat?'rgba(220,252,231,0.08)':'rgba(10,18,35,0.7)',
                color: batFullGlow?'#15803d':flowInvToBat?'#15803d':dead,
                border:`1px solid ${batFullGlow?'rgba(134,239,172,0.5)':flowInvToBat?'rgba(134,239,172,0.35)':dead}` }}>
                {batFullGlow?'FULL':batChargeSolar?'☀ CHG SOLAR':batChargeGrid?'⚡ CHG GRID':flowBatToInv?'DISCHARGING':'STANDBY'}
              </div>
            </div>
          </foreignObject>
          <foreignObject x={battery.x-35-140} y={battery.y-25} width={132} height={80}>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:'11px',color:'#475569',letterSpacing:'0.08em',textTransform:'uppercase',fontFamily:'monospace',marginBottom:'2px' }}>Battery · 24V 100Ah</div>
              <div style={{ display:'flex',alignItems:'baseline',gap:'3px',justifyContent:'flex-end' }}>
                <span style={{ fontSize:'32px',fontWeight:400,lineHeight:1,fontFamily:'monospace',color:k4?'#f1f5f9':dead }}>{batteryVoltage.toFixed(1)}</span>
                <span style={{ fontSize:'19px',fontWeight:500,fontFamily:'monospace',color:'#10b981',textShadow:'0 0 6px #10b98150' }}>V</span>
              </div>
              <div style={{ fontSize:'10px',color:'#475569',fontFamily:'monospace',marginTop:'1px' }}>{batSoc}% SOC</div>
              <div style={{ fontSize:'9px',fontFamily:'monospace',marginTop:'2px',
                color: batteryCurrent > 0 ? '#34d399' : batteryCurrent < 0 ? '#fbbf24' : '#475569' }}>
                {batteryCurrent > 0 ? `+${batteryCurrent.toFixed(2)}A ↓` : batteryCurrent < 0 ? `${batteryCurrent.toFixed(2)}A ↑` : '0.00A'}
              </div>
            </div>
          </foreignObject>

          {/* ── INVERTER — [FIX] dim/BYPASSED when K2 active ── */}
          <foreignObject x={inverter.x-35} y={inverter.y-35} width={70} height={100} overflow="visible">
            <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:'2px' }}>
              <div style={{ width:'70px',height:'70px',display:'flex',alignItems:'center',justifyContent:'center',
                background:inverterActive?'rgba(245,243,255,0.04)':'rgba(10,18,35,0.9)',
                border:`1.5px solid ${inverterActive?'#8b5cf6':dead}`, borderRadius:'10px',
                boxShadow:inverterActive?'0 2px 10px rgba(139,92,246,0.3)':'0 1px 3px rgba(0,0,0,0.5)',transition:'all 0.5s ease' }}>
                <svg width="42" height="42" viewBox="0 0 80 80" fill="none">
                  <rect x="8" y="6" width="64" height="62" rx="5"
                    fill={inverterActive?'rgba(139,92,246,0.07)':'#0a1525'} stroke={inverterActive?'#8b5cf6':dead} strokeWidth="2"
                    style={inverterActive?{filter:'drop-shadow(0 0 5px rgba(139,92,246,0.25))'}:undefined}/>
                  <rect x="13" y="11" width="38" height="22" rx="2"
                    fill={inverterActive?'rgba(139,92,246,0.1)':'#0f2030'} stroke={inverterActive?'#8b5cf6':dead} strokeWidth="1" strokeOpacity="0.6"/>
                  {inverterActive&&<polyline points="15,29 20,20 26,26 32,17 38,23 44,18 48,21" stroke="#8b5cf6" strokeWidth="1.8" fill="none" strokeLinecap="round"/>}
                  <circle cx="60" cy="15" r="5" fill={inverterActive?'#10b981':dead}
                    style={inverterActive?{filter:'drop-shadow(0 0 3px #10b981)'}:undefined}/>
                  <circle cx="60" cy="28" r="5" fill={inverterActive?'#8b5cf6':dead}>
                    {inverterActive&&<animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/>}
                  </circle>
                  <text x="22" y="73" fill={inverterActive?'#f59e0b':dead} fontSize="9" fontFamily="monospace" fontWeight="900">DC</text>
                  <text x="34" y="73" fill="#334155" fontSize="9" fontFamily="monospace">→</text>
                  <text x="44" y="73" fill={inverterActive?'#8b5cf6':dead} fontSize="9" fontFamily="monospace" fontWeight="900">AC</text>
                </svg>
              </div>
              <span style={{ fontSize:'9px',fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:inverterActive?'#8b5cf6':dead }}>Inverter</span>
              <div style={{ fontSize:'8px',fontWeight:700,padding:'1px 6px',borderRadius:'8px',lineHeight:'14px',whiteSpace:'nowrap',
                background:inverterActive?'rgba(237,233,254,0.08)':'rgba(10,18,35,0.7)',
                color:inverterActive?'#6d28d9':dead, border:`1px solid ${inverterActive?'rgba(196,181,253,0.35)':dead}` }}>
                {k2?'BYPASSED':k1?'ON':'OFF'}
              </div>
            </div>
          </foreignObject>

          {/* ── GRID ── */}
          <foreignObject x={grid.x-35} y={grid.y-35} width={70} height={100} overflow="visible">
            <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:'2px' }}>
              <div style={{ width:'70px',height:'70px',display:'flex',alignItems:'center',justifyContent:'center',
                background:(k2&&gridHealthy)||(k3&&gridHealthy)?'rgba(239,246,255,0.04)':'rgba(10,18,35,0.9)',
                border:`1.5px solid ${(k2&&gridHealthy)||(k3&&gridHealthy)?'#3b82f6':dead}`, borderRadius:'10px',
                boxShadow:(k2&&gridHealthy)||(k3&&gridHealthy)?'0 2px 10px rgba(59,130,246,0.3)':'0 1px 3px rgba(0,0,0,0.5)',transition:'all 0.5s ease' }}>
                <svg width="42" height="42" viewBox="0 0 80 80" fill="none">
                  {((k2||k3)&&gridHealthy)&&<polygon points="43,2 36,14 41,14 33,26 44,12 39,12" fill="#3b82f6" style={{filter:'drop-shadow(0 0 4px #3b82f6)'}}/>}
                  <line x1="40" y1="4" x2="40" y2="72" stroke={(k2||k3)&&gridHealthy?'#3b82f6':dead} strokeWidth="2.5"/>
                  <line x1="12" y1="18" x2="68" y2="18" stroke={(k2||k3)&&gridHealthy?'#3b82f6':dead} strokeWidth="2" strokeLinecap="round"/>
                  <line x1="16" y1="32" x2="64" y2="32" stroke={(k2||k3)&&gridHealthy?'#3b82f6':dead} strokeWidth="1.8" strokeLinecap="round"/>
                  <line x1="22" y1="46" x2="58" y2="46" stroke={(k2||k3)&&gridHealthy?'#3b82f6':dead} strokeWidth="1.5" strokeLinecap="round"/>
                  <line x1="40" y1="18" x2="12" y2="50" stroke={(k2||k3)&&gridHealthy?'#3b82f6':dead} strokeWidth="1" strokeOpacity="0.5"/>
                  <line x1="40" y1="18" x2="68" y2="50" stroke={(k2||k3)&&gridHealthy?'#3b82f6':dead} strokeWidth="1" strokeOpacity="0.5"/>
                  <line x1="40" y1="72" x2="28" y2="76" stroke={(k2||k3)&&gridHealthy?'#3b82f6':dead} strokeWidth="2" strokeLinecap="round"/>
                  <line x1="40" y1="72" x2="52" y2="76" stroke={(k2||k3)&&gridHealthy?'#3b82f6':dead} strokeWidth="2" strokeLinecap="round"/>
                  {[[12,18],[68,18],[16,32],[64,32]].map(([x,y],i)=>(
                    <circle key={i} cx={x} cy={y} r="3"
                      fill={(k2||k3)&&gridHealthy?'rgba(219,234,254,0.15)':'#0f2030'}
                      stroke={(k2||k3)&&gridHealthy?'#3b82f6':dead} strokeWidth="1"/>
                  ))}
                </svg>
              </div>
              <span style={{ fontSize:'9px',fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:(k2||k3)&&gridHealthy?'#3b82f6':dead }}>Grid AC</span>
              <div style={{ fontSize:'8px',fontWeight:700,padding:'1px 6px',borderRadius:'8px',lineHeight:'14px',whiteSpace:'nowrap',
                background:(k2||k3)&&gridHealthy?'rgba(219,234,254,0.08)':'rgba(10,18,35,0.7)',
                color:(k2||k3)&&gridHealthy?'#1d4ed8':dead,
                border:`1px solid ${(k2||k3)&&gridHealthy?'rgba(147,197,253,0.35)':dead}` }}>
                {flowGridAssist?'GRID ASSIST':k2?'BYPASS':k3?'K3 AUTO':'STANDBY'}
              </div>
            </div>
          </foreignObject>
          <foreignObject x={grid.x+42} y={grid.y-30} width={170} height={110}>
            <div>
              <div style={{ fontSize:'11px',color:'#475569',letterSpacing:'0.08em',textTransform:'uppercase',fontFamily:'monospace',marginBottom:'2px' }}>Grid</div>
              <div style={{ display:'flex',alignItems:'baseline',gap:'3px',lineHeight:1 }}>
                <span style={{ fontSize:'32px',fontWeight:400,lineHeight:1,fontFamily:'monospace',color:(k2||k3)&&gridHealthy?'#f1f5f9':dead }}>{gridVoltage.toFixed(0)}</span>
                <span style={{ fontSize:'19px',fontWeight:500,fontFamily:'monospace',color:'#3b82f6',textShadow:'0 0 6px #3b82f650' }}>Vac</span>
              </div>
              <div style={{ display:'flex',alignItems:'baseline',gap:'3px',lineHeight:1,marginTop:'2px' }}>
                <span style={{ fontSize:'32px',fontWeight:400,lineHeight:1,fontFamily:'monospace',color:(k2||k3)&&gridHealthy?'#f1f5f9':dead }}>{gridFrequency.toFixed(1)}</span>
                <span style={{ fontSize:'19px',fontWeight:500,fontFamily:'monospace',color:'#3b82f6',textShadow:'0 0 6px #3b82f650' }}>Hz</span>
              </div>
              {flowGridAssist && <div style={{ fontSize:'9px',color:'#2dd4bf',fontFamily:'monospace',marginTop:'3px' }}>↙ GRID ASSIST</div>}
            </div>
          </foreignObject>

          {/* ── SERVER ── */}
          <foreignObject x={server.x-35} y={server.y-35} width={70} height={100} overflow="visible">
            <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:'2px' }}>
              <div style={{ width:'70px',height:'70px',display:'flex',alignItems:'center',justifyContent:'center',
                background:outletsOn?'rgba(240,249,255,0.04)':'rgba(10,18,35,0.9)',
                border:`1.5px solid ${outletsOn?'#0ea5e9':batCritical?'rgba(248,113,113,0.35)':dead}`, borderRadius:'10px',
                boxShadow:outletsOn?'0 2px 10px rgba(14,165,233,0.3)':'0 1px 3px rgba(0,0,0,0.5)',transition:'all 0.5s ease' }}>
                <svg width="42" height="42" viewBox="0 0 80 80" fill="none">
                  <rect x="5" y="4" width="70" height="72" rx="4"
                    fill={outletsOn?'rgba(14,165,233,0.05)':'#0a1525'} stroke={outletsOn?'#0ea5e9':dead} strokeWidth="2"
                    style={outletsOn?{filter:'drop-shadow(0 0 5px rgba(14,165,233,0.25))'}:undefined}/>
                  <rect x="5"  y="4" width="7" height="72" rx="2" fill={outletsOn?'rgba(14,165,233,0.08)':'#0f2030'} stroke={outletsOn?'#0ea5e9':dead} strokeWidth="0.8" strokeOpacity="0.5"/>
                  <rect x="68" y="4" width="7" height="72" rx="2" fill={outletsOn?'rgba(14,165,233,0.08)':'#0f2030'} stroke={outletsOn?'#0ea5e9':dead} strokeWidth="0.8" strokeOpacity="0.5"/>
                  {[0,1,2,3].map(i=>(
                    <g key={i}>
                      <rect x="14" y={8+i*16} width="52" height="13" rx="2"
                        fill={outletsOn?'rgba(14,165,233,0.03)':'#0f2030'} stroke={outletsOn?'#0ea5e9':dead} strokeWidth="0.8" strokeOpacity="0.5"/>
                      {outletsOn&&[0,2].map(d=>(
                        <rect key={d} x={17+d*7} y={8+i*16+4} width={3} height={5} rx="0.5"
                          fill={i===2?'#f59e0b':'#10b981'} opacity="0.7">
                          <animate attributeName="opacity" values="0.7;0.15;0.7"
                            dur={`${0.9+d*0.3+i*0.2}s`} repeatCount="indefinite"/>
                        </rect>
                      ))}
                      <circle cx="62" cy={8+i*16+6.5} r="2.5"
                        fill={outletsOn?(i===2?'#f59e0b':'#10b981'):dead}
                        style={outletsOn?{filter:`drop-shadow(0 0 3px ${i===2?'#f59e0b':'#10b981'})`}:undefined}/>
                    </g>
                  ))}
                </svg>
              </div>
              <span style={{ fontSize:'9px',fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:outletsOn?'#0ea5e9':dead }}>Server</span>
              <div style={{ fontSize:'8px',fontWeight:700,padding:'1px 6px',borderRadius:'8px',lineHeight:'14px',whiteSpace:'nowrap',
                background:batCritical?'rgba(254,226,226,0.07)':outletsOn?'rgba(224,242,254,0.07)':'rgba(10,18,35,0.7)',
                color:batCritical?'rgba(185,28,28,0.8)':outletsOn?'#0369a1':dead,
                border:`1px solid ${batCritical?'rgba(252,165,165,0.25)':outletsOn?'rgba(125,211,252,0.35)':dead}` }}>
                {batCritical?'SAFE MODE':flowGridToServer?'via BYPASS':flowInvToServer?'via INVERTER':'OFFLINE'}
              </div>
            </div>
          </foreignObject>
          <foreignObject x={server.x+42} y={server.y-25} width={170} height={75}>
            <div>
              <div style={{ fontSize:'11px',color:'#475569',letterSpacing:'0.08em',textTransform:'uppercase',fontFamily:'monospace',marginBottom:'2px' }}>Consumption</div>
              <div style={{ display:'flex',alignItems:'baseline',gap:'3px' }}>
                <span style={{ fontSize:'32px',fontWeight:400,lineHeight:1,fontFamily:'monospace',color:outletsOn?'#f1f5f9':dead }}>
                  {outletsOn&&inverterPower>0?Math.round(inverterPower*0.85):0}
                </span>
                <span style={{ fontSize:'19px',fontWeight:500,fontFamily:'monospace',color:'#0ea5e9',textShadow:'0 0 6px #0ea5e950' }}>W</span>
              </div>
              {flowGridToServer && <div style={{ fontSize:'9px',color:'#60a5fa',fontFamily:'monospace',marginTop:'2px' }}>via BYPASS (K2)</div>}
              {flowInvToServer  && <div style={{ fontSize:'9px',color:'#a78bfa',fontFamily:'monospace',marginTop:'2px' }}>via INVERTER (K1)</div>}
            </div>
          </foreignObject>

          {/* ════ RELAY STRIP ════ */}
          <foreignObject x="6" y={H-28} width={W-12} height="24">
            <div style={{ display:'flex',gap:'4px',width:'100%',height:'100%',alignItems:'center' }}>
              {relays.map(r=>(
                <div key={r.label} style={{ flex:1,display:'flex',alignItems:'center',gap:'5px',padding:'1px 7px',borderRadius:'5px',height:'22px',
                  background:r.active?`${r.color}12`:'rgba(15,23,42,0.7)',
                  border:`1px solid ${r.active?`${r.color}35`:'rgba(29,78,216,0.18)'}` }}>
                  <div style={{ width:'6px',height:'6px',borderRadius:'50%',flexShrink:0,
                    background:r.active?r.color:dead,
                    boxShadow:r.active?`0 0 4px ${r.color},0 0 8px ${r.color}70`:undefined,
                    border:r.active?undefined:`1px solid ${dead}`,
                    animation:r.active?'ssBlink 2s infinite':undefined }}/>
                  <div style={{ display:'flex',flexDirection:'column',lineHeight:1,gap:'1px' }}>
                    <span style={{ fontSize:'6px',color:r.active?`${r.color}75`:dead,letterSpacing:'0.1em',textTransform:'uppercase' }}>{r.label}</span>
                    <span style={{ fontSize:'8px',fontWeight:900,color:r.active?r.color:dead,letterSpacing:'0.08em' }}>{r.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </foreignObject>

        </svg>
      </div>
    </div>
  );
}