const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const ProxyChain = require('proxy-chain');
const fs = require('fs-extra');
const path = require('path');
const { ipcMain, webContents } = require('electron');
const { URL } = require('url');
const { shuffleArray } = require('./utils');
const { logger } = require('./logger');

function sendProxyLog(message, progress = null) {
  // Send to all renderer windows
  for (const wc of webContents.getAllWebContents()) {
    wc.send('proxy-log', { message, progress });
  }
}

class ProxyManager {
  constructor() {
    this.proxies = [];
    this.badProxies = new Set(); // Set to store proxies that failed
    this.workingProxies = [];
    this.cacheFile = path.join(process.cwd(), 'proxy-cache.json');
    this.loadCache();
    this.proxySources = [
      {
        name: 'Sunny9577 HTTP',
        url: 'https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/proxies.txt',
        type: 'http',
        parser: (data) => data.split('\n').filter(Boolean)
      },
      {
        name: 'Proxifly HTTP',
        url: 'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt',
        type: 'http',
        parser: (data) => {
          // Proxifly format: IP:PORT:COUNTRY:ANONYMITY
          return data.split('\n')
            .filter(Boolean)
            .map(line => line.split(':').slice(0, 2).join(':'))
            .filter(proxy => {
              const [ip, port] = proxy.split(':');
              return ip && port && !isNaN(parseInt(port));
            });
        }
      },
      {
        name: 'Proxifly SOCKS4',
        url: 'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks4/data.txt',
        type: 'socks4',
        parser: (data) => {
          return data.split('\n')
            .filter(Boolean)
            .map(line => line.split(':').slice(0, 2).join(':'))
            .filter(proxy => {
              const [ip, port] = proxy.split(':');
              return ip && port && !isNaN(parseInt(port));
            });
        }
      },
      {
        name: 'Proxifly SOCKS5',
        url: 'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks5/data.txt',
        type: 'socks5',
        parser: (data) => {
          return data.split('\n')
            .filter(Boolean)
            .map(line => line.split(':').slice(0, 2).join(':'))
            .filter(proxy => {
              const [ip, port] = proxy.split(':');
              return ip && port && !isNaN(parseInt(port));
            });
        }
      }
    ];
    this.currentIndex = 0;
    this.loadProxies();
  }

  getCacheStatus() {
    return {
      totalProxies: this.proxies.length,
      workingProxies: this.workingProxies.length,
      lastUpdated: this.lastUpdated || null,
      cacheFile: this.cacheFile,
      proxySources: this.proxySources.map(source => ({
        name: source.name,
        type: source.type,
        url: source.url
      }))
    };
  }

  async loadCache() {
    try {
      if (await fs.pathExists(this.cacheFile)) {
        const data = await fs.readJson(this.cacheFile);
        this.proxies = data.proxies || [];
        this.lastUpdated = data.lastUpdated || new Date().toISOString();
        logger.info(`[ProxyManager] Loaded ${this.proxies.length} proxies from cache (Last updated: ${this.lastUpdated})`);
      }
    } catch (e) {
      logger.error('[ProxyManager] Error loading proxy cache:', e);
      this.lastUpdated = null;
    }
  }

  async saveCache() {
    try {
      this.lastUpdated = new Date().toISOString();
      await fs.writeJson(this.cacheFile, { 
        proxies: this.proxies,
        lastUpdated: this.lastUpdated
      });
    } catch (e) {
      logger.error('[ProxyManager] Error saving proxy cache:', e);
    }
  }

  validateProxyFormat(proxy) {
    if (!proxy) return false;
    
    try {
      // Handle different proxy formats
      let proxyStr = proxy;
      
      // If it's an object with proxy property
      if (typeof proxy === 'object' && proxy.proxy) {
        proxyStr = proxy.proxy;
      }
      
      // If it's a string, ensure it has protocol
      if (typeof proxyStr === 'string') {
        // Remove any existing protocol
        proxyStr = proxyStr.replace(/^(https?:\/\/|socks5:\/\/)/, '');
        
        // Check for ip:port:username:password format
        const parts = proxyStr.split(':');
        if (parts.length === 4) {
          const [ip, port, username, password] = parts;
          if (ip && port && username && password && !isNaN(parseInt(port))) {
            return true;
          }
        }
        
        // Check for username:password@ip:port format
        const [auth, host] = proxyStr.split('@');
        if (host) {
          const [username, password] = auth.split(':');
          const [ip, port] = host.split(':');
          if (username && password && ip && port && !isNaN(parseInt(port))) {
            return true;
          }
        }
        
        // Check for simple ip:port format
        const [ip, port] = proxyStr.split(':');
        if (ip && port && !isNaN(parseInt(port))) {
          return true;
        }
      }
      
      return false;
    } catch (e) {
      logger.error('[ProxyManager] Invalid proxy format:', e);
      return false;
    }
  }

