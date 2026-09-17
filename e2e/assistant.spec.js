import { test, expect } from '@playwright/test';

/**
 * E2E suite for LlmAvatarAssistant.
 *
 * Two tests:
 *   1. (static, no model)  the page + floating component render, the bubble
 *      shows the default text, and the avatar canvas is present.
 *   2. (live)              the real component is driven against the real
 *      llama.cpp model (FG-Inteligencia, via the /v1 dev proxy) and we assert
 *      that the answer appears AND that the page auto-scrolls to the section
 *      the model referenced.
 *
 * The live test is the "deep" one requested: it exercises the full pipeline —
 * question -> OpenAI-compatible chat -> streamed answer -> section scan ->
 * smooth scroll — in a real browser against a real model.
 */

// Run the live test only when we actually want to hit the model. The unit
// suite (`npm test`) never touches the network; `npm run e2e` does.
const LIVE = process.env.LLM_E2E !== '0';

test.describe('LlmAvatarAssistant (static render)', () => {
  test('page and floating component render', async ({ page }) => {
    await page.goto('/');

    // The portfolio sections are present with stable ids (scroll targets).
    await expect(page.locator('#overview')).toBeVisible();
    await expect(page.locator('#configuration')).toBeVisible();

    // The floating assistant is present with its three parts.
    const root = page.locator('[data-testid="lav-root"]');
    await expect(root).toBeAttached();
    await expect(page.locator('[data-testid="lav-bubble"]')).toBeVisible();
    await expect(page.locator('[data-testid="lav-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="lav-send"]')).toBeVisible();

    // The default text is shown before any question.
    const bubble = page.locator('[data-testid="lav-bubble"]');
    await expect(bubble).toContainText(/I am floating here/);

    // The 3D avatar canvas exists (WebGL may be headless; we only assert it
    // is mounted, not its pixels, for determinism).
    await expect(page.locator('.lav-avatar-wrap canvas')).toBeAttached();

    // The component sits on the right by default.
    await expect(root).toHaveClass(/lav-side--right/);
  });
});

test.describe('LlmAvatarAssistant (live LLM)', () => {
  test.skip(!LIVE, 'live LLM test disabled (LLM_E2E=0)');

  test('answers a question and auto-scrolls to the referenced section', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-testid="lav-input"]').waitFor();

    // Baseline: we start at the top of the page.
    const scrollYBefore = await page.evaluate(() => window.scrollY);

    // Ask a question whose correct answer references the "Configuration"
    // section. FG-Inteligencia reliably names that section's exact title.
    const input = page.locator('[data-testid="lav-input"]');
    await input.click();
    await input.fill('Where do I find the list of configurable props?');
    await page.locator('[data-testid="lav-send"]').click();

    // The bubble should fill with a real answer that references the section.
    const responseText = page.locator('[data-testid="lav-response-text"]');
    await expect(responseText, 'answer referencing the Configuration section')
      .toContainText('Configuration', { timeout: 120_000 });

    // No error should be present for a successful answer.
    await expect(page.locator('[data-testid="lav-error"]')).not.toBeVisible();

    // The matched section title should be highlighted in the bubble.
    await expect(page.locator('[data-testid="lav-section-link"]'), 'matched title highlighted')
      .toContainText('Configuration', { timeout: 10_000 });

    // The page must have scrolled to the #configuration section: the section
    // heading should now be near the top of the viewport, and the scroll
    // position should have advanced from the baseline.
    const configTop = page.locator('#configuration h2');
    await expect
      .poll(async () => {
        const box = await configTop.boundingBox();
        const y = await page.evaluate(() => window.scrollY);
        // Heading within ~220px of the top of the viewport AND we moved down.
        return box && y - scrollYBefore > 100 && box.y > -60 && box.y < 240;
      }, { message: 'page scrolled to the Configuration section' })
      .toBe(true, { timeout: 12_000 });
  });
});
