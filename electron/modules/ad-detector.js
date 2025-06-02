const { logger } = require('../logger');
const { getStopState } = require('../state');

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

async function setupAdDetection(page, taskId) {
  if (getStopState()) {
    logger.info(`[Automation][Task ${taskId}] Stop requested during ad detection setup`);
    return;
  }

  try {
    await page.evaluateOnNewDocument((taskId) => {
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
          // Increase the index check slightly, as legitimate iframes might appear early
          if (iframeIndex <= 8) return true;

          // Check src attribute with broader patterns
          const src = element.getAttribute('src') || '';
          if (/ad|banner|sponsor|promo|marketing|advert|affiliate|partner|track|click|google|doubleclick|adtech|adroll|criteo|taboola|outbrain|revcontent|contentad|adform|popads|adsterra|propellerads|medianet|valueimpression|infolinks|chitika|adwaremedia|adcash/i.test(src)) {
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

          // Additional iframe attribute checks
          if (element.getAttribute('scrolling') === 'no') return true;
          if (element.getAttribute('marginwidth') === '0') return true;
          if (element.getAttribute('marginheight') === '0') return true;
          if (element.getAttribute('frameborder') === '0') return true;
          if (element.hasAttribute('allowtransparency')) return true;
        }

        // Check for ad attributes
        for (const attr of adAttributes) {
          if (element.hasAttribute(attr)) return true;
        }

        // Check class names with refined patterns
        if (element.className) {
          const classes = element.className.split(' ');
          for (const cls of classes) {
            for (const pattern of adClassPatterns) {
              if (pattern.test(cls)) return true;
            }
          }
        }

        // Check element ID with refined patterns
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

        // Check for visibility and display properties
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false; // Explicitly not an ad if hidden
        }

        // Check for fixed or sticky positioning (common for intrusive ads)
        if (style.position === 'fixed' || style.position === 'sticky') {
            // Add checks to ensure it's not a legitimate header/footer
            const rect = element.getBoundingClientRect();
            // If fixed/sticky and large enough to be an ad, consider it likely
            if ((rect.width > 100 && rect.height > 50) || (rect.height > 100 && rect.width > 50)) {
               return true;
            }
        }

        // Check for high z-index (often used for pop-ups/overlays)
        const zIndex = parseInt(style.zIndex);
        if (!isNaN(zIndex) && zIndex > 1000) { // High z-index threshold
            const rect = element.getBoundingClientRect();
             // If high z-index and reasonably sized, consider it likely
             if ((rect.width > 100 && rect.height > 50) || (rect.height > 100 && rect.width > 50)) {
               return true;
            }
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

        // Check for elements with little or no text content but significant size
        const textContent = element.textContent.trim();
        const hasSignificantSize = (width > 100 && height > 50) || (height > 100 && width > 50);
        if (textContent.length < 20 && hasSignificantSize) { // Heuristic: small text content, large size
            // Add exceptions for common non-ad elements that might match this (e.g., images, icons)
            const nonTextTags = ['IMG', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO'];
            if (!nonTextTags.includes(element.tagName)) {
               return true;
            }
        }

        return false;
      }

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              const element = node;
              // Only check elements that are currently connected to the DOM
              if (document.body.contains(element) && isLikelyAd(element)) {
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
    }, taskId);

    logger.info(`[Automation][Task ${taskId}] Ad detection system initialized`);
  } catch (error) {
    logger.error(`[Automation][Task ${taskId}] Error setting up ad detection: ${error.message}`);
  }
}

module.exports = {
  validateCustomSelectors,
  getDefaultAdSelectors,
  setupAdDetection
}; 