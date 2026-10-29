import type { Page } from '@playwright/test';

/**
 * Readiness marker for a screen whose geometry is about to be measured: fonts are loaded, no finite
 * motion is still running (screen entry, sheets, menus; spinners, countdowns and other long or
 * endless animations are ignored), and two frames have been laid out since. It replaces fixed
 * waits, which a loaded machine can outrun: entry motion runs on wall time, and a 450ms wait does
 * not cover a 460ms entry animation that started a frame late.
 */
export async function settled(page: Page, timeout = 15_000) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(() => document.getAnimations().every(animation => {
    if (animation.playState !== 'running') return true;
    // Motion is short. Long or endless timelines (spinners, a toast's Undo countdown) are content.
    const end = Number(animation.effect?.getComputedTiming().endTime);
    return !Number.isFinite(end) || end > 2_000;
  }), undefined, { timeout, polling: 'raf' });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/**
 * Waits for `count` rendered frames. Screen focus (`@elizaos/ui/accessibility/screen-focus`) judges
 * focus two frames after a change and then retries for up to 12 more, so 16 frames is the whole
 * window in which it may move focus, whatever the machine's frame rate. A fixed wait is not.
 */
export async function frames(page: Page, count = 16) {
  await page.evaluate(count => new Promise<void>(resolve => {
    let left = count;
    const next = () => (--left <= 0 ? resolve() : requestAnimationFrame(next));
    requestAnimationFrame(next);
  }), count);
}
