import { logger } from './logger';

export function sanitizePath(path: string): string {
  if (!path || typeof path !== 'string') {
    return 'unknown';
  }

  return path
    // Remove invalid characters
    .replace(/[<>:"|?*\x00-\x1f]/g, '')
    // Normalize path separators
    .replace(/\\/g, '/')
    // Remove consecutive slashes
    .replace(/\/+/g, '/')
    // Remove leading/trailing spaces and dots
    .replace(/^[\s\.]+|[\s\.]+$/g, '')
    // Limit path length
    .substring(0, 255)
    // Ensure it's not empty
    || 'unknown';
}

export function cleanUrlForComparison(url: string): string {
  return url.replace(/\//g, '').replace(/#.*/, '');
}

export interface ResolvedPath {
  path: string;
  name: string;
  dataURI: string | false;
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

  // Add default extension to non extension filename
  if (filename.search(/\./) === -1) {
    let haveExtension: string | null = null;
    if (cType && cContent) {
      // Special Case for Images with Base64
      if (cType.indexOf('image') !== -1) {
        if (cContent.charAt(0) === '/') haveExtension = 'jpg';
        else if (cContent.charAt(0) === 'R') haveExtension = 'gif';
        else if (cContent.charAt(0) === 'i') haveExtension = 'png';
      }
      
      if (!haveExtension) {
        if (cType.indexOf('stylesheet') !== -1 || cType.indexOf('css') !== -1) haveExtension = 'css';
        else if (cType.indexOf('json') !== -1) haveExtension = 'json';
        else if (cType.indexOf('javascript') !== -1) haveExtension = 'js';
        else if (cType.indexOf('html') !== -1) haveExtension = 'html';
      }

      if (!haveExtension) haveExtension = 'html';
    } else {
      haveExtension = 'html';
    }
    
    filepath = `${filepath}.${haveExtension}`;
    filename = `${filename}.${haveExtension}`;
    logger.debug('File without extension updated: ', filename, filepath);
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
  };
}