  async getProxyUrl(proxy) {
    if (!proxy) {
      proxy = this.getNextProxy();
    }

    if (!proxy) {
      return null;
    }

    try {
      const { host, port, username, password } = proxy;
      if (username && password) {
        return `http://${username}:${password}@${host}:${port}`;
      }
      return `http://${host}:${port}`;
    } catch (error) {
      logger.error('[ProxyManager] Error formatting proxy URL:', error);
      return null;
    }
  }

  loadProxies() {
    try {
      const proxyPath = path.join(__dirname, '..', 'public', 'proxy', 'proxy.json');
      if (fs.existsSync(proxyPath)) {
        const data = fs.readJsonSync(proxyPath);
        this.proxies = shuffleArray([...data]); // Create a new shuffled array
        logger.info(`[ProxyManager] Loaded ${this.proxies.length} proxies`);
      }
    } catch (error) {
      logger.error('[ProxyManager] Error loading proxies:', error);
      this.proxies = [];
    }
  }

  getNextProxy() {
    if (this.proxies.length === 0) {
      return null;
    }

    let proxy = null;
    let attempts = 0;
    const maxAttempts = this.proxies.length; // Prevent infinite loops

    while (attempts < maxAttempts) {
      // If we've reached the end, reshuffle and start over
      if (this.currentIndex >= this.proxies.length) {
        this.reshuffleProxies(); // Reshuffle also clears badProxies set
        // If after reshuffling, proxies are still zero (shouldn't happen if initially > 0), break.
        if (this.proxies.length === 0) {
          logger.warn('[ProxyManager] No proxies available after reshuffle.');
          return null;
        }
      }

      const currentProxy = this.proxies[this.currentIndex];
      this.currentIndex++;
      attempts++;

      // Check if the current proxy is in the badProxies set
      const proxyString = typeof currentProxy === 'string' ? currentProxy : currentProxy.proxy;
      if (!this.badProxies.has(proxyString)) {
        proxy = currentProxy;
        break; // Found a good proxy, exit loop
      } else {
        logger.info(`[ProxyManager] Skipping bad proxy: ${proxyString}`);
      }
    }

    // If loop finished without finding a good proxy
    if (!proxy) {
      logger.warn('[ProxyManager] No available good proxies found after checking all.');
    }

    return proxy;
  }

  // Add method to force proxy reshuffle
  reshuffleProxies() {
    this.proxies = shuffleArray([...this.proxies]);
    this.currentIndex = 0;
    this.badProxies.clear(); // Clear bad proxies on reshuffle
  }

  getProxyCount() {
    return this.proxies.length;
  }

  // Add fetchProxies method
  async fetchProxies(options = {}) {
    // Fetch proxies from all sources
    let allProxies = [];
    for (const source of this.proxySources) {
      try {
        const resp = await axios.get(source.url, { timeout: 20000 });
        const parsed = source.parser(resp.data);
        allProxies = allProxies.concat(parsed);
        logger.info(`[ProxyManager] Loaded ${parsed.length} proxies from ${source.name}`);
      } catch (e) {
        logger.error(`[ProxyManager] Failed to load proxies from ${source.name}: ${e.message}`, e);
      }
    }
    this.proxies = shuffleArray([...new Set(allProxies)]);
    await this.saveCache();
    logger.info(`[ProxyManager] Total proxies loaded: ${this.proxies.length}`);
    return this.proxies;
  }

  // Add method to mark a proxy as bad
  markBadProxy(proxy) {
    if (proxy && (typeof proxy === 'string' || proxy.proxy)) {
      const proxyString = typeof proxy === 'string' ? proxy : proxy.proxy;
      this.badProxies.add(proxyString);
      logger.warn(`[ProxyManager] Marked proxy as bad: ${proxyString}`);
    }
  }
}

const proxyManager = new ProxyManager();
module.exports = { proxyManager };

// Add test execution
if (process.argv.includes('--test-proxies')) {
  proxyManager.testProxySources()
    .then(results => {
      logger.info('\n[ProxyManager] Test Results:', JSON.stringify(results, null, 2));
      process.exit(0);
    })
    .catch(error => {
      logger.error('[ProxyManager] Test failed:', error);
      process.exit(1);
    });
}