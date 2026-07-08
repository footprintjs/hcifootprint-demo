/**
 * AX-tree browser smoke test — real chromium over the real storefront, no LLM.
 * Proves the baseline's perception+action layer works: the snapshot shows the
 * catalog with refs, and ref-clicks drive the SAME app the oracle reads.
 * Skipped wholesale when the pinned chromium headless shell is not on disk.
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { DressShop } from '../src/app/shop.js';
import { startShopHost } from './web-host.js';
import { CHROMIUM_EXECUTABLE, pruneSnapshot } from './modalities/ax-tree.js';

const hasBrowser = existsSync(CHROMIUM_EXECUTABLE);

async function snapshot(page: Page): Promise<string> {
  const snap = await (page as Page & { _snapshotForAI: () => Promise<{ full: string }> })._snapshotForAI();
  return pruneSnapshot(snap.full);
}

/** Find the ref of the first line matching a pattern in the snapshot. */
function refOf(snap: string, pattern: RegExp): string {
  const line = snap.split('\n').find((l) => pattern.test(l));
  const ref = line && /\[ref=(e\d+)\]/.exec(line)?.[1];
  if (!ref) throw new Error(`No ref found for ${pattern} in snapshot:\n${snap}`);
  return ref;
}

describe.skipIf(!hasBrowser)('ax-tree perception + action over the real storefront', () => {
  it('snapshots the catalog with refs and drives the app by ref-clicks', async () => {
    const shop = new DressShop();
    const host = await startShopHost(shop);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ executablePath: CHROMIUM_EXECUTABLE });
      const page = await browser.newPage();
      await page.goto(host.url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(300);

      // Home renders with the real nav; no script/style noise in the AX tree.
      let snap = await snapshot(page);
      expect(snap).toContain('button "Dresses"');
      expect(snap).not.toMatch(/<script|<style|function|var /);

      // Click "Dresses" by ref → the SPA opens the catalog and auto-searches all.
      await page.locator(`aria-ref=${refOf(snap, /button "Dresses"/)}`).click();
      await page.waitForTimeout(400);
      expect(shop.state.page).toBe('catalog'); // the REAL app moved
      snap = await snapshot(page);
      expect(snap).toContain('Emerald Satin Wrap'); // names visible
      expect(snap).toContain('$135'); // prices visible
      expect(snap).toContain('button "red"'); // color filters visible

      // Open the Emerald Satin Wrap via its card's View link.
      const lines = snap.split('\n');
      const cardIdx = lines.findIndex((l) => l.includes('Emerald Satin Wrap'));
      const viewLine = lines.slice(cardIdx).find((l) => /link "View"|button "View"/.test(l));
      const viewRef = viewLine && /\[ref=(e\d+)\]/.exec(viewLine)?.[1];
      expect(viewRef).toBeDefined();
      await page.locator(`aria-ref=${viewRef}`).click();
      await page.waitForTimeout(400);
      expect(shop.state.page).toBe('product');
      expect(shop.state.selectedDress?.id).toBe('d13'); // oracle-equivalent motion
    } finally {
      await browser?.close().catch(() => undefined);
      await host.close();
    }
  }, 30_000);
});
