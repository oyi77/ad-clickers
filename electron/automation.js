const axios = require('axios');
const fs = require('fs-extra');
const { proxyManager } = require('./proxy-manager.js');
const { 
  getFingerprintFromProvider, 
  getRandomFingerprint,
  detectFingerprintFormat 
} = require('./modules/fingerprint');
const { validateCustomSelectors, getDefaultAdSelectors, setupAdDetection } = require('./modules/ad-detector');
const { setStealthMode, launchBrowser, setupPage } = require('./modules/browser');
const { findAndClickAdElements } = require('./modules/ad-searcher');
const { getRandomInt, delay, shuffleArray } = require('./modules/utils');
const { logger } = require('./logger');

// Create a logging function that will be set by main process
let logToUI = (message) => {
  console.log('[Automation]', message);
};

function setLogger(logger) {
  logToUI = logger;
}

// Function to get delay time based on settings
function getDelayTime(setting, defaultMin, defaultMax) {
  if (setting === 0) {
    return Math.floor(Math.random() * (defaultMax - defaultMin + 1)) + defaultMin;
  }
  return setting * 1000; // Convert seconds to milliseconds
}

async function checkIPQuality(proxy) {
  try {
    const proxyUrl = await proxyManager.getProxyUrl(proxy);
    if (!proxyUrl) {
      logger.error('[Automation] Failed to get proxy URL for IP quality check');
      return false;
    }

    const resp = await axios.get(`https://ipinfo.io/json`, {
      proxy: {
        host: new URL(proxyUrl).hostname,
        port: parseInt(new URL(proxyUrl).port, 10),
        protocol: new URL(proxyUrl).protocol.replace(':', '')
      },
      timeout: 10000
    });

    if (resp && resp.data) {
      if (resp.data.org && /amazon|google|microsoft|ovh|digitalocean|cloud/.test(resp.data.org.toLowerCase())) {
        logger.info(`[Automation] IP detected as datacenter: ${resp.data.org}`);
        return false;
      }
      if (resp.data.bogon) {
        logger.info('[Automation] IP detected as bogon');
        return false;
      }
      return true;
    }
  } catch (e) {
    logger.error('[Automation] IP quality check failed:', e.message);
  }
  return false;
}

// Helper function to detect selector type
function detectSelectorType(selector) {
  if (selector.startsWith('/') || selector.startsWith('./') || selector.startsWith('//')) {
    return 'xpath';
  } else if (selector.startsWith('document.') || selector.includes('querySelector') || selector.includes('getElement')) {
    return 'js';
  } else {
    return 'css';
  }
}

// Helper function to evaluate selector
async function evaluateSelector(page, selector, type) {
  try {
    switch (type) {
      case 'xpath':
        return await page.$x(selector);
      case 'js':
        return await page.evaluateHandle(selector);
      case 'css':
      default:
        return await page.$$(selector);
    }
  } catch (e) {
    logger.error(`[Automation] Error evaluating ${type} selector:`, e);
    return [];
  }
}

