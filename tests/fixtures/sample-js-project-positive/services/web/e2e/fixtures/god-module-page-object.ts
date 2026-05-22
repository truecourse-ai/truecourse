// Playwright-style end-to-end Page Object Model. POMs intentionally collect
// many helper methods (open, fill, submit, assert, ...) because that's their
// whole purpose — the rule must not flag them as god-modules.

type PageStub = {
  goto(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  waitForSelector(selector: string): Promise<void>;
  textContent(selector: string): Promise<string | null>;
  isVisible(selector: string): Promise<boolean>;
};

export class DocumentEditorPage {
  private readonly page: PageStub;
  private readonly baseUrl: string;

  constructor(page: PageStub, baseUrl: string) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async openNewDocument(): Promise<void> {
    await this.page.goto(`${this.baseUrl}/documents/new`);
  }

  async openExistingDocument(id: string): Promise<void> {
    await this.page.goto(`${this.baseUrl}/documents/${id}`);
  }

  async fillTitle(value: string): Promise<void> {
    await this.page.fill('input[name="title"]', value);
  }

  async fillDescription(value: string): Promise<void> {
    await this.page.fill('textarea[name="description"]', value);
  }

  async clickSaveDraft(): Promise<void> {
    await this.page.click('button[data-action="save-draft"]');
  }

  async clickPublish(): Promise<void> {
    await this.page.click('button[data-action="publish"]');
  }

  async clickAddRecipient(): Promise<void> {
    await this.page.click('button[data-action="add-recipient"]');
  }

  async fillRecipientEmail(value: string): Promise<void> {
    await this.page.fill('input[name="recipient-email"]', value);
  }

  async fillRecipientName(value: string): Promise<void> {
    await this.page.fill('input[name="recipient-name"]', value);
  }

  async clickRemoveRecipient(index: number): Promise<void> {
    await this.page.click(`button[data-recipient-index="${index}"]`);
  }

  async waitForToastSuccess(): Promise<void> {
    await this.page.waitForSelector('[data-toast="success"]');
  }

  async waitForToastError(): Promise<void> {
    await this.page.waitForSelector('[data-toast="error"]');
  }

  readTitle(): Promise<string | null> {
    return this.page.textContent('input[name="title"]');
  }

  isPublishEnabled(): Promise<boolean> {
    return this.page.isVisible('button[data-action="publish"]:not([disabled])');
  }

  async clickSettingsTab(): Promise<void> {
    await this.page.click('[role="tab"][data-tab="settings"]');
  }

  async clickPreviewTab(): Promise<void> {
    await this.page.click('[role="tab"][data-tab="preview"]');
  }

  async clickRecipientsTab(): Promise<void> {
    await this.page.click('[role="tab"][data-tab="recipients"]');
  }

  async expectStatus(value: string): Promise<boolean> {
    const actual = await this.page.textContent('[data-document-status]');
    return actual === value;
  }
}
