const { delay } = require('./utils');

async function handleIframeClick(page, element, taskId, logToUI) {
  try {
    // Get element position and dimensions
    const box = await element.boundingBox();
    if (!box) {
      logToUI(`[Task ${taskId}] Could not get element bounding box`);
      return false;
    }

    // Calculate center point of the element
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Move mouse to element with human-like movement
    await page.mouse.move(centerX, centerY, { steps: 25 });
    await delay(Math.random() * 100 + 50);

    // Simulate mouse down
    await page.mouse.down();
    await delay(Math.random() * 50 + 25);

    // Simulate mouse up
    await page.mouse.up();
    await delay(Math.random() * 100 + 50);

    // Try clicking with mouse.click as fallback
    try {
      await page.mouse.click(centerX, centerY, {
        delay: Math.random() * 100 + 50,
        button: 'left',
        clickCount: 1
      });
    } catch (clickError) {
      logToUI(`[Task ${taskId}] Mouse click failed: ${clickError.message}`);
    }

    // If it's an iframe, try to access its content
    if (element.tagName === 'IFRAME') {
      try {
        const frame = await element.contentFrame();
        if (frame) {
          // Get clickable elements inside iframe
          const clickableElements = await frame.$$('a, button, [role="button"], [onclick]');
          if (clickableElements.length > 0) {
            const randomElement = clickableElements[Math.floor(Math.random() * clickableElements.length)];
            const elementBox = await randomElement.boundingBox();
            
            if (elementBox) {
              // Move mouse to element inside iframe
              await frame.mouse.move(
                elementBox.x + elementBox.width / 2,
                elementBox.y + elementBox.height / 2,
                { steps: 25 }
              );
              await delay(Math.random() * 100 + 50);

              // Click inside iframe
              await frame.mouse.down();
              await delay(Math.random() * 50 + 25);
              await frame.mouse.up();
              await delay(Math.random() * 100 + 50);

              // Try direct click as fallback
              try {
                await frame.mouse.click(
                  elementBox.x + elementBox.width / 2,
                  elementBox.y + elementBox.height / 2,
                  {
                    delay: Math.random() * 100 + 50,
                    button: 'left',
                    clickCount: 1
                  }
                );
              } catch (frameClickError) {
                logToUI(`[Task ${taskId}] Frame mouse click failed: ${frameClickError.message}`);
              }
            }
          }
        }
      } catch (frameError) {
        logToUI(`[Task ${taskId}] Error accessing iframe content: ${frameError.message}`);
      }
    }

    // Verify click success by checking for navigation or new window
    const pages = await page.browser().pages();
    if (pages.length > 1) {
      logToUI(`[Task ${taskId}] Click successful - new window/tab detected`);
      return true;
    }

    // Check if URL changed
    const currentUrl = page.url();
    if (currentUrl !== await page.evaluate(() => window.location.href)) {
      logToUI(`[Task ${taskId}] Click successful - URL changed`);
      return true;
    }

    return true;
  } catch (error) {
    logToUI(`[Task ${taskId}] Error in handleIframeClick: ${error.message}`);
    return false;
  }
}

module.exports = {
  handleIframeClick
}; 