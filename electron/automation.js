const axios = require('axios');
const fs = require('fs-extra');
const { logger } = require('./logger');
const { proxyManager } = require('./proxy-manager.js');
const { getStopState, setStopState, resetStopState } = require('./state');
const { 
  getFingerprintFromProvider, 
  getRandomFingerprint,
  detectFingerprintFormat 
} = require('./modules/fingerprint');
const { validateCustomSelectors, getDefaultAdSelectors, setupAdDetection } = require('./modules/ad-detector');
const { setStealthMode, launchBrowser, setupPage } = require('./modules/browser');
const { findAndClickAdElements } = require('./modules/ad-searcher');
const { getRandomInt, delay, shuffleArray } = require('./modules/utils');
const { spawnSync } = require('child_process');

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
        if (typeof page.$x === 'function') {
          return await page.$x(selector);
        } else {
          // fallback: use page.evaluateHandle to find elements by XPath
          return await page.evaluateHandle((xpath) => {
            const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const nodes = [];
            for (let i = 0; i < result.snapshotLength; i++) {
              nodes.push(result.snapshotItem(i));
            }
            return nodes;
          }, selector);
        }
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

// Add global cleanup function
async function forceCleanupBrowser(browser, taskId) {
  if (!browser) return;
  
  try {
    // Track cleanup start time
    const cleanupStart = Date.now();
    logger.info(`[Automation][Task ${taskId}] Starting browser cleanup`);

    // Force close all pages first with timeout
    const pages = await Promise.race([
      browser.pages().catch(() => []),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Pages fetch timeout')), 5000))
    ]);

    await Promise.all(pages.map(async (page) => {
      try {
        if (!page.isClosed()) {
          // Clear browser data
          const client = await page.target().createCDPSession().catch(() => null);
          if (client) {
            await Promise.all([
              client.send('Network.clearBrowserCache').catch(() => {}),
              client.send('Network.clearBrowserCookies').catch(() => {}),
              client.send('Storage.clearDataForOrigin', {
                origin: '*',
                storageTypes: 'all',
              }).catch(() => {})
            ]);
            await client.detach().catch(() => {});
          }
          
          // Close page with timeout
          await Promise.race([
            page.close(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Page close timeout')), 3000))
          ]);
        }
      } catch (e) {
        logger.error(`[Automation][Task ${taskId}] Error closing page: ${e.message}`);
      }
    }));

    // Force close browser with timeout
    try {
      await Promise.race([
        browser.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Browser close timeout')), 5000))
      ]);
    } catch (e) {
      logger.error(`[Automation][Task ${taskId}] Normal close failed: ${e.message}, attempting force kill`);
      try {
        const process = browser.process();
        if (process) {
          process.kill('SIGKILL');
        }
      } catch (killError) {
        logger.error(`[Automation][Task ${taskId}] Force kill failed: ${killError.message}`);
      }
    }

    const cleanupDuration = Date.now() - cleanupStart;
    logger.info(`[Automation][Task ${taskId}] Browser cleanup completed in ${cleanupDuration}ms`);
  } catch (e) {
    logger.error(`[Automation][Task ${taskId}] Error in browser cleanup: ${e.message}`);
  } finally {
    // Ensure browser is removed from tracking
    activeBrowsers.delete(taskId);
  }
}

// Modify stopAutomation function
async function stopAutomation() {
  if (getStopState()) {
    logger.info('[Automation] Stop already in progress');
    return;
  }
  
  setStopState(true);
  const stopStart = Date.now();
  logger.info('[Automation] Stopping automation...');
  
  // Close all active browser instances with force
  const cleanupPromises = [];
  for (const [taskId, browser] of activeBrowsers.entries()) {
    cleanupPromises.push(forceCleanupBrowser(browser, taskId).catch(e => {
      logger.error(`[Automation] Error cleaning up browser ${taskId}: ${e.message}`);
      return null; // Don't let individual failures stop the cleanup
    }));
  }

  // Wait for all cleanup to complete with timeout
  try {
    await Promise.race([
      Promise.all(cleanupPromises),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Global cleanup timeout')), 30000))
    ]);
  } catch (e) {
    logger.error(`[Automation] Global cleanup error: ${e.message}`);
  }

  // Ensure map is cleared even if cleanup fails
  activeBrowsers.clear();

  // --- AGGRESSIVE CHROME CLEANUP ---
  try {
    logger.info('[Automation] Aggressive Chrome process cleanup: scanning for orphaned Chrome processes...');
    // Use ps to find all Chrome processes with puppeteer- user-data-dir
    const ps = spawnSync('ps', ['-eo', 'pid,command'], { encoding: 'utf-8' });
    if (ps.stdout) {
      const lines = ps.stdout.split('\n');
      for (const line of lines) {
        if (line.includes('chrome') && line.includes('--user-data-dir') && line.includes('puppeteer-')) {
          const match = line.match(/\s*(\d+)\s+(.*)/);
          if (match) {
            const pid = match[1];
            logger.info(`[Automation] Killing orphaned Chrome process PID: ${pid} | CMD: ${match[2]}`);
            try {
              process.kill(pid, 'SIGKILL');
            } catch (e) {
              logger.error(`[Automation] Failed to kill orphaned Chrome PID ${pid}: ${e.message}`);
            }
          }
        }
      }
    }
  } catch (e) {
    logger.error(`[Automation] Error during aggressive Chrome cleanup: ${e.message}`);
  }
  // --- END AGGRESSIVE CLEANUP ---
  
  const stopDuration = Date.now() - stopStart;
  logger.info(`[Automation] Stop completed in ${stopDuration}ms`);
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

async function checkIPQualityWithBrowser(page, taskId) {
  try {
    logger.info(`[Automation][Task ${taskId}] Checking IP quality...`);
    await page.goto('https://www.ip2check.org/', {
      waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
      timeout: 30000
    });

    // Wait for the risk score element
    await page.waitForSelector('text/Fraud score:', { timeout: 20000 });
    
    // Get the fraud score and IP details
    const data = await page.evaluate(() => {
      const scoreText = document.body.innerText.match(/Fraud score: (\d+)/);
      const score = scoreText ? parseInt(scoreText[1]) : null;
      
      const ipText = document.body.innerText.match(/Current visiting IP[：:]\s*([0-9.]+)/);
      const ip = ipText ? ipText[1] : null;

      const ispText = document.body.innerText.match(/ISP\s*([^\n]+)/);
      const isp = ispText ? ispText[1].trim() : null;

      return { score, ip, isp };
    });

    logger.info(`[Automation][Task ${taskId}] IP Quality Check Results:`);
    logger.info(`  IP: ${data.ip}`);
    logger.info(`  Fraud Score: ${data.score}`);
    logger.info(`  ISP: ${data.isp}`);

    // Check if the IP is from a datacenter or has a high fraud score
    const isDatacenter = data.isp && /amazon|google|microsoft|ovh|digitalocean|cloud|aws|azure/i.test(data.isp);
    const isHighRisk = data.score > 50;

    if (isDatacenter) {
      logger.warn(`[Automation][Task ${taskId}] IP detected as datacenter: ${data.isp}`);
      return false;
    }

    if (isHighRisk) {
      logger.warn(`[Automation][Task ${taskId}] IP has high fraud score: ${data.score}`);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(`[Automation][Task ${taskId}] Error checking IP quality: ${error.message}`);
    return false;
  }
}

async function checkDeviceInfo(page, taskId) {
  const deviceCheckUrls = [
    'https://browserleaks.com/javascript',
    'https://www.whatismybrowser.com/detect/what-is-my-user-agent',
    'https://www.browserscan.net',
    'https://iphey.com',
    'https://bot.sannysoft.com'
  ];

  for (const url of deviceCheckUrls) {
    try {
      logger.info(`[Automation][Task ${taskId}] Checking device info using ${url}...`);
      
      // Set a reasonable timeout
      const prevTimeout = page.getDefaultNavigationTimeout();
      await page.setDefaultNavigationTimeout(20000);

      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 20000
        });
      } catch (navError) {
        logger.warn(`[Automation][Task ${taskId}] Navigation timeout for ${url}, trying next service...`);
        continue;
      }

      // Reset timeout to previous value
      await page.setDefaultNavigationTimeout(prevTimeout);

      // Different checks based on the URL
      if (url.includes('browserleaks.com')) {
        const deviceInfo = await extractBrowserLeaks(page, taskId);
        if (deviceInfo) return true;
      } 
      else if (url.includes('whatismybrowser.com')) {
        const deviceInfo = await extractWhatIsMyBrowser(page, taskId);
        if (deviceInfo) return true;
      }
      else if (url.includes('browserscan.net')) {
        const deviceInfo = await extractBrowserScan(page, taskId);
        if (deviceInfo) return true;
      }
      else if (url.includes('iphey.com')) {
        const deviceInfo = await extractIphey(page, taskId);
        if (deviceInfo) return true;
      }
      else if (url.includes('sannysoft.com')) {
        const deviceInfo = await extractSannySoft(page, taskId);
        if (deviceInfo) return true;
      }

    } catch (error) {
      logger.warn(`[Automation][Task ${taskId}] Failed checking with ${url}: ${error.message}`);
      continue;
    }
  }

  logger.error(`[Automation][Task ${taskId}] All device info checks failed`);
  return false;
}

