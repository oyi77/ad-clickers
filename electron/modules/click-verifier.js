const { delay } = require('../modules/utils');
const automation = require('../automation');
const { logger } = require('../logger');
const { getStopState } = require('../state');

async function verifyClickSuccess(page, taskId) {
  try {
    if (getStopState()) {
      logger.info(`[Automation][Task ${taskId}] Stop requested during click verification`);
      return false;
    }

    // Get initial URL and page count
    const initialUrl = page.url();
    const initialPages = await page.browser().pages();
    const initialPageCount = initialPages.length;

    // Wait for potential navigation or new window
    await delay(2000);

    if (getStopState()) {
      logger.info(`[Automation][Task ${taskId}] Stop requested during click verification delay`);
      return false;
    }

    // Check for new tabs/windows
    const currentPages = await page.browser().pages();
    if (currentPages.length > initialPageCount) {
      logger.info(`[Automation][Task ${taskId}] Click successful - new window/tab detected`);
      return true;
    }

    // Check if URL changed
    try {
      const currentUrl = page.url();
      if (currentUrl !== initialUrl) {
        logger.info(`[Automation][Task ${taskId}] Click successful - URL changed from ${initialUrl} to ${currentUrl}`);
        return true;
      }
    } catch (urlError) {
      // If we can't get the URL, it likely means the page has navigated
      logger.info(`[Automation][Task ${taskId}] Click successful - page navigation detected (URL check failed)`);
      return true;
    }

    if (getStopState()) {
      logger.info(`[Automation][Task ${taskId}] Stop requested during click verification checks`);
      return false;
    }

    // Check if page was reloaded or navigation occurred
    try {
      const [pageReloaded, navigationOccurred] = await Promise.all([
        page.evaluate(() => {
          try {
            return performance.navigation.type === 1;
          } catch (e) {
            return false;
          }
        }).catch(() => false),
        page.evaluate(() => {
          try {
            return window.performance.getEntriesByType('navigation').some(nav => 
              nav.type === 'navigate' || nav.type === 'reload'
            );
          } catch (e) {
            return false;
          }
        }).catch(() => false)
      ]);

      if (pageReloaded) {
        logger.info(`[Automation][Task ${taskId}] Click successful - page was reloaded`);
        return true;
      }

      if (navigationOccurred) {
        logger.info(`[Automation][Task ${taskId}] Click successful - navigation event detected`);
        return true;
      }
    } catch (evalError) {
      // If evaluation fails, it might mean the page has navigated
      logger.info(`[Automation][Task ${taskId}] Click successful - page navigation detected (evaluation failed)`);
      return true;
    }

    if (getStopState()) {
      logger.info(`[Automation][Task ${taskId}] Stop requested during navigation checks`);
      return false;
    }

    // Additional check for navigation by waiting for network idle
    try {
      await page.waitForNavigation({ 
        waitUntil: 'networkidle0',
        timeout: 2000 
      }).catch(() => {});
      
      // If we get here and the URL is different, it means navigation occurred
      const finalUrl = page.url();
      if (finalUrl !== initialUrl) {
        logger.info(`[Automation][Task ${taskId}] Click successful - navigation completed to ${finalUrl}`);
        return true;
      }
    } catch (navError) {
      // If navigation check fails, it might still be a successful click
      logger.info(`[Automation][Task ${taskId}] Click verification inconclusive - navigation check failed`);
    }

    logger.info(`[Automation][Task ${taskId}] Click verification failed - no navigation or new window detected`);
    return false;
  } catch (error) {
    logger.error(`[Automation][Task ${taskId}] Error in verifyClickSuccess:`, error);
    return false;
  }
}

module.exports = {
  verifyClickSuccess
}; 