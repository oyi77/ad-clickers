const { validateCustomSelectors, getDefaultAdSelectors } = require('./ad-detector');
const { detectSelectorType, evaluateSelector, waitForSelector } = require('./utils');
const { handleIframeClick } = require('./click-handler');
const { delay, getRandomInt } = require('../modules/utils');
const { verifyClickSuccess } = require('./click-verifier');
const { logger } = require('../logger');
const { getStopState } = require('../state');

// Helper function to get delay time based on settings
function getDelayTime(setting, defaultMin, defaultMax) {
  if (setting === 0) {
    return Math.floor(Math.random() * (defaultMax - defaultMin + 1)) + defaultMin;
  }
  return setting * 1000; // Convert seconds to milliseconds
}

async function findAndClickAdElements(page, customSelectors = [], taskId, delays = {}, logToUI) {
  const maxAttempts = 3;
  let attempt = 1;

  try {
    if (getStopState()) {
      logger.info(`[Automation][Task ${taskId}] Stop requested during ad search`);
      return false;
    }

    while (attempt <= maxAttempts && !getStopState()) {
      logToUI(`[Automation] [Task ${taskId}] Attempt ${attempt}/${maxAttempts} to find ad elements...`);

      // Default ad selectors
      const selectors = [
        // CSS Selectors
        { type: 'css', selector: 'iframe[srcdoc=""]' },
        // XPath Selectors for iframes
        { type: 'xpath', selector: '//iframe[5]' },
        { type: 'xpath', selector: '/html/iframe[5]' },
        { type: 'xpath', selector: '//iframe[4]' },
        { type: 'xpath', selector: '/html/iframe[4]' },
        { type: 'xpath', selector: '//iframe[3]' },
        { type: 'xpath', selector: '/html/iframe[3]' },
        { type: 'xpath', selector: '//iframe[2]' },
        { type: 'xpath', selector: '/html/iframe[2]' },
        { type: 'xpath', selector: '//iframe[1]' },
        { type: 'xpath', selector: '/html/iframe[1]' },
        // XPath Selectors for ad-related iframes
        { type: 'xpath', selector: '//iframe[contains(@src, "ad")]' },
        { type: 'xpath', selector: '//iframe[contains(@src, "banner")]' },
        { type: 'xpath', selector: '//iframe[contains(@src, "sponsor")]' },
        { type: 'xpath', selector: '//iframe[contains(@src, "promo")]' },
        { type: 'xpath', selector: '//iframe[contains(@src, "marketing")]' },
        { type: 'xpath', selector: '//iframe[contains(@src, "advert")]' },
        { type: 'xpath', selector: '//iframe[contains(@src, "affiliate")]' },
        { type: 'xpath', selector: '//iframe[contains(@src, "partner")]' },
        { type: 'xpath', selector: '//iframe[contains(@src, "track")]' },
        { type: 'xpath', selector: '//iframe[contains(@src, "click")]' },
        // CSS Selectors for ad-related links
        { type: 'css', selector: 'a[href*="ad"]' },
        { type: 'css', selector: 'a[href*="sponsor"]' },
        { type: 'css', selector: 'a[href*="promo"]' },
        { type: 'css', selector: 'a[href*="click"]' },
        { type: 'css', selector: 'a[href*="track"]' },
        { type: 'css', selector: 'a[href*="affiliate"]' },
        { type: 'css', selector: 'a[href*="partner"]' },
        { type: 'css', selector: 'a[href*="banner"]' },
        { type: 'css', selector: 'a[href*="advert"]' },
        { type: 'css', selector: 'a[href*="marketing"]' },
        // CSS Selectors for ad-related iframes
        { type: 'css', selector: 'iframe[src*="ad"]' },
        { type: 'css', selector: 'iframe[src*="banner"]' },
        { type: 'css', selector: 'iframe[src*="sponsor"]' },
        { type: 'css', selector: 'iframe[src*="promo"]' },
        { type: 'css', selector: 'iframe[src*="marketing"]' },
        { type: 'css', selector: 'iframe[src*="advert"]' },
        { type: 'css', selector: 'iframe[src*="affiliate"]' },
        { type: 'css', selector: 'iframe[src*="partner"]' },
        { type: 'css', selector: 'iframe[src*="track"]' },
        { type: 'css', selector: 'iframe[src*="click"]' },
        // Additional CSS Selectors
        { type: 'css', selector: 'iframe[srcdoc=""]' },
        { type: 'css', selector: '[data-ad-detected="true"]' },
        // Class-based CSS Selectors for iframes
        { type: 'css', selector: 'iframe[class*="ad"]' },
        { type: 'css', selector: 'iframe[class*="banner"]' },
        { type: 'css', selector: 'iframe[class*="sponsor"]' },
        { type: 'css', selector: 'iframe[class*="promo"]' },
        { type: 'css', selector: 'iframe[class*="marketing"]' },
        { type: 'css', selector: 'iframe[class*="advert"]' },
        { type: 'css', selector: 'iframe[class*="affiliate"]' },
        { type: 'css', selector: 'iframe[class*="partner"]' },
        { type: 'css', selector: 'iframe[class*="track"]' },
        { type: 'css', selector: 'iframe[class*="click"]' },
        { type: 'css', selector: 'iframe[class*="right"][class*="top"]' },
        ...customSelectors
      ];

      // Try each selector
      for (const { type, selector } of selectors) {
        if (getStopState()) {
          logger.info(`[Automation][Task ${taskId}] Stop requested during ad element search`);
          return false;
        }

        // logToUI(`[Automation] [Task ${taskId}] Processing ${type.toUpperCase()} selector: ${selector}`);
        
        try {
          let elements;
          if (type === 'xpath') {
            elements = await page.$x(selector);
          } else {
            elements = await page.$$(selector);
          }

          if (elements.length > 0) {
            // Randomly select one element
            const element = elements[Math.floor(Math.random() * elements.length)];
            
            // Check if element is visible
            const isVisible = await element.isVisible().catch(() => false);
            if (!isVisible) continue;

            // Try to click the element
            try {
              if (getStopState()) {
                logger.info(`[Automation][Task ${taskId}] Stop requested before clicking ad element`);
                return false;
              }

              await element.click({ delay: Math.random() * 100 + 50 });
              logger.info(`[Automation][Task ${taskId}] Successfully clicked ad element: ${selector}`);
              
              // Add delay after click
              const clickDelay = delays.click === 0 ? 
                Math.floor(Math.random() * 2000) + 1000 : // Random 1-3 seconds
                delays.click * 1000;
              
              if (!getStopState()) {
                await delay(clickDelay);
              }
              
              return true;
            } catch (clickError) {
              logger.warn(`[Automation][Task ${taskId}] Failed to click element: ${clickError.message}`);
            }
          }
        } catch (error) {
          if (getStopState()) {
            logger.info(`[Automation][Task ${taskId}] Stop requested during error handling`);
            return false;
          }
          logger.warn(`[Automation][Task ${taskId}] Error processing selector ${selector}: ${error.message}`);
        }
      }

      if (getStopState()) {
        logger.info(`[Automation][Task ${taskId}] Stop requested after processing all selectors`);
        return false;
      }

      logToUI(`[Automation] [Task ${taskId}] No ad elements found, retrying in 5 seconds...`);
      await delay(5000);
      attempt++;
    }

    return false;
  } catch (error) {
    logger.error(`[Automation][Task ${taskId}] Error in findAndClickAdElements:`, error);
    return false;
  }
}

module.exports = {
  findAndClickAdElements
}; 