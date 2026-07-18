import { test as base } from "@playwright/test";

// Browser-mode "Print" calls window.print(), which opens the OS print dialog
// and blocks a headless run. Stub it so the print buttons are safe to click.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.print = () => {};
    });
    await use(page);
  },
});

export { expect } from "@playwright/test";
