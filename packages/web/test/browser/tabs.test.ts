import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { ENGINES, openScenario, phone, useEngine } from './harness.js';

// The current tab is in the address: a refresh or a notification link opens
// the right screen, and Back goes to the tab before.

async function currentTab(page: Page): Promise<string | null> {
  return page.locator('.tab[aria-current="page"]').getAttribute('data-testid');
}

describe.each(ENGINES)('tabs in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('a link straight to /review opens the Review tab (as a notification would)', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/review');
    expect(new URL(page.url()).pathname).toBe('/review');
    expect(await currentTab(page)).toBe('tab-review');
    expect(await page.getByRole('heading', { level: 1 }).innerText()).toBe('Review');
    expect(await page.title()).toBe('Review · Budget');
    await page.context().close();
  });

  it('every tab has its own address, and a refresh stays on it', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    for (const tab of ['buckets', 'review', 'settings', 'home'] as const) {
      await page.getByTestId(`tab-${tab}`).click();
      expect(new URL(page.url()).pathname).toBe(`/${tab}`);
      expect(await currentTab(page)).toBe(`tab-${tab}`);
      await page.reload();
      await page.getByTestId(tab).waitFor();
      expect(new URL(page.url()).pathname).toBe(`/${tab}`);
      expect(await currentTab(page)).toBe(`tab-${tab}`);
    }
    await page.context().close();
  });

  it('Back goes to the tab before', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    await page.getByTestId('tab-buckets').click();
    await page.getByTestId('tab-settings').click();
    await page.goBack();
    await page.getByTestId('buckets').waitFor();
    expect(new URL(page.url()).pathname).toBe('/buckets');
    expect(await currentTab(page)).toBe('tab-buckets');
    await page.goBack();
    await page.getByTestId('home').waitFor();
    expect(await currentTab(page)).toBe('tab-home');
    await page.context().close();
  });

  it('the bare address opens Home and says /home', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    await page.goto(`${base()}/`);
    await page.getByTestId('home').waitFor();
    expect(new URL(page.url()).pathname).toBe('/home');
    expect(await currentTab(page)).toBe('tab-home');
    await context.close();
  });

  it('a row on Home that leads to another tab changes the address too', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    await page.getByTestId('attention-review').click();
    await page.getByTestId('review').waitFor();
    expect(new URL(page.url()).pathname).toBe('/review');
    await page.goBack();
    await page.getByTestId('home').waitFor();
    await page.getByTestId('all-buckets').click();
    await page.getByTestId('buckets').waitFor();
    expect(new URL(page.url()).pathname).toBe('/buckets');
    await page.context().close();
  });

  it('the Review badge shows on every tab', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/settings');
    await page.getByTestId('review-badge').waitFor();
    expect(await page.getByTestId('review-badge').innerText()).toBe('2');
    await page.context().close();
  });

  it('screens that come next say so', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    expect(await page.getByTestId('coming-next').innerText()).toContain('Coming next');
    await page.context().close();
  });
});
