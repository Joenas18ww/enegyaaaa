/// <reference types="vite/client" />

/**
 * API Utility - FLASK BACKEND WITH MARIADB/MYSQL
 * Smart Energy System - Frontend API Client
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const RASPBERRY_PI_IP = '172.20.10.12';

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const joinUrl = (base: string, path: string): string => {
  const normalizedBase = trimTrailingSlash(base);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  // For relative base (e.g. ""), keep the path relative.
  if (!normalizedBase) return normalizedPath;
  return `${normalizedBase}${normalizedPath}`;
};

const getApiBaseUrl = (): string => {
  const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
  return configuredApiUrl ? trimTrailingSlash(configuredApiUrl) : '/api';
};

const getAuthBaseUrl = (): string => {
  const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
  if (!configuredApiUrl) return '';
  return trimTrailingSlash(configuredApiUrl).replace(/\/api$/, '');
};

const API_BASE_URL = getApiBaseUrl();
const AUTH_BASE_URL = getAuthBaseUrl();

console.log('🌐 Smart Energy System - API Configuration');
console.log('📡 API Base URL:', API_BASE_URL);
console.log('🔐 Auth Base URL:', AUTH_BASE_URL);
console.log('💾 Database: MariaDB/MySQL via Flask');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface SensorData {
  grid: {
    voltage: number;
    frequency: number;
    current: number;
    power: number;
  };
  solar: {
    voltage: number;
    current: number;
    power: number;
    efficiency: number;
    // Array of 4 values — one per panel string: [pv1A, pv2A, pv3A, pv4A]
    // If not provided by the API, EnergySystemContext falls back to estimated split.
    stringCurrents?: number[];
  };
  battery: {
    voltage: number;
    current: number;
    soc: number;
    power: number;
    cell1Voltage: number;
    cell2Voltage: number;
    cell3Voltage: number;
    cell4Voltage: number;
    // PZEM-017 bidirectional fields (v7.0+)
    charge_a?:    number;
    discharge_a?: number;
    source?:      string;
    // [EXPAND-200Ah] Bank B fields — undefined / 0 / false when 100Ah mode
    // Populated when PZEM#3 (0x03) + PZEM#4 (0x04) respond on RS485 bus
    bank_b_available?: boolean;   // true = Bank B online = 200Ah mode
    bank_b_voltage?:   number;    // BankB pack voltage (B3.V + B4.V)
    bank_b_current?:   number;    // BankB pack current (avg B3.I, B4.I)
    bank_b_soc?:       number;    // BankB SOC % (from voltage lookup)
    capacity_ah?:      number;    // 100 or 200 — auto-detected by backend
    anomaly_details?:  string[];  // per-bank anomaly messages (imbalance, overcurrent, etc.)
  };
  inverter: {
    voltage: number;
    current: number;
    frequency: number;
    power: number;
  };
  system: {
    temperature: number;
    currentSource: 'Grid' | 'Inverter';
    thermalShutdown?: boolean;
    server_time?:     string;
    rtc_available?:   boolean;
    systemEfficiency?: number | null;  // ISO 50001 — P_out/P_in × 100
  };
  k3?: {
    active:          boolean;
    direction:       string;
    reconnectOk:     boolean;
    stableSeconds:   number;
    requiredSeconds: number;
  };
  manualLockout?: {
    active:    boolean;
    remaining: number;
  };
  // [PATCH] Power flow breakdown from Flask _compute_power_flow()
  // Added to SensorData — was missing, causing data.powerFlow to always be undefined
  // in EnergySystemContext poll(), so setPowerFlow() was never called.
  powerFlow?: {
    solarToLoad:   number;
    batteryToLoad: number;
    gridToLoad:    number;
    gridToBattery: number;
    solarDcW:      number;
    batDischargeW: number;
    batChargeW:    number;
    inverterW:     number;
    gridW:         number;
  };
  outlets: {
    outlet1: { status: boolean; current: number; voltage: number };
    outlet2: { status: boolean; current: number; voltage: number };
  };
}

export interface AnomalyLog {
  id: number;
  timestamp: string;
  type: string;
  source: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  systemAction: string;
  systemTemp: number;
  battery: string;
  solarPower: string;
  gridVoltage: string;
  emailStatus: 'Sent' | 'Failed' | 'Queued';
  buzzer: 'ON' | 'OFF';
  status: 'Resolved' | 'Monitoring' | 'Normal';
  // Extended fields returned by Flask v7.0+
  resolvedAt?:       string | null;
  responseTimeMs?:   number | null;
  inverterPower?:    number | null;
  panelFaultDetail?: string | null;
  detectedAt?:       string | null;
  actionAt?:         string | null;
}

export interface SSRState {
  controlMode: 'solar' | 'grid' | 'assist' | 'shutdown' | 'failsafe';
  autoSwitchEnabled: boolean;
  manualOverride: boolean;
  ssrStates: { SSR1: boolean; SSR2: boolean; SSR3: boolean; SSR4?: boolean; K1?: boolean; K2?: boolean; K4?: boolean };
  totalSwitches: number;
  lastSwitchTime: string;
  // Extra fields returned by Flask /api/ssr/state
  k4Closed?: boolean;
  contactorClosed?: boolean;
  k3ReconnectOk?: boolean;
  k3StableSeconds?: number;
  arduino?: string;
}

export interface SensorLogEntry {
  id: number;
  timestamp: string;
  grid_voltage: number;
  grid_frequency: number;
  grid_current: number;
  grid_power: number;
  solar_dc_voltage: number;
  solar_dc_current: number;
  solar_dc_power: number;
  solar_ac_voltage: number;
  solar_ac_current: number;
  solar_ac_power: number;
  battery_pack_voltage: number;
  battery_pack_current: number;
  battery_pack_soc: number;
  battery_pack_power: number;
  // [INA226 v6.0+] bidirectional battery current
  battery_charge_a:    number;
  battery_discharge_a: number;
  battery_source?:     string;
  // [EXPAND-200Ah] Bank B log fields
  battery_bank_b_voltage?:  number;
  battery_bank_b_current?:  number;
  battery_bank_b_soc?:      number;
  battery_capacity_ah?:     number;
  inverter_voltage: number;
  inverter_current: number;
  inverter_frequency: number;
  inverter_power: number;
  system_temp: number;
  outlet_1_current: number;
  outlet_1_voltage: number;
  outlet_2_current: number;
  outlet_2_voltage: number;
  ssr1_state: boolean;
  ssr2_state: boolean;
  ssr3_state: boolean;
  control_mode: string;
}

export interface BuzzerState {
  active: boolean;
  duration_ms: number;
  triggered_at: string | null;
}

// ============================================================================
// HELPER
// ============================================================================

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = joinUrl(API_BASE_URL, endpoint);
  try {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: `HTTP ${response.status}: ${response.statusText}`,
      }));
      throw new Error(error.error || `API request failed: ${response.statusText}`);
    }
    return response.json();
  } catch (error) {
    console.error(`❌ API Request Failed [${endpoint}]:`, error);
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error('💡 Check: 1) Flask running  2) IP correct  3) Port 5000 open');
      console.error(`   Current API URL: ${API_BASE_URL}`);
    }
    throw error;
  }
}

// ============================================================================
// AUTH — GOOGLE OAUTH
// ============================================================================

export function loginWithGoogle(): void {
  window.location.href = joinUrl(AUTH_BASE_URL, '/auth/google');
}

export async function logout(): Promise<void> {
  await fetch(joinUrl(AUTH_BASE_URL, '/auth/logout'), {
    method: 'POST',
    credentials: 'include',
  });
}

export function parseAuthFromUrl(): { email: string; name: string; picture: string } | null {
  const params = new URLSearchParams(window.location.search);
  const email   = params.get('email');
  const name    = params.get('name');
  const picture = params.get('picture');
  const error   = params.get('error');

  if (error) {
    console.error('❌ OAuth error:', error);
    window.history.replaceState({}, document.title, window.location.pathname);
    return null;
  }

  if (email && name) {
    console.log('✅ OAuth login successful:', email);
    window.history.replaceState({}, document.title, window.location.pathname);
    return { email, name, picture: picture || '' };
  }

  return null;
}

// ============================================================================
// SENSOR DATA
// ============================================================================

export async function getCurrentSensorData(): Promise<SensorData> {
  return apiRequest<SensorData>('/sensor-data/current');
}

export async function getSensorHistory(limit = 100): Promise<SensorLogEntry[]> {
  // [FIX] /sensor-data/logs returns { logs: [] } but SensorDataLogsView
  // maps fields like grid_voltage, solar_dc_voltage etc — those only exist
  // in the /sensor-data/history route which returns a flat array directly.
  // Using /logs was returning wrapped data with wrong field names → empty table.
  const response = await apiRequest<SensorLogEntry[] | { logs: SensorLogEntry[] }>(
    `/sensor-data/history?limit=${limit}`
  );
  // Handle both flat array and wrapped object defensively
  if (Array.isArray(response)) return response;
  return (response as { logs: SensorLogEntry[] }).logs ?? [];
}

// ============================================================================
// ANOMALY LOGS
// ============================================================================

export async function getAnomalyLogs(limit = 50): Promise<AnomalyLog[]> {
  const response = await apiRequest<{ logs: AnomalyLog[] }>(`/anomaly-logs?limit=${limit}`);
  return response.logs ?? [];
}

export async function addAnomalyLog(
  log: Omit<AnomalyLog, 'id' | 'timestamp'>
): Promise<{ success: boolean; id: number }> {
  return apiRequest<{ success: boolean; id: number }>('/anomaly-logs', {
    method: 'POST',
    body: JSON.stringify(log),
  });
}

export async function updateAnomalyLogEmailStatus(
  anomalyId: number,
  emailStatus: 'Sent' | 'Failed' | 'Queued'
): Promise<{ success: boolean; anomaly_id: number; email_status: string }> {
  return apiRequest(`/anomaly-logs/${anomalyId}/email-status`, {
    method: 'PATCH',
    body: JSON.stringify({ emailStatus }),
  });
}

// ============================================================================
// SSR CONTROL
// ============================================================================

export async function getSSRState(): Promise<SSRState> {
  return apiRequest<SSRState>('/ssr/state');
}

export async function updateSSRState(state: Partial<SSRState>): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>('/ssr/state', {
    method: 'POST',
    body: JSON.stringify(state),
  });
}

// ============================================================================
// OUTLET CONTROL
// ============================================================================

export async function controlOutlet(
  outlet: 'outlet1' | 'outlet2',
  status: boolean
): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/outlets/${outlet}`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

// ============================================================================
// BUZZER CONTROL
// ============================================================================

export async function triggerBuzzer(
  durationMs = 5000,
  reason = 'Anomaly alert'
): Promise<{ success: boolean; duration_ms: number; triggered_at: string }> {
  return apiRequest('/buzzer/trigger', {
    method: 'POST',
    body: JSON.stringify({ duration_ms: durationMs, reason }),
  });
}

export async function getBuzzerState(): Promise<BuzzerState> {
  return apiRequest<BuzzerState>('/buzzer/state');
}

// ============================================================================
// SYSTEM HEALTH
// ============================================================================

export async function checkHealth(): Promise<{
  status: string;
  timestamp: string;
  database: string;
  services: { dataAcquisition: string; anomalyMonitoring: string; autoSwitch: string };
}> {
  return apiRequest('/system/health');
}

export async function triggerSystemRefresh(): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>('/system/refresh', { method: 'POST' });
}

// ============================================================================
// UTILITIES
// ============================================================================

export async function testConnection(): Promise<boolean> {
  try {
    await checkHealth();
    console.log('✅ API Connection: SUCCESS');
    return true;
  } catch {
    console.error('❌ API Connection: FAILED');
    console.error(`🔧 Test: curl http://${RASPBERRY_PI_IP}:5000/api/system/health`);
    return false;
  }
}

export function getApiConfig() {
  return {
    baseUrl: API_BASE_URL,
    authUrl: AUTH_BASE_URL,
    raspberryPiIp: RASPBERRY_PI_IP,
    environment: import.meta.env.MODE || 'production',
  };
}

if (import.meta.env.DEV) {
  setTimeout(() => testConnection(), 1000);
}
