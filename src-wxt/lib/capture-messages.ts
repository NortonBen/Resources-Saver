export type CaptureTaskKind = 'dom-scan' | 'network-live';

export type CapturedResource = {
  url: string;
  type: string;
  size: number;
  status: 'pending' | 'success' | 'failed';
  origin: 'static' | 'network';
};

export type CaptureSession = {
  tabId: number;
  tabUrl: string;
  tabTitle: string;
  task: CaptureTaskKind;
  active: boolean;
  resources: CapturedResource[];
};

export const CAPTURE_MESSAGE = {
  GET_ACTIVE_TAB: 'CAPTURE_GET_ACTIVE_TAB',
  GET_SESSION: 'CAPTURE_GET_SESSION',
  START_TASK: 'CAPTURE_START_TASK',
  STOP_TASK: 'CAPTURE_STOP_TASK',
  RUN_DOM_SCAN: 'CAPTURE_RUN_DOM_SCAN',
  PIN_TAB: 'CAPTURE_PIN_TAB',
  RESOURCES_UPDATED: 'CAPTURE_RESOURCES_UPDATED',
} as const;

export type CaptureMessageType = (typeof CAPTURE_MESSAGE)[keyof typeof CAPTURE_MESSAGE];

export function guessResourceType(url: string, mimeType?: string): string {
  if (mimeType) {
    const m = mimeType.toLowerCase();
    if (m.includes('image')) return 'image';
    if (m.includes('javascript')) return 'script';
    if (m.includes('css')) return 'stylesheet';
    if (m.includes('json')) return 'json';
    if (m.includes('font')) return 'font';
    if (m.includes('video')) return 'media';
    if (m.includes('audio')) return 'media';
    if (m.includes('wasm')) return 'wasm';
  }
  if (/\.(png|jpe?g|gif|svg|webp|avif|ico)$/i.test(url)) return 'image';
  if (/\.js(\?|$)/i.test(url)) return 'script';
  if (/\.css(\?|$)/i.test(url)) return 'stylesheet';
  if (/\.(woff2?|ttf|otf|eot)$/i.test(url)) return 'font';
  if (/\.(mp4|webm|ogg)$/i.test(url)) return 'media';
  if (/\.json(\?|$)/i.test(url)) return 'json';
  return 'file';
}

export function isRestrictedTabUrl(url?: string): boolean {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://')
  );
}