async function extractBrowserLeaks(page, taskId) {
  try {
    // First wait for the page to be fully loaded
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 });
    
    // Wait a bit for dynamic content
    await delay(2000);

    const deviceInfo = await page.evaluate(() => {
      const info = {};
      
      // Basic JS properties
      info['User Agent'] = navigator.userAgent;
      info['Platform'] = navigator.platform;
      info['Languages'] = navigator.languages?.join(', ');
      
      // Browser properties
      info['Browser Properties'] = {
        cookieEnabled: navigator.cookieEnabled,
        doNotTrack: navigator.doNotTrack,
        hardwareConcurrency: navigator.hardwareConcurrency,
        maxTouchPoints: navigator.maxTouchPoints,
        deviceMemory: navigator.deviceMemory
      };

      // Screen properties
      info['Screen Properties'] = {
        width: window.screen.width,
        height: window.screen.height,
        colorDepth: window.screen.colorDepth,
        pixelDepth: window.screen.pixelDepth
      };

      // WebGL info
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
          const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
          if (debugInfo) {
            info['WebGL Vendor'] = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
            info['WebGL Renderer'] = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
          }
        }
      } catch (e) {
        info['WebGL Error'] = e.message;
      }

      // Audio context
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        info['Audio Context State'] = audioContext.state;
        audioContext.close();
      } catch (e) {
        info['Audio Context Error'] = e.message;
      }

      // Plugins
      try {
        const plugins = Array.from(navigator.plugins).map(p => p.name);
        info['Plugins'] = plugins.join(', ');
      } catch (e) {
        info['Plugins Error'] = e.message;
      }

      // Timezone
      info['Timezone'] = Intl.DateTimeFormat().resolvedOptions().timeZone;

      return info;
    });

    logger.info(`[Automation][Task ${taskId}] BrowserLeaks Results:`);
    
    // Log basic info
    ['User Agent', 'Platform', 'Languages', 'Timezone', 'Plugins'].forEach(key => {
      if (deviceInfo[key]) {
        logger.info(`  ${key}: ${deviceInfo[key]}`);
      }
    });

    // Log browser properties
    if (deviceInfo['Browser Properties']) {
      logger.info('  Browser Properties:');
      Object.entries(deviceInfo['Browser Properties']).forEach(([key, value]) => {
        logger.info(`    ${key}: ${value}`);
      });
    }

    // Log screen properties
    if (deviceInfo['Screen Properties']) {
      logger.info('  Screen Properties:');
      Object.entries(deviceInfo['Screen Properties']).forEach(([key, value]) => {
        logger.info(`    ${key}: ${value}`);
      });
    }

    // Log WebGL info
    if (deviceInfo['WebGL Vendor']) logger.info(`  WebGL Vendor: ${deviceInfo['WebGL Vendor']}`);
    if (deviceInfo['WebGL Renderer']) logger.info(`  WebGL Renderer: ${deviceInfo['WebGL Renderer']}`);

    // Check for automation indicators
    const hasAutomationIndicators = [
      deviceInfo['WebGL Vendor']?.toLowerCase().includes('swiftshader'),
      deviceInfo['WebGL Renderer']?.toLowerCase().includes('swiftshader'),
      deviceInfo['User Agent']?.toLowerCase().includes('headless'),
      deviceInfo['Plugins'] === '',
      deviceInfo['Browser Properties']?.hardwareConcurrency === 0,
      deviceInfo['Browser Properties']?.deviceMemory === 0,
      !deviceInfo['Audio Context State'],
      deviceInfo['Languages'] === undefined
    ].some(indicator => indicator === true);

    if (hasAutomationIndicators) {
      logger.warn(`[Automation][Task ${taskId}] Automation indicators detected in browser fingerprint`);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(`[Automation][Task ${taskId}] Error extracting from BrowserLeaks: ${error.message}`);
    return false;
  }
}

