const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

let stealthEnabled = true;

function setStealthMode(enabled) {
  stealthEnabled = enabled;
  if (enabled) {
    if (!puppeteer.plugins.some(p => p.name === 'stealth')) {
      puppeteer.use(StealthPlugin());
    }
  } else {
    puppeteer.plugins = puppeteer.plugins.filter(p => p.name !== 'stealth');
  }
}

async function launchBrowser(browser = 'chrome', proxy = null, headless = true) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'puppeteer-'));
  
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

  const browserInstance = await puppeteer.launch({
    headless: headlessConfig,
    args,
    userDataDir: tempDir,
    ignoreHTTPSErrors: true,
    defaultViewport: {
      width: 1920,
      height: 1080
    },
    product: browser === 'firefox' ? 'firefox' : 'chrome'
  });

  return browserInstance;
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
}

module.exports = {
  stealthEnabled,
  setStealthMode,
  launchBrowser,
  setupPage
}; 