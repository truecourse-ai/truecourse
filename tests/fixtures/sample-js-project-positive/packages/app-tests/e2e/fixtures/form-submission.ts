declare const page: { waitForTimeout: (ms: number) => Promise<void>; getByTestId: (id: string) => any };

export const submitFormWithValidation = async () => {
  await page.waitForTimeout(200);

  await page.getByTestId('form-submit-button').click();
};

export const fillAndSubmitLoginForm = async (email: string, password: string) => {
  await page.waitForTimeout(200);

  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
};
