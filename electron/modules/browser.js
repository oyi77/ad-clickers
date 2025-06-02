const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const { proxyManager } = require('../proxy-manager');
const { logger } = require('../logger');
const { getStopState } = require('../state');

let stealthMode = true;

function setStealthMode(enabled) {
  stealthMode = enabled;
  if (enabled) {
    if (!puppeteer.plugins.some(p => p.name === 'stealth')) {
      puppeteer.use(StealthPlugin());
    }
  } else {
    puppeteer.plugins = puppeteer.plugins.filter(p => p.name !== 'stealth');
  }
}

async function launchBrowser(browser = 'chrome', proxy = null, headless = true) {
  let tempDir = null;
  let browserInstance = null;

  try {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'puppeteer-'));
    
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-zygote',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--start-maximized',
      '--disable-notifications',
      '--disable-popup-blocking',
      '--disable-infobars',
      '--disable-extensions',
      '--disable-default-apps',
      '--disable-translate',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-first-run',
      '--mute-audio',
      '--hide-scrollbars',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees,Autofill',
      '--disable-ipc-flooding-protection',
      '--disable-prompt-on-repost',
      '--enable-features=NetworkService,NetworkServiceInProcess',
      '--force-color-profile=srgb',
      '--password-store=basic',
      '--disable-autofill-keyboard-accessory-view',
      '--disable-autofill-address-form',
      '--disable-autofill-credit-card-form'
    ];

    if (proxy) {
      try {
        const proxyUrl = typeof proxy === 'string' ? proxy : proxy.proxy;
        // Parse the proxy URL
        const [host, port, username, password] = proxyUrl.split(':');
        
        // Add proxy server argument
        args.push(`--proxy-server=http://${host}:${port}`);
        
        // Add proxy authentication if credentials are provided
        if (username && password) {
          args.push(`--proxy-auth=${username}:${password}`);
        }
      } catch (e) {
        console.error('Error configuring proxy:', e);
      }
    }

    // Configure headless mode
    let headlessConfig;
    if (headless) {
      headlessConfig = 'new'; // Use new headless mode
    } else {
      headlessConfig = false; // Show browser window
      // Add additional args for visible mode
      args.push('--window-position=0,0');
      args.push('--window-size=1920,1080');
    }

    // Determine which browser to launch
    const isFirefox = browser.toLowerCase() === 'firefox';
    
    // Configure browser-specific launch options
    const launchOptions = {
      headless: headlessConfig,
      args,
      userDataDir: tempDir,
      ignoreHTTPSErrors: true,
      defaultViewport: {
        width: 1920,
        height: 1080
      }
    };

    // Add Firefox-specific configurations
    if (isFirefox) {
      launchOptions.product = 'firefox';
      // Remove Chrome-specific arguments
      launchOptions.args = args.filter(arg => !arg.includes('disable-blink-features') && 
                                            !arg.includes('disable-features=TranslateUI,BlinkGenPropertyTrees'));
      // Add Firefox-specific arguments
      launchOptions.args.push('--width=1920');
      launchOptions.args.push('--height=1080');
    }

    // Launch the browser with a timeout
    browserInstance = await Promise.race([
      puppeteer.launch(launchOptions),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Browser launch timeout')), 30000))
    ]);

    // Setup cleanup handlers
    browserInstance.on('disconnected', async () => {
      try {
        const process = browserInstance.process();
        if (process) {
          process.kill('SIGKILL');
        }
      } catch (e) {
        console.error('Error killing browser process:', e);
      }

      if (tempDir) {
        try {
          await fs.remove(tempDir).catch((e) => {
            console.error('Error removing temp directory:', e);
          });
        } catch (e) {
          console.error('Error in temp directory cleanup:', e);
        }
      }
    });

    return browserInstance;
  } catch (error) {
    // Cleanup on launch failure
    if (browserInstance) {
      try {
        const process = browserInstance.process();
        if (process) {
          process.kill('SIGKILL');
        }
      } catch (e) {
        console.error('Error killing browser process during cleanup:', e);
      }
    }

    if (tempDir) {
      try {
        await fs.remove(tempDir).catch((e) => {
          console.error('Error removing temp directory during cleanup:', e);
        });
      } catch (e) {
        console.error('Error in temp directory cleanup during failure:', e);
      }
    }
    throw error;
  }
}

async function setupPage(page, fingerprint, proxy) {
  await page.setDefaultNavigationTimeout(30000);
  await page.setDefaultTimeout(30000);
  
  await page.setUserAgent(fingerprint.userAgent);
  
  await page.setExtraHTTPHeaders({
    'Accept-Language': fingerprint.language,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'DNT': '1'
  });

  await page.emulateTimezone(fingerprint.timezone.name);
  await page.setViewport({
    width: fingerprint.screen.width,
    height: fingerprint.screen.height,
    deviceScaleFactor: 1
  });

  if (proxy) {
    try {
      const proxyUrl = typeof proxy === 'string' ? proxy : proxy.proxy;
      const [host, port, username, password] = proxyUrl.split(':');
      
      if (username && password) {
        await page.authenticate({
          username,
          password
        });
      }
    } catch (e) {
      console.error('Error setting up proxy authentication:', e);
    }
  }

  // Add page cleanup handler with better error handling
  page.on('close', async () => {
    try {
      // Check if page is still valid
      if (!page.isClosed()) {
        try {
          // Try to clear browser data directly through page context
          await Promise.all([
            page.evaluate(() => {
              try {
                localStorage.clear();
                sessionStorage.clear();
                const cookies = document.cookie.split(';');
                for (let i = 0; i < cookies.length; i++) {
                  const cookie = cookies[i];
                  const eqPos = cookie.indexOf('=');
                  const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
                  document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT';
                }
              } catch (e) {}
            }).catch(() => {}),
            page.setCacheEnabled(false).catch(() => {}),
            page.coverage?.stopJSCoverage().catch(() => {}),
            page.coverage?.stopCSSCoverage().catch(() => {})
          ]);
        } catch (e) {
          console.error('Error clearing page data:', e);
        }
      }
    } catch (e) {
      console.error('Error in page cleanup:', e);
    }
  });

  // Add error event handler
  page.on('error', error => {
    console.error('Page error:', error);
  });

  // Add console message handler for debugging
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      console.log(`Page ${message.type()}: ${message.text()}`);
    }
  });
}

module.exports = {
  stealthMode,
  setStealthMode,
  launchBrowser,
  setupPage
}; 