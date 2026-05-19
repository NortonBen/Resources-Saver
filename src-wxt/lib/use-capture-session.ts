import { useCallback, useEffect, useState } from 'react';
import {
  CAPTURE_MESSAGE,
  type CaptureSession,
  type CaptureTaskKind,
  type CapturedResource,
} from './capture-messages';

type ActiveTabInfo = {
  tabId: number | null;
  url: string;
  title: string;
  restricted: boolean;
};

function sendMessage<T>(payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response as T);
    });
  });
}

export function useCaptureSession() {
  const [activeTab, setActiveTab] = useState<ActiveTabInfo>({
    tabId: null,
    url: '',
    title: '',
    restricted: false,
  });
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshActiveTab = useCallback(async () => {
    const info = await sendMessage<ActiveTabInfo>({ type: CAPTURE_MESSAGE.GET_ACTIVE_TAB });
    setActiveTab(info);
    return info;
  }, []);

  const refreshSession = useCallback(async () => {
    const { session: next } = await sendMessage<{ session: CaptureSession | null }>({
      type: CAPTURE_MESSAGE.GET_SESSION,
    });
    setSession(next);
    return next;
  }, []);

  const syncFromBackground = useCallback(async () => {
    await Promise.all([refreshActiveTab(), refreshSession()]);
  }, [refreshActiveTab, refreshSession]);

  useEffect(() => {
    void (async () => {
      const tab = await refreshActiveTab();
      const { session: existing } = await sendMessage<{ session: CaptureSession | null }>({
        type: CAPTURE_MESSAGE.GET_SESSION,
      });
      if (!existing && tab.tabId && !tab.restricted) {
        try {
          const { session: pinned } = await sendMessage<{ session: CaptureSession }>({
            type: CAPTURE_MESSAGE.PIN_TAB,
            tabId: tab.tabId,
          });
          setSession(pinned);
        } catch {
          /* ignore */
        }
      } else {
        setSession(existing);
      }
    })();

    const onMessage = (message: { type?: string; session?: CaptureSession }) => {
      if (message.type === CAPTURE_MESSAGE.RESOURCES_UPDATED && message.session) {
        setSession(message.session);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);

    const onTabChange = () => void syncFromBackground();
    chrome.tabs.onActivated.addListener(onTabChange);
    chrome.tabs.onUpdated.addListener((_id, info) => {
      if (info.url || info.title || info.status === 'complete') {
        void syncFromBackground();
      }
    });

    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onActivated.removeListener(onTabChange);
    };
  }, [syncFromBackground]);

  const startTask = useCallback(
    async (task: CaptureTaskKind, tabId?: number) => {
      setLoading(true);
      try {
        const { session: next } = await sendMessage<{ session: CaptureSession }>({
          type: CAPTURE_MESSAGE.START_TASK,
          task,
          tabId,
        });
        setSession(next);
        return next;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const stopTask = useCallback(async () => {
    const { session: next } = await sendMessage<{ session: CaptureSession | null }>({
      type: CAPTURE_MESSAGE.STOP_TASK,
    });
    setSession(next);
    return next;
  }, []);

  const runDomScan = useCallback(async (tabId?: number) => {
    setLoading(true);
    try {
      const { session: next, count } = await sendMessage<{
        session: CaptureSession;
        count: number;
      }>({
        type: CAPTURE_MESSAGE.RUN_DOM_SCAN,
        tabId,
      });
      setSession(next);
      return count;
    } finally {
      setLoading(false);
    }
  }, []);

  const targetTabId = session?.tabId ?? activeTab.tabId;
  const targetUrl = session?.tabUrl || activeTab.url;
  const targetTitle = session?.tabTitle || activeTab.title;
  const isMonitoring = Boolean(session?.active && session.task === 'network-live');
  const resources: CapturedResource[] = session?.resources ?? [];

  const useCurrentTabAsTarget = useCallback(async () => {
    if (session?.active) await stopTask();
    const { session: next } = await sendMessage<{ session: CaptureSession }>({
      type: CAPTURE_MESSAGE.PIN_TAB,
    });
    setSession(next);
    await refreshActiveTab();
    return next;
  }, [session?.active, stopTask, refreshActiveTab]);

  return {
    activeTab,
    session,
    loading,
    targetTabId,
    targetUrl,
    targetTitle,
    isMonitoring,
    resources,
    startTask,
    stopTask,
    runDomScan,
    syncFromBackground,
    useCurrentTabAsTarget,
  };
}