// Helper function to wait for selector
async function waitForSelector(page, selector, type, timeout = 5000) {
  try {
    switch (type) {
      case 'xpath':
        await page.waitForXPath(selector, { timeout });
        break;
      case 'js':
        // For JS selectors, we'll evaluate them directly
        await page.evaluate(selector);
        break;
      case 'css':
      default:
        await page.waitForSelector(selector, { timeout });
        break;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Helper function to get random element to click
async function getRandomClickableElement(page) {
  const selectors = [
    'a', 'button', 'input[type="button"]', 'input[type="submit"]',
    'div[role="button"]', 'span[role="button"]',
    'header', 'nav', 'footer', 'main', 'article', 'section'
  ];
  
  // Try each selector until we find a clickable element
  for (const selector of selectors) {
    const elements = await page.$$(selector);
    if (elements.length > 0) {
      // Filter out elements that are not visible or are ads
      const visibleElements = [];
      for (const element of elements) {
        const isVisible = await element.isVisible();
        const isAd = await element.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && 
                 style.visibility !== 'hidden' && 
                 style.opacity !== '0' &&
                 !el.closest('[class*="ad"], [id*="ad"], [class*="sponsor"], [id*="sponsor"]');
        });
        if (isVisible && !isAd) {
          visibleElements.push(element);
        }
      }
      if (visibleElements.length > 0) {
        return visibleElements[Math.floor(Math.random() * visibleElements.length)];
      }
    }
  }
  return null;
}

// Helper function to perform random scrolling
async function performRandomScrolling(page, minDuration, maxDuration) {
  const duration = getRandomInt(minDuration, maxDuration) * 1000; // Convert to milliseconds
  const startTime = Date.now();
  
  while (Date.now() - startTime < duration) {
    const scrollAmount = getRandomInt(100, 500);
    await page.evaluate((amount) => {
      window.scrollBy(0, amount);
    }, scrollAmount);
    await delay(getRandomInt(100, 500));
  }
}

// Add a Map to track active browser instances
const activeBrowsers = new Map();

// Modify stopAutomation function
function stopAutomation() {
  isStopping = true;
  logger.info('[Automation] Stopping automation...');
  
  // Close all active browser instances
  for (const [taskId, browser] of activeBrowsers.entries()) {
    try {
      browser.close();
      logger.info(`[Automation][Task ${taskId}] Browser closed due to stop request`);
    } catch (e) {
      logger.error(`[Automation][Task ${taskId}] Error closing browser: ${e.message}`);
    }
  }
  
  // Clear the active browsers map
  activeBrowsers.clear();
}

// Add new function to verify click success
async function verifyClickSuccess(page, taskId, logToUI) {
  try {
    // Get initial URL
    const initialUrl = page.url();
    const initialPages = await page.browser().pages();
    const initialPageCount = initialPages.length;

    // Wait a short duration for any immediate DOM changes or events
    await delay(1000); // Wait for 1 second for initial reaction

    // Check for new tabs/windows first as it's a strong indicator
    const currentPages = await page.browser().pages();
    if (currentPages.length > initialPageCount) {
      logger.info(`[Automation][Task ${taskId}] Click successful - new window/tab detected (${currentPages.length} vs ${initialPageCount})`);
      return true;
    }

    // Check if URL changed
    const currentUrl = page.url();
    if (currentUrl !== initialUrl) {
      logger.info(`[Automation][Task ${taskId}] Click successful - URL changed from ${initialUrl} to ${currentUrl}`);
      return true;
    }

    // Check if page was reloaded (navigation type 1)
    // Note: This might not always be reliable for ad clicks opening overlays.
    const navigationEntries = await page.evaluate(() => {
      return window.performance.getEntriesByType('navigation');
    });
    
    if (navigationEntries.some(nav => nav.type === 'reload')) {
       logger.info(`[Automation][Task ${taskId}] Click successful - page was reloaded`);
       return true;
    }

    // Check for other types of navigation (like SPA route changes after click)
     if (navigationEntries.some(nav => nav.type === 'navigate' || nav.type === 'push' || nav.type === 'replace')) {
       // We already checked for full URL change, this might catch hash changes or pushState
       if (page.url() !== initialUrl) {
          logger.info(`[Automation][Task ${taskId}] Click successful - navigation event detected (SPA style)`);
          return true;
       }
     }

    // === Enhanced DOM-based checks ===

    // Define some common selectors for modals, popups, and new ad containers
    const potentialSuccessSelectors = [
      'div[id*="ad"] > iframe', // New ad iframe appearing
      'div[class*="ad"] > iframe', 
      'iframe[id*="ad"]', 
      'iframe[name*="ad"]',
      '.adsbygoogle',
      '.ad-container',
      '.ad-wrapper',
      '.modal-open', // Body class often added for modals
      '.mfp-wrap', // Magnific Popup
      '.lity',
      '[id*="fancybox"]',
      '[class*="lightbox"]',
      '[role="dialog"]',
      '[aria-modal="true"]',
      'body > .backdrop', // Common backdrop element for modals
      'body > .modal'
    ];

    logger.info(`[Automation][Task ${taskId}] Checking for appearance of potential success elements...`);
    let foundPotentialElement = false;
    for (const selector of potentialSuccessSelectors) {
        try {
            // Wait for the selector to appear with a small timeout
            const element = await page.waitForSelector(selector, { state: 'attached', timeout: 1000 });
            if (element) {
                const isVisible = await element.isVisible().catch(() => false); // Check visibility safely
                if (isVisible) {
                    logger.info(`[Automation][Task ${taskId}] Click successful - Found visible potential success element: ${selector}`);
                    foundPotentialElement = true;
                    break; // Exit loop once one element is found
                }
            }
        } catch (e) {
            // Selector not found within timeout, or other error. Ignore and try next.
        }
    }
    
    if (foundPotentialElement) {
        return true;
    }

    logger.info(`[Automation][Task ${taskId}] Click verification failed - no clear success indicators detected.`);
    return false;
  } catch (error) {
    logger.error(`[Automation][Task ${taskId}] Error during click verification: ${error.message}`, error);
    return false;
  }
}

// Modify handleIframeClick function to use verifyClickSuccess
async function handleIframeClick(page, element, taskId, logToUI) {
  try {
    // Get element position and dimensions
    const box = await element.boundingBox();
    if (!box) {
      logger.warn(`[Automation][Task ${taskId}] Could not get element bounding box`);
      return false;
    }

    // Calculate center point of the element
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Move mouse to element with human-like movement
    await page.mouse.move(centerX, centerY, { steps: 25 });
    await delay(Math.random() * 100 + 50);

    // Simulate mouse down
    await page.mouse.down();
    await delay(Math.random() * 50 + 25);

    // Simulate mouse up
    await page.mouse.up();
    await delay(Math.random() * 100 + 50);

    // Try clicking with mouse.click as fallback
    try {
      await page.mouse.click(centerX, centerY, {
        delay: Math.random() * 100 + 50,
        button: 'left',
        clickCount: 1
      });
    } catch (clickError) {
      logger.warn(`[Automation][Task ${taskId}] Mouse click failed: ${clickError.message}`);
    }

    // If it's an iframe, try to access its content
    if (element.tagName === 'IFRAME') {
      try {
        const frame = await element.contentFrame();
        if (frame) {
          // Get clickable elements inside iframe
          const clickableElements = await frame.$$('a, button, [role="button"], [onclick]');
          if (clickableElements.length > 0) {
            const randomElement = clickableElements[Math.floor(Math.random() * clickableElements.length)];
            const elementBox = await randomElement.boundingBox();
            
            if (elementBox) {
              // Move mouse to element inside iframe
              await frame.mouse.move(
                elementBox.x + elementBox.width / 2,
                elementBox.y + elementBox.height / 2,
                { steps: 25 }
              );
              await delay(Math.random() * 100 + 50);

              // Click inside iframe
              await frame.mouse.down();
              await delay(Math.random() * 50 + 25);
              await frame.mouse.up();
              await delay(Math.random() * 100 + 50);

              // Try direct click as fallback
              try {
                await frame.mouse.click(
                  elementBox.x + elementBox.width / 2,
                  elementBox.y + elementBox.height / 2,
                  {
                    delay: Math.random() * 100 + 50,
                    button: 'left',
                    clickCount: 1
                  }
                );
              } catch (frameClickError) {
                logger.warn(`[Automation][Task ${taskId}] Frame mouse click failed: ${frameClickError.message}`);
              }
            }
          }
        }
      } catch (frameError) {
        logger.error(`[Automation][Task ${taskId}] Error accessing iframe content: ${frameError.message}`, frameError);
      }
    }

    // Verify click success
    return await verifyClickSuccess(page, taskId, logToUI);

  } catch (error) {
    logger.error(`[Automation][Task ${taskId}] Error in handleIframeClick: ${error.message}`, error);
    return false;
  }
}

async function visitAndClick(url, proxy = null, customSelectors = [], taskId, options = {}) {
  const {
    delays = {},
    randomClicks = {},
    scrollDuration = {},
    providers = {},
    browser = 'chrome',
    stealth = true,
    headless = true,
    targetClicks = 0,
  } = options;

  let browserInstance = null;
  let retryCount = 0;
  const maxRetries = 3;
  let clicksMade = 0;

  // Check if we should stop
  if (isStopping) {
    logger.info(`[Automation][Task ${taskId}] Task cancelled due to stop request`);
    return false;
  }

  while (retryCount < maxRetries) {
    try {
      // Check if we should stop before each major operation
      if (isStopping) {
        logger.info(`[Automation][Task ${taskId}] Task cancelled due to stop request`);
        return false;
      }

      // Get fingerprint
      const fingerprint = await getFingerprintFromProvider(providers.fingerprint);
      const format = detectFingerprintFormat(fingerprint);
      logger.info(`[Automation][Task ${taskId}] Using ${format} fingerprint format`);

      // Launch browser with headless setting
      browserInstance = await launchBrowser(browser, proxy, headless);
      
      // Add browser to active browsers map
      activeBrowsers.set(taskId, browserInstance);
      
      logger.info(`[Automation][Task ${taskId}] Browser launched successfully in ${headless ? 'headless' : 'visible'} mode`);
      
      // Setup page
      const page = await browserInstance.newPage();
      await setupPage(page, fingerprint, proxy);
      logger.info(`[Automation][Task ${taskId}] Page setup completed`);

      // Visit deviceinfo.me first to check fingerprint and IP
      try {
        await page.goto('https://www.deviceinfo.me/', {
          waitUntil: 'networkidle0',
          timeout: 30000 // 30 seconds timeout
        });
        logger.info(`[Automation][Task ${taskId}] Visited deviceinfo.me successfully`);
      } catch (error) {
        logger.warn(`[Automation][Task ${taskId}] Failed to visit deviceinfo.me: ${error.message}`);
        // Optionally, decide whether to proceed or abort if deviceinfo.me fails
        // For now, we log and continue to the target URL
      }

      // Extract and log information from deviceinfo.me
      try {
        logger.info(`[Automation][Task ${taskId}] Extracting data from deviceinfo.me...`);
        
        // Wait for key elements to load, increasing timeout slightly
        await page.waitForSelector('#ip-address', { timeout: 15000 });
        await page.waitForSelector('#user-agent', { timeout: 15000 });
        await page.waitForSelector('#os', { timeout: 15000 });
        await page.waitForSelector('#browser', { timeout: 15000 });
        await page.waitForSelector('#country', { timeout: 15000 });
        await page.waitForSelector('#city', { timeout: 15000 });
        
        const ipAddress = await page.$eval('#ip-address', el => el.textContent.trim()).catch(() => 'N/A');
        const userAgent = await page.$eval('#user-agent', el => el.textContent.trim()).catch(() => 'N/A');
        const os = await page.$eval('#os', el => el.textContent.trim()).catch(() => 'N/A');
        const browserInfo = await page.$eval('#browser', el => el.textContent.trim()).catch(() => 'N/A');
        const country = await page.$eval('#country', el => el.textContent.trim()).catch(() => 'N/A');
        const city = await page.$eval('#city', el => el.textContent.trim()).catch(() => 'N/A');
        const timezone = await page.$eval('#system-time-zone', el => el.textContent.trim()).catch(() => 'N/A');
        const proxyDetected = await page.$eval('#proxy-ip-address', el => el.textContent.trim()).catch(() => 'N/A');
        const adBlockDetected = await page.$eval('#ad-blocker', el => el.textContent.trim()).catch(() => 'N/A');
        const canvasFingerprinting = await page.$eval('#canvas-fingerprinting', el => el.textContent.trim()).catch(() => 'N/A');
        const audioContextFingerprinting = await page.$eval('#audiocontext-fingerprinting', el => el.textContent.trim()).catch(() => 'N/A');
        
        logger.info(`[Automation][Task ${taskId}] deviceinfo.me data:\n`);
        logger.info(`  IP Address: ${ipAddress}`);
        logger.info(`  User Agent: ${userAgent}`);
        logger.info(`  OS: ${os}`);
        logger.info(`  Browser: ${browserInfo}`);
        logger.info(`  Location: ${city}, ${country}`);
        logger.info(`  Timezone: ${timezone}`);
        logger.info(`  Proxy Detected: ${proxyDetected}`);
        logger.info(`  Ad Blocker: ${adBlockDetected}`);
        logger.info(`  Canvas Fingerprinting: ${canvasFingerprinting}`);
        logger.info(`  AudioContext Fingerprinting: ${audioContextFingerprinting}`);
        
      } catch (dataError) {
        logger.warn(`[Automation][Task ${taskId}] Could not extract data from deviceinfo.me: ${dataError.message}`);
        logger.error(`[Automation][Task ${taskId}] Error extracting deviceinfo.me data:`, dataError);
      }

      // Setup ad detection with real-time monitoring
      await setupAdDetection(page, taskId);
      logger.info(`[Automation][Task ${taskId}] Ad detection system initialized`);
          
      // Visit URL with improved timeout handling
      logger.info(`[Automation][Task ${taskId}] Visiting URL: ${url}`);
      try {
        // Set a shorter timeout for initial navigation
        await page.goto(url, { 
          waitUntil: 'networkidle0',
          timeout: 30000 // 30 seconds timeout
        });
        logger.info(`[Automation][Task ${taskId}] Page loaded successfully`);

        // Wait for page to be fully loaded
        await page.waitForFunction(() => {
          return document.readyState === 'complete';
        }, { timeout: 10000 });

        // Wait a bit more for any dynamic content
        await delay(2000);
      } catch (timeoutError) {
        logger.warn(`[Automation][Task ${taskId}] Initial page load timed out, attempting to stop loading and continue...`);
        try {
          // Try to stop the page load
          await page.evaluate(() => {
            window.stop();
          });
        } catch (stopError) {
          logger.error(`[Automation][Task ${taskId}] Could not stop page load: ${stopError.message}`, stopError);
        }
      }
      
      // Perform random scrolling
      if (scrollDuration.min > 0 && scrollDuration.max > 0) {
        logger.info(`[Automation][Task ${taskId}] Performing random scrolling for ${scrollDuration.min}-${scrollDuration.max} seconds`);
        await performRandomScrolling(page, scrollDuration.min, scrollDuration.max);
      }

      // Perform random clicks if enabled
      if (randomClicks.enabled) {
        const numClicks = getRandomInt(randomClicks.min, randomClicks.max);
        logger.info(`[Automation][Task ${taskId}] Performing ${numClicks} random clicks`);
        
        for (let i = 0; i < numClicks; i++) {
          try {
            const element = await getRandomClickableElement(page);
            if (element) {
              // Check if element is still valid
              const isElementValid = await page.evaluate(el => {
                return el && document.body.contains(el);
              }, element).catch(() => false);

              if (isElementValid) {
                if (element.tagName === 'IFRAME') {
                  clickedAny = await handleIframeClick(page, element, taskId, logToUI);
                  if (clickedAny) {
                    logger.info(`[Automation][Task ${taskId}] Successfully clicked iframe element`);
                    // Do not return here, continue to try clicking ads
                  }
                } else {
                  try {
                    await element.click({ delay: Math.random() * 100 + 50 });
                    // No need to increment clicksMade here as these are random clicks
                    logger.info(`[Automation][Task ${taskId}] Successfully performed random click: ${element.tagName}`);
                    await delay(getRandomInt(500, 2000));
                  } catch (clickError) {
                    logger.warn(`[Automation][Task ${taskId}] Failed to perform random click ${i + 1}: ${clickError.message}`);
                  }
                }
              } else {
                logger.warn(`[Automation][Task ${taskId}] Element no longer valid for random click ${i + 1}`);
              }
            }
          } catch (clickError) {
            logger.warn(`[Automation][Task ${taskId}] Failed to perform random click ${i + 1}: ${clickError.message}`);
          }
        }
      }
      
      // Visit delay
      const visitDelayTime = getDelayTime(delays.visit, 30, 60);
      logger.info(`[Automation][Task ${taskId}] Waiting for ${visitDelayTime/1000} seconds after visit...`);
      await delay(visitDelayTime);

      // Handle popups
      const pages = await browserInstance.pages();
      for (const popup of pages) {
        if (popup !== page) {
          logger.info(`[Automation][Task ${taskId}] Closing popup window`);
          await popup.close();
        }
      }

      // Attempt to find and click ad elements up to targetClicks
      while (clicksMade < targetClicks && !isStopping) {
        logger.info(`[Automation][Task ${taskId}] Attempting ad clicks (Clicks made: ${clicksMade}/${targetClicks})`);
        const clickedInThisIteration = await findAndClickAdElements(page, customSelectors, taskId, delays, logToUI);
        
        if (clickedInThisIteration) {
          // Assuming findAndClickAdElements clicks at least one element if it returns true
          clicksMade++; // Increment for each successful call that results in a click
          logger.info(`[Automation][Task ${taskId}] Successfully clicked an ad element. Total clicks made: ${clicksMade}`);
          // Add a small delay between click attempts to simulate user behavior
          await delay(getRandomInt(500, 1500));
        } else {
          logger.info(`[Automation][Task ${taskId}] No new ad elements found to click or click failed in this iteration.`);
          break; // No more clickable ads found in this iteration
        }
      }

      logger.info(`[Automation][Task ${taskId}] Finished ad click attempts. Total clicks made in this visit: ${clicksMade}`);

      // Close delay
      const closeDelayTime = getDelayTime(delays.close, 1, 3);
      logger.info(`[Automation][Task ${taskId}] Waiting for ${closeDelayTime/1000} seconds before closing...`);
      await delay(closeDelayTime);

      // Before returning, remove browser from active browsers map and close it
      if (browserInstance) {
        try {
          await browserInstance.close();
          activeBrowsers.delete(taskId);
          logger.info(`[Automation][Task ${taskId}] Browser closed successfully`);
        } catch (closeError) {
          logger.error(`[Automation][Task ${taskId}] Error closing browser: ${closeError.message}`, closeError);
        }
      }

      // If we reached here, the visit was successful or completed attempts
      return clicksMade >= targetClicks || targetClicks === 0; // Return true if target clicks met or no clicks required

    } catch (error) {
      // Log the detailed error
      logger.error(`[Automation][Task ${taskId}] An error occurred during visit: ${error.message}`, error);

      // Check if the error is related to proxy or network issues
      const isNetworkError = error.message.includes('ERR_PROXY_CONNECTION_FAILED') ||
                             error.message.includes('net::ERR_') ||
                             error.message.includes('Timeout') ||
                             error.message.includes('Navigation Timeout');

      if (isNetworkError && proxy) {
        logger.warn(`[Automation][Task ${taskId}] Network error detected with proxy. Considering proxy as potentially bad.`);
        proxyManager.markBadProxy(proxy); // Mark the proxy as bad
        // Optionally add logic here to mark the proxy as bad or remove it for this task
        // proxyManager.markBadProxy(proxy); // Assuming proxyManager has such a method
      }

      // Increment retry count and log
      retryCount++;
      if (retryCount < maxRetries) {
        logger.info(`[Automation][Task ${taskId}] Retrying visit (${retryCount}/${maxRetries})...`);
        await delay(5000); // Wait before retrying
      } else {
        logger.error(`[Automation][Task ${taskId}] Max retries reached for URL: ${url}`);
        return false; // Return false after max retries
      }

    } finally {
      // Ensure browser is closed even if errors occur
      if (browserInstance) {
        try {
          await browserInstance.close();
          logger.info(`[Automation][Task ${taskId}] Browser instance closed.`);
        } catch (closeError) {
          logger.error(`[Automation][Task ${taskId}] Error closing browser instance: ${closeError.message}`, closeError);
        }
        // Remove browser from active browsers map
        activeBrowsers.delete(taskId);
      }
    }
  }

  // If loop finishes without success after retries
  return false;
}

// Add a function to stop the automation
let isStopping = false;

function resetStopState() {
  isStopping = false;
}

module.exports = { 
  checkIPQuality,
  visitAndClick,
  setLogger,
  setStealthMode,
  getRandomFingerprint,
  stopAutomation,
  resetStopState,
  shuffleArray
};
