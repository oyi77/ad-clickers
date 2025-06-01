const { visitAndClick, getRandomFingerprint, stopAutomation: automationStopAutomation, resetStopState } = require('./automation.js');
const { proxyManager } = require('./proxy-manager.js');
const { logger, setUILogger } = require('./logger');
const { delay } = require('./modules/utils');

// Create a logging function that will be set by main process
let logToUI = (message) => {
  console.log('[Runner]', message);
};

function setLogger(logger) {
  logToUI = logger;
}

async function concurrentVisitTask(url, proxy = null, customSelectors = [], taskId, options = {}) {
  try {
    // Get fingerprint and user agent
    const fingerprint = await getRandomFingerprint();
    
    // Format proxy information for logging
    let proxyInfo = 'no proxy';
    if (proxy) {
      if (typeof proxy === 'string') {
        proxyInfo = proxy;
      } else if (proxy.proxy) {
        proxyInfo = proxy.proxy;
      }
    }
    
    logger.info(`[Runner][Task ${taskId}] Starting visit task with proxy: ${proxyInfo}`);
    logger.info(`[Runner][Task ${taskId}] Using browser: ${options.browser || 'chrome'}`);
    logger.info(`[Runner][Task ${taskId}] Stealth mode: ${options.stealth ? 'enabled' : 'disabled'}`);
    logger.info(`[Runner][Task ${taskId}] Headless mode: ${options.headless ? 'enabled' : 'disabled'}`);
    
    // Visit and click
    const success = await visitAndClick(url, proxy, customSelectors, taskId, options);
    
    // Format result message
    const resultMessage = success ? 
      `[Task ${taskId}] Visit completed successfully` : 
      `[Task ${taskId}] Visit failed`;
    
    logger.info(`[Runner] ${resultMessage}`);
    
    return {
      status: success ? 'OK' : 'ERROR',
      proxy: proxyInfo,
      fingerprint: fingerprint,
      taskId: taskId,
      message: resultMessage,
      browser: options.browser || 'chrome',
      stealth: options.stealth,
      headless: options.headless
    };
  } catch (e) {
    const errorMessage = `[Task ${taskId}] Visit failed: ${e.message}`;
    logger.error(`[Runner] ${errorMessage}`, e);
    return {
      status: 'ERROR',
      proxy: proxy ? (typeof proxy === 'string' ? proxy : proxy.proxy) : 'No proxy',
      error: e.message,
      taskId: taskId,
      message: errorMessage,
      browser: options.browser || 'chrome',
      stealth: options.stealth,
      headless: options.headless
    };
  }
}

async function checkIPQuality(proxy) {
  // Implementation of checkIPQuality function
  return false;
}

// Helper function to detect selector type
function detectSelectorType(selector) {
  // Implementation of detectSelectorType function
}

// Helper function to evaluate selector
async function evaluateSelector(page, selector, type) {
  // Implementation of evaluateSelector function
}

// Helper function to wait for selector
async function waitForSelector(page, selector, type, timeout = 5000) {
  // Implementation of waitForSelector function
}

// Helper function to get random element to click
async function getRandomClickableElement(page) {
  // Implementation of getRandomClickableElement function
}

// Helper function to perform random scrolling
async function performRandomScrolling(page, minDuration, maxDuration) {
  // Implementation of performRandomScrolling function
}

// Add a Map to track active browser instances
const activeBrowsers = new Map();

// Modify stopAutomation function
function stopAutomation() {
  automationStopAutomation();
}

// Add new function to verify click success
async function verifyClickSuccess(page, taskId, logToUI) {
  // Implementation of verifyClickSuccess function
}

// Modify handleIframeClick function to use verifyClickSuccess
async function handleIframeClick(page, element, taskId, logToUI) {
  // Implementation of handleIframeClick function
}

// Add a function to stop the automation
let isStopping = false;


// Add a function to shuffle proxies
function shuffleProxies(proxies) {
  for (let i = proxies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [proxies[i], proxies[j]] = [proxies[j], proxies[i]]; // Swap elements
  }
  return proxies;
}

