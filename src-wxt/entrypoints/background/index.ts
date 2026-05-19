import { logger } from '../../lib/logger';
import {
  CAPTURE_MESSAGE,
  type CaptureSession,
  type CaptureTaskKind,
  type CapturedResource,
  guessResourceType,
  isRestrictedTabUrl,
} from '../../lib/capture-messages';
let session: CaptureSession | null = null;

function notifyResourcesUpdated() {
  if (!session) return;
  chrome.runtime
    .sendMessage({
      type: CAPTURE_MESSAGE.RESOURCES_UPDATED,
      session: { ...session, resources: [...session.resources] },
    })
    .catch(() => {
      /* side panel may be closed */
    });
}

function upsertNetworkResource(
  url: string,
  mimeType: string | undefined,
  size: number
) {
  if (!session?.active || session.task !== 'network-live') return;
  if (
    url.startsWith('chrome-extension://') ||
    url.startsWith('data:') ||
    url.startsWith('blob:')
  ) {
    return;
  }

  const existing = session.resources.find((r) => r.url === url);
  if (existing) {
    if (size > 0) existing.size = size;
    existing.status = 'success';
    existing.origin = 'network';
    notifyResourcesUpdated();
    return;
  }

  session.resources.push({
    url,
    type: guessResourceType(url, mimeType),
    size,
    status: 'success',
    origin: 'network',
  });
  notifyResourcesUpdated();
}

function mergeDomResources(items: { url: string; type: string }[]) {
  if (!session) return;

  for (const item of items) {
    const existing = session.resources.find((r) => r.url === item.url);
    if (existing) {
      if (existing.origin !== 'network') existing.type = item.type;
      continue;
    }
    session.resources.push({
      url: item.url,
      type: item.type,
      size: 0,
      status: 'pending',
      origin: 'static',
    });
  }
  notifyResourcesUpdated();
}

async function syncTabMeta(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  if (!session || session.tabId !== tabId) return;
  session.tabUrl = tab.url ?? session.tabUrl;
  session.tabTitle = tab.title ?? session.tabTitle;
}

async function runDomScan(tabId: number): Promise<number> {
  if (isRestrictedTabUrl((await chrome.tabs.get(tabId)).url)) {
    return 0;
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const res: { url: string; type: string }[] = [];
      const collect = (url: string, type: string) => {
        if (
          url &&
          !url.startsWith('data:') &&
          !url.startsWith('blob:') &&
          !url.startsWith('chrome-extension://')
        ) {
          try {
            res.push({ url: new URL(url, document.baseURI).href, type });
          } catch {
            /* ignore */
          }
        }
      };
      document.querySelectorAll('img').forEach((img) => collect(img.src, 'image'));
      document.querySelectorAll('script').forEach((s) => s.src && collect(s.src, 'script'));
      document.querySelectorAll('link[rel="stylesheet"]').forEach((l) =>
        collect((l as HTMLLinkElement).href, 'stylesheet')
      );
      document.querySelectorAll('link[rel*="icon"]').forEach((l) =>
        collect((l as HTMLLinkElement).href, 'image')
      );
      document.querySelectorAll('video, audio, source').forEach((m) => {
        const el = m as HTMLMediaElement | HTMLSourceElement;
        collect(el.src || (el as HTMLSourceElement).srcset || '', 'media');
      });
      return res;
    },
  });

  const discovered = (results?.[0]?.result ?? []) as { url: string; type: string }[];
  mergeDomResources(discovered);
  return discovered.length;
}

async function startTask(tabId: number, task: CaptureTaskKind) {
  const tab = await chrome.tabs.get(tabId);
  if (isRestrictedTabUrl(tab.url)) {
    throw new Error('Cannot monitor this page (browser internal URL)');
  }

  const sameTab = session?.tabId === tabId;
  session = {
    tabId,
    tabUrl: tab.url ?? '',
    tabTitle: tab.title ?? '',
    task,
    active: true,
    resources: sameTab ? session!.resources : [],
  };

  if (task === 'dom-scan') {
    await runDomScan(tabId);
    session.active = false;
    notifyResourcesUpdated();
    return;
  }

  await runDomScan(tabId);
  notifyResourcesUpdated();
}

function stopTask() {
  if (!session) return;
  session.active = false;
  notifyResourcesUpdated();
}

export default defineBackground(() => {
  logger.info('Background script initialized');

  chrome.runtime.onInstalled.addListener(() => {
    logger.info('Resources Saver extension installed');

    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => logger.error('Error setting side panel behavior:', error));
  });

  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (!session?.active || session.task !== 'network-live') return;
      if (details.tabId !== session.tabId) return;
      if (details.type === 'main_frame') return;

      const mimeType = details.responseHeaders?.find(
        (h) => h.name.toLowerCase() === 'content-type'
      )?.value;

      upsertNetworkResource(details.url, mimeType, 0);
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!session || tabId !== session.tabId) return;
    if (changeInfo.url) session.tabUrl = changeInfo.url;
    if (changeInfo.title) session.tabTitle = changeInfo.title;
    if (changeInfo.status === 'complete' && session.active && session.task === 'network-live') {
      void runDomScan(tabId);
    }
    notifyResourcesUpdated();
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (session?.tabId === tabId) {
      session = null;
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handle = async () => {
      switch (message.type) {
        case CAPTURE_MESSAGE.GET_ACTIVE_TAB: {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          return {
            tabId: tab?.id ?? null,
            url: tab?.url ?? '',
            title: tab?.title ?? '',
            restricted: isRestrictedTabUrl(tab?.url),
          };
        }

        case CAPTURE_MESSAGE.GET_SESSION: {
          if (session) await syncTabMeta(session.tabId);
          return { session: session ? { ...session, resources: [...session.resources] } : null };
        }

        case CAPTURE_MESSAGE.START_TASK: {
          const tabId = message.tabId as number | undefined;
          const task = message.task as CaptureTaskKind;
          let id = tabId;
          if (!id) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            id = tab?.id;
          }
          if (!id) throw new Error('No active tab');
          await startTask(id, task);
          return { session: session ? { ...session, resources: [...session.resources] } : null };
        }

        case CAPTURE_MESSAGE.STOP_TASK: {
          stopTask();
          return { session: session ? { ...session, resources: [...session.resources] } : null };
        }

        case CAPTURE_MESSAGE.RUN_DOM_SCAN: {
          const tabId = (message.tabId as number) ?? session?.tabId;
          if (!tabId) throw new Error('No tab to scan');
          const count = await runDomScan(tabId);
          if (session) await syncTabMeta(tabId);
          return {
            count,
            session: session ? { ...session, resources: [...session.resources] } : null,
          };
        }

        case CAPTURE_MESSAGE.PIN_TAB: {
          let tabId = message.tabId as number | undefined;
          if (!tabId) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            tabId = tab?.id;
          }
          if (!tabId) throw new Error('No active tab');
          const tab = await chrome.tabs.get(tabId);
          if (isRestrictedTabUrl(tab.url)) {
            throw new Error('Cannot monitor this page');
          }
          const keepResources = session?.tabId === tabId;
          session = {
            tabId,
            tabUrl: tab.url ?? '',
            tabTitle: tab.title ?? '',
            task: session?.task ?? 'dom-scan',
            active: false,
            resources: keepResources ? session!.resources : [],
          };
          notifyResourcesUpdated();
          return { session: { ...session, resources: [...session.resources] } };
        }

        case 'PING':
          return { status: 'PONG' };

        default:
          return undefined;
      }
    };

    void handle()
      .then(sendResponse)
      .catch((err: Error) => sendResponse({ error: err.message }));
    return true;
  });
});
