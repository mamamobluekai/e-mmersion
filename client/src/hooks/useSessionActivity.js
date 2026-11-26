import { useEffect } from 'react';
import { API_BASE } from '../config/api';
import { authSessionId } from '../utils/authRefresh';

const activityEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
const activityInterval = 15_000;

export function useSessionActivity(sessionId) {
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    let timer;
    let nextActivity = 0;

    function schedule(delay) {
      if (controller.signal.aborted) return;
      clearTimeout(timer);
      timer = setTimeout(() => void check(), Math.max(1000, delay));
    }

    async function check(activity = false) {
      const token = localStorage.getItem('wim-token');
      if (authSessionId(token) !== sessionId) return;
      try {
        const response = await fetch(`${API_BASE}/users/session${activity ? '/activity' : ''}`, {
          method: activity ? 'POST' : 'GET',
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) return schedule(activityInterval);
        const { remainingMs } = await response.json();
        schedule(Number.isFinite(remainingMs) ? remainingMs : activityInterval);
      } catch {
        schedule(activityInterval);
      }
    }

    function recordActivity(event) {
      if (!event.isTrusted || document.visibilityState !== 'visible' || Date.now() < nextActivity) return;
      nextActivity = Date.now() + activityInterval;
      void check(true);
    }

    function validateVisibleSession() {
      if (document.visibilityState === 'visible') void check();
    }

    void check();
    for (const event of activityEvents) window.addEventListener(event, recordActivity, { passive: true });
    document.addEventListener('visibilitychange', validateVisibleSession);
    return () => {
      controller.abort();
      clearTimeout(timer);
      for (const event of activityEvents) window.removeEventListener(event, recordActivity);
      document.removeEventListener('visibilitychange', validateVisibleSession);
    };
  }, [sessionId]);
}
