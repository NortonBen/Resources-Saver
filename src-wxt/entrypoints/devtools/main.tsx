import { logger } from '../../lib/logger';

// Create the DevTools panel
chrome.devtools.panels.create(
  'Resources Saver',
  'icons/icon32.png',
  'panel.html',
  (panel) => {
    logger.info('DevTools panel created');
  }
);