async function extractBrowserScan(page, taskId) {
  try {
    await page.waitForSelector('.browser-details', { timeout: 10000 });
    
    const deviceInfo = await page.evaluate(() => {
      const info = {};
      const details = document.querySelectorAll('.browser-details div');
      details.forEach(detail => {
        const text = detail.textContent.trim();
        if (text.includes(':')) {
          const [key, value] = text.split(':').map(s => s.trim());
          info[key] = value;
        }
      });
      return info;
    });

    logger.info(`[Automation][Task ${taskId}] BrowserScan Results:`);
    Object.entries(deviceInfo).forEach(([key, value]) => {
      logger.info(`  ${key}: ${value}`);
    });

    // Check if we got basic browser info
    return Object.keys(deviceInfo).length > 0;
  } catch (error) {
    logger.error(`[Automation][Task ${taskId}] Error extracting from BrowserScan: ${error.message}`);
    return false;
  }
}

async function extractIphey(page, taskId) {
  try {
    await page.waitForSelector('#result', { timeout: 10000 });
    
    const deviceInfo = await page.evaluate(() => {
      const info = {};
      info['Browser'] = document.querySelector('[data-browser]')?.textContent;
      info['OS'] = document.querySelector('[data-os]')?.textContent;
      info['Device'] = document.querySelector('[data-device]')?.textContent;
      return info;
    });

    logger.info(`[Automation][Task ${taskId}] Iphey Results:`);
    Object.entries(deviceInfo).forEach(([key, value]) => {
      logger.info(`  ${key}: ${value}`);
    });

    return deviceInfo['Browser'] && deviceInfo['OS'];
  } catch (error) {
    logger.error(`[Automation][Task ${taskId}] Error extracting from Iphey: ${error.message}`);
    return false;
  }
}

