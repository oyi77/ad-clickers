const { faker } = require('@faker-js/faker');
const randomUseragent = require('random-useragent');
const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../logger');
const { getStopState } = require('../state');

// Screen resolutions with weights
const SCREEN_RESOLUTIONS = [
  { width: 1920, height: 1080, weight: 0.4 },
  { width: 1366, height: 768, weight: 0.2 },
  { width: 1536, height: 864, weight: 0.15 },
  { width: 1440, height: 900, weight: 0.15 },
  { width: 1280, height: 720, weight: 0.1 }
];

// WebGL renderers with weights
const WEBGL_RENDERERS = [
  { 
    vendor: 'Google Inc.', 
    renderer: 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)',
    weight: 0.15
  },
  { 
    vendor: 'Google Inc.', 
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0)',
    weight: 0.12
  },
  { 
    vendor: 'Apple GPU', 
    renderer: 'Apple M1',
    weight: 0.1
  },
  { 
    vendor: 'Google Inc.', 
    renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0)',
    weight: 0.12
  },
  {
    vendor: 'Google Inc.',
    renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)',
    weight: 0.1
  },
  {
    vendor: 'Google Inc.',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
    weight: 0.08
  },
  {
    vendor: 'Google Inc.',
    renderer: 'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0)',
    weight: 0.08
  },
  {
    vendor: 'Google Inc.',
    renderer: 'ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11 vs_5_0 ps_5_0)',
    weight: 0.07
  },
  {
    vendor: 'Google Inc.',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)',
    weight: 0.07
  },
  {
    vendor: 'Google Inc.',
    renderer: 'ANGLE (AMD, AMD Radeon Vega 8 Direct3D11 vs_5_0 ps_5_0)',
    weight: 0.06
  },
  {
    vendor: 'Google Inc.',
    renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
    weight: 0.05
  },
  {
    vendor: 'Google Inc.',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce MX450 Direct3D11 vs_5_0 ps_5_0)',
    weight: 0.05
  },
  {
    vendor: 'Google Inc.',
    renderer: 'ANGLE (AMD, AMD Radeon Pro 5500M Direct3D11 vs_5_0 ps_5_0)',
    weight: 0.05
  }
];

function getWeightedRandomItem(array) {
  const totalWeight = array.reduce((sum, item) => sum + (item.weight || 1), 0);
  let random = Math.random() * totalWeight;
  
  for (const item of array) {
    random -= (item.weight || 1);
    if (random <= 0) {
      return item;
    }
  }
  
  return array[0];
}

// Realistic plugin lists for common browsers
const CHROME_PLUGINS = [
  { name: 'PDF Viewer', description: 'Portable Document Format' },
  { name: 'Chrome PDF Viewer', description: 'Portable Document Format' },
  { name: 'Native Client', description: 'Native Client' },
];

const FIREFOX_PLUGINS = [
  { name: 'Shockwave Flash', description: 'Shockwave Flash 11.2 r202' },
  { name: 'Adobe Acrobat', description: 'Adobe Acrobat Plug-In Version 21.001.20145' },
];

// Realistic Mime types
const COMMON_MIME_TYPES = [
  { type: 'application/pdf', suffixes: 'pdf' },
  { type: 'application/x-nacl', suffixes: '' },
  { type: 'application/x-pnacl', suffixes: '' },
  { type: 'application/x-shockwave-flash', suffixes: 'swf' },
];

function getRandomFingerprint() {
  const userAgent = randomUseragent.getRandom(ua => {
    return ua.browserName === 'Chrome' || ua.browserName === 'Firefox';
  });

  const screen = getWeightedRandomItem(SCREEN_RESOLUTIONS);
  const timezone = faker.location.timeZone();
  const webgl = getWeightedRandomItem(WEBGL_RENDERERS);
  
  // More realistic language distribution with weights
  const languages = [
    { value: 'en-US,en;q=0.9', weight: 0.35 },
    { value: 'en-GB,en;q=0.9', weight: 0.15 },
    { value: 'fr-FR,fr;q=0.9,en;q=0.8', weight: 0.1 },
    { value: 'de-DE,de;q=0.9,en;q=0.8', weight: 0.1 },
    { value: 'es-ES,es;q=0.9,en;q=0.8', weight: 0.1 },
    { value: 'it-IT,it;q=0.9,en;q=0.8', weight: 0.05 },
    { value: 'pt-BR,pt;q=0.9,en;q=0.8', weight: 0.05 },
    { value: 'ru-RU,ru;q=0.9,en;q=0.8', weight: 0.05 },
    { value: 'ja-JP,ja;q=0.9,en;q=0.8', weight: 0.05 }
  ];
  const language = getWeightedRandomItem(languages).value;

  const platform = userAgent.includes('Windows') ? 'Win32' :
                  userAgent.includes('Macintosh') ? 'MacIntel' :
                  'Linux x86_64';

  // More realistic color depth distribution
  const colorDepths = [
    { value: 24, weight: 0.7 },  // Most common
    { value: 30, weight: 0.2 },  // HDR displays
    { value: 48, weight: 0.1 }   // Professional displays
  ];
  const colorDepth = getWeightedRandomItem(colorDepths).value;

  // More realistic device memory distribution
  const deviceMemories = [
    { value: 4, weight: 0.2 },   // Budget laptops
    { value: 8, weight: 0.5 },   // Most common
    { value: 16, weight: 0.25 }, // Gaming/Workstation
    { value: 32, weight: 0.05 }  // High-end systems
  ];
  const deviceMemory = getWeightedRandomItem(deviceMemories).value;

  // More realistic hardware concurrency distribution
  const hardwareConcurrencies = [
    { value: 2, weight: 0.1 },   // Budget systems
    { value: 4, weight: 0.4 },   // Common laptops
    { value: 6, weight: 0.2 },   // Mid-range
    { value: 8, weight: 0.2 },   // Gaming/Workstation
    { value: 12, weight: 0.05 }, // High-end
    { value: 16, weight: 0.05 }  // Workstation/Server
  ];
  const hardwareConcurrency = getWeightedRandomItem(hardwareConcurrencies).value;

  // More realistic plugin count distribution and selection
  const pluginCounts = [
    { value: 0, weight: 0.2 },   // Fewer plugins
    { value: 1, weight: 0.3 },   // Common
    { value: 2, weight: 0.3 },   // Power users
    { value: 3, weight: 0.1 },   // Developers
    { value: 4, weight: 0.05 },  // Heavy users
    { value: 5, weight: 0.05 }   // Rare
  ];
  const numPlugins = getWeightedRandomItem(pluginCounts).value;

  let selectedPlugins = [];
  if (userAgent.includes('Chrome')) {
    selectedPlugins = faker.helpers.arrayElements(CHROME_PLUGINS, numPlugins > CHROME_PLUGINS.length ? CHROME_PLUGINS.length : numPlugins);
  } else if (userAgent.includes('Firefox')) {
    selectedPlugins = faker.helpers.arrayElements(FIREFOX_PLUGINS, numPlugins > FIREFOX_PLUGINS.length ? FIREFOX_PLUGINS.length : numPlugins);
  }

  // Generate realistic build ID format
  const buildID = faker.string.alphanumeric(8).toUpperCase();

  // More realistic canvas noise values
  const canvasNoise = faker.number.float({ 
    min: 0.1, 
    max: 0.9,
    precision: 0.0001 
  });
  
  const webglNoise = faker.number.float({ 
    min: 0.1, 
    max: 0.9,
    precision: 0.0001 
  });

  // Generate realistic mime types based on selected plugins
  const mimeTypes = [];
  const addedMimeTypes = new Set(); // To avoid duplicates
  selectedPlugins.forEach(plugin => {
      const associatedMimes = COMMON_MIME_TYPES.filter(mime => plugin.description.includes(mime.suffixes.toUpperCase() || mime.type.split('/').pop().toUpperCase()));
      associatedMimes.forEach(mime => {
          if (!addedMimeTypes.has(mime.type)) {
              mimeTypes.push({
                  type: mime.type,
                  suffixes: mime.suffixes,
                  description: mime.description || '',
                  enabledPlugin: plugin // Link mime type to the plugin that enables it
              });
              addedMimeTypes.add(mime.type);
          }
      });
  });

  // Generate realistic font list (simplified)
  const fonts = [
      'Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Impact'
  ];
  const selectedFonts = faker.helpers.arrayElements(fonts, faker.number.int({ min: 5, max: fonts.length }));

  return {
    userAgent,
    screen,
    timezone: {
      offset: -new Date().getTimezoneOffset(),
      name: timezone
    },
    language,
    platform,
    webgl,
    colorDepth,
    deviceMemory,
    hardwareConcurrency,
    mobile: false,
    doNotTrack: faker.datatype.boolean({ probability: 0.3 }), // 30% chance of true
    cookiesEnabled: true,
    plugins: selectedPlugins, // Use the selected plugins
    mimeTypes: mimeTypes, // Add generated mime types
    fonts: selectedFonts, // Add generated font list
    audioC: { // AudioContext fingerprinting (simplified)
        bufferSize: faker.helpers.arrayElement([512, 1024, 2048, 4096]),
        channelCount: faker.helpers.arrayElement([1, 2]),
        sampleRate: faker.helpers.arrayElement([44100, 48000]),
        noise: faker.number.float({ min: -1, max: 1, precision: 0.000001 }) // Simulate noise
    },
    canvas: { // Canvas fingerprinting (existing + noise)
      noise: canvasNoise,
      webglNoise: webglNoise,
      // Additional canvas properties could be added here if needed
    },
    clientRects: { // ClientRects noise (simplified)
        noise: faker.number.float({ min: -0.5, max: 0.5, precision: 0.00001 }) // Simulate sub-pixel noise
    },
    cpuClass: platform.includes('Win') ? faker.helpers.arrayElement(['x86', 'x64', '']) : '', // CPU class for Windows
    navigator: { // Additional navigator properties
        connection: { // Simulate NetworkInformation API
            rtt: faker.helpers.arrayElement([50, 100, 150, 200, 250]),
            downlink: faker.number.float({ min: 1, max: 10, precision: 0.1 }),
            effectiveType: faker.helpers.arrayElement(['4g', '3g']),
            saveData: faker.datatype.boolean({ probability: 0.1 })
        },
        buildID: buildID, // Use the generated build ID
        vendorSub: '', // Typically empty
        productSub: '20030107', // Common value
        vendor: faker.helpers.arrayElement(['Google Inc.', 'Apple Computer, Inc.']), // Already exists, but ensuring it's here
        maxTouchPoints: 0, // Already exists, ensuring it's here
        pdfViewerEnabled: selectedPlugins.some(p => p.name.includes('PDF')), // Infer from plugins
        webdriver: false // Indicate no WebDriver detected
    },
    permissions: { // Simulate Permissions API states
        notifications: faker.helpers.arrayElement(['granted', 'denied', 'prompt']),
        push: faker.helpers.arrayElement(['granted', 'denied', 'prompt']),
        midi: faker.helpers.arrayElement(['granted', 'denied', 'prompt']),
        camera: faker.helpers.arrayElement(['granted', 'denied', 'prompt']),
        microphone: faker.helpers.arrayElement(['granted', 'denied', 'prompt']),
        geolocation: faker.helpers.arrayElement(['granted', 'denied', 'prompt'])
    },
    mediaDevices: { // Simulate MediaDevices API
        supports: faker.datatype.boolean({ probability: 0.95 }), // Most devices support it
        deviceCount: faker.number.int({ min: 0, max: 5 }) // Number of media devices
    }
  };
}

// Add fingerprint format detection
function detectFingerprintFormat(fp) {
  // Check for Bablosoft format
  if (fp.hasOwnProperty('navigator') && fp.hasOwnProperty('screen')) {
    return 'bablosoft';
  }
  
  // Check for IX Browser format
  if (fp.hasOwnProperty('userAgent') && fp.hasOwnProperty('webgl')) {
    return 'ixbrowser';
  }
  
  // Check for our default format
  if (fp.hasOwnProperty('userAgent') && fp.hasOwnProperty('screen')) {
    return 'default';
  }
  
  return 'unknown';
}

function validateFingerprint(fp) {
  const format = detectFingerprintFormat(fp);
  
  switch (format) {
    case 'bablosoft':
      return {
        valid: true,
        format: 'bablosoft',
        converted: convertBablosoftToDefault(fp)
      };
      
    case 'ixbrowser':
      return {
        valid: true,
        format: 'ixbrowser',
        converted: convertIXBrowserToDefault(fp)
      };
      
    case 'default':
      return {
        valid: true,
        format: 'default',
        converted: fp
      };
      
    default:
      return {
        valid: false,
        format: 'unknown',
        error: 'Invalid fingerprint format'
      };
  }
}

function convertBablosoftToDefault(fp) {
  return {
    userAgent: fp.navigator.userAgent,
    screen: {
      width: fp.screen.width,
      height: fp.screen.height
    },
    timezone: {
      offset: fp.timezone.offset,
      name: fp.timezone.name
    },
    language: fp.navigator.language,
    platform: fp.navigator.platform,
    webgl: {
      vendor: fp.webgl.vendor,
      renderer: fp.webgl.renderer
    },
    colorDepth: fp.screen.colorDepth,
    deviceMemory: fp.navigator.deviceMemory,
    hardwareConcurrency: fp.navigator.hardwareConcurrency,
    mobile: fp.navigator.mobile,
    doNotTrack: fp.navigator.doNotTrack,
    cookiesEnabled: fp.navigator.cookiesEnabled,
    plugins: fp.navigator.plugins.length,
    touchPoints: fp.navigator.maxTouchPoints,
    maxTouchPoints: fp.navigator.maxTouchPoints,
    vendor: fp.navigator.vendor,
    appVersion: fp.navigator.appVersion,
    appName: fp.navigator.appName,
    appCodeName: fp.navigator.appCodeName,
    product: fp.navigator.product,
    productSub: fp.navigator.productSub,
    oscpu: fp.navigator.oscpu,
    buildID: fp.navigator.buildID,
    canvas: fp.canvas
  };
}

// Convert IX Browser format to our default format
function convertIXBrowserToDefault(fp) {
  return {
    userAgent: fp.userAgent,
    screen: {
      width: fp.screenWidth || 1920,
      height: fp.screenHeight || 1080
    },
    timezone: {
      offset: fp.timezoneOffset || -new Date().getTimezoneOffset(),
      name: fp.timezone || 'UTC'
    },
    language: fp.language || 'en-US',
    platform: fp.platform || 'Win32',
    webgl: {
      vendor: fp.webgl.vendor || 'Google Inc.',
      renderer: fp.webgl.renderer || 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0)'
    },
    colorDepth: fp.colorDepth || 24,
    deviceMemory: fp.deviceMemory || 8,
    hardwareConcurrency: fp.hardwareConcurrency || 4,
    mobile: fp.mobile || false,
    doNotTrack: fp.doNotTrack || false,
    cookiesEnabled: fp.cookiesEnabled || true,
    plugins: fp.plugins || 0,
    touchPoints: fp.touchPoints || 0,
    maxTouchPoints: fp.maxTouchPoints || 0,
    vendor: fp.vendor || 'Google Inc.',
    appVersion: fp.appVersion || fp.userAgent,
    appName: fp.appName || 'Netscape',
    appCodeName: fp.appCodeName || 'Mozilla',
    product: fp.product || 'Gecko',
    productSub: fp.productSub || '20030107',
    oscpu: fp.oscpu,
    buildID: fp.buildID || faker.string.alphanumeric(8),
    canvas: fp.canvas || {
      noise: faker.number.float({ min: 0.1, max: 0.9 }),
      webglNoise: faker.number.float({ min: 0.1, max: 0.9 })
    }
  };
}

// Modify loadLocalFingerprints to use validation
async function loadLocalFingerprints() {
  try {
    const fpDir = path.join(process.cwd(), 'public', 'fp');
    const files = await fs.readdir(fpDir);
    const fpFiles = files.filter(f => f.endsWith('.json'));
    
    if (fpFiles.length === 0) {
      console.error('No fingerprint files found in public/fp directory');
      return null;
    }

    const randomFile = fpFiles[Math.floor(Math.random() * fpFiles.length)];
    const fpPath = path.join(fpDir, randomFile);
    
    const fpData = await fs.readJson(fpPath);
    console.log(`Loaded fingerprint from ${randomFile}`);
    
    // Validate and convert the fingerprint
    const validation = validateFingerprint(fpData);
    if (!validation.valid) {
      console.error(`Invalid fingerprint format in ${randomFile}:`, validation.error);
      return null;
    }
    
    console.log(`Converted ${validation.format} fingerprint to default format`);
    return validation.converted;
  } catch (e) {
    console.error('Error loading local fingerprints:', e);
    return null;
  }
}

// Modify getFingerprintFromProvider to use validation
async function getFingerprintFromProvider(provider = 'default') {
  try {
    if (getStopState()) {
      logger.info('[Automation] Stop requested during fingerprint fetch');
      return null;
    }

    if (provider === 'default') {
      return getRandomFingerprint();
    }

    if (provider === 'local') {
      const localFp = await loadLocalFingerprints();
      if (localFp) {
        return localFp;
      }
      console.log('Falling back to default fingerprint due to local loading failure');
      return getRandomFingerprint();
    }

    const response = await axios.get(provider);
    if (response.data) {
      // Validate and convert the fingerprint
      const validation = validateFingerprint(response.data);
      if (!validation.valid) {
        console.error('Invalid fingerprint format from provider:', validation.error);
        return getRandomFingerprint();
      }
      
      console.log(`Converted ${validation.format} fingerprint to default format`);
      return validation.converted;
    }
  } catch (e) {
    logger.error('[Automation] Error getting fingerprint:', e);
    return null;
  }
  
  return getRandomFingerprint();
}

module.exports = {
  getRandomFingerprint,
  getFingerprintFromProvider,
  detectFingerprintFormat,
  validateFingerprint,
  convertBablosoftToDefault,
  convertIXBrowserToDefault
}; 