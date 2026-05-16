
// E2E test helper — waitForTimeout(500) stabilizes UI before dropdown interaction
declare const page: { waitForTimeout(ms: number): Promise<void>; keyboard: { press(key: string): Promise<void> } };
declare const dropdownButton: { focus(): Promise<void> };

export async function openDropdown(): Promise<void> {
  await page.waitForTimeout(500); // Wait for table remount to settle before interacting
  await dropdownButton.focus();
  await page.keyboard.press('Enter');

  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await dropdownButton.focus();
  await page.keyboard.press('Enter');
}



// waitForTimeout(200) in e2e test is a standard short stabilization delay before interactions
declare const page: {
  waitForTimeout(ms: number): Promise<void>;
  getByTestId(id: string): { click(): Promise<void> };
  getByRole(role: string, opts: { name: string }): { click(): Promise<void>; fill(value: string): Promise<void> };
};

export async function interactWithSignaturePad(): Promise<void> {
  await page.waitForTimeout(200);

  await page.getByTestId('signature-pad-dialog-button').click();

  await page.getByRole('tab', { name: 'Type' }).click();
  await page.getByRole('tab', { name: 'Type' }).fill('My Signature');
}