async function startConcurrentVisits({ 
  urls,
  proxies = [], 
  parallel = 3, 
  customSelectors = [], 
  delays = {}, 
  providers = {},
  browser = 'chrome',
  stealth = true,
  headless = true,
  targetImpressions = 1,
  targetClicks = 0,
}) {
  try {
    resetStopState();
    logger.info(`[Runner] Starting automation for ${urls.length} URL(s) with ${parallel} parallel instances`);
    logger.info(`[Runner] Using ${proxies.length} proxies`);
    logger.info(`[Runner] Using ${customSelectors.length} custom ad selectors`);
    logger.info(`[Runner] Browser: ${browser}`);
    logger.info(`[Runner] Stealth mode: ${stealth ? 'enabled' : 'disabled'}`);
    logger.info(`[Runner] Headless mode: ${headless ? 'enabled' : 'disabled'}`);
    
    // Log delay settings
    if (delays.visit === 0) logger.info('Using random visit delay (30-60s)');
    else logger.info(`Using fixed visit delay: ${delays.visit}s`);
    
    if (delays.click === 0) logger.info('Using random click delay (1-3s)');
    else logger.info(`Using fixed click delay: ${delays.click}s`);
    
    if (delays.close === 0) logger.info('Using random close delay (1-3s)');
    else logger.info(`Using fixed close delay: ${delays.close}s`);

    // Log provider settings
    logger.info(`Using ${providers.proxy === 'default' ? 'default' : 'custom'} proxy provider`);
    logger.info(`Using ${providers.fingerprint === 'default' ? 'default' : 'custom'} fingerprint provider`);

    const results = [];
    let urlVisitCounts = {}; // Track impressions per URL
    urls.forEach(url => urlVisitCounts[url] = 0);
    
    // Shuffle and segment proxies for parallel instances
    let availableProxies = [...proxies];
    shuffleProxies(availableProxies);
    
    // Track used proxies to avoid duplicates
    const usedProxies = new Set();
    let currentProxyIndex = 0;

    let currentTasks = new Set();

    // Function to get next available proxy
    const getNextProxy = () => {
      if (proxies.length === 0) return null;

      // Try to find an unused proxy
      while (currentProxyIndex < proxies.length) {
        const proxy = proxies[currentProxyIndex];
        currentProxyIndex++;
        
        if (!usedProxies.has(proxy)) {
          usedProxies.add(proxy);
          return proxy;
        }
      }

      // If all proxies have been used, reset and start over
      if (currentProxyIndex >= proxies.length) {
        currentProxyIndex = 0;
        usedProxies.clear();
        shuffleProxies(proxies); // Reshuffle for next round
        return proxies[currentProxyIndex++];
      }

      return null;
    };

    // Function to find the next URL to visit
    const getNextUrl = () => {
      for (const url of urls) {
        if (urlVisitCounts[url] < targetImpressions) {
          return url;
        }
      }
      return null;
    };

    // Function to run a single visit task
    const runVisitTask = async (urlToVisit, proxyToUse) => {
      const taskId = `${urlToVisit}-${urlVisitCounts[urlToVisit] + 1}`;
      logger.info(`[Runner][Coordinator] Starting task ${taskId} for URL: ${urlToVisit}`);
      
      try {
        const taskResult = await concurrentVisitTask(urlToVisit, proxyToUse, customSelectors, taskId, {
          delays,
          providers,
          browser,
          stealth,
          headless,
          targetClicks
        });
        
        if (taskResult.status === 'OK') {
          urlVisitCounts[urlToVisit]++;
        } else {
          // If task failed, remove the proxy from used set so it can be retried
          usedProxies.delete(proxyToUse);
        }
        
        results.push(taskResult);
        logger.info(`[Runner][Coordinator] Task ${taskId} finished with status: ${taskResult.status}`);
        
        currentTasks.delete(taskId);
        scheduleNextTask();
        
      } catch (error) {
        logger.error(`[Runner][Coordinator] Task ${taskId} failed with error: ${error.message}`, error);
        usedProxies.delete(proxyToUse); // Allow proxy to be retried
        results.push({ status: 'ERROR', url: urlToVisit, proxy: proxyToUse, error: error.message });
        
        currentTasks.delete(taskId);
        scheduleNextTask();
      }
    };

    // Function to schedule the next task
    const scheduleNextTask = () => {
      if (isStopping) {
        logger.info('[Runner][Coordinator] Automation is stopping, no new tasks scheduled.');
        return;
      }

      // Check if we've already reached the parallel limit
      if (currentTasks.size >= parallel) {
        logger.info(`[Runner][Coordinator] Already at parallel limit (${parallel}), waiting for tasks to complete.`);
        return;
      }

      // Calculate how many new tasks we can start
      const availableSlots = parallel - currentTasks.size;
      
      // Start new tasks up to the available slots
      for (let i = 0; i < availableSlots; i++) {
        const urlToVisit = getNextUrl();
        
        if (!urlToVisit) {
          logger.info('[Runner][Coordinator] All URLs reached target impressions or no URLs provided.');
          break;
        }
        
        const proxyToUse = getNextProxy();
        if (!proxyToUse && proxies.length > 0) {
          logger.warn('[Runner][Coordinator] No available proxies, waiting for current tasks to complete');
          break;
        }
        
        const taskId = `${urlToVisit}-${urlVisitCounts[urlToVisit] + 1}`;
        currentTasks.add(taskId);
        runVisitTask(urlToVisit, proxyToUse);
      }
    };

    // Start the initial set of tasks
    logger.info('[Runner][Coordinator] Scheduling initial tasks...');
    scheduleNextTask();

    // Wait for all current tasks to complete
    while(currentTasks.size > 0) {
      await delay(1000);
      if (isStopping) break;
    }
    
    if (isStopping) {
      logger.info('[Runner][Coordinator] Automation stopped. Final results may be incomplete.');
    }

    // Log results
    const successCount = results.filter(r => r.status === 'OK').length;
    logger.info(`Automation finished. Total visit tasks completed: ${results.length}, Successes: ${successCount}`);

    logger.info('Final Impressions per URL:');
    for (const url of urls) {
      logger.info(`- ${url}: ${urlVisitCounts[url]} impressions`);
    }

    return results;
  } catch (error) {
    logger.error('[Runner] Error in startConcurrentVisits:', error);
    throw error;
  }
}

module.exports = {
  checkIPQuality,
  visitAndClick,
  startConcurrentVisits,
  setLogger,
  stopAutomation,
  resetStopState
};