async function extractSannySoft(page, taskId) {
  try {
    // This is a comprehensive automation detection test
    await page.waitForSelector('#webdriver-result', { timeout: 10000 });
    
    const testResults = await page.evaluate(() => {
      const results = {};
      document.querySelectorAll('.test-result').forEach(result => {
        const testName = result.querySelector('.test-name')?.textContent;
        const testValue = result.querySelector('.test-value')?.textContent;
        if (testName && testValue) {
          results[testName.trim()] = testValue.trim();
        }
      });
      return results;
    });

    logger.info(`[Automation][Task ${taskId}] SannySoft Bot Detection Results:`);
    Object.entries(testResults).forEach(([test, result]) => {
      logger.info(`  ${test}: ${result}`);
    });

    // Check if any automation indicators are present
    const failedTests = Object.values(testResults).filter(result => 
      result.toLowerCase().includes('failed') || 
      result.toLowerCase().includes('detected')
    ).length;

    return failedTests === 0;
  } catch (error) {
    logger.error(`[Automation][Task ${taskId}] Error extracting from SannySoft: ${error.message}`);
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
  if (getStopState()) {
    logger.info(`[Automation][Task ${taskId}] Task cancelled due to stop request`);
    return false;
  }

  try {
    while (retryCount < maxRetries && !getStopState()) {
      try {
        if (getStopState()) {
          logger.info(`[Automation][Task ${taskId}] Task cancelled due to stop request`);
          return false;
        }

        const fingerprint = await getFingerprintFromProvider(providers.fingerprint);
        const format = detectFingerprintFormat(fingerprint);
        logger.info(`[Automation][Task ${taskId}] Using ${format} fingerprint format`);

        browserInstance = await launchBrowser(browser, proxy, headless);
        activeBrowsers.set(taskId, browserInstance);
        logger.info(`[Automation][Task ${taskId}] Browser launched successfully in ${headless ? 'headless' : 'visible'} mode`);

        // If stop was requested during browser launch, clean up and exit
        if (getStopState()) {
          logger.info(`[Automation][Task ${taskId}] Stop requested after browser launch, cleaning up`);
          await forceCleanupBrowser(browserInstance, taskId);
          return false;
        }

        const page = await browserInstance.newPage();
        await page.setDefaultTimeout(60000);
        await page.setDefaultNavigationTimeout(60000);
        await setupPage(page, fingerprint, proxy);
        logger.info(`[Automation][Task ${taskId}] Page setup completed`);

        // Check IP quality first
        const ipQualityOk = await checkIPQualityWithBrowser(page, taskId);
        if (!ipQualityOk) {
          logger.warn(`[Automation][Task ${taskId}] IP quality check failed, marking proxy as bad`);
          if (proxy) {
            proxyManager.markBadProxy(proxy);
          }
          // Close browser and retry with different proxy
          await forceCleanupBrowser(browserInstance, taskId);
          logger.info(`[Automation][Task ${taskId}] Browser cleanup completed`);
          
          if (!getStopState()) {
            retryCount++;
            if (retryCount < maxRetries) {
              logger.info(`[Automation][Task ${taskId}] Retrying visit (${retryCount}/${maxRetries})...`);
              await delay(5000);
              continue;
            }
          }
          return false;
        }

        // Visit URL directly
        logger.info(`[Automation][Task ${taskId}] Visiting URL: ${url}`);
        try {
          if (getStopState()) {
            logger.info(`[Automation][Task ${taskId}] Stop requested before page load`);
            return false;
          }

          await page.goto(url, { 
            waitUntil: ['load', 'domcontentloaded', 'networkidle0'],
            timeout: 60000 
          });
          logger.info(`[Automation][Task ${taskId}] Page loaded successfully`);

          // Wait for page to be fully loaded
          await page.waitForFunction(() => {
            return document.readyState === 'complete';
          }, { timeout: 30000 });

          // Wait a bit more for any dynamic content
          await delay(3000);
        } catch (timeoutError) {
          if (getStopState()) return false;
          logger.warn(`[Automation][Task ${taskId}] Page load timed out, attempting to proceed anyway...`);
        }

        // Setup ad detection with real-time monitoring
        if (getStopState()) {
          logger.info(`[Automation][Task ${taskId}] Stop requested before ad detection setup`);
          return false;
        }
        await setupAdDetection(page, taskId);
        logger.info(`[Automation][Task ${taskId}] Ad detection system initialized`);
            
        // Perform random scrolling
        if (!getStopState() && scrollDuration.min > 0 && scrollDuration.max > 0) {
          logger.info(`[Automation][Task ${taskId}] Performing random scrolling for ${scrollDuration.min}-${scrollDuration.max} seconds`);
          await performRandomScrolling(page, scrollDuration.min, scrollDuration.max);
        }

        // Perform random clicks if enabled
        if (!getStopState() && randomClicks.enabled) {
          const numClicks = getRandomInt(randomClicks.min, randomClicks.max);
          logger.info(`[Automation][Task ${taskId}] Performing ${numClicks} random clicks`);
          
          for (let i = 0; i < numClicks && !getStopState(); i++) {
            try {
              const element = await getRandomClickableElement(page);
              if (element && !getStopState()) {
                // Check if element is still valid
                const isElementValid = await page.evaluate(el => {
                  return el && document.body.contains(el);
                }, element).catch(() => false);

                if (isElementValid && !getStopState()) {
                  if (element.tagName === 'IFRAME') {
                    clickedAny = await handleIframeClick(page, element, taskId, logToUI);
                  } else {
                    try {
                      await element.click({ delay: Math.random() * 100 + 50 });
                      logger.info(`[Automation][Task ${taskId}] Successfully performed random click: ${element.tagName}`);
                      await delay(getRandomInt(500, 2000));
                    } catch (clickError) {
                      logger.warn(`[Automation][Task ${taskId}] Failed to perform random click ${i + 1}: ${clickError.message}`);
                    }
                  }
                }
              }
            } catch (clickError) {
              if (getStopState()) break;
              logger.warn(`[Automation][Task ${taskId}] Failed to perform random click ${i + 1}: ${clickError.message}`);
            }
          }
        }
        
        // Visit delay
        if (!getStopState()) {
          const visitDelayTime = getDelayTime(delays.visit, 30, 60);
          logger.info(`[Automation][Task ${taskId}] Waiting for ${visitDelayTime/1000} seconds after visit...`);
          await delay(visitDelayTime);
        }

        // Handle popups
        if (!getStopState()) {
          const pages = await browserInstance.pages();
          for (const popup of pages) {
            if (popup !== page && !getStopState()) {
              logger.info(`[Automation][Task ${taskId}] Closing popup window`);
              await popup.close();
            }
          }
        }

        // Attempt to find and click ad elements up to targetClicks
        let adClickAttempted = false;
        while (clicksMade < targetClicks && !getStopState()) {
          logger.info(`[Automation][Task ${taskId}] Attempting ad clicks (Clicks made: ${clicksMade}/${targetClicks})`);
          const clickedInThisIteration = await findAndClickAdElements(page, customSelectors, taskId, delays, logToUI);
          adClickAttempted = true;
          if (getStopState()) {
            logger.info(`[Automation][Task ${taskId}] Stop requested during ad clicking`);
            break;
          }

          if (clickedInThisIteration) {
            clicksMade++;
            logger.info(`[Automation][Task ${taskId}] Successfully clicked an ad element. Total clicks made: ${clicksMade}`);
            await delay(getRandomInt(500, 1500));
          } else {
            logger.info(`[Automation][Task ${taskId}] No new ad elements found to click or click failed in this iteration.`);
            // If customSelectors are provided and no ad was found/clicked, close browser and retry with new proxy/fingerprint/instance
            if (customSelectors && customSelectors.length > 0 && adClickAttempted) {
              logger.info(`[Automation][Task ${taskId}] Custom selectors provided but no ad found/clicked. Closing browser and retrying with new proxy/fingerprint/instance.`);
              await forceCleanupBrowser(browserInstance, taskId);
              browserInstance = null;
              retryCount++;
              if (retryCount < maxRetries && !getStopState()) {
                logger.info(`[Automation][Task ${taskId}] Retrying visit (${retryCount}/${maxRetries}) with new proxy/fingerprint...`);
                await delay(5000);
                continue;
              } else {
                logger.error(`[Automation][Task ${taskId}] Max retries reached or stop requested for URL: ${url}`);
                return false;
              }
            }
            break;
          }
        }

        logger.info(`[Automation][Task ${taskId}] Finished ad click attempts. Total clicks made in this visit: ${clicksMade}`);

        // Close delay
        if (!getStopState()) {
          const closeDelayTime = getDelayTime(delays.close, 1, 3);
          logger.info(`[Automation][Task ${taskId}] Waiting for ${closeDelayTime/1000} seconds before closing...`);
          await delay(closeDelayTime);
        }

        // Success - break out of retry loop
        break;

      } catch (error) {
        logger.error(`[Automation][Task ${taskId}] An error occurred during visit: ${error.message}`, error);

        // Enhanced browser cleanup on error
        if (browserInstance) {
          await forceCleanupBrowser(browserInstance, taskId);
          logger.info(`[Automation][Task ${taskId}] Browser cleanup completed`);
        }

        // If error is related to proxy, mark it as bad
        if (error.message.includes('ERR_PROXY_CONNECTION_FAILED') || 
            error.message.includes('net::ERR_PROXY') ||
            error.message.includes('ECONNREFUSED')) {
          if (proxy) {
            logger.warn(`[Automation][Task ${taskId}] Proxy error detected, marking as bad: ${proxy}`);
            proxyManager.markBadProxy(proxy);
          }
        }

        if (getStopState()) {
          logger.info(`[Automation][Task ${taskId}] Stop requested during error handling`);
          return false;
        }

        retryCount++;
        if (retryCount < maxRetries && !getStopState()) {
          logger.info(`[Automation][Task ${taskId}] Retrying visit (${retryCount}/${maxRetries})...`);
          await delay(5000);
        } else {
          logger.error(`[Automation][Task ${taskId}] Max retries reached or stop requested for URL: ${url}`);
          return false;
        }
      }
    }
  } finally {
    // Ensure browser is cleaned up
    if (browserInstance) {
      await forceCleanupBrowser(browserInstance, taskId);
      logger.info(`[Automation][Task ${taskId}] Final browser cleanup completed`);
    }
  }

  return !getStopState() && (clicksMade >= targetClicks || targetClicks === 0);
}

// Export all functions at the end
module.exports = {
  checkIPQuality,
  visitAndClick,
  setLogger,
  setStealthMode,
  getRandomFingerprint,
  stopAutomation,
  shuffleArray
};
