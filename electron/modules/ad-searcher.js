const { validateCustomSelectors, getDefaultAdSelectors } = require('./ad-detector');
const { detectSelectorType, evaluateSelector, waitForSelector } = require('./utils');
const { handleIframeClick } = require('./click-handler');
const { delay, getRandomInt } = require('./utils');
const { verifyClickSuccess } = require('./click-verifier');

// Helper function to get delay time based on settings
function getDelayTime(setting, defaultMin, defaultMax) {
  if (setting === 0) {
    return Math.floor(Math.random() * (defaultMax - defaultMin + 1)) + defaultMin;
  }
  return setting * 1000; // Convert seconds to milliseconds
}

async function findAndClickAdElements(page, customSelectors, taskId, delays, logToUI) {
  const maxAdSearchRetries = 3;
  let adSearchRetryCount = 0;
  let clickedAny = false;

  // Prepare selector groups in order: custom, then priority, then default
  let selectorGroups = [];
  const validatedCustom = validateCustomSelectors(customSelectors);
  if (validatedCustom.length > 0) selectorGroups.push(validatedCustom);
  // Always prioritize iframe[srcdoc=""] as its own group if not in custom
  if (!validatedCustom.includes('iframe[srcdoc=""]')) selectorGroups.push(['iframe[srcdoc=""]']);
  selectorGroups.push(getDefaultAdSelectors());

  while (adSearchRetryCount < maxAdSearchRetries && !clickedAny) {
    try {
      logToUI(`[Task ${taskId}] Attempt ${adSearchRetryCount + 1}/${maxAdSearchRetries} to find ad elements...`);
      let foundElements = null;
      let foundSelector = null;
      let foundSelectorType = null;
      // Search each group in order, stop at first group with elements
      for (const group of selectorGroups) {
        for (const selector of group) {
          const selectorType = detectSelectorType(selector);
          logToUI(`[Task ${taskId}] Processing ${selectorType.toUpperCase()} selector: ${selector}`);
          const found = await waitForSelector(page, selector, selectorType, 5000);
          if (!found) continue;
          const elements = await evaluateSelector(page, selector, selectorType);
          logToUI(`[Task ${taskId}] Found ${elements && elements.length ? elements.length : 0} elements for selector: ${selector}`);
          if (elements && elements.length > 0) {
            foundElements = elements;
            foundSelector = selector;
            foundSelectorType = selectorType;
            // Log candidate info
            for (const element of elements) {
              try {
                const info = await page.evaluate(el => {
                  return {
                    tag: el.tagName,
                    id: el.id,
                    class: el.className,
                    inIframe: !!el.ownerDocument.defaultView.frameElement
                  };
                }, element);
                logToUI(`[Task ${taskId}] Candidate element: <${info.tag.toLowerCase()} id='${info.id}' class='${info.class}'> inIframe=${info.inIframe}`);
              } catch (e) {
                logToUI(`[Task ${taskId}] Error logging candidate element: ${e.message}`);
              }
            }
            break;
          }
        }
        if (foundElements) break;
      }
      // If found, try to click
      if (foundElements && foundElements.length > 0) {
        for (const element of foundElements) {
          // Get info for special handling
          const info = await page.evaluate(el => {
            return {
              tag: el.tagName,
              id: el.id,
              class: el.className,
              inIframe: !!el.ownerDocument.defaultView.frameElement
            };
          }, element);
          // Special handling for iframe[srcdoc=""]
          if (info.tag === 'IFRAME' && foundSelector === 'iframe[srcdoc=""]') {
            try {
              const box = await element.boundingBox();
              if (box) {
                const centerX = box.x + box.width / 2;
                const centerY = box.y + box.height / 2;
                await page.mouse.move(centerX, centerY, { steps: 25 });
                await delay(Math.random() * 100 + 50);
                await page.mouse.down();
                await delay(Math.random() * 50 + 25);
                await page.mouse.up();
                await delay(Math.random() * 100 + 50);
                try {
                  await page.mouse.click(centerX, centerY, {
                    delay: Math.random() * 100 + 50,
                    button: 'left',
                    clickCount: 1
                  });
                } catch (mouseClickError) {
                  logToUI(`[Task ${taskId}] Mouse click fallback failed: ${mouseClickError.message}`);
                }
                logToUI(`[Task ${taskId}] Clicked iframe[srcdoc=""] at (${centerX}, ${centerY})`);
                clickedAny = await verifyClickSuccess(page, taskId, logToUI);
                if (clickedAny) return true;
              } else {
                logToUI(`[Task ${taskId}] Could not get bounding box for iframe[srcdoc=""]`);
              }
            } catch (iframeClickError) {
              logToUI(`[Task ${taskId}] Error clicking iframe[srcdoc=""]: ${iframeClickError.message}`);
              try {
                await page.evaluate(el => {
                  if (el && document.body.contains(el)) {
                    el.click();
                    const clickEvent = new MouseEvent('click', {
                      bubbles: true,
                      cancelable: true,
                      view: window
                    });
                    el.dispatchEvent(clickEvent);
                  }
                }, element);
                logToUI(`[Task ${taskId}] Fallback JS click dispatched for iframe[srcdoc=""]`);
                clickedAny = await verifyClickSuccess(page, taskId, logToUI);
                if (clickedAny) return true;
              } catch (jsClickError) {
                logToUI(`[Task ${taskId}] Fallback JS click failed for iframe[srcdoc=""]: ${jsClickError.message}`);
              }
            }
          } else if (info.tag === 'IFRAME') {
            clickedAny = await handleIframeClick(page, element, taskId, logToUI);
            if (clickedAny) {
              logToUI(`[Task ${taskId}] Successfully clicked iframe element`);
              return true;
            }
          } else {
            try {
              await element.click({ delay: Math.random() * 100 + 50 });
              clickedAny = await verifyClickSuccess(page, taskId, logToUI);
              if (clickedAny) {
                logToUI(`[Task ${taskId}] Successfully clicked element: ${info.tag}`);
                return true;
              }
            } catch (clickError) {
              try {
                await page.evaluate(el => {
                  if (el && document.body.contains(el)) {
                    el.click();
                    const clickEvent = new MouseEvent('click', {
                      bubbles: true,
                      cancelable: true,
                      view: window
                    });
                    el.dispatchEvent(clickEvent);
                  }
                }, element);
                clickedAny = await verifyClickSuccess(page, taskId, logToUI);
                if (clickedAny) {
                  logToUI(`[Task ${taskId}] Successfully clicked element using JS: ${info.tag}`);
                  return true;
                }
              } catch (evalError) {
                logToUI(`[Task ${taskId}] Failed to click element ${info.tag}: ${evalError.message}`);
              }
            }
          }
        }
      }
      // If not found, retry
      if (!clickedAny) {
        adSearchRetryCount++;
        if (adSearchRetryCount < maxAdSearchRetries) {
          logToUI(`[Task ${taskId}] No ad elements found, retrying in 5 seconds...`);
          await delay(5000);
        }
      }
    } catch (error) {
      logToUI(`[Task ${taskId}] Error during ad element search: ${error.message}`);
      adSearchRetryCount++;
      if (adSearchRetryCount < maxAdSearchRetries) {
        logToUI(`[Task ${taskId}] Retrying ad element search in 5 seconds...`);
        await delay(5000);
      }
    }
  }
  return clickedAny;
}

module.exports = {
  findAndClickAdElements
}; 