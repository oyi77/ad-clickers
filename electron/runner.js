const { 
  visitAndClick, 
  getRandomFingerprint, 
  stopAutomation: automationStopAutomation
} = require('./automation.js');
const { logger, setUILogger } = require('./logger');
const { delay } = require('./modules/utils');
const { proxyManager } = require('./proxy-manager');
const { getStopState, setStopState, resetStopState } = require('./state');

// Module level variables
let currentTasks = new Set();
let urlVisitCounts = {};
let usedProxies = new Set();
let currentProxyIndex = 0;

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


// Add a Map to track active browser instances
const activeBrowsers = new Map();

// Add a function to shuffle proxies
function shuffleProxies(proxies) {
  for (let i = proxies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [proxies[i], proxies[j]] = [proxies[j], proxies[i]]; // Swap elements
  }
  return proxies;
}

// Helper function to get delay time based on settings
function getDelayTime(setting, defaultMin, defaultMax) {
  if (setting === 0) {
    return Math.floor(Math.random() * (defaultMax - defaultMin + 1)) + defaultMin;
  }
  return setting * 1000; // Convert seconds to milliseconds
}

// Modify stopAutomation function
async function stopAutomation() {
  if (getStopState()) {
    logger.info('[Runner] Stop already in progress, waiting...');
    return;
  }
  
  setStopState(true);
  logger.info('[Runner] Stopping automation...');
  
  try {
    // Wait for current tasks to finish cleanup
    if (currentTasks.size > 0) {
      logger.info(`[Runner] Waiting for ${currentTasks.size} tasks to cleanup...`);
      const timeout = 30000; // 30 second timeout
      const startTime = Date.now();
      
      // Wait for tasks to clean up with periodic logging
      while (currentTasks.size > 0 && (Date.now() - startTime) < timeout) {
        const remainingTasks = Array.from(currentTasks);
        logger.info(`[Runner] Still waiting for tasks: ${remainingTasks.join(', ')}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      if (currentTasks.size > 0) {
        logger.warn(`[Runner] Cleanup timed out with ${currentTasks.size} tasks remaining`);
        currentTasks.clear();
      }
    }
  } catch (error) {
    logger.error('[Runner] Error during stop cleanup:', error);
  }
}

// Function to start concurrent visits
async function startConcurrentVisits(urls, options = {}) {
  const {
    maxConcurrent = 3,
    targetClicks = 0,
    delays = {},
    randomClicks = {},
    scrollDuration = {},
    providers = {},
    browser = 'chrome',
    stealth = true,
    headless = true,
    customSelectors = []
  } = options;

  // Reset stop state before starting
  resetStopState();

  logger.info(`[Runner] Starting automation for ${urls.length} URL(s) with ${maxConcurrent} parallel instances`);
  logger.info(`[Runner] Using ${proxyManager.getProxyCount()} proxies`);
  logger.info(`[Runner] Using ${customSelectors.length} custom ad selectors`);
  logger.info(`[Runner] Browser: ${browser}`);
  logger.info(`[Runner] Stealth mode: ${stealth ? 'enabled' : 'disabled'}`);
  logger.info(`[Runner] Headless mode: ${headless ? 'enabled' : 'disabled'}`);

  if (delays.visit === 0) {
    logger.info('Using random visit delay (30-60s)');
  } else {
    logger.info(`Using ${delays.visit}s visit delay`);
  }

  if (delays.click === 0) {
    logger.info('Using random click delay (1-3s)');
  } else {
    logger.info(`Using ${delays.click}s click delay`);
  }

  if (delays.close === 0) {
    logger.info('Using random close delay (1-3s)');
  } else {
    logger.info(`Using ${delays.close}s close delay`);
  }

  if (providers.proxy === 'default') {
    logger.info('Using default proxy provider');
  } else {
    logger.info(`Using custom proxy provider: ${providers.proxy}`);
  }

  if (providers.fingerprint === 'default') {
    logger.info('Using default fingerprint provider');
  } else {
    logger.info(`Using custom fingerprint provider: ${providers.fingerprint}`);
  }

  // Initialize task queue
  const taskQueue = [];
  for (const url of urls) {
    // Create multiple tasks for each URL based on maxConcurrent
    for (let i = 0; i < maxConcurrent; i++) {
      const taskId = `${url}-${i + 1}`;
      taskQueue.push({ url, taskId });
    }
  }

  // Coordinator function to manage tasks
  async function coordinator() {
    logger.info('[Runner][Coordinator] Scheduling initial tasks...');
    const hasProxies = proxyManager.getProxyCount() > 0;
    
    while (taskQueue.length > 0 && !getStopState()) {
      const task = taskQueue.shift();
      if (!task) break;

      const { url, taskId } = task;
      
      // Get proxy for this task if available, else null
      const proxy = hasProxies ? proxyManager.getNextProxy() : null;

      // If proxies are required and none are available, skip
      // But if proxies are optional, proceed with proxy = null
      // (No error log needed)

      logger.info(`[Runner][Coordinator] Starting task ${taskId} for URL: ${url}`);
      
      // Add task to tracking set
      currentTasks.add(taskId);

      // Start the visit task
      visitTask(url, proxy, taskId, options).catch(error => {
        logger.error(`[Runner][Task ${taskId}] Error in visit task:`, error);
      }).finally(() => {
        // Remove task from tracking on completion
        currentTasks.delete(taskId);
        
        // If not stopping, add task back to queue
        if (!getStopState()) {
          taskQueue.push({ url, taskId });
          logger.info(`[Runner][Coordinator] Rescheduling task ${taskId}`);
        }
      });

      // Add delay between starting tasks
      if (!getStopState()) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // Start the coordinator
  await coordinator();
}

// Individual visit task
async function visitTask(url, proxy, taskId, options) {
  const {
    targetClicks = 0,
    delays = {},
    randomClicks = {},
    scrollDuration = {},
    providers = {},
    browser = 'chrome',
    stealth = true,
    headless = true,
    customSelectors = []
  } = options;

  logger.info(`[Runner][Task ${taskId}] Starting visit task with proxy: ${proxy}`);
  logger.info(`[Runner][Task ${taskId}] Using browser: ${browser}`);
  logger.info(`[Runner][Task ${taskId}] Stealth mode: ${stealth ? 'enabled' : 'disabled'}`);
  logger.info(`[Runner][Task ${taskId}] Headless mode: ${headless ? 'enabled' : 'disabled'}`);

  try {
    await visitAndClick(url, proxy, customSelectors, taskId, {
      delays,
      randomClicks,
      scrollDuration,
      providers,
      browser,
      stealth,
      headless,
      targetClicks
    });
  } catch (error) {
    logger.error(`[Runner][Task ${taskId}] Error in visit task:`, error);
    throw error;
  }
}

// Add new function to verify click success
async function verifyClickSuccess(page, taskId, logToUI) {
  // Implementation of verifyClickSuccess function
}

// Modify handleIframeClick function to use verifyClickSuccess
async function handleIframeClick(page, element, taskId, logToUI) {
  // Implementation of handleIframeClick function
}

module.exports = {
  checkIPQuality,
  visitAndClick,
  startConcurrentVisits,
  setLogger,
  stopAutomation,
  resetStopState
};
