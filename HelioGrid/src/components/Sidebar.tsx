import {
  Home, History, Bell, User, Monitor, LogOut, Zap, HelpCircle,
  ChevronDown, ChevronUp, Sun, BarChart3, Power, Database, Settings
} from 'lucide-react';
import type { ViewType } from '../App';
import { useState } from 'react';

interface SidebarProps {
  activeView: ViewType;
  setActiveView: (view: ViewType) => void;
  onClose: () => void;
  onLogout: () => void;
}

const scrollbarStyle: React.CSSProperties = {
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(148,163,184,0.25) transparent',
};

export function Sidebar({ activeView, setActiveView, onClose, onLogout }: SidebarProps) {
  const [dashboardOpen, setDashboardOpen] = useState(true);

  const dashboardSubItems = [
    { id: 'pv-array'      as ViewType, icon: Sun,      label: 'PV Array Status',      description: 'Panel monitoring' },
    { id: 'analytics'     as ViewType, icon: BarChart3, label: 'Real-Time Analytics',  description: 'Graphs & trends'  },
    { id: 'power-control' as ViewType, icon: Power,    label: 'Power & Load Control', description: 'SSR & outlets'    },
  ];

  const mainMenuItems = [
    // { id: 'lcd' as ViewType, icon: Monitor, label: 'LCD Terminal View' }, // Hidden — using KioskLCD instead
    { id: 'history'        as ViewType, icon: History,  label: 'Anomaly Logs'        },
    { id: 'alert-config'   as ViewType, icon: Bell,     label: 'Alert Configuration' },
    { id: 'sensor-logs'    as ViewType, icon: Database, label: 'Sensor Data Logs'    },
    { id: 'system-modules' as ViewType, icon: Settings, label: 'System Modules'      },
    { id: 'admin'          as ViewType, icon: User,     label: 'Admin'               },
  ];

  const handleClick = (view: ViewType) => { setActiveView(view); onClose(); };
  const handleLogout = () => { onClose(); setTimeout(() => onLogout(), 300); };

  const isDashboardActive = ['dashboard', 'pv-array', 'analytics', 'power-control'].includes(activeView);

  return (
    <div className="h-full bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white flex flex-col shadow-2xl">

      {/* ── Logo ── */}
      <div className="p-4 sm:p-6 border-b border-white/10 flex-shrink-0">
        <button
          onClick={() => handleClick('dashboard')}
          className="flex items-center gap-3 w-full group hover:opacity-90 transition-opacity"
        >
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-sky-500/50 transition-shadow">
            <Zap className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <h2 className="text-base sm:text-lg truncate">HelioGrid</h2>
            <p className="text-xs text-blue-300">Campus Resilience</p>
          </div>
        </button>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 p-3 sm:p-4 space-y-1 overflow-y-auto overflow-x-hidden" style={scrollbarStyle}>
        <div className="space-y-1">

          {/* Dashboard parent row */}
          <div className={`flex items-center rounded-xl transition-all duration-200 ${
            isDashboardActive
              ? 'bg-gradient-to-r from-sky-500 to-blue-600 shadow-lg shadow-blue-500/30'
              : 'hover:bg-white/10'
          }`}>
            <button
              onClick={() => handleClick('dashboard')}
              className="flex items-center gap-3 flex-1 px-3 sm:px-4 py-3 text-left"
            >
              <Home className="w-5 h-5 flex-shrink-0" />
              <span className="flex-1 truncate">Dashboard</span>
            </button>
            <button
              onClick={() => setDashboardOpen(!dashboardOpen)}
              className="px-3 py-3 hover:bg-white/10 rounded-r-xl transition-colors"
              aria-label="Toggle submenu"
            >
              {dashboardOpen
                ? <ChevronUp   className="w-4 h-4 text-white/80" />
                : <ChevronDown className="w-4 h-4 text-white/80" />}
            </button>
          </div>

          {/* Sub-items with vertical line */}
          {dashboardOpen && (
            <div className="ml-6 space-y-0.5 border-l-2 border-blue-400/30 pl-2">
              {dashboardSubItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleClick(item.id)}
                  className={`w-full flex items-start gap-2 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                    activeView === item.id
                      ? 'bg-blue-500/30 text-white font-medium'
                      : 'text-blue-200 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 text-left min-w-0">
                    <div className="truncate">{item.label}</div>
                    <div className="text-xs text-blue-300/70 truncate">{item.description}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-px bg-white/10 my-2" />

        {/* Main menu items */}
        {mainMenuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => handleClick(item.id)}
            className={`w-full flex items-center gap-3 px-3 sm:px-4 py-3 rounded-xl transition-all duration-200 ${
              activeView === item.id
                ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg shadow-blue-500/30 scale-[0.98]'
                : 'text-blue-100 hover:bg-white/10 hover:translate-x-1'
            }`}
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Footer ── */}
      <div className="p-3 sm:p-4 border-t border-white/10 space-y-2 flex-shrink-0">
        <button className="w-full flex items-center gap-3 px-3 sm:px-4 py-3 rounded-xl text-blue-100 hover:bg-white/10 transition-all hover:translate-x-1">
          <HelpCircle className="w-5 h-5 flex-shrink-0" />
          <span className="truncate">Help &amp; Docs</span>
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 sm:px-4 py-3 rounded-xl text-red-300 hover:bg-red-500/20 transition-all hover:translate-x-1"
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          <span className="truncate">Logout</span>
        </button>
      </div>
    </div>
  );
}