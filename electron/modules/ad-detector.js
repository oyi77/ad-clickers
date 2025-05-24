function validateCustomSelectors(selectors) {
  return selectors.map(selector => {
    selector = selector.trim();
    
    if (selector.includes('iframe')) {
      if (selector.includes('.')) {
        const parts = selector.split('.');
        if (parts.length > 1) {
          const classPart = parts.slice(1).join('.');
          return `iframe[class*="${classPart}"]`;
        }
      }
    }
    
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return `[class*="${className}"]`;
    }
    
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      return `[id*="${id}"]`;
    }
    
    if (selector.includes('[') && selector.includes(']')) {
      return selector;
    }
    
    if (/^[a-zA-Z]+$/.test(selector)) {
      return selector;
    }
    
    return `[class*="${selector}"], [id*="${selector}"], [data-*="${selector}"]`;
  }).filter(Boolean);
}

function getDefaultAdSelectors() {
  return [
    // Ads Provider Specialized 
    '//iframe[5]',
    '/html/iframe[5]',
    '//iframe[4]',
    '/html/iframe[4]',
    '//iframe[3]',
    '/html/iframe[3]',
    '//iframe[2]',
    '/html/iframe[2]',
    '//iframe[1]',
    '/html/iframe[1]',
    '//iframe[contains(@src, "ad")]',
    '//iframe[contains(@src, "banner")]',
    '//iframe[contains(@src, "sponsor")]',
    '//iframe[contains(@src, "promo")]',
    '//iframe[contains(@src, "marketing")]',
    '//iframe[contains(@src, "advert")]',
    '//iframe[contains(@src, "affiliate")]',
    '//iframe[contains(@src, "partner")]',
    '//iframe[contains(@src, "track")]',
    '//iframe[contains(@src, "click")]',
    // Common ad selectors
    'a[href*="ad"]',
    'a[href*="sponsor"]',
    'a[href*="promo"]',
    'a[href*="click"]',
    'a[href*="track"]',
    'a[href*="affiliate"]',
    'a[href*="partner"]',
    'a[href*="banner"]',
    'a[href*="advert"]',
    'a[href*="marketing"]',
    // Iframe selectors
    'iframe[src*="ad"]',
    'iframe[src*="banner"]',
    'iframe[src*="sponsor"]',
    'iframe[src*="promo"]',
    'iframe[src*="marketing"]',
    'iframe[src*="advert"]',
    'iframe[src*="affiliate"]',
    'iframe[src*="partner"]',
    'iframe[src*="track"]',
    'iframe[src*="click"]',
    'iframe[srcdoc=""]',
    '[data-ad-detected="true"]',
    'iframe[class*="ad"]',
    'iframe[class*="banner"]',
    'iframe[class*="sponsor"]',
    'iframe[class*="promo"]',
    'iframe[class*="marketing"]',
    'iframe[class*="advert"]',
    'iframe[class*="affiliate"]',
    'iframe[class*="partner"]',
    'iframe[class*="track"]',
    'iframe[class*="click"]',
    'iframe[class*="right"][class*="top"]',
  ];
}

function setupAdDetection(page, taskId) {
  return page.evaluateOnNewDocument(() => {
    const originalOpen = window.open;
    window.open = function() {
      console.log(`[Task ${taskId}] Popup detected:`, arguments[0]);
      return null;
    };

    function isLikelyAd(element) {
      const adAttributes = [
        'data-ad',
        'data-adunit',
        'data-ad-client',
        'data-ad-slot',
        'data-ad-format',
        'data-ad-region',
        'data-ad-channel',
        'data-ad-type',
        'data-ad-status',
        'data-ad-id',
        'data-adclick',
        'data-adclickid',
        'data-advertiser',
        'data-advertiser-id',
        'data-advertiser-name',
        'data-advertiser-url',
        'data-advertiser-domain',
        'data-advertiser-category',
        'data-advertiser-type',
        'data-advertiser-status'
      ];

      const adClassPatterns = [
        /ad-/i,
        /ads?-/i,
        /banner/i,
        /sponsor/i,
        /promo/i,
        /marketing/i,
        /advertisement/i,
        /advert/i,
        /affiliate/i,
        /partner/i,
        /track/i,
        /click/i,
        /[a-z]{8,}/i,
        /right/i,
        /top/i,
        /google/i,
        /doubleclick/i,
        /adtech/i,
        /adroll/i,
        /criteo/i,
        /taboola/i,
        /outbrain/i,
        /revcontent/i,
        /contentad/i,
        /adform/i,
        /adroll/i,
        /adroll/i,
        /adroll/i,
        /adroll/i
      ];

      const adIdPatterns = [
        /ad-/i,
        /ads?-/i,
        /banner/i,
        /sponsor/i,
        /promo/i,
        /marketing/i,
        /advertisement/i,
        /advert/i,
        /affiliate/i,
        /partner/i,
        /track/i,
        /click/i,
        /right/i,
        /top/i,
        /google/i,
        /doubleclick/i,
        /adtech/i,
        /adroll/i,
        /criteo/i,
        /taboola/i,
        /outbrain/i,
        /revcontent/i,
        /contentad/i,
        /adform/i
      ];

      // Special handling for iframes
      if (element.tagName === 'IFRAME') {
        // Check if it's one of the first few iframes (often ads)
        const iframes = document.getElementsByTagName('iframe');
        const iframeIndex = Array.from(iframes).indexOf(element);
        if (iframeIndex <= 5) return true;

        // Check src attribute
        const src = element.getAttribute('src') || '';
        if (/ad|banner|sponsor|promo|marketing|advert|affiliate|partner|track|click|google|doubleclick|adtech|adroll|criteo|taboola|outbrain|revcontent|contentad|adform/i.test(src)) {
          return true;
        }

        // Check for empty srcdoc
        if (element.hasAttribute('srcdoc') && element.getAttribute('srcdoc') === '') {
          return true;
        }
        
        // Check for right/top positioning classes
        const classes = element.className.split(' ');
        if (classes.some(c => c.includes('right')) && classes.some(c => c.includes('top'))) {
          return true;
        }

        // Check for common ad provider classes
        if (classes.some(c => /google|doubleclick|adtech|adroll|criteo|taboola|outbrain|revcontent|contentad|adform/i.test(c))) {
          return true;
        }
      }

      // Check for ad attributes
      for (const attr of adAttributes) {
        if (element.hasAttribute(attr)) return true;
      }

      // Check class names
      if (element.className) {
        const classes = element.className.split(' ');
        for (const cls of classes) {
          for (const pattern of adClassPatterns) {
            if (pattern.test(cls)) return true;
          }
        }
      }

      // Check element ID
      if (element.id) {
        for (const pattern of adIdPatterns) {
          if (pattern.test(element.id)) return true;
        }
      }

      // Check for common ad dimensions
      const style = window.getComputedStyle(element);
      const width = parseInt(style.width);
      const height = parseInt(style.height);
      const commonAdSizes = [
        [728, 90],   // Leaderboard
        [300, 250],  // Medium Rectangle
        [336, 280],  // Large Rectangle
        [300, 600],  // Half Page
        [320, 50],   // Mobile Banner
        [970, 90],   // Large Leaderboard
        [250, 250],  // Square
        [200, 200],  // Small Square
        [468, 60],   // Banner
        [234, 60],   // Half Banner
        [120, 600],  // Skyscraper
        [160, 600],  // Wide Skyscraper
        [120, 240],  // Vertical Banner
        [240, 400],  // Vertical Rectangle
        [250, 360],  // Triple Widescreen
        [580, 400],  // Netboard
        [300, 1050], // Portrait
        [970, 250],  // Billboard
        [300, 100],  // 3:1 Rectangle
        [970, 66]    // Large Mobile Banner
      ];

      for (const [w, h] of commonAdSizes) {
        if (width === w && height === h) return true;
      }

      // Check for clickable elements with ad-like attributes
      if (element.tagName === 'A' || element.tagName === 'BUTTON' || element.getAttribute('role') === 'button') {
        const href = element.getAttribute('href') || '';
        if (/ad|banner|sponsor|promo|marketing|advert|affiliate|partner|track|click|google|doubleclick|adtech|adroll|criteo|taboola|outbrain|revcontent|contentad|adform/i.test(href)) {
          return true;
        }
      }

      // Check for elements with onclick handlers containing ad-related terms
      const onclick = element.getAttribute('onclick') || '';
      if (/ad|banner|sponsor|promo|marketing|advert|affiliate|partner|track|click|google|doubleclick|adtech|adroll|criteo|taboola|outbrain|revcontent|contentad|adform/i.test(onclick)) {
        return true;
      }

      return false;
    }

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            const element = node;
            if (isLikelyAd(element)) {
              console.log(`[Task ${taskId}] Ad element detected:`, element);
              element.setAttribute('data-ad-detected', 'true');
            }
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  });
}

module.exports = {
  validateCustomSelectors,
  getDefaultAdSelectors,
  setupAdDetection
}; 