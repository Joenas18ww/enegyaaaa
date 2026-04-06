"""
anomaly_engine.py
=================
Standalone voltage anomaly detector for HelioGrid.
Based on: Overview and Conditions PDF spec.

Classification rules (per PDF + system spec):
  DROPOUT  Critical : V == 0V, single reading
  DROPOUT  Warning  : 0 < V < 23V (10% Vn), ≥2 consecutive readings
  SPIKE    Warning  : |ΔV| ≥ 8V  AND  V still inside range
  SPIKE    Critical : |ΔV| ≥ 23V AND  V outside range
  DRIFT    Warning  : 1V < |ΔV| ≤ 7V  (gradual change, not big enough for spike)
  DRIFT    Critical : ≥3 consecutive readings outside range (sustained)
  NORMAL   —        : |ΔV| ≤ 1V and V inside range

Each VoltageAnomalyEngine instance is independent — one for Grid, one for Inverter.
Inverter: only tolerance differs — all other thresholds are the same as Grid.
"""

class VoltageAnomalyEngine:
    def __init__(
        self,
        source: str = "Grid",
        nominal: float = 230.0,
        tolerance: float = 0.10,           # ±10%  → 207–253V
        spike_warn_delta: float = 8.0,     # ΔV ≥ 8V  → Spike Warning
        spike_crit_delta: float = 23.0,    # ΔV ≥ 23V → Spike Critical (if outside range)
        drift_warn_min: float = 1.0,       # |ΔV| > 1V  → start of drift zone
        drift_warn_max: float = 7.0,       # |ΔV| ≤ 7V  → still drift (not spike)
        drift_crit_readings: int = 3,      # consecutive readings outside range → Critical
        dropout_warn_readings: int = 2,    # consecutive low-V readings → Warning
        confirm_count: int = 3,            # consecutive critical readings before alert
    ):
        self.source = source
        self.Vn = nominal
        self.Vhigh = nominal * (1 + tolerance)       # 253V
        self.Vlow  = nominal * (1 - tolerance)       # 207V
        self.SPIKE_WARN_DELTA  = spike_warn_delta
        self.SPIKE_CRIT_DELTA  = spike_crit_delta
        self.DRIFT_WARN_MIN    = drift_warn_min
        self.DRIFT_WARN_MAX    = drift_warn_max
        self.DRIFT_CRIT_READINGS = drift_crit_readings
        self.DROPOUT_WARN_READINGS = dropout_warn_readings
        self.DROPOUT_WARN_THRESHOLD = nominal * 0.10  # 23V  (10% of Vn)
        self.cfg_confirm_count = confirm_count

        # --- state ---
        self.history: list[float] = []          # last 5 readings
        self._prev: float | None = None

        # consecutive counters
        self._drift_crit_count   = 0
        self._dropout_warn_count = 0
        self._crit_spike_count   = 0
        self._crit_drift_count   = 0
        self._alert_sent_spike   = False
        self._alert_sent_drift   = False

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------
    def inside_range(self, v: float) -> bool:
        return self.Vlow <= v <= self.Vhigh

    def get_active_count(self) -> int:
        """Return current consecutive critical-reading count (spike or drift)."""
        return max(self._crit_spike_count, self._crit_drift_count)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------
    def _reset_alert_counts(self):
        self._crit_spike_count  = 0
        self._crit_drift_count  = 0
        self._alert_sent_spike  = False
        self._alert_sent_drift  = False

    def _reset_drift_crit(self):
        self._drift_crit_count = 0

    def _reset_dropout_warn(self):
        self._dropout_warn_count = 0

    # ------------------------------------------------------------------
    # Main classify — returns dict
    # ------------------------------------------------------------------
    def classify(self, v: float) -> dict:
        """
        Classify a single voltage reading.

        Returns:
            {
              "fault_type": str,        # "Normal" | "Spike High" | "Spike Low" |
                                        #  "Drift High" | "Drift Low" | "Dropout"
              "severity":   str,        # "Normal" | "Warning" | "Critical"
              "delta":      float,      # ΔV vs previous reading
              "confirm_count": int,     # consecutive critical count (spike/drift)
              "alert":      bool,       # True when confirm_count ≥ cfg_confirm_count
            }
        """
        # maintain history (last 5)
        self.history.append(v)
        if len(self.history) > 5:
            self.history.pop(0)

        prev  = self._prev if self._prev is not None else v
        delta = v - prev
        self._prev = v

        result = self._run_logic(v, delta)
        return result

    def _run_logic(self, v: float, delta: float) -> dict:

        # ----------------------------------------------------------------
        # 1. DROPOUT — highest priority
        # ----------------------------------------------------------------
        if v == 0.0:
            # Critical: V = 0, single reading
            self._reset_alert_counts()
            self._reset_drift_crit()
            self._reset_dropout_warn()
            return self._make(v, delta, "Dropout", "Critical", 1, True)

        if 0.0 < v < self.DROPOUT_WARN_THRESHOLD:
            # [FIX-DROPOUT-CRITICAL] 0 < V < 23V is Critical — same as V==0.
            # Any voltage this low (< 10% of nominal) is a real dropout,
            # not a transitional state. Treating it as Warning causes missed
            # buzzer/email and wrong UI severity for readings like 0.1V.
            self._dropout_warn_count += 1
            self._reset_alert_counts()
            self._reset_drift_crit()
            return self._make(v, delta, "Dropout", "Critical",
                              self._dropout_warn_count, True)

        # Reset dropout warn counter once we're back above threshold
        self._reset_dropout_warn()

        # ----------------------------------------------------------------
        # 2. SPIKE — biglaang pagbabago
        # ----------------------------------------------------------------
        if abs(delta) >= self.SPIKE_WARN_DELTA:
            fault = "Spike High" if delta > 0 else "Spike Low"

            # Critical: |ΔV| ≥ 23V AND outside 207–253V
            if abs(delta) >= self.SPIKE_CRIT_DELTA and not self.inside_range(v):
                self._crit_spike_count += 1
                self._reset_drift_crit()
                alert = (self._crit_spike_count >= self.cfg_confirm_count
                         and not self._alert_sent_spike)
                if alert:
                    self._alert_sent_spike = True
                return self._make(v, delta, fault, "Critical",
                                  self._crit_spike_count, alert)

            # Warning: |ΔV| ≥ 8V, voltage still inside range
            self._reset_alert_counts()
            self._reset_drift_crit()
            return self._make(v, delta, fault, "Warning", 0, False)

        # ----------------------------------------------------------------
        # 3. DRIFT — gradual change
        # ----------------------------------------------------------------
        h = self.history

        # --- 3a. Critical drift: outside range, sustained ≥3 readings ---
        if not self.inside_range(v):
            self._drift_crit_count += 1
            self._reset_alert_counts()  # spike counters not relevant here

            fault = "Drift High" if v > self.Vhigh else "Drift Low"

            # Use separate drift alert tracking
            alert = (self._drift_crit_count >= self.DRIFT_CRIT_READINGS
                     and not self._alert_sent_drift)
            if alert:
                self._alert_sent_drift = True

            severity = "Critical" if self._drift_crit_count >= self.DRIFT_CRIT_READINGS else "Warning"
            return self._make(v, delta, fault, severity,
                              self._drift_crit_count, alert)

        # Back inside range → reset drift crit counter
        self._reset_drift_crit()

        # --- 3b. Warning drift: gradual change 1V < |ΔV| ≤ 7V ---
        if self.DRIFT_WARN_MIN < abs(delta) <= self.DRIFT_WARN_MAX:
            fault = "Drift High" if delta > 0 else "Drift Low"
            self._reset_alert_counts()
            return self._make(v, delta, fault, "Warning", 0, False)

        # ----------------------------------------------------------------
        # 4. NORMAL
        # ----------------------------------------------------------------
        self._reset_alert_counts()
        return self._make(v, delta, "Normal", "Normal", 0, False)

    # ------------------------------------------------------------------
    def _make(self, v, delta, fault, severity, confirm_count, alert) -> dict:
        return {
            "source":        self.source,
            "voltage":       round(v, 2),
            "delta":         round(delta, 3),
            "fault_type":    fault,
            "severity":      severity,
            "confirm_count": confirm_count,
            "alert":         alert,
        }


# ============================================================
# Convenience factory for Flask — drop-in replacements
# ============================================================
def make_grid_engine() -> VoltageAnomalyEngine:
    """Grid AC — 230V ±10%, thresholds per PDF spec."""
    return VoltageAnomalyEngine(
        source="Grid",
        nominal=230.0,
        tolerance=0.10,
        spike_warn_delta=8.0,
        spike_crit_delta=23.0,
        drift_warn_min=1.0,
        drift_warn_max=7.0,
        drift_crit_readings=3,
        dropout_warn_readings=2,
        confirm_count=3,
    )


def make_inverter_engine(tolerance: float = 0.10) -> VoltageAnomalyEngine:
    """
    Inverter AC — same 230V base and same thresholds as Grid.
    Only tolerance differs (pass the inverter's actual tolerance).
    """
    return VoltageAnomalyEngine(
        source="Inverter",
        nominal=230.0,
        tolerance=tolerance,          # ← only this changes vs Grid
        spike_warn_delta=8.0,
        spike_crit_delta=23.0,
        drift_warn_min=1.0,
        drift_warn_max=7.0,
        drift_crit_readings=3,
        dropout_warn_readings=2,
        confirm_count=3,
    )


# ============================================================
# Flask-compatible wrapper — adds the API that flask expects:
#   engine.process(v)              → 'none' | 'warning' | 'critical'
#   engine.reset()                 → clears state on sensor reconnect
#   engine.last_fault_type         → str
#   engine.last_delta              → float
#   engine.cfg.name                → str
#   engine.cfg.confirm_count       → int
#   engine.cfg.v_critical_low/high → float (runtime-updatable)
#   engine.update_thresholds(lo,hi)→ update bounds at runtime
# ============================================================

class _EngineCfg:
    """Thin config holder so flask can read engine.cfg.name etc."""
    def __init__(self, name: str, confirm_count: int,
                 v_critical_low: float, v_critical_high: float):
        self.name            = name
        self.confirm_count   = confirm_count
        self.v_critical_low  = v_critical_low
        self.v_critical_high = v_critical_high


class _FlaskEngine:
    """
    Wraps VoltageAnomalyEngine and exposes the API flask_unified_complete.py uses.
    Rules are 100% unchanged — all logic stays in VoltageAnomalyEngine.classify().
    """

    def __init__(self, engine: VoltageAnomalyEngine,
                 v_critical_low: float, v_critical_high: float):
        self._engine          = engine
        self.last_fault_type  = "Normal"
        self.last_delta       = 0.0
        self.cfg              = _EngineCfg(
            name            = engine.source,
            confirm_count   = engine.cfg_confirm_count,
            v_critical_low  = v_critical_low,
            v_critical_high = v_critical_high,
        )

    def process(self, v: float) -> str:
        """
        Run one voltage reading through the engine.
        Returns 'none' | 'warning' | 'critical'  (what flask stores in cache).
        """
        result               = self._engine.classify(v)
        self.last_fault_type = result["fault_type"]
        self.last_delta      = result["delta"]

        severity = result["severity"]      # "Normal" | "Warning" | "Critical"
        if severity == "Critical":
            return "critical"
        if severity == "Warning":
            return "warning"
        return "none"

    def reset(self):
        """Clear engine state — called by flask on sensor reconnect."""
        self._engine.__init__(
            source               = self._engine.source,
            nominal              = self._engine.Vn,
            tolerance            = (self._engine.Vhigh / self._engine.Vn) - 1.0,
            spike_warn_delta     = self._engine.SPIKE_WARN_DELTA,
            spike_crit_delta     = self._engine.SPIKE_CRIT_DELTA,
            drift_warn_min       = self._engine.DRIFT_WARN_MIN,
            drift_warn_max       = self._engine.DRIFT_WARN_MAX,
            drift_crit_readings  = self._engine.DRIFT_CRIT_READINGS,
            dropout_warn_readings= self._engine.DROPOUT_WARN_READINGS,
            confirm_count        = self._engine.cfg_confirm_count,
        )
        self.last_fault_type = "Normal"
        self.last_delta      = 0.0

    def update_thresholds(self, v_low: float, v_high: float):
        """
        Update runtime voltage bounds (called from /api/settings route).
        Resets engine state so new thresholds apply immediately.
        """
        self.cfg.v_critical_low  = v_low
        self.cfg.v_critical_high = v_high
        # Rebuild the underlying engine with new tolerance
        tol = (v_high / self._engine.Vn) - 1.0
        self._engine.__init__(
            source               = self._engine.source,
            nominal              = self._engine.Vn,
            tolerance            = tol,
            spike_warn_delta     = self._engine.SPIKE_WARN_DELTA,
            spike_crit_delta     = self._engine.SPIKE_CRIT_DELTA,
            drift_warn_min       = self._engine.DRIFT_WARN_MIN,
            drift_warn_max       = self._engine.DRIFT_WARN_MAX,
            drift_crit_readings  = self._engine.DRIFT_CRIT_READINGS,
            dropout_warn_readings= self._engine.DROPOUT_WARN_READINGS,
            confirm_count        = self._engine.cfg_confirm_count,
        )
        self.last_fault_type = "Normal"
        self.last_delta      = 0.0


# ── Module-level singletons imported by flask ─────────────────────────────────
# from anomaly_engine import GRID_ENGINE, INVERTER_ENGINE, VoltageAnomalyEngine

GRID_ENGINE = _FlaskEngine(
    make_grid_engine(),
    v_critical_low  = 207.0,   # 230V − 10%
    v_critical_high = 253.0,   # 230V + 10%
)

INVERTER_ENGINE = _FlaskEngine(
    make_inverter_engine(tolerance=0.10),
    v_critical_low  = 207.0,
    v_critical_high = 253.0,
)
