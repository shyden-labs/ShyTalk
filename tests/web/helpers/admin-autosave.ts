import { Page, Locator, expect } from "@playwright/test";

/**
 * The `<label>` heading the `.field-group` that holds a Users-tab field.
 * It is not tied to any input, so clicking it takes focus off the field
 * without giving focus to another one.
 */
function fieldHeading(page: Page, fieldSelector: string): Locator {
  return page
    .locator(fieldSelector)
    .locator(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' field-group ')][1]/label",
    );
}

/**
 * Leave a Users-tab field the way an admin does, by clicking elsewhere, so
 * the panel's blur listener auto-saves it.
 *
 * Never `el.blur()`: Chromium with touch on (the chromium project sets
 * `hasTouch`, mobile-chrome is a Pixel 5) ignores `blur()` on a focused
 * `datetime-local`, so no blur fires and nothing saves (SHY-0597).
 */
export async function leaveField(page: Page, fieldSelector: string): Promise<void> {
  await fieldHeading(page, fieldSelector).click();
  await expect(page.locator(fieldSelector)).not.toBeFocused();
}

/**
 * Leave the field, then wait for "Saved" beside it. `timeout` is the
 * caller's existing wait for the save, kept as it was.
 */
export async function waitForAutoSave(
  page: Page,
  fieldSelector: string,
  timeout?: number,
): Promise<void> {
  await leaveField(page, fieldSelector);
  const saved = page.locator(fieldSelector).locator("..").locator(".field-feedback.saved");
  await expect(saved).toBeVisible({ timeout });
  await expect(saved).toContainText("Saved");
}
