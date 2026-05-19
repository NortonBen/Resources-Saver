import { logger } from './logger';

export function sanitizePath(path: string): string {
  if (!path || typeof path !== 'string') {
    return 'unknown';
  }

  const segments = path
    .replace(/[<>:"|?*\x00-\x1f]/g, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .split('/')
    .map((segment) =>
      segment.replace(/^[\s\.]+|[\s\.]+$/g, '').substring(0, 200) || 'unknown'
    )
    .filter(Boolean);

  return segments.join('/') || 'unknown';
}

export function cleanUrlForComparison(url: string): string {
  return url.replace(/\//g, '').replace(/#.*/, '');
}

export interface ResolvedPath {
  path: string;
  name: string;
  dataURI: string | false;
  extension: string | null;
}

const KNOWN_EXTENSIONS = new Set([
  'json', 'js', 'mjs', 'cjs', 'css', 'html', 'htm', 'map',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp4', 'webm', 'ogg', 'mp3', 'wav', 'wasm',
  'txt', 'xml', 'pdf', 'zip', 'bin', 'atlas', 'plist',
]);

/** Known extension from URL path (e.g. `a.b.json` → `json`, not `b`). */
export function getKnownUrlExtension(url: string): string | null {
  try {
    const withoutQuery = url.split('?')[0].split('#')[0];
    const segment = withoutQuery.substring(withoutQuery.lastIndexOf('/') + 1);
    const match = segment.match(/\.([a-z0-9]+)$/i);
    if (!match) return null;
    const ext = match[1].toLowerCase();
    return KNOWN_EXTENSIONS.has(ext) ? ext : null;
  } catch {
    return null;
  }
}

export function extensionFromMimeType(cType?: string): string | null {
  if (!cType) return null;
  const t = cType.toLowerCase();
  if (t.includes('json')) return 'json';
  if (t.includes('javascript') || t === 'script') return 'js';
  if (t.includes('css') || t.includes('stylesheet')) return 'css';
  if (t.includes('html')) return 'html';
  if (t.includes('wasm')) return 'wasm';
  if (t.includes('svg')) return 'svg';
  if (t.includes('png')) return 'png';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('gif')) return 'gif';
  if (t.includes('webp')) return 'webp';
  if (t.includes('woff2')) return 'woff2';
  if (t.includes('woff')) return 'woff';
  if (t.includes('ttf')) return 'ttf';
  if (t.includes('mp4')) return 'mp4';
  if (t.includes('webm')) return 'webm';
  if (t.includes('mp3')) return 'mp3';
  if (t.includes('pdf')) return 'pdf';
  if (t.includes('xml')) return 'xml';
  if (t.includes('plain')) return 'txt';
  return null;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  json: 'application/json',
  js: 'application/javascript',
  mjs: 'application/javascript',
  cjs: 'application/javascript',
  css: 'text/css',
  html: 'text/html',
  htm: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  wasm: 'application/wasm',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
};

export function mimeTypeForDownload(url: string, cType?: string): string {
  const ext = getKnownUrlExtension(url) || extensionFromMimeType(cType);
  if (ext && MIME_BY_EXTENSION[ext]) return MIME_BY_EXTENSION[ext];
  if (cType && cType.includes('/')) return cType;
  return 'application/octet-stream';
}

function ensureFileExtension(filename: string, extension: string): string {
  const base = filename.split(';')[0];
  const match = base.match(/\.([a-z0-9]+)$/i);
  if (match && KNOWN_EXTENSIONS.has(match[1].toLowerCase())) {
    if (match[1].toLowerCase() === extension) return base;
    return base.replace(/\.[a-z0-9]+$/i, `.${extension}`);
  }
  return `${base}.${extension}`;
}

export function resolveURLToPath(cUrl: string, cType?: string, cContent?: string): ResolvedPath {
  let filepath: string;
  let filename: string;
  let isDataURI: string | false = false;

  const foundIndex = cUrl.search(/\:\/\//);
  
  // Check if it's a data URI or similar
  if (foundIndex === -1 || foundIndex >= 10) {
    isDataURI = cUrl;
    logger.debug('Data URI Detected!!!!!');

    if (cUrl.indexOf('data:') === 0) {
      const dataURIInfo = cUrl.split(';')[0].split(',')[0].substring(0, 30).replace(/[^A-Za-z0-9]/g, '.');
      filename = `${dataURIInfo}.${Math.random().toString(16).substring(2)}.txt`;
    } else {
      filename = `data.${Math.random().toString(16).substring(2)}.txt`;
    }

    filepath = `_DataURI/${filename}`;
  } else {
    if (cUrl.split('://')[0].includes('http')) {
      // For http:// https://
      filepath = cUrl.split('://')[1].split('?')[0];
    } else {
      // For webpack:// ng:// ftp://
      filepath = cUrl.replace('://', '---').split('?')[0];
    }
    
    if (filepath.charAt(filepath.length - 1) === '/') {
      filepath = filepath + 'index.html';
    }
    filename = filepath.substring(filepath.lastIndexOf('/') + 1);
  }

  // Get Rid of QueryString after ;
  filename = filename.split(';')[0];
  filepath = filepath.substring(0, filepath.lastIndexOf('/') + 1) + filename;

  const urlExt = getKnownUrlExtension(cUrl);
  const mimeExt = extensionFromMimeType(cType);
  let resolvedExt = urlExt || mimeExt;

  if (!resolvedExt && cType && cContent && cType.indexOf('image') !== -1) {
    if (cContent.charAt(0) === '/') resolvedExt = 'jpg';
    else if (cContent.charAt(0) === 'R') resolvedExt = 'gif';
    else if (cContent.charAt(0) === 'i') resolvedExt = 'png';
  }

  if (resolvedExt) {
    filename = ensureFileExtension(filename, resolvedExt);
    filepath = filepath.substring(0, filepath.lastIndexOf('/') + 1) + filename;
    if (!urlExt) {
      logger.debug('Extension inferred from type:', resolvedExt, filename);
    }
  } else if (!filename.includes('.')) {
    const fallback = 'html';
    filename = `${filename}.${fallback}`;
    filepath = `${filepath}.${fallback}`;
    resolvedExt = fallback;
    logger.debug('File without extension, default:', filename);
  } else {
    const match = filename.match(/\.([a-z0-9]+)$/i);
    resolvedExt = match ? match[1].toLowerCase() : null;
  }

  // Remove path violation cases
  filepath = sanitizePath(filepath);
  filename = sanitizePath(filename);

  // Decode URI
  if (filepath.indexOf('%') !== -1) {
    try {
      filepath = decodeURIComponent(filepath);
      filename = decodeURIComponent(filename);
    } catch (err) {
      logger.error('Error decoding URI component:', err);
    }
  }

  // Strip double slashes
  while (filepath.includes('//')) {
    filepath = filepath.replace('//', '/');
  }

  // Strip the first slash
  if (filepath.charAt(0) === '/') {
    filepath = filepath.slice(1);
  }

  return {
    path: filepath,
    name: filename,
    dataURI: isDataURI,
    extension: resolvedExt || getKnownUrlExtension(cUrl) || extensionFromMimeType(cType),
  };
}
