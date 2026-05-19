import { logger } from './logger';

export type ResourceBytes = {
  data: Uint8Array;
};

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function decodeDevToolsContent(content: string, encoding: string): Uint8Array {
  if (encoding === 'base64') {
    return base64ToUint8Array(content);
  }
  return new TextEncoder().encode(content);
}

export function getContentWithTimeout(
  handler: (cb: (content: string, encoding: string) => void) => void,
  timeoutMs = 8000
): Promise<{ content: string; encoding: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { content: string; encoding: string } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      handler((content, encoding) => {
        finish(content ? { content, encoding } : null);
      });
    } catch {
      finish(null);
    }
  });
}

/** Extension fetch (bypasses page CORS when host_permissions match). */
export async function fetchResourceBytes(url: string): Promise<ResourceBytes | null> {
  try {
    const response = await fetch(url, { credentials: 'include', cache: 'force-cache' });
    if (!response.ok) {
      logger.debug('fetchResourceBytes HTTP error', url, response.status);
      return null;
    }
    const buffer = await response.arrayBuffer();
    return { data: new Uint8Array(buffer) };
  } catch (e) {
    logger.debug('fetchResourceBytes failed', url, e);
    return null;
  }
}

/** DevTools getContent first, then network fetch fallback. */
export async function loadResourceBytes(
  url: string,
  handler?: (cb: (content: string, encoding: string) => void) => void
): Promise<ResourceBytes | null> {
  if (handler) {
    const fromDevTools = await getContentWithTimeout(handler);
    if (fromDevTools?.content) {
      return { data: decodeDevToolsContent(fromDevTools.content, fromDevTools.encoding) };
    }
  }
  return fetchResourceBytes(url);
}

/** Avoid ZIP / disk overwrites when paths collide after sanitization. */
export function uniquifyPath(path: string, used: Set<string>): string {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }

  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = file.lastIndexOf('.');
  const base = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : '';

  let i = 1;
  let candidate = `${dir}${base}_${i}${ext}`;
  while (used.has(candidate)) {
    i++;
    candidate = `${dir}${base}_${i}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

export function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: objectUrl,
        filename,
        conflictAction: 'overwrite',
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          URL.revokeObjectURL(objectUrl);
          reject(chrome.runtime.lastError ?? new Error('Download failed to start'));
          return;
        }

        const onChanged = (delta: chrome.downloads.DownloadDelta) => {
          if (delta.id !== downloadId) return;

          if (delta.state?.current === 'complete') {
            chrome.downloads.onChanged.removeListener(onChanged);
            URL.revokeObjectURL(objectUrl);
            resolve();
          } else if (delta.error?.current) {
            chrome.downloads.onChanged.removeListener(onChanged);
            URL.revokeObjectURL(objectUrl);
            reject(new Error(delta.error.current));
          }
        };

        chrome.downloads.onChanged.addListener(onChanged);
      }
    );
  });
}

/** Fetch with the inspected page's cookies (for authenticated / same-site assets). */
export async function fetchResourceBytesInTab(
  tabId: number,
  url: string
): Promise<ResourceBytes | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (targetUrl: string) => {
        try {
          const response = await fetch(targetUrl, { credentials: 'include', cache: 'force-cache' });
          if (!response.ok) return null;
          return Array.from(new Uint8Array(await response.arrayBuffer()));
        } catch {
          return null;
        }
      },
      args: [url],
    });
    const bytes = results?.[0]?.result;
    if (!bytes || !Array.isArray(bytes)) return null;
    return { data: new Uint8Array(bytes) };
  } catch (e) {
    logger.debug('fetchResourceBytesInTab failed', url, e);
    return null;
  }
}

export async function loadResourceBytesForTab(
  tabId: number,
  url: string
): Promise<ResourceBytes | null> {
  const fromTab = await fetchResourceBytesInTab(tabId, url);
  if (fromTab) return fromTab;
  return fetchResourceBytes(url);
}

export function downloadUrl(url: string, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        conflictAction: 'overwrite',
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          reject(chrome.runtime.lastError ?? new Error('Download failed to start'));
          return;
        }

        const onChanged = (delta: chrome.downloads.DownloadDelta) => {
          if (delta.id !== downloadId) return;
          if (delta.state?.current === 'complete') {
            chrome.downloads.onChanged.removeListener(onChanged);
            resolve();
          } else if (delta.error?.current) {
            chrome.downloads.onChanged.removeListener(onChanged);
            reject(new Error(delta.error.current));
          }
        };

        chrome.downloads.onChanged.addListener(onChanged);
      }
    );
  });
}
