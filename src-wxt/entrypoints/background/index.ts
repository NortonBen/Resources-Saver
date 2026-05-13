import { logger } from '../../lib/logger';

export default defineBackground(() => {
  logger.info('Background script initialized');

  chrome.runtime.onInstalled.addListener(() => {
    logger.info('Resources Saver extension installed');
    
    // Set side panel behavior
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error) => logger.error('Error setting side panel behavior:', error));
  });

  // Handle messages if needed
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ status: 'PONG' });
    }
    return true;
  });
});
