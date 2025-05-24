const { contextBridge, ipcRenderer } = require('electron');

// Log when the preload script is loaded
console.log('[Preload] Script loaded');

// Initialize IPC communication
function initializeIpc() {
  console.log('[Preload] Starting IPC communication initialization...');
  
  // Expose protected methods that allow the renderer process to use
  // the ipcRenderer without exposing the entire object
  contextBridge.exposeInMainWorld(
    'electron',
    {
      isElectron: true,
      invoke: (channel, ...args) => {
        // Whitelist channels
        const validChannels = ['start-visits', 'fetch-proxies', 'get-cache-status', 'confirm-close', 'cancel-close', 'stop-automation'];
        if (validChannels.includes(channel)) {
          console.log(`[Preload] Invoking IPC channel: ${channel}`);
          // Add type safety for the invoke call
          // The args structure for 'start-visits' now includes:
          // { proxies: string[], urls: string[], parallel: number, customSelectors: string[],
          //   delays: object, providers: object, browser: string, stealth: boolean, headless: boolean,
          //   targetImpressions: number, targetClicks: number }
          return ipcRenderer.invoke(channel, ...args).catch(error => {
            console.error(`[Preload] Error invoking ${channel}:`, error);
            throw error;
          });
        }
        console.error(`[Preload] Invalid IPC channel: ${channel}`);
        return Promise.reject(new Error(`Invalid channel: ${channel}`));
      },
      ipcRenderer: {
        on: (channel, listener) => {
          const validChannels = ['proxy-log', 'automation-log', 'show-close-dialog'];
          if (validChannels.includes(channel)) {
            console.log(`[Preload] Setting up listener for channel: ${channel}`);
            // Wrap the listener to ensure proper error handling
            const wrappedListener = (event, ...args) => {
              try {
                console.log(`[Preload] Received message on ${channel}:`, args);
                listener(event, ...args);
              } catch (error) {
                console.error(`[Preload] Error in listener for ${channel}:`, error);
              }
            };
            ipcRenderer.on(channel, wrappedListener);
          } else {
            console.error(`[Preload] Invalid listener channel: ${channel}`);
          }
        },
        removeAllListeners: (channel) => {
          const validChannels = ['proxy-log', 'automation-log', 'show-close-dialog'];
          if (validChannels.includes(channel)) {
            console.log(`[Preload] Removing listeners for channel: ${channel}`);
            ipcRenderer.removeAllListeners(channel);
          } else {
            console.error(`[Preload] Invalid remove listeners channel: ${channel}`);
          }
        }
      }
    }
  );
  
  console.log('[Preload] IPC communication initialization complete');
}

// Initialize when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  console.log('[Preload] DOM Content Loaded');
  initializeIpc();
});
