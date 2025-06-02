const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { startConcurrentVisits, setLogger, stopAutomation } = require('./runner.js');
const { proxyManager } = require('./proxy-manager.js');
const { logger, setUILogger } = require('./logger');
const { getStopState, setStopState, resetStopState } = require('./state');

const isDev = !app.isPackaged;
let mainWindow = null;

// Function to send logs to the UI
function sendLogToUI(level, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('automation-log', { level, message });
  }
}

// Initialize IPC handlers
function initializeIpcHandlers() {
  logger.info('[Main] Starting IPC handler initialization...');
  
  // Set up the logger for the runner
  setLogger(sendLogToUI);
  setUILogger(sendLogToUI);
  
  // Handle window close confirmation
  ipcMain.handle('confirm-close', async () => {
    logger.info('[Main] Confirming app close');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
    app.quit();
  });

  // Handle window close cancellation
  ipcMain.handle('cancel-close', async () => {
    logger.info('[Main] Cancelling app close');
    // Do nothing, window will stay open
  });

  // Handle visit starts
  ipcMain.handle('start-visits', async (event, options) => {
    try {
      logger.info('[Main] Handling start-visits request');
      logger.info('[Main] Visit options:', options);

      // Sync proxies from frontend if provided
      if (Array.isArray(options.proxies) && options.proxies.length > 0) {
        proxyManager.proxies = options.proxies;
        proxyManager.currentIndex = 0;
        proxyManager.badProxies = new Set();
      }

      // Reset stop state before starting
      resetStopState();

      // Start the visits
      const result = await startConcurrentVisits(options.urls, {
        maxConcurrent: options.parallel || 3,
        targetClicks: options.targetClicks || 0,
        delays: options.delays || {},
        randomClicks: options.randomClicks || {},
        scrollDuration: options.scrollDuration || {},
        providers: options.providers || {},
        browser: options.browser || 'chrome',
        stealth: options.stealth !== false,
        headless: options.headless !== false,
        customSelectors: options.customSelectors || []
      });
      return Array.isArray(result) ? result : [];
    } catch (error) {
      logger.error('[Main] Error in start-visits:', error);
      return [{ status: 'ERROR', error: error?.message || String(error) }];
    }
  });

  // Handle proxy fetching
  ipcMain.handle('fetch-proxies', async (event, options) => {
    logger.info('[Main] Handling fetch-proxies request');
    try {
      return await proxyManager.fetchProxies(options);
    } catch (error) {
      logger.error('[Main] Error in fetch-proxies:', error);
      return { error: error.message };
    }
  });

  // Handle cache status
  ipcMain.handle('get-cache-status', async () => {
    logger.info('[Main] Handling get-cache-status request');
    try {
      const status = proxyManager.getCacheStatus();
      logger.info('[Main] Cache status:', status);
      return status;
    } catch (error) {
      logger.error('[Main] Error in get-cache-status:', error);
      return { error: error.message };
    }
  });

  // Handle stop automation
  ipcMain.handle('stop-automation', async () => {
    logger.info('[Main] Handling stop-automation request');
    stopAutomation();
    return true;
  });

  // Handle stop-visits request
  ipcMain.handle('stop-visits', async () => {
    try {
      logger.info('[Main] Handling stop-visits request');
      await stopAutomation();
      return { success: true };
    } catch (error) {
      logger.error('[Main] Error in stop-visits:', error);
      throw error;
    }
  });

  logger.info('[Main] IPC handlers initialization complete');
}

function createWindow() {
  logger.info('[Main] Creating window...');
  logger.info('[Main] Preload path:', path.join(__dirname, 'preload.js'));

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    show: false,
    autoHideMenuBar: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    resizable: false
  });

  // Handle window close event
  mainWindow.on('close', (event) => {
    logger.info('[Main] Window close event triggered');
    if (!mainWindow.isDestroyed()) {
      event.preventDefault();
      logger.info('[Main] Sending show-close-dialog event');
      mainWindow.webContents.send('show-close-dialog');
    }
  });

  if (isDev) {
    logger.info('[Main] Loading development URL...');
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    logger.info('[Main] Loading production file...');
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    logger.info('[Main] Window ready to show');
    mainWindow.show();
  });

  return mainWindow;
}

// Initialize app
app.whenReady().then(async () => {
  logger.info('[Main] App is ready, starting initialization...');
  
  // Initialize IPC handlers first
  initializeIpcHandlers();
  
  // Then create the window
  const win = createWindow();
  
  // Wait for the window to be ready
  await new Promise(resolve => {
    win.webContents.on('did-finish-load', () => {
      logger.info('[Main] Window finished loading');
      resolve();
    });
  });
  
  logger.info('[Main] App initialization complete');
});

app.on('window-all-closed', () => {
  logger.info('[Main] All windows closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  logger.info('[Main] App quitting');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Export the sendLogToUI function
module.exports = { sendLogToUI };
