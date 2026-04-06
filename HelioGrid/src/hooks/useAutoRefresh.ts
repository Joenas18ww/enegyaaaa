import { useEffect, useRef, useCallback } from 'react';

export interface UseAutoRefreshOptions {
  /** Callback function to execute when refresh is triggered */
  onRefresh: () => void;

  /**
   * How long (ms) the tab must be hidden before triggering a refresh on return.
   * Default: 2 minutes — similar to Gmail, Facebook, etc.
   */
  idleTimeout?: number;

  /** Interval (ms) for periodic background refresh. Default: 30 seconds */
  refreshInterval?: number;

  /** Enable refresh when returning to tab after being away. Default: true */
  enableIdleRefresh?: boolean;

  /** Enable periodic refresh while tab is active. Default: true */
  enablePeriodicRefresh?: boolean;
}

/**
 * Auto-refresh hook — works like Gmail/Facebook/real websites:
 *
 * 1. PERIODIC REFRESH — refreshes every N seconds while tab is visible
 * 2. TAB VISIBILITY REFRESH — when you switch back to this tab after
 *    being away for `idleTimeout` ms, it immediately refreshes
 *
 * Uses the Page Visibility API (document.visibilitychange) — the correct
 * way to detect tab switching, not mouse/keyboard activity.
 */
export function useAutoRefresh({
  onRefresh,
  idleTimeout = 2 * 60 * 1000,   // 2 minutes — refresh on tab return if away this long
  refreshInterval = 30 * 1000,    // 30 seconds periodic refresh
  enableIdleRefresh = true,
  enablePeriodicRefresh = true,
}: UseAutoRefreshOptions) {
  const hiddenAt = useRef<number | null>(null);
  const periodicTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stable ref so effects don't re-run when onRefresh identity changes
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  // ─── Tab visibility handler ──────────────────────────────────────────────
  const handleVisibilityChange = useCallback(() => {
    if (document.hidden) {
      // Tab went to background — record when
      hiddenAt.current = Date.now();
      console.log('[AutoRefresh] Tab hidden');
    } else {
      // Tab came back into focus
      const awayMs = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      console.log(`[AutoRefresh] Tab visible — away for ${Math.round(awayMs / 1000)}s`);

      if (enableIdleRefresh && awayMs >= idleTimeout) {
        console.log('[AutoRefresh] Away long enough — refreshing data');
        onRefreshRef.current();
      }

      hiddenAt.current = null;
    }
  }, [enableIdleRefresh, idleTimeout]);

  // ─── Tab visibility detection ────────────────────────────────────────────
  useEffect(() => {
    if (!enableIdleRefresh) return;

    document.addEventListener('visibilitychange', handleVisibilityChange);
    console.log('[AutoRefresh] Tab visibility detection started');

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      console.log('[AutoRefresh] Tab visibility detection stopped');
    };
  }, [enableIdleRefresh, handleVisibilityChange]);

  // ─── Periodic refresh (only while tab is active) ─────────────────────────
  useEffect(() => {
    if (!enablePeriodicRefresh) return;

    periodicTimer.current = setInterval(() => {
      // Skip periodic refresh if tab is hidden — save resources
      if (document.hidden) return;
      console.log('[AutoRefresh] Periodic refresh');
      onRefreshRef.current();
    }, refreshInterval);

    console.log(`[AutoRefresh] Periodic refresh every ${refreshInterval / 1000}s`);

    return () => {
      if (periodicTimer.current) clearInterval(periodicTimer.current);
      console.log('[AutoRefresh] Periodic refresh stopped');
    };
  }, [enablePeriodicRefresh, refreshInterval]);

  // ─── Initial load ────────────────────────────────────────────────────────
  useEffect(() => {
    console.log('[AutoRefresh] Initial load');
    onRefreshRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    forceRefresh: () => onRefreshRef.current(),
    isTabHidden: () => document.hidden,
    getHiddenDuration: () => hiddenAt.current ? Date.now() - hiddenAt.current : 0,
  };
}