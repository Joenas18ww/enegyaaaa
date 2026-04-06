import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { DashboardView } from "./components/DashboardView";
// import { LCDPreview } from "./components/LCDPreview"; // Hidden — using KioskLCD instead
import { AnomalyLogView } from "./components/AnomalyLogView";
import { SensorDataLogsView } from "./components/SensorDataLogsView";
import { NotificationsView as AlertConfigView } from "./components/NotificationsView";
import { AdminView } from "./components/AdminView";
import { LoginPage } from "./components/LoginPage";
import { SplashScreen } from "./components/SplashScreen";
import { SystemModulesView } from "./components/SystemModulesView";

import { SolarPanelsStatusCard } from "./components/cards/SolarPanelsStatusCard";
import { PowerHistoryCard, EnergyBalanceCard, CumulativeConsumptionCard } from "./components/cards/PowerHistoryCard";
import { UnifiedSSROutletCard } from "./components/cards/UnifiedSSROutletCard";

import { Menu } from "lucide-react";
import { EnergySystemProvider, useEnergySystem } from "./contexts/EnergySystemContext";
import { useAutoRefresh } from "./hooks/useAutoRefresh";
import { KioskLCD } from "./components/KioskLCD";

export type ViewType =
  | "dashboard"
  | "pv-array"
  | "analytics"
  | "power-control"
  | "lcd"
  | "kiosk"
  | "history"
  | "alert-config"
  | "sensor-logs"
  | "system-modules"
  | "admin";

export interface GoogleUser {
  name: string;
  email: string;
  picture: string;
}

// ── Session helpers ──────────────────────────────────────────────────────────
const SESSION_KEY = "heliogrid_user";

function saveSession(user: GoogleUser): void {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(user)); } catch { /* ignore */ }
}

function loadSession(): GoogleUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as GoogleUser) : null;
  } catch { return null; }
}

function clearSession(): void {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
// ────────────────────────────────────────────────────────────────────────────

function PageWrapper({ title, subtitle, children }: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-3 sm:p-4 lg:p-6 xl:p-8 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-800">{title}</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function AppContent() {
  const isKiosk = window.location.search.includes('kiosk=true');

  // ── Restore session from localStorage on first render ──
  const savedUser = loadSession();

  const [showSplash, setShowSplash]   = useState(!isKiosk && savedUser === null);
  const [isLoggedIn, setIsLoggedIn]   = useState(isKiosk || savedUser !== null);
  const [activeView, setActiveView]   = useState<ViewType>(isKiosk ? "kiosk" : "dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [googleUser, setGoogleUser]   = useState<GoogleUser | null>(savedUser);

  const { refreshData } = useEnergySystem();

  useAutoRefresh({
    onRefresh: refreshData,
    idleTimeout: 5 * 60 * 1000,
    refreshInterval: 5 * 1000,
    enableIdleRefresh: true,
    enablePeriodicRefresh: true,
  });

  const handleLogin = (user: GoogleUser) => {
    saveSession(user);       // ← persist to localStorage
    setGoogleUser(user);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    clearSession();          // ← clear from localStorage
    setIsLoggedIn(false);
    setGoogleUser(null);
  };

  // ── Kiosk mode: skip splash and login entirely ──
  if (isKiosk) {
    return (
      <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#000' }}>
        <KioskLCD />
      </div>
    );
  }

  if (showSplash) return <SplashScreen onComplete={() => setShowSplash(false)} />;

  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <div className={`fixed lg:static inset-y-0 left-0 z-30 w-64 transform transition-transform duration-300 ease-in-out ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <Sidebar
          activeView={activeView}
          setActiveView={setActiveView}
          onClose={() => setSidebarOpen(false)}
          onLogout={handleLogout}
        />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="lg:hidden flex items-center justify-between p-4 bg-white border-b border-slate-200 shadow-sm">
          <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-slate-100 rounded-lg">
            <Menu className="w-6 h-6 text-slate-600" />
          </button>
          <h1 className="text-lg font-bold text-slate-800">HelioGrid</h1>
          <div className="w-10" />
        </header>

        <main className="flex-1 overflow-auto bg-[#f8fafc]">
          {activeView === "dashboard" && <DashboardView />}

          {activeView === "pv-array" && (
            <PageWrapper title="PV Array Status" subtitle="Individual panel performance">
              <SolarPanelsStatusCard />
            </PageWrapper>
          )}

          {activeView === "analytics" && (
            <PageWrapper title="Real-Time Analytics" subtitle="Power trends and data">
              <div className="space-y-6">
                <PowerHistoryCard />
                <EnergyBalanceCard />
                <CumulativeConsumptionCard />
              </div>
            </PageWrapper>
          )}

          {activeView === "power-control" && (
            <PageWrapper title="Power & Load Control" subtitle="SSR and Outlets Management">
              <UnifiedSSROutletCard />
            </PageWrapper>
          )}

          {/* {activeView === "lcd" && <LCDPreview />} */}{/* Hidden — using KioskLCD instead */}

          {activeView === "kiosk" && (
            <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'fixed', top: 0, left: 0, zIndex: 9999 }}>
              <KioskLCD />
            </div>
          )}

          {activeView === "history"        && <AnomalyLogView />}
          {activeView === "alert-config"   && <AlertConfigView />}
          {activeView === "sensor-logs"    && <SensorDataLogsView />}
          {activeView === "system-modules" && <SystemModulesView />}
          {activeView === "admin"          && <AdminView googleUser={googleUser} onLogout={handleLogout} />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <EnergySystemProvider>
      <AppContent />
    </EnergySystemProvider>
  );
}
