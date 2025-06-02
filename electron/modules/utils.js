const { logger } = require('../logger');

// Helper function to get random number between min and max
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Add delay helper function
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to detect selector type
function detectSelectorType(selector) {
  if (selector.startsWith('/') || selector.startsWith('./') || selector.startsWith('//')) {
    return 'xpath';
  } else if (selector.startsWith('document.') || selector.includes('querySelector') || selector.includes('getElement')) {
    return 'js';
  } else {
    return 'css';
  }
}

// Helper function to evaluate selector
async function evaluateSelector(page, selector, type, stopState = false) {
  try {
    if (stopState) return [];
    
    switch (type) {
      case 'xpath':
        return await page.$x(selector);
      case 'js':
        return await page.evaluateHandle(selector);
      case 'css':
      default:
        return await page.$$(selector);
    }
  } catch (e) {
    logger.error(`[Automation] Error evaluating ${type} selector:`, e);
    return [];
  }
}

// Helper function to wait for selector
async function waitForSelector(page, selector, type, timeout = 5000, stopState = false) {
  try {
    if (stopState) return false;
    
    switch (type) {
      case 'xpath':
        await page.waitForXPath(selector, { timeout });
        break;
      case 'js':
        await page.evaluate(selector);
        break;
      case 'css':
      default:
        await page.waitForSelector(selector, { timeout });
        break;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Helper function to shuffle array
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

module.exports = {
  getRandomInt,
  delay,
  detectSelectorType,
  evaluateSelector,
  waitForSelector,
  shuffleArray
}; 