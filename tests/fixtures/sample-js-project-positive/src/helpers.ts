/**
 * Helper module for relative namespace import test.
 */

export function capitalize(str: string): string {
  if (str.length === 0) return str;
  const first = str[0] ?? '';
  return first.toUpperCase() + str.slice(1);
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-/gu, '')
    .replace(/-$/gu, '');
}

// `el.innerHTML = ''` clears a node and `el.innerHTML = '<static literal>'`
// inserts a hard-coded HTML fragment - neither of these admits user-controlled
// input, so the disabled-auto-escaping detector must not fire on a static
// or empty RHS.

export function clearList(host: HTMLElement): void {
  host.innerHTML = '';
}

export function renderEmptyState(host: HTMLElement): void {
  host.innerHTML = '<p class="empty">No items yet.</p>';
}

export function renderTitleStatic(host: HTMLElement): void {
  host.innerHTML = `<h1>Dashboard</h1>`;
}

// IIFE wrappers used to scope module-private state. The expression-complexity
// detector counts operators on `expression_statement` nodes by recursing
// into all descendants - including the function bodies inside the IIFE -
// which inflates the count by the operators of every nested function. None
// of the inner function bodies has a complex expression on its own (each
// stays below the 5-op threshold) but together they push the IIFE's
// aggregate count over the limit, firing a false positive on the IIFE.
((): void => {
  function isPositive(n: number): boolean {
    return n > 0;
  }
  function isSmall(n: number): boolean {
    return n < 100;
  }
  function isOdd(n: number): boolean {
    return n % 2 === 1;
  }
  function isEven(n: number): boolean {
    return n % 2 === 0;
  }
  function combine(a: number, b: number): number {
    return a + b;
  }
  const total = combine(1, 2);
  globalThis.dispatchEvent(
    new CustomEvent('iife-ready', { detail: { total, isPositive, isSmall, isOdd, isEven } }),
  );
})();



// Standard streaming NDJSON reader pattern: try/finally cleanup +
// while-read-chunks + for-lines + try/catch malformed + switch on event type.
// Nesting is inherent to the streaming idiom, not a complexity smell.
type StreamEvent =
  | { type: 'field'; name: string }
  | { type: 'progress'; pct: number }
  | { type: 'done' };

declare const fetchEventStream: (url: string) => Promise<Response>;

export async function readDetectFieldsStream(
  url: string,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const response = await fetchEventStream(url);
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length === 0) continue;
        try {
          const event = JSON.parse(line) as StreamEvent;
          switch (event.type) {
            case 'field':
              onEvent(event);
              break;
            case 'progress':
              onEvent(event);
              break;
            case 'done':
              onEvent(event);
              return;
          }
        } catch {
          continue;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Idiomatic batch-processing handler: for+Promise.allSettled+map+if branches.
// Max depth ~4, not genuinely problematic — the run/run export name is
// boilerplate, not a complexity signal.
type EmailDomainBatch = { id: string; domains: string[] };
type SyncResult = { id: string; ok: boolean };

declare const fetchPendingBatches: () => Promise<EmailDomainBatch[]>;
declare const verifyDomain: (domain: string) => Promise<boolean>;
declare const markBatchComplete: (id: string, ok: boolean) => Promise<void>;
declare const logger: { warn: (msg: string) => void };

export const syncEmailDomainsHandler = {
  async run(): Promise<SyncResult[]> {
    const batches = await fetchPendingBatches();
    const results: SyncResult[] = [];
    for (const batch of batches) {
      const settled = await Promise.allSettled(
        batch.domains.map(async (domain) => {
          const ok = await verifyDomain(domain);
          if (!ok) {
            logger.warn(`domain ${domain} failed verification`);
          }
          return ok;
        }),
      );
      const allOk = settled.every(
        (r) => r.status === 'fulfilled' && r.value === true,
      );
      await markBatchComplete(batch.id, allOk);
      results.push({ id: batch.id, ok: allOk });
    }
    return results;
  },
};


// Playwright E2E fixture-style module: many small co-located helpers for
// driving the envelope editor UI in tests. Idiomatic for Playwright suites -
// not a production god-module smell. The helpers all operate on the same
// `Page` abstraction and exist purely to keep individual test files terse.

declare const test: {
  step: <T>(name: string, body: () => Promise<T>) => Promise<T>;
};

interface Locator {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  hover(): Promise<void>;
  isVisible(): Promise<boolean>;
  waitFor(): Promise<void>;
  count(): Promise<number>;
  textContent(): Promise<string | null>;
  getAttribute(name: string): Promise<string | null>;
}

interface Page {
  goto(url: string): Promise<void>;
  getByRole(role: string, options?: { name?: string }): Locator;
  getByLabel(label: string): Locator;
  getByTestId(id: string): Locator;
  getByText(text: string): Locator;
  locator(selector: string): Locator;
  waitForURL(url: string | RegExp): Promise<void>;
  waitForSelector(selector: string): Promise<void>;
  keyboard: { press(key: string): Promise<void>; type(text: string): Promise<void> };
  mouse: { click(x: number, y: number): Promise<void>; move(x: number, y: number): Promise<void> };
}

export async function openEnvelopeEditor(page: Page, envelopeId: string): Promise<void> {
  await test.step('open envelope editor', async () => {
    await page.goto(`/envelopes/${envelopeId}/edit`);
    await page.waitForSelector('[data-testid="envelope-editor"]');
  });
}

export async function addRecipient(page: Page, email: string, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Add recipient' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Save' }).click();
}

export async function removeRecipient(page: Page, email: string): Promise<void> {
  await page.getByTestId(`recipient-${email}`).hover();
  await page.getByTestId(`recipient-${email}-remove`).click();
}

export async function setRecipientRole(page: Page, email: string, role: string): Promise<void> {
  await page.getByTestId(`recipient-${email}-role`).click();
  await page.getByRole('option', { name: role }).click();
}

export async function addSignatureField(page: Page, recipientEmail: string, x: number, y: number): Promise<void> {
  await page.getByTestId(`recipient-${recipientEmail}`).click();
  await page.getByRole('button', { name: 'Signature' }).click();
  await page.mouse.click(x, y);
}

export async function addTextField(page: Page, recipientEmail: string, x: number, y: number): Promise<void> {
  await page.getByTestId(`recipient-${recipientEmail}`).click();
  await page.getByRole('button', { name: 'Text' }).click();
  await page.mouse.click(x, y);
}

export async function addDateField(page: Page, recipientEmail: string, x: number, y: number): Promise<void> {
  await page.getByTestId(`recipient-${recipientEmail}`).click();
  await page.getByRole('button', { name: 'Date' }).click();
  await page.mouse.click(x, y);
}

export async function addCheckboxField(page: Page, recipientEmail: string, x: number, y: number): Promise<void> {
  await page.getByTestId(`recipient-${recipientEmail}`).click();
  await page.getByRole('button', { name: 'Checkbox' }).click();
  await page.mouse.click(x, y);
}

export async function addDropdownField(page: Page, recipientEmail: string, x: number, y: number, options: string[]): Promise<void> {
  await page.getByTestId(`recipient-${recipientEmail}`).click();
  await page.getByRole('button', { name: 'Dropdown' }).click();
  await page.mouse.click(x, y);
  for (const option of options) {
    await page.getByLabel('Option').fill(option);
    await page.keyboard.press('Enter');
  }
}

export async function selectField(page: Page, fieldId: string): Promise<void> {
  await page.getByTestId(`field-${fieldId}`).click();
}

export async function deleteField(page: Page, fieldId: string): Promise<void> {
  await page.getByTestId(`field-${fieldId}`).click();
  await page.keyboard.press('Delete');
}

export async function moveField(page: Page, fieldId: string, x: number, y: number): Promise<void> {
  await page.getByTestId(`field-${fieldId}`).hover();
  await page.mouse.move(x, y);
}

export async function setFieldRequired(page: Page, fieldId: string, required: boolean): Promise<void> {
  await page.getByTestId(`field-${fieldId}`).click();
  const checkbox = page.getByLabel('Required');
  if ((await checkbox.getAttribute('aria-checked')) !== String(required)) {
    await checkbox.click();
  }
}

export async function setEnvelopeTitle(page: Page, title: string): Promise<void> {
  await page.getByLabel('Envelope title').fill(title);
}

export async function setEnvelopeMessage(page: Page, message: string): Promise<void> {
  await page.getByLabel('Message').fill(message);
}

export async function saveEnvelopeDraft(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByText('Draft saved').waitFor();
}

export async function sendEnvelope(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.waitForURL(/\/envelopes\/[^/]+\/sent/u);
}

export async function gotoNextPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Next page' }).click();
}

export async function gotoPreviousPage(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Previous page' }).click();
}

export async function setPageNumber(page: Page, pageNumber: number): Promise<void> {
  await page.getByLabel('Page').fill(String(pageNumber));
  await page.keyboard.press('Enter');
}

export async function zoomIn(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Zoom in' }).click();
}

export async function zoomOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Zoom out' }).click();
}

export async function resetZoom(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reset zoom' }).click();
}

export async function expectFieldCount(page: Page, count: number): Promise<void> {
  const actual = await page.getByTestId('field').count();
  if (actual !== count) throw new Error(`expected ${count} fields, got ${actual}`);
}

export async function expectRecipientVisible(page: Page, email: string): Promise<void> {
  const visible = await page.getByTestId(`recipient-${email}`).isVisible();
  if (!visible) throw new Error(`recipient ${email} not visible`);
}

export async function expectFieldVisible(page: Page, fieldId: string): Promise<void> {
  const visible = await page.getByTestId(`field-${fieldId}`).isVisible();
  if (!visible) throw new Error(`field ${fieldId} not visible`);
}

export async function duplicateField(page: Page, fieldId: string): Promise<void> {
  await page.getByTestId(`field-${fieldId}`).click();
  await page.keyboard.press('Control+D');
}

export async function undoLastAction(page: Page): Promise<void> {
  await page.keyboard.press('Control+Z');
}

export async function redoLastAction(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+Z');
}

export async function closeEditor(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
}

// Single-responsibility Canvas class wrapping an HTML canvas element for
// signature drawing. All methods are cohesive low-level canvas/drawing
// operations - this is a focused primitive, not a god module despite the
// method count and line total.

interface Point {
  x: number;
  y: number;
  pressure: number;
  time: number;
}

interface CanvasOptions {
  minWidth: number;
  maxWidth: number;
  throttle: number;
  velocityFilterWeight: number;
  penColor: string;
  backgroundColor: string;
}

export class SignatureCanvas {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly options: CanvasOptions;
  private points: Point[] = [];
  private strokes: Point[][] = [];
  private isDrawing = false;
  private lastVelocity = 0;
  private lastWidth = 0;
  private lastPoint: Point | null = null;

  constructor(canvas: HTMLCanvasElement, options: Partial<CanvasOptions> = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.options = {
      minWidth: options.minWidth ?? 0.5,
      maxWidth: options.maxWidth ?? 2.5,
      throttle: options.throttle ?? 16,
      velocityFilterWeight: options.velocityFilterWeight ?? 0.7,
      penColor: options.penColor ?? '#000000',
      backgroundColor: options.backgroundColor ?? '#ffffff',
    };
    this.clear();
  }

  clear(): void {
    this.ctx.fillStyle = this.options.backgroundColor;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.points = [];
    this.strokes = [];
    this.isDrawing = false;
    this.lastVelocity = 0;
    this.lastWidth = (this.options.minWidth + this.options.maxWidth) / 2;
    this.lastPoint = null;
  }

  isEmpty(): boolean {
    return this.strokes.length === 0;
  }

  beginStroke(x: number, y: number, pressure = 1): void {
    this.isDrawing = true;
    const point: Point = { x, y, pressure, time: Date.now() };
    this.points = [point];
    this.lastPoint = point;
    this.lastVelocity = 0;
    this.lastWidth = (this.options.minWidth + this.options.maxWidth) / 2;
    this.ctx.beginPath();
    this.ctx.fillStyle = this.options.penColor;
    this.ctx.strokeStyle = this.options.penColor;
  }

  extendStroke(x: number, y: number, pressure = 1): void {
    if (!this.isDrawing) return;
    const point: Point = { x, y, pressure, time: Date.now() };
    this.points.push(point);
    if (this.lastPoint === null) {
      this.lastPoint = point;
      return;
    }
    const velocity = this.computeVelocity(this.lastPoint, point);
    const smoothed =
      this.options.velocityFilterWeight * velocity +
      (1 - this.options.velocityFilterWeight) * this.lastVelocity;
    const width = this.strokeWidth(smoothed);
    this.drawSegment(this.lastPoint, point, this.lastWidth, width);
    this.lastVelocity = smoothed;
    this.lastWidth = width;
    this.lastPoint = point;
  }

  endStroke(): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    if (this.points.length > 0) this.strokes.push(this.points);
    this.points = [];
    this.lastPoint = null;
  }

  private computeVelocity(a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dt = Math.max(1, b.time - a.time);
    return Math.sqrt(dx * dx + dy * dy) / dt;
  }

  private strokeWidth(velocity: number): number {
    const { minWidth, maxWidth } = this.options;
    return Math.max(minWidth, maxWidth - velocity * (maxWidth - minWidth));
  }

  private drawSegment(from: Point, to: Point, startWidth: number, endWidth: number): void {
    const steps = 8;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const radius = startWidth + (endWidth - startWidth) * t;
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2, false);
      this.ctx.fill();
    }
  }

  toDataURL(type = 'image/png', quality?: number): string {
    return this.canvas.toDataURL(type, quality);
  }

  fromDataURL(dataUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        this.clear();
        this.ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
        resolve();
      };
      image.onerror = () => reject(new Error('image load failed'));
      image.src = dataUrl;
    });
  }

  resize(width: number, height: number): void {
    const data = this.toDataURL();
    this.canvas.width = width;
    this.canvas.height = height;
    void this.fromDataURL(data);
  }

  setPenColor(color: string): void {
    this.options.penColor = color;
  }

  setBackgroundColor(color: string): void {
    this.options.backgroundColor = color;
  }
}


// Union types that include a Promise branch require `await` to handle the
// thenable case; the plain-string branch resolves to itself as a harmless
// no-op. The await-non-thenable rule must not fire on `Promise<T> | T`.

declare const setCopiedText: (s: string) => void;
declare const clipboard: { writeText: (s: string) => Promise<void> };

type CopyValue = Promise<string> | string;

export async function copyTextToClipboard(
  text: Promise<string> | string,
): Promise<string> {
  const resolved = await text;
  setCopiedText(resolved);
  return resolved;
}

export async function writeClipboardValue(value: CopyValue): Promise<void> {
  await clipboard.writeText(await value);
}


// Mutex/lock release across an async boundary: ref.current is intentionally
// toggled true (acquire) -> drain queue -> false (release). The two writes are
// the lock acquire/release cycle, not a redundant overwrite.
declare const isProcessingRef: { current: boolean };
declare const queue: Array<() => Promise<void>>;
export async function drainAutosaveQueue(): Promise<void> {
  if (isProcessingRef.current) return;
  isProcessingRef.current = true;
  try {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task) await task();
    }
  } finally {
    isProcessingRef.current = false;
  }
}


// Empty-catch FP: comment-only catch documenting an intentional, non-fatal
// suppression. The email failure must not block the surrounding team-email
// revocation operation, so the author swallows the error on purpose.
declare const sendTeamEmailRevokedEmail: (teamId: string) => Promise<void>;

export async function revokeTeamEmail(teamId: string): Promise<{ ok: true }> {
  try {
    await sendTeamEmailRevokedEmail(teamId);
  } catch (e) {
    // Todo: Teams - Alert us.
    // We don't want to prevent a user from revoking access because an email could not be sent.
  }

  return { ok: true };
}

// Empty-catch FP: catch with only an explanatory comment. getIpAddress() may
// throw when the header is missing or malformed; the optional IP is
// validated downstream via ZIpSchema.safeParse(ip), so swallowing here is
// safe and deliberate.
declare const getIpAddress: (req: { headers: Record<string, string> }) => string;
declare const ZIpSchema: { safeParse: (v: unknown) => { success: boolean; data?: string } };

export function extractRequestIp(req: { headers: Record<string, string> }): string | undefined {
  let ip: string | undefined;

  try {
    ip = getIpAddress(req);
  } catch {
    // Do nothing.
  }

  const parsed = ZIpSchema.safeParse(ip);
  return parsed.success ? parsed.data : undefined;
}


// Enum-keyed accumulation over a plain object literal whose keys are
// pre-declared as the full closed set of known enum values. The indexing
// keys come from typed groupBy result rows, never from user input, so
// __proto__/constructor/prototype cannot reach the assignment target.

enum ReadStatus {
  NOT_OPENED = 'NOT_OPENED',
  OPENED = 'OPENED',
}

enum SigningStatus {
  NOT_SIGNED = 'NOT_SIGNED',
  SIGNED = 'SIGNED',
  REJECTED = 'REJECTED',
}

enum SendStatus {
  NOT_SENT = 'NOT_SENT',
  SENT = 'SENT',
}

interface RecipientGroup {
  readStatus: ReadStatus;
  signingStatus: SigningStatus;
  sendStatus: SendStatus;
  _count: number;
}

declare const groupedRecipients: ReadonlyArray<RecipientGroup>;

export function getRecipientStats(): {
  read: Record<ReadStatus, number>;
  signing: Record<SigningStatus, number>;
  send: Record<SendStatus, number>;
} {
  const stats = {
    [ReadStatus.NOT_OPENED]: 0,
    [ReadStatus.OPENED]: 0,
    [SigningStatus.NOT_SIGNED]: 0,
    [SigningStatus.SIGNED]: 0,
    [SigningStatus.REJECTED]: 0,
    [SendStatus.NOT_SENT]: 0,
    [SendStatus.SENT]: 0,
  };

  for (const { readStatus, signingStatus, sendStatus, _count } of groupedRecipients) {
    stats[readStatus] += _count;
    stats[signingStatus] += _count;
    stats[sendStatus] += _count;
  }

  return {
    read: { NOT_OPENED: stats.NOT_OPENED, OPENED: stats.OPENED },
    signing: {
      NOT_SIGNED: stats.NOT_SIGNED,
      SIGNED: stats.SIGNED,
      REJECTED: stats.REJECTED,
    },
    send: { NOT_SENT: stats.NOT_SENT, SENT: stats.SENT },
  };
}



// ReDoS false-positive guard: /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/ pairs a
// quantified atom `[a-z0-9]+` with a group whose first character class
// `[-_]` is fully disjoint from `[a-z0-9]`. There is no overlap between the
// inner `+` and the outer `*`, so the engine has zero ambiguity and cannot
// catastrophically backtrack. Both anchors are present and the upstream
// schema bounds the input to 30 chars before the regex ever runs.
declare const teamUrlCandidate: string;
const TEAM_URL_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
export function isValidTeamUrl(value: string): boolean {
  if (value.length > 30) return false;
  return TEAM_URL_PATTERN.test(value);
}
export const teamUrlOk: boolean = isValidTeamUrl(teamUrlCandidate);



// Class implements an interface (no `extends`), so there is no superclass
// constructor to call. Assigning to `this` directly in the constructor is
// valid TypeScript and must not be flagged by the this-before-super rule.
interface Transport {
  name: string;
  send(payload: string): void;
}

interface TransportOptions {
  endpoint: string;
  apiKey: string;
}

export class MailChannelsTransport implements Transport {
  public name = 'mailchannels';
  private _options: TransportOptions;

  constructor(options: TransportOptions) {
    this._options = {
      endpoint: options.endpoint,
      apiKey: options.apiKey,
    };
  }

  public send(payload: string): void {
    globalThis.dispatchEvent(
      new CustomEvent('mail-send', { detail: { endpoint: this._options.endpoint, payload } }),
    );
  }
}

// Plain data class that implements a structural interface. There is no
// superclass, so `this.x = x` in the constructor is valid even though no
// `super()` precedes it.
interface PointLike {
  x: number;
  y: number;
  timestamp: number;
}

export class Point implements PointLike {
  public x: number;
  public y: number;
  public timestamp: number;

  constructor(x: number, y: number, timestamp: number) {
    this.x = x;
    this.y = y;
    this.timestamp = timestamp;
  }

  public distanceTo(other: PointLike): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

declare const __mcOpts: TransportOptions;
const __mc = new MailChannelsTransport(__mcOpts);
__mc.send('hello');
const __pt = new Point(1, 2, Date.now());
globalThis.dispatchEvent(new CustomEvent('point-ready', { detail: { d: __pt.distanceTo({ x: 0, y: 0, timestamp: 0 }) } }));


// Positive cases for bugs/deterministic/unbound-method (must NOT flag).

// Mode: this-field-not-method — `this.field` read for a primitive/object value, never a method.
interface QueueConnection {
  host: string;
  port: number;
}
interface QueueConfig {
  connection: QueueConnection;
  name: string;
}
declare const buildQueue: (config: QueueConfig) => { id: string };
export class JobRunner {
  private readonly _connection: QueueConnection;
  public context: string;
  constructor(connection: QueueConnection, context: string) {
    this._connection = connection;
    this.context = context;
  }
  start(name: string): { id: string } {
    return buildQueue({ connection: this._connection, name });
  }
  describe(): string {
    return `runner(${this.context})`;
  }
}

// Mode: bound-this-method-call — direct `this.method(...)` and `receiver.method(...)` invocations are bound.
export class SignaturePad {
  private readonly points: ReadonlyArray<{ x: number; y: number }> = [];
  private currentCanvasWidth = 400;
  private currentCanvasHeight = 200;
  smooth(): number {
    return this.smoothSignature(this.points);
  }
  clear(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, this.currentCanvasWidth, this.currentCanvasHeight);
  }
  private smoothSignature(points: ReadonlyArray<{ x: number; y: number }>): number {
    return points.length;
  }
}

// Mode: static-or-global-function — calls on static class methods or global objects have no `this` requirement.
export class Point {
  constructor(public readonly x: number, public readonly y: number) {}
  static fromEvent(ev: { offsetX: number; offsetY: number }): Point {
    return new Point(ev.offsetX, ev.offsetY);
  }
}
export function clampToCanvas(width: number, height: number): number {
  const origin = Point.fromEvent({ offsetX: 0, offsetY: 0 });
  return Math.min(width, height) + origin.x;
}

// Mode: plain-object-property-access — chained access on a plain object literal type, not a class.
interface JobDefinition {
  id: string;
  trigger: { name: string; cron?: string };
}
declare const registerJob: (name: string, id: string) => void;
export function registerAll(jobs: readonly JobDefinition[]): void {
  for (const job of jobs) {
    registerJob(job.trigger.name, job.id);
  }
}

// Mode: arrow-function-lexical-this — `this` inside an arrow function is lexically captured from the enclosing method.
interface InngestClient {
  send(event: { name: string }): Promise<void>;
}
export class InngestAdapter {
  private readonly _client: InngestClient;
  constructor(client: InngestClient) {
    this._client = client;
  }
  getApiHandler(): () => Promise<InngestClient> {
    return async () => {
      return this._client;
    };
  }
}



// Sequential flat validators - each if-branch is independent and non-nested.
// Cognitive-complexity tools count one increment per branch and inflate the
// total purely from branch count, even though the structural depth never
// exceeds one (or two for the regex case). These validators are linear and
// easy to read, so the rule must not fire on them.

declare const checkboxValidationSigns: ReadonlyArray<{ label: string; value: '=' | '>=' | '<=' }>;
declare const numberFormatValues: ReadonlyArray<{ value: string; regex: RegExp }>;

interface CheckboxFieldMeta {
  readonly readOnly?: boolean;
  readonly required?: boolean;
  readonly validationRule?: string;
  readonly validationLength?: number;
}

interface DropdownFieldMeta {
  readonly readOnly?: boolean;
  readonly required?: boolean;
  readonly values?: ReadonlyArray<{ value: string }>;
  readonly defaultValue?: string;
}

interface NumberFieldMeta {
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly readOnly?: boolean;
  readonly required?: boolean;
  readonly numberFormat?: string;
  readonly fontSize?: number;
}

// shape-2616475c3762: flat validation branches with a single inner switch.
export function validateCheckboxField(
  values: readonly string[],
  fieldMeta: CheckboxFieldMeta,
  isSigningPage: boolean = false,
): string[] {
  const errors: string[] = [];
  const { readOnly, required, validationRule, validationLength } = fieldMeta;

  if (readOnly && required) {
    errors.push('A field cannot be both read-only and required');
  }

  if (values.length === 0) {
    errors.push('At least one option must be added');
  }

  if (readOnly && values.length === 0) {
    errors.push('A read-only field must have at least one value');
  }

  if (isSigningPage && required && values.length === 0) {
    errors.push('Selecting an option is required');
  }

  if (validationRule && !validationLength) {
    errors.push('You need to specify the number of options for validation');
  }

  if (validationLength && !validationRule) {
    errors.push('You need to specify the validation rule');
  }

  if (validationRule && validationLength) {
    const validation = checkboxValidationSigns.find((sign) => sign.label === validationRule);
    if (validation) {
      let lengthCondition = false;
      switch (validation.value) {
        case '=':
          lengthCondition = isSigningPage
            ? values.length !== validationLength
            : values.length < validationLength;
          break;
        case '>=':
          lengthCondition = values.length < validationLength;
          break;
        case '<=':
          lengthCondition = isSigningPage
            ? values.length > validationLength
            : values.length < validationLength;
          break;
      }
      if (lengthCondition) {
        errors.push(`You need to ${validationRule.toLowerCase()} ${validationLength} options`);
      }
    }
  }

  return errors;
}

// shape-9bd33609f205: all branches are flat independent if-statements,
// each pushing one error. Zero nesting beyond one level.
export function validateDropdownField(
  value: string | undefined,
  fieldMeta: DropdownFieldMeta,
  isSigningPage: boolean = false,
  fontSize?: number,
): string[] {
  const errors: string[] = [];
  const { readOnly, required, values, defaultValue } = fieldMeta;

  if (readOnly && required) {
    errors.push('A field cannot be both read-only and required');
  }

  if (readOnly && (!values || values.length === 0)) {
    errors.push('A read-only field must have at least one value');
  }

  if (isSigningPage && required && !value) {
    errors.push('Choosing an option is required');
  }

  if (values && values.length === 0) {
    errors.push('Select field must have at least one option');
  }

  if (values && values.length === 0 && defaultValue) {
    errors.push('Default value must be one of the available options');
  }

  if (value && values && !values.find((item) => item.value === value)) {
    errors.push('Selected value must be one of the available options');
  }

  if (values && defaultValue && !values.find((item) => item.value === defaultValue)) {
    errors.push('Default value must be one of the available options');
  }

  if (values && values.some((item) => item.value.length < 1)) {
    errors.push('Option value cannot be empty');
  }

  if (values && new Set(values.map((item) => item.value)).size !== values.length) {
    errors.push('Duplicate values are not allowed');
  }

  if (fontSize && (fontSize < 8 || fontSize > 96)) {
    errors.push('Font size must be between 8 and 96.');
  }

  return errors;
}

// shape-f7a0c09e8760: flat sequential validator with max nesting of two
// (outer if + inner regex check). Structural complexity is low; rule fires
// purely on branch count.
export function validateNumberField(
  value: string,
  fieldMeta?: NumberFieldMeta,
  isSigningPage: boolean = false,
): string[] {
  const errors: string[] = [];
  const { minValue, maxValue, readOnly, required, numberFormat, fontSize } = fieldMeta || {};

  if (numberFormat && value.length > 0) {
    const foundRegex = numberFormatValues.find((item) => item.value === numberFormat)?.regex;
    if (!foundRegex) {
      errors.push(`Invalid number format - ${numberFormat}`);
    }
    if (foundRegex && !foundRegex.test(value)) {
      errors.push(`Value ${value} does not match the number format - ${numberFormat}`);
    }
  }

  const numberValue = parseFloat(value);

  if (isSigningPage && required && !value) {
    errors.push('Value is required');
  }

  if ((isSigningPage || value.length > 0) && !/^[0-9,.]+$/u.test(value.trim())) {
    errors.push('Value is not a valid number');
  }

  if (typeof minValue === 'number' && minValue > 0 && numberValue < minValue) {
    errors.push(`Value ${value} is less than the minimum value of ${minValue}`);
  }

  if (typeof maxValue === 'number' && maxValue > 0 && numberValue > maxValue) {
    errors.push(`Value ${value} is greater than the maximum value of ${maxValue}`);
  }

  if (typeof minValue === 'number' && typeof maxValue === 'number' && minValue > maxValue) {
    errors.push('Minimum value cannot be greater than maximum value');
  }

  if (readOnly && numberValue < 1) {
    errors.push('A read-only field must have a value greater than 0');
  }

  if (readOnly && required) {
    errors.push('A field cannot be both read-only and required');
  }

  if (fontSize && (fontSize < 8 || fontSize > 96)) {
    errors.push('Font size must be between 8 and 96.');
  }

  return errors;
}



// FP fixture for code-quality/deterministic/function-in-loop.
// Two arrow functions are defined inside a for-of loop but they
// only capture block-scoped const bindings from the same iteration
// and are immediately consumed via Promise.all in that same
// iteration - they never escape the loop, so there is no
// stale-closure hazard. Modelled after documenso's
// seal-document.handler.ts (shapes c9b02575e0da and f407946960a8).
declare const envelopes: ReadonlyArray<{
  id: string;
  language: 'en' | 'de';
  pdfData: Uint8Array;
  documentId: string;
}>;
declare const usePlaywrightPdf: boolean;
declare function getCertificatePdf(opts: { documentId: string; language: string }): Promise<Uint8Array>;
declare function getCertificatePdfLegacy(opts: { documentId: string; language: string }): Promise<Uint8Array>;
declare function getAuditLogsPdf(opts: { documentId: string; language: string }): Promise<Uint8Array>;
declare function getAuditLogsPdfLegacy(opts: { documentId: string; language: string }): Promise<Uint8Array>;
declare function persistSealedEnvelope(input: {
  envelopeId: string;
  pdfData: Uint8Array;
  certificate: Uint8Array | null;
  auditLog: Uint8Array | null;
}): Promise<void>;

export async function sealEnvelopesInBatch(): Promise<void> {
  for (const envelopeItem of envelopes) {
    const { id: envelopeId, language, pdfData, documentId } = envelopeItem;

    // shape c9b02575e0da - block-scoped certificate factory, captures
    // only loop-local const bindings, consumed via Promise.all below.
    const makeCertificatePdf = async (): Promise<Uint8Array> =>
      usePlaywrightPdf
        ? getCertificatePdf({ documentId, language })
        : getCertificatePdfLegacy({ documentId, language });

    // shape f407946960a8 - block-scoped audit-log factory, sibling of
    // makeCertificatePdf, also consumed in the same iteration.
    const makeAuditLogPdf = async (): Promise<Uint8Array> =>
      usePlaywrightPdf
        ? getAuditLogsPdf({ documentId, language })
        : getAuditLogsPdfLegacy({ documentId, language });

    const [certificate, auditLog] = await Promise.all([
      makeCertificatePdf(),
      makeAuditLogPdf(),
    ]);

    await persistSealedEnvelope({
      envelopeId,
      pdfData,
      certificate,
      auditLog,
    });
  }
}


// max-nesting-depth FP: a flat if/else-if chain dispatching on a discriminated
// union should count as a single decision point, not as N nested branches.
// The rule treats every `else if` as a new level, pushing the deepest leaf
// past the threshold even though every arm is structurally a sibling.

type SyncOutcome =
  | { status: 'created'; domain: string }
  | { status: 'updated'; domain: string }
  | { status: 'reregistered'; domain: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: Error };

declare const domains: readonly string[];
declare const logger: { info(msg: string): void; warn(msg: string): void; error(msg: string, err?: unknown): void };
declare function syncOneDomain(domain: string): Promise<SyncOutcome>;

export async function syncEmailDomains(): Promise<void> {
  let createdCount = 0;
  let updatedCount = 0;
  let reregisteredCount = 0;
  let skippedCount = 0;

  for (const domain of domains) {
    try {
      const result = await syncOneDomain(domain);
      if (result.status === 'created') {
        createdCount++;
      } else if (result.status === 'updated') {
        updatedCount++;
      } else if (result.status === 'reregistered') {
        reregisteredCount++;
      } else if (result.status === 'skipped') {
        skippedCount++;
      } else if (result.status === 'failed') {
        logger.error(`failed to sync ${domain}`, result.error);
      }
    } catch (err) {
      logger.error(`unexpected sync error for ${domain}`, err);
    }
  }

  logger.info(
    `sync complete: created=${createdCount} updated=${updatedCount} reregistered=${reregisteredCount} skipped=${skippedCount}`,
  );
}



// missing-destructuring FP patterns: intentional single-property extraction,
// per-field typeof narrowing on Record<string, unknown>, and module-scope
// re-export aliasing of namespace primitives.

interface OrganisationClaim {
  flags: {
    hidePoweredBy: boolean;
    allowSignerCustomization: boolean;
    enableBranding: boolean;
  };
  name: string;
}

declare const organisationClaim: OrganisationClaim;

// shape-11bc93e68863: single-property extraction is intentional; the other
// flags are accessed inline at their own call sites rather than destructured
// together.
export function resolveBrandingFooter(): boolean {
  const hidePoweredBy = organisationClaim.flags.hidePoweredBy;
  if (organisationClaim.flags.enableBranding) {
    return !hidePoweredBy;
  }
  return !hidePoweredBy && !organisationClaim.flags.allowSignerCustomization;
}

// shape-c2c15e669244 (variant 1): Record<string, unknown> claims require
// per-field typeof narrowing, so destructuring would lose the type guard.
declare const claims: Record<string, unknown>;

export function extractOAuthProfile(): { name: string; email: string } {
  const name = claims.name;
  const email = claims.email;
  if (typeof name !== 'string') {
    throw new Error('claims.name missing');
  }
  if (typeof email !== 'string') {
    throw new Error('claims.email missing');
  }
  return { name, email };
}

// shape-c2c15e669244 (variant 2) + shape-50a803269f32: Radix-style namespace
// re-export. Each member is aliased at module scope and immediately exported.
declare const CollapsiblePrimitive: {
  Root: unknown;
  CollapsibleTrigger: unknown;
  CollapsibleContent: unknown;
};

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger;
export const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent;



// ---------------------------------------------------------------------------
// nested-template-literal FP fixtures
// ---------------------------------------------------------------------------
// Mode 1: tagged-template i18n macro (LinguiJS `msg`). The inner backtick is
// a tagged template, not a bare nested template, so combining it with dynamic
// values inside an outer template is the required idiom and must not fire.
// Mode 2: ternary-conditional URL segment. The inner template is the consequent
// or alternate of a ternary that is directly interpolated into an outer
// template - idiomatic URL construction, not gratuitous nesting.

declare const msg: (strings: TemplateStringsArray, ...values: unknown[]) => { id: string };
declare const i18n: { _: (descriptor: { id: string }) => string };

declare const documentTitle: string;
declare const recipientName: string;
declare const eventTimestamp: string;
declare const signerEmail: string;
declare const ipAddress: string;
declare const userAgent: string;

export function renderAuditLogSignedEntry(): string {
  // FP mode 1: inner backtick has a `msg` tag (LinguiJS i18n macro).
  return `[audit] ${i18n._(msg`Document ${documentTitle} was signed by ${recipientName}`)} at ${eventTimestamp}`;
}

export function renderAuditLogViewedEntry(): string {
  // FP mode 1: another tagged-template inner literal inside an outer template.
  return `[audit] ${i18n._(msg`Recipient ${recipientName} viewed the document from ${ipAddress}`)} (${userAgent})`;
}

export function renderCertificateFooter(): string {
  // FP mode 1: tagged-template nested inside a multi-line outer template.
  return `Certificate of completion\nGenerated for: ${i18n._(msg`Signer ${signerEmail} on ${documentTitle}`)}\n`;
}

declare const envelopeId: string;
declare const recipientId: string;
declare const presignToken: string | null;
declare const baseUrl: string;

export function buildEnvelopeDownloadUrl(): string {
  // FP mode 2: inner template is the consequent of a ternary used as an
  // optional `?presignToken=` query segment on an outer URL template.
  return `${baseUrl}/api/envelopes/${envelopeId}/download${
    presignToken !== null ? `?presignToken=${presignToken}` : ''
  }`;
}

export function buildEnvelopeRecipientUrl(): string {
  // FP mode 2: same idiom on a recipient-scoped URL with a second segment.
  return `${baseUrl}/api/envelopes/${envelopeId}/recipients/${recipientId}${
    presignToken !== null ? `?presignToken=${presignToken}` : ''
  }`;
}

declare const ticketSubject: string;
declare const ticketBody: string;
declare const userEmail: string | null;

export function renderSupportTicketBody(): string {
  // FP mode 2: ternary-conditional inner template for an optional email line.
  return `Subject: ${ticketSubject}\n${
    userEmail !== null ? `From: ${userEmail}\n` : ''
  }Body:\n${ticketBody}`;
}



// --- prefer-const false-positive fixtures (mirroring documenso patterns) ---

declare const getPageSize: (page: unknown) => { width: number; height: number };
declare const radiansToDegrees: (rad: number) => number;

export function computeFieldBoxForRotatedPage(
  page: unknown,
  isPageRotatedToLandscape: boolean,
  field: { width: string; height: string; positionX: string; positionY: string },
): { x: number; y: number; w: number; h: number } {
  // shape-cf8e6ed2179e:
  // pageWidth/pageHeight are reassigned via swap destructuring when the page
  // is rotated 90/270 degrees, so `const` is impossible here even though the
  // declaration line alone reads like a const candidate.
  let { width: pageWidth, height: pageHeight } = getPageSize(page);

  if (isPageRotatedToLandscape) {
    [pageWidth, pageHeight] = [pageHeight, pageWidth];
  }

  const w = pageWidth * (Number(field.width) / 100);
  const h = pageHeight * (Number(field.height) / 100);
  const x = pageWidth * (Number(field.positionX) / 100);
  const y = pageHeight * (Number(field.positionY) / 100);
  return { x, y, w, h };
}

declare const isValidReturnTo: (path: string) => boolean;
declare const normalizeReturnTo: (path: string) => string | null;

export function resolveOAuthRedirect(
  storedRedirectPath: string,
  storedState: string,
): { redirectState: string; redirectPath: string } {
  // shape-2ef712a431e4:
  // The destructured `redirectPath` is reassigned on multiple downstream
  // branches, so the declaration must stay `let`. The rule only inspects the
  // declaration site and misses the later mutations of the destructured
  // binding.
  // eslint-disable-next-line prefer-const
  let [redirectState, redirectPath] = storedRedirectPath.split(' ');

  if (redirectState !== storedState || !redirectPath) {
    redirectPath = '/';
  }

  if (!isValidReturnTo(redirectPath)) {
    redirectPath = '/';
  }

  redirectPath = normalizeReturnTo(redirectPath) || '/';

  return { redirectState, redirectPath };
}

type PDF = { kind: 'pdf'; id: string };
declare const makeCertificatePdf: () => Promise<PDF>;
declare const makeAuditLogPdf: () => Promise<PDF>;

export async function buildSealedDocumentAttachments(
  needsCertificate: boolean,
  needsAuditLog: boolean,
): Promise<{ certificateDoc: PDF | null; auditLogDoc: PDF | null }> {
  // shape-7b04b4add88e:
  // certificateDoc / auditLogDoc are declared `let` with a null initializer
  // and only later reassigned via array destructuring from Promise.all. The
  // declaration line looks const-eligible, but the variables are genuinely
  // mutated downstream.
  let certificateDoc: PDF | null = null;
  let auditLogDoc: PDF | null = null;

  if (needsCertificate || needsAuditLog) {
    [certificateDoc, auditLogDoc] = await Promise.all([
      needsCertificate ? makeCertificatePdf() : Promise.resolve<PDF | null>(null),
      needsAuditLog ? makeAuditLogPdf() : Promise.resolve<PDF | null>(null),
    ]);
  }

  return { certificateDoc, auditLogDoc };
}



// Anchor-precedence false-positive guard (shape-68e2a0c664b5): the pattern
// /^\/api\/|^\/__/ contains a top-level `|` alternation, but EACH branch
// already carries its own `^` anchor (`^\/api\/` and `^\/__`). So both
// alternatives are correctly anchored to the start of the input - there is
// no bug where one branch is anchored and the other floats. The detector
// must not flag patterns where every top-level alternative has its own
// anchor.
declare const incomingPath: string;
const INTERNAL_ROUTE_RE = /^\/api\/|^\/__/;
export function isInternalRoute(path: string): boolean {
  return INTERNAL_ROUTE_RE.test(path);
}
export const internalRouteHit: boolean = isInternalRoute(incomingPath);

// Anchor-precedence false-positive guard (shape-84adcb92f0d8): the RFC 5322
// email pattern has `^` at the very start and `$` at the very end with NO
// top-level `|` alternation between them. Every inner `|` is safely nested
// inside a non-capturing group `(?:...)`, so the anchors unambiguously wrap
// the entire pattern. The detector must not fire on patterns whose only
// `|` operators live inside parenthesised groups.
declare const candidateEmail: string;
const RFC5322_EMAIL_RE =
  /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/i;
export function isRfc5322Email(value: string): boolean {
  return RFC5322_EMAIL_RE.test(value);
}
export const emailOk: boolean = isRfc5322Email(candidateEmail);



/**
 * `require-await` false-positive shapes.
 *
 * Each block below uses `async` deliberately without an inner `await`
 * because the surrounding type contract, framework API, or chaining
 * pattern requires the function to return a Promise. The detector
 * sees `async` + no `await` and flags it, but the async keyword is
 * load-bearing in every case here.
 */

// ---------------------------------------------------------------------------
// Mode: event-handler-type-conformance
// React-style onClick / handleSubmit handlers whose props are typed as
// `() => Promise<void>`. The async keyword exists only to satisfy that
// type signature; the body delegates to a mutation that already returns
// a Promise, so there is nothing to await on this level.
// ---------------------------------------------------------------------------
declare const deleteClaim: (input: { id: string }) => Promise<void>;
declare const acceptOrganisationInvitation: (input: { token: string }) => Promise<void>;
declare const refetchRecentActivity: () => Promise<void>;

interface AsyncClickButtonProps {
  onClick: () => Promise<void>;
  label: string;
}

export function makeDeleteClaimButton(claimId: string): AsyncClickButtonProps {
  return {
    label: 'Delete',
    // async required by `() => Promise<void>` prop signature; deleteClaim
    // already returns a Promise so an extra await would just unwrap-rewrap.
    onClick: async () => deleteClaim({ id: claimId }),
  };
}

export function makeAcceptInviteButton(token: string): AsyncClickButtonProps {
  return {
    label: 'Accept',
    onClick: async () => acceptOrganisationInvitation({ token }),
  };
}

export function makeRefetchButton(): AsyncClickButtonProps {
  return {
    label: 'Refresh',
    onClick: async () => refetchRecentActivity(),
  };
}

// ---------------------------------------------------------------------------
// Mode: interface-conformance-and-map-callbacks
// async wrappers exist to match an interface method shape (File.arrayBuffer),
// a ts-pattern .with()/.otherwise() arm whose return is awaited by match(),
// or an abstract stub that throws unconditionally. No await is possible
// because the body either wraps a sync value, delegates to an async fn,
// or never returns at all.
// ---------------------------------------------------------------------------
declare const prefilledPdfBytes: ArrayBuffer;

interface FileLike {
  name: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export function buildPrefilledFile(name: string): FileLike {
  return {
    name,
    type: 'application/pdf',
    // Interface signature is `() => Promise<ArrayBuffer>`; the body
    // intentionally wraps a sync value with Promise.resolve.
    arrayBuffer: async () => Promise.resolve(prefilledPdfBytes),
  };
}

declare const putFileInS3: (file: FileLike) => Promise<string>;
declare const putFileInDatabase: (file: FileLike) => Promise<string>;

interface PatternMatcher<TInput, TOutput> {
  with: (value: TInput, arm: () => TOutput) => PatternMatcher<TInput, TOutput>;
  otherwise: (arm: () => TOutput) => TOutput;
}

declare const match: <TInput, TOutput>(value: TInput) => PatternMatcher<TInput, TOutput>;

export async function putFileServerSide(
  transport: 's3' | 'database',
  file: FileLike,
): Promise<string> {
  return await match<'s3' | 'database', Promise<string>>(transport)
    // Each arm must return a Promise<string>; async () => fn(file)
    // satisfies that shape by delegating to an already-async function.
    .with('s3', async () => putFileInS3(file))
    .otherwise(async () => putFileInDatabase(file));
}

interface JobsClient {
  wait: () => Promise<void>;
}

export function makeUnimplementedJobsClient(): JobsClient {
  return {
    // Abstract stub: throws unconditionally. The interface requires
    // `() => Promise<void>`, so async is mandatory even though the body
    // never reaches an await point.
    wait: async () => {
      throw new Error('Not implemented');
    },
  };
}

// ---------------------------------------------------------------------------
// Mode: framework-handler-conformance
// Framework-mandated handler signatures (Hono route, Hono middleware,
// tRPC createContext factory). The framework calls these and awaits the
// returned promise itself, so the handler is `async` purely to match
// the expected `(ctx) => Promise<Response>` / `() => Promise<Ctx>` type.
// ---------------------------------------------------------------------------
interface HonoContext {
  reqPath: string;
}

interface HonoResponse {
  status: number;
}

declare const handleOAuthCallbackUrl: (input: {
  c: HonoContext;
  clientOptions: { provider: string };
}) => Promise<HonoResponse>;

declare const openApiTrpcServerHandler: (
  c: HonoContext,
  opts: { isBeta: boolean },
) => Promise<HonoResponse>;

declare const createTrpcContext: (input: {
  c: HonoContext;
  requestSource: string;
}) => Promise<{ userId: string | null }>;

type HonoHandler = (c: HonoContext) => Promise<HonoResponse>;

export const oidcCallbackHandler: HonoHandler = async (c) =>
  handleOAuthCallbackUrl({ c, clientOptions: { provider: 'oidc' } });

export const openApiV2Middleware: HonoHandler = async (c) =>
  openApiTrpcServerHandler(c, { isBeta: false });

interface TrpcServerOptions {
  createContext: () => Promise<{ userId: string | null }>;
}

export function buildTrpcServerOptions(c: HonoContext): TrpcServerOptions {
  return {
    // tRPC's createContext factory signature is `() => Promise<Ctx>`;
    // async keyword is required by the factory's declared return type.
    createContext: async () => createTrpcContext({ c, requestSource: 'apiV2' }),
  };
}

// ---------------------------------------------------------------------------
// Mode: promise-chain-redundant-async
// .then()/.catch() callbacks declared `async` even though they only call
// another Promise-returning method. The async keyword is structurally
// redundant (the chain handles the promise) but intentional — the author
// is keeping every arm in the chain async-uniform.
// ---------------------------------------------------------------------------
interface FontResponse {
  arrayBuffer: () => Promise<ArrayBuffer>;
}

declare const fetchFont: (url: string) => Promise<FontResponse>;
declare const PDFLoad: (bytes: ArrayBuffer) => Promise<{ pageCount: number }>;

export function loadFontBytes(url: string): Promise<ArrayBuffer> {
  // The .then arm only forwards res.arrayBuffer(); async is redundant
  // (the chain already awaits it) but kept for stylistic uniformity.
  return fetchFont(url).then(async (res) => res.arrayBuffer());
}

export function loadSecondaryFontBytes(url: string): Promise<ArrayBuffer> {
  return fetchFont(url).then(async (res) => res.arrayBuffer());
}

export function loadDocumentInfo(
  bytesPromise: Promise<ArrayBuffer>,
): Promise<{ pageCount: number }> {
  return bytesPromise.then(async (bytes) => PDFLoad(bytes));
}

// ---------------------------------------------------------------------------
// Mode: delegate-return-no-await
// Top-level async functions whose body is a single return-of-a-call to
// another Promise-returning function. Removing async would change the
// declared return type that callers depend on for type inference, even
// though there is nothing to await internally.
// ---------------------------------------------------------------------------
interface JobProvider {
  triggerJob: (options: { name: string; payload: unknown }) => Promise<void>;
}

export class JobsDispatcher {
  constructor(private readonly provider: JobProvider) {}

  // Class method's signature on the interface is `Promise<void>`;
  // delegating directly to provider.triggerJob keeps async only to
  // signal the return type to callers and subclasses.
  public async triggerJob(options: { name: string; payload: unknown }): Promise<void> {
    return this.provider.triggerJob(options);
  }
}

type EnvelopeFileVersion = 'pending' | 'signed' | 'original';

interface HandleEnvelopeItemFileRequestOptions {
  version: EnvelopeFileVersion;
  itemId: string;
}

declare const handlePendingFileRequest: (
  options: HandleEnvelopeItemFileRequestOptions,
) => Promise<ArrayBuffer>;
declare const handleStoredFileRequest: (
  options: HandleEnvelopeItemFileRequestOptions,
) => Promise<ArrayBuffer>;

export const handleEnvelopeItemFileRequest = async (
  options: HandleEnvelopeItemFileRequestOptions,
): Promise<ArrayBuffer> => {
  if (options.version === 'pending') {
    return handlePendingFileRequest(options);
  }
  return handleStoredFileRequest(options);
};

declare const prismaDocumentDataCreate: (input: {
  data: { type: string; data: string; initialData: string };
}) => Promise<{ id: string }>;

export const createDocumentData = async ({
  documentData,
}: {
  documentData: string;
}): Promise<{ id: string }> => {
  // Single return of a Promise-returning ORM call; async signals the
  // return type to callers without introducing a redundant await.
  return prismaDocumentDataCreate({
    data: {
      type: 'BYTES_64',
      data: documentData,
      initialData: documentData,
    },
  });
};



/**
 * Positive fixtures for code-quality/deterministic/require-unicode-regexp.
 *
 * The visitor fires on every `regex` literal whose flags do not include
 * `u` or `v`. Each block below contains at least one such literal,
 * mirroring a real shape observed in the documenso audit corpus.
 */

// Mode: ascii-validation-patterns
// Password validator using ASCII shorthand classes. Each `.refine` regex
// is missing the `u` flag — the rule fires on every literal here.
declare const z: {
  string: () => {
    refine: (
      fn: (value: string) => boolean,
      opts: { message: string },
    ) => { refine: any };
  };
};

export const passwordSchema = z
  .string()
  .refine((value) => value.length > 25 || /[A-Z]/.test(value), {
    message: 'Must contain an uppercase letter',
  })
  .refine((value) => value.length > 25 || /[a-z]/.test(value), {
    message: 'Must contain a lowercase letter',
  })
  .refine((value) => value.length > 25 || /\d/.test(value), {
    message: 'Must contain a digit',
  })
  .refine(
    (value) => value.length > 25 || /[`~<>?,./!@#$%^&*()\-_"'+=|{}[\];:\\]/.test(value),
    { message: 'Must contain a special character' },
  );

// Mode: url-path-route-patterns
// Protocol stripping and path prefix matching. ASCII URL syntax with no
// unicode flag — the rule fires on each literal below.
declare const formatDirectTemplatePath: (token: string) => string;

export function stripProtocol(token: string): string {
  return formatDirectTemplatePath(token).replace(/https?:\/\//, '');
}

export const NON_PAGE_PATH_REGEX = /^(\/api\/|\/ingest\/|\/__manifest|\/assets\/|\/apple-.*|\/favicon.*)/;
export const EMBED_PATH_REGEX = /^\/embed(\/|\.data|$)/;
export const FRAMEABLE_PATH_REGEX =
  /^\/(signin|forgot-password|check-email|unverified-account|sign|d)(\/|\.data|$)/;

// Mode: text-transformation-patterns
// Whitespace and line-ending normalization used in email body cleanup.
// Plain ASCII whitespace classes — rule fires on each `.replace` regex.
export function normalizeMessageBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/\n\s*\n+/g, '\n\n')
    .replace(/\n{2,}/g, '\n\n');
}

export function slugifyTeamName(input: string): string {
  return input.replace(/\s+/g, '-');
}

// Mode: file-extension-filesystem-patterns
// PDF filename extension stripping. ASCII literal `\.pdf$` with no `u`
// flag — rule fires on both the case-sensitive and case-insensitive form.
export function stripPdfExtension(title: string): string {
  return title.replace(/\.pdf$/, '');
}

export function stripPdfExtensionCaseInsensitive(title: string): string {
  return title.replace(/\.pdf$/i, '');
}

export function downloadBaseName(fileName: string | undefined): string {
  return (fileName ?? 'document').replace(/\.pdf$/, '');
}

// Mode: template-placeholder-patterns
// `{{...}}` and `{...}` placeholder extraction used by PDF auto-place
// fields and custom email template rendering. ASCII delimiter pairs —
// rule fires on each literal.
export const PLACEHOLDER_REGEX = /\{\{([^}]+)\}\}/g;

export function extractInnerPlaceholder(placeholder: string): string | null {
  const innerMatch = placeholder.match(/^\{\{([^}]+)\}\}$/);
  return innerMatch?.[1] ?? null;
}

export function renderCustomEmailTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{(\S+)\}/g, (_, key: string) => values[key] ?? '');
}



// abstract-override-placeholder: BaseJobProvider is an abstract-base stub.
// Each method body is a single `throw new Error('Not implemented')` so the
// `this`-usage check sees no `this` reference and flags the method. The
// class is the polymorphic base - subclasses override these methods and
// rely on `this`. Promoting any of them to static would break the override
// contract. The class deliberately has no `extends`/`implements` clause so
// the visitor's heritage skip does not apply.
declare const jobsBaseRegistry: { recordEnqueue(id: string): void };

interface JobDefinition {
  readonly id: string;
  readonly handler: (payload: unknown) => Promise<void>;
}

export class BaseJobProvider {
  defineJob(_definition: JobDefinition): void {
    throw new Error('Not implemented');
  }
  triggerJob(_id: string, _payload: unknown): Promise<void> {
    throw new Error('Not implemented');
  }
  start(): Promise<void> {
    throw new Error('Not implemented');
  }
}

export class TriggerJobProvider extends BaseJobProvider {
  override defineJob(definition: JobDefinition): void {
    jobsBaseRegistry.recordEnqueue(definition.id);
  }
  override async triggerJob(id: string, _payload: unknown): Promise<void> {
    jobsBaseRegistry.recordEnqueue(id);
  }
  override async start(): Promise<void> {
    return;
  }
}

// interface-contract-implementation: SkiaCanvasFactory structurally satisfies
// the pdfjs CanvasFactory contract (create / reset / destroy on a canvas).
// The class is passed at runtime to pdfjs.getDocument, which calls these
// methods on the instance. Because TypeScript `implements` is not declared
// (structural typing only) the visitor's heritage skip does not fire, and
// the methods - which use only the module-level `skiaCanvas` factory - are
// reported as static candidates. Converting them to static would break the
// instance contract that pdfjs expects.
declare const skiaCanvas: {
  createCanvas(width: number, height: number): { width: number; height: number; getContext(kind: '2d'): unknown };
};

interface PdfCanvasAndContext {
  canvas: { width: number; height: number };
  context: unknown;
}

export class SkiaCanvasFactory {
  create(width: number, height: number): PdfCanvasAndContext {
    const canvas = skiaCanvas.createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(canvasAndContext: PdfCanvasAndContext, width: number, height: number): void {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext: PdfCanvasAndContext): void {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

// private-helper-no-this-but-static-adds-no-value: LicenseClient holds private
// helpers that interact with module-level singletons (prisma, fs). The methods
// genuinely do not reference `this`, so the rule flags them - but they are
// `private` and only invoked through the public surface of the class. Promoting
// a private helper to static adds no observable value at the call site and
// changes the class's internal API surface noisily.
declare const prisma: { license: { findFirst(args: unknown): Promise<{ token: string } | null> } };
declare const writeFileSync: (path: string, contents: string) => void;
declare const fetchJson: (url: string) => Promise<{ valid: boolean }>;
const LICENSE_PATH = '/etc/truecourse/license.json';
const LICENSE_URL = 'https://example.invalid/license';

export class LicenseClient {
  private cachedToken: string | null = null;

  async refresh(): Promise<void> {
    this.cachedToken = await this._readToken();
    this._writeTokenCache(this.cachedToken ?? '');
    await this._verifyToken(this.cachedToken ?? '');
  }

  private async _readToken(): Promise<string | null> {
    const row = await prisma.license.findFirst({ where: { active: true } });
    return row ? row.token : null;
  }
  private _writeTokenCache(token: string): void {
    writeFileSync(LICENSE_PATH, JSON.stringify({ token }));
  }
  private async _verifyToken(_token: string): Promise<boolean> {
    const result = await fetchJson(LICENSE_URL);
    return result.valid;
  }
}

// singleton-initialization-encapsulation: TelemetryClient is a singleton whose
// constructor seeds `this.installationId` from a generator method. The
// generator itself does not consult `this` (it only reads a module-level
// id source), so the rule flags it - but the value is conceptually owned by
// the instance, and promoting the generator to static would scatter the
// initialization across class + module scope.
declare const randomId: () => string;

export class TelemetryClient {
  installationId: string;
  constructor() {
    this.installationId = this._generateInstallationId();
  }
  private _generateInstallationId(): string {
    const base = randomId();
    return `install-${base}`;
  }
}

// this-access-obscured-by-async-wrapper: SignaturePadCanvas.toBlob does access
// `this.$canvas`, but the access lives inside a `new Promise(...)` executor
// arrow function. The visitor's `usesThisOrSuper` walk explicitly does not
// recurse into arrow_function / function_expression nodes, so the `this`
// reference is invisible to the static-method check and the method is
// (falsely) reported as a static candidate.
declare const noopBlob: Blob;

export class SignaturePadCanvas {
  $canvas: { toBlob(cb: (blob: Blob | null) => void): void } = { toBlob: (cb) => cb(noopBlob) };

  toBlob(): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      this.$canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob returned null'));
      });
    });
  }
}



// ---- unnamed-regex-capture: shape-fdfb1e035926 ----
// Character-class regex (no real capture group) consumed exclusively by .test().
declare const passwordCandidate: string;
export function hasSpecialCharacter(): boolean {
  return passwordCandidate.length > 25 || /[`~<>?,./!@#$%^&*()\-_"'+=|{}[\];:\\]/.test(passwordCandidate);
}

// ---- unnamed-regex-capture: shape-1883ca5a2fd8 ----
// Lowercase-named regex const with positional capture group, used only via .test(path).
const nonPagePathRegex = /^(\/api\/|\/ingest\/|\/__manifest|\/assets\/|\/apple-.*|\/favicon.*)/;
declare const requestPath: string;
export function isNonPagePath(): boolean {
  return nonPagePathRegex.test(requestPath);
}

// ---- unnamed-regex-capture: shape-f266ada3f8fe ----
// SCREAMING_SNAKE_CASE regex const with positional capture group, used only via .test(path).
const NON_PAGE_PATH_REGEX = /^(\/api\/|\/ingest\/|\/__manifest|\/assets\/|\/apple-.*|\/favicon.*)/;
export function shouldSkipSecurityHeaders(): boolean {
  return NON_PAGE_PATH_REGEX.test(requestPath);
}



// Singleton with a private constructor invoked internally via the static
// factory method. The visitor collects `constructor` as a private member and
// only looks for `this.<name>` access or `private_property_identifier`, so the
// internal `new BullMQJobProviderLike()` call is not recognised as a use and
// the private constructor is wrongly flagged as unused.
export class BullMQJobProviderLike {
  private static _singleton: BullMQJobProviderLike | null = null;

  private constructor() {
    // intentionally empty - constructor is private so external code cannot
    // call `new BullMQJobProviderLike()` directly.
  }

  public static getInstance(): BullMQJobProviderLike {
    if (BullMQJobProviderLike._singleton === null) {
      BullMQJobProviderLike._singleton = new BullMQJobProviderLike();
    }
    return BullMQJobProviderLike._singleton;
  }

  public ping(): string {
    return 'pong';
  }
}

// Singleton holder class whose private static `_instance` is referenced via
// `LocalJobProviderLike._instance` inside the class body (the canonical
// singleton pattern). The visitor's walker only adds names accessed through
// `this.<member>` to the used set, so class-name-qualified static member
// references are not detected and `_instance` is wrongly flagged as unused.
export class LocalJobProviderLike {
  private static _instance: LocalJobProviderLike | null = null;

  public static getInstance(): LocalJobProviderLike {
    if (LocalJobProviderLike._instance === null) {
      LocalJobProviderLike._instance = new LocalJobProviderLike();
    }
    return LocalJobProviderLike._instance;
  }

  public describe(): string {
    return 'local-job-provider';
  }
}


// Useless-empty-export FP (shape-5f518a5e7b17): mirrors the package-level
// `index.ts` idiom used by monorepos like documenso. The package exposes its
// public surface exclusively via sub-path imports (e.g.
// `@documenso/lib/server-only/...`) and has no barrel re-exports. The lone
// `export {};` is a deliberate TypeScript module-boundary marker - removing
// it turns the file into a script that shares global scope, which is not
// what the package author wants. Simulated here by a documented marker
// alongside ambient declarations that establish the package's typing surface.
declare const __packageMarker_subpathOnlyApi: unique symbol;

// Intentional ES module marker for a sub-path-only package entry point.
export {};

// Useless-empty-export FP (shape-302807ef605f): side-effect-only polyfill
// that mutates globalThis (here, a Promise.withResolvers ES2024 shim). The
// file contains no value or type exports, but the trailing `export {};` is
// required to make TypeScript treat the file as an ES module so that
// `declare global` augmentations and `import './polyfills/...'` semantics
// behave correctly. Without it the polyfill leaks into the ambient script
// scope and the `declare global` block becomes invalid.
declare global {
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }
}

declare const globalPromise: PromiseConstructor & {
  withResolvers?: <T>() => {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};

if (typeof globalPromise.withResolvers !== 'function') {
  globalPromise.withResolvers = function withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  } {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Intentional ES module marker required by the `declare global` augmentation
// above - removing it would make the file a script and break the polyfill.
export {};



// catch-without-error-type FP fixtures — each block reproduces a documenso FP
// pattern where the rule fires on a catch handler that is safe in practice.

declare const AppError: { parseError(err: unknown): { code: string; message: string } };
declare const toast: (msg: { title: string; description?: string }) => void;
declare const doSomething: () => Promise<void>;
declare const setIsLoading: (v: boolean) => void;
declare const setSubmitting: (v: boolean) => void;
declare const window: { postMessage(data: unknown, origin: string): void };
declare const db: { task: { update(args: { where: { id: string }; data: { status: string } }): Promise<void> } };
declare const taskId: string;

// MODE 1: app-error-parse-normalization
// Catch hands the value to AppError.parseError(), which safely normalizes any
// thrown value into a typed AppError. No untyped property access on err.
export async function modeAppErrorParse(): Promise<void> {
  try {
    await doSomething();
  } catch (err) {
    const error = AppError.parseError(err);
    toast({ title: 'Operation failed', description: error.message });
    setIsLoading(false);
  }
}

// MODE 2: pass-through-logging-no-property-access
// Catch only passes err as an argument to console.error and shows a fully
// static toast. No MemberExpression on err anywhere in the body.
export async function modePassThroughLogging(): Promise<void> {
  try {
    await doSomething();
  } catch (err) {
    console.error('Error creating document:', err);
    toast({ title: 'Something went wrong', description: 'Please try again later.' });
  }
}

// MODE 3: error-unused-or-opaque-rethrow
// Catch ignores err entirely — resets boolean state and shows a generic toast.
// The error value is never dereferenced.
export async function modeErrorUnused(): Promise<void> {
  try {
    await doSomething();
  } catch (err) {
    setSubmitting(false);
    toast({ title: 'Unable to verify email', description: 'Please retry shortly.' });
  }
}

// MODE 4: safe-coercion-no-property-access
// Catch coerces err via String() and posts it to the parent window. No
// property access on the untyped catch parameter.
export function modeSafeCoercion(): void {
  try {
    doSomething();
  } catch (err) {
    const message = String(err);
    window.postMessage({ action: 'document-error', data: { message } }, '*');
    setIsLoading(false);
  }
}

// MODE 5: db-side-effect-then-rethrow
// Catch performs a DB write to mark the job failed, logs err as an argument,
// then rethrows. No property dereference on the catch parameter.
export async function modeDbSideEffectThenRethrow(): Promise<void> {
  try {
    await doSomething();
  } catch (err) {
    await db.task.update({ where: { id: taskId }, data: { status: 'FAILED' } });
    console.log('job failed', err);
    throw err;
  }
}



// positive: jwt-no-expiry (shape e6c376c4dcf3) — bare sign() call is a custom
// HMAC/webhook signing utility (server-only/crypto/sign), not a JWT library.
// The result is placed in an X-Job-Signature HTTP header for internal job
// dispatch — the rule must not match an identifier `sign` whose import source
// is not jsonwebtoken/jose.
declare const sign: (payload: string) => string;

interface JobDispatchRequest {
  endpoint: string;
  payload: { jobId: string; attempt: number };
}

export async function dispatchLocalJob_e6c376c4dcf3(
  request: JobDispatchRequest,
): Promise<Response> {
  const data = JSON.stringify(request.payload);
  const signature = sign(data);
  return fetch(request.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Job-Signature': signature,
    },
    body: data,
  });
}

// positive: jwt-no-expiry (shape e47053f84358) — jose's SignJWT builder chain
// already configures expiration via .setExpirationTime() earlier in the same
// chain. The terminal .sign(secret) only takes a key; expiry is encoded in the
// JWT claims, not in the .sign() options. The rule must follow the builder
// chain back to detect setExpirationTime before flagging.
declare class SignJWT {
  constructor(payload: Record<string, unknown>);
  setProtectedHeader(header: { alg: string }): this;
  setIssuedAt(date: Date): this;
  setExpirationTime(date: Date): this;
  setSubject(sub: string): this;
  setAudience(aud: string): this;
  sign(key: Uint8Array): Promise<string>;
}

interface PresignTokenInput {
  apiToken: { id: string; userId: string; teamId: string | null; token: string };
  expiresInMinutes?: number;
}

export async function createEmbeddingPresignToken_e47053f84358(
  input: PresignTokenInput,
): Promise<{ token: string; expiresAt: Date }> {
  const now = new Date();
  const effectiveExpiresIn = input.expiresInMinutes ?? 60;
  const expiresAt = new Date(now.getTime() + effectiveExpiresIn * 60_000);
  const secret = new TextEncoder().encode(input.apiToken.token);
  const token = await new SignJWT({
    aud: String(input.apiToken.teamId ?? input.apiToken.userId),
    sub: String(input.apiToken.id),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(secret);
  return { token, expiresAt };
}

// positive: jwt-no-expiry (shape 88aea15ad30d) — pdf.sign() on a @libpdf/core
// PDF document is a PDF digital-signature operation, not JWT creation. The
// receiver is a PDF object whose .sign() applies a CMS/PKCS#7 signature using
// the provided signer and reason. The rule must check the receiver kind
// before flagging any .sign() member call.
interface PdfSigner {
  certificate: Uint8Array;
  privateKey: Uint8Array;
}

interface PdfDocument {
  sign(opts: {
    signer: PdfSigner;
    reason: string;
    location?: string;
    contactInfo?: string;
  }): Promise<{ bytes: Uint8Array }>;
}

declare const pdf: PdfDocument;
declare const signer: PdfSigner;

export async function signDocumentPdf_88aea15ad30d(
  reason: string,
): Promise<Uint8Array> {
  const { bytes } = await pdf.sign({
    signer,
    reason,
    location: 'Documenso',
    contactInfo: 'support@documenso.com',
  });
  return bytes;
}



// ---------------------------------------------------------------------------
// too-many-return-statements: positive (FP) fixtures.
// Threshold is >5 returns per function. Each block below has 6+ returns by
// design, but every return is idiomatic and refactoring would reduce clarity.
// ---------------------------------------------------------------------------

declare const FieldTypeTMR: {
  readonly NAME: 'NAME';
  readonly INITIALS: 'INITIALS';
  readonly EMAIL: 'EMAIL';
  readonly DATE: 'DATE';
  readonly CHECKBOX: 'CHECKBOX';
  readonly RADIO: 'RADIO';
  readonly DROPDOWN: 'DROPDOWN';
  readonly SIGNATURE: 'SIGNATURE';
  readonly FREE_SIGNATURE: 'FREE_SIGNATURE';
  readonly TEXT: 'TEXT';
  readonly NUMBER: 'NUMBER';
};

type FieldTypeTMRValue = (typeof FieldTypeTMR)[keyof typeof FieldTypeTMR];

interface AutoSignableFieldTMR {
  readonly type: FieldTypeTMRValue;
  readonly inserted: boolean;
}

declare const AUTO_SIGNABLE_FIELD_TYPES_TMR: ReadonlyArray<FieldTypeTMRValue>;

// shape-9dc1cd18a345: filter callback with five early-return false guards and
// a final return true. Refactoring into a combined boolean expression would
// hurt readability; each guard documents one disqualification.
export function buildAutoSignableFieldsTMR(
  fields: ReadonlyArray<AutoSignableFieldTMR>,
  fullName: string | undefined,
  email: string | undefined,
): ReadonlyArray<AutoSignableFieldTMR> {
  return fields.filter((field) => {
    if (field.inserted) {
      return false;
    }

    if (!AUTO_SIGNABLE_FIELD_TYPES_TMR.includes(field.type)) {
      return false;
    }

    if (field.type === FieldTypeTMR.NAME && !fullName) {
      return false;
    }

    if (field.type === FieldTypeTMR.INITIALS && !fullName) {
      return false;
    }

    if (field.type === FieldTypeTMR.EMAIL && !email) {
      return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// shape-2676c4423d4b: React-component-style guard-clause dispatch per
// FieldType. Each branch returns a structurally distinct UI fragment, and a
// final fallthrough returns the generic label. Six returns total. Merging the
// branches into a single ternary or switch would obscure the distinct render
// shapes (checkbox grid vs radio group vs dropdown caret vs signature image).
// ---------------------------------------------------------------------------

interface RenderableFieldTMR {
  readonly type: FieldTypeTMRValue;
  readonly inserted: boolean;
  readonly customText?: string;
  readonly fieldMeta?: { readonly type?: string; readonly values?: ReadonlyArray<{ value: string }> };
  readonly signature?: { readonly signatureImageAsBase64?: string };
}

interface RenderNodeTMR {
  readonly kind: 'checkbox' | 'radio' | 'dropdown' | 'signature' | 'empty' | 'text';
  readonly props: Record<string, unknown>;
}

declare const renderCheckboxGroupTMR: (field: RenderableFieldTMR) => RenderNodeTMR;
declare const renderRadioGroupTMR: (field: RenderableFieldTMR) => RenderNodeTMR;
declare const renderDropdownPlaceholderTMR: () => RenderNodeTMR;
declare const renderSignatureImageTMR: (src: string) => RenderNodeTMR;
declare const renderEmptyTMR: () => RenderNodeTMR;
declare const renderGenericTextTMR: (field: RenderableFieldTMR) => RenderNodeTMR;

export function FieldContentTMR(field: RenderableFieldTMR): RenderNodeTMR {
  if (field.type === FieldTypeTMR.CHECKBOX && field.fieldMeta?.type === 'checkbox') {
    return renderCheckboxGroupTMR(field);
  }

  if (
    field.type === FieldTypeTMR.RADIO &&
    field.fieldMeta?.type === 'radio' &&
    field.fieldMeta.values &&
    field.fieldMeta.values.length > 0
  ) {
    return renderRadioGroupTMR(field);
  }

  if (field.type === FieldTypeTMR.DROPDOWN && field.fieldMeta?.type === 'dropdown' && !field.inserted) {
    return renderDropdownPlaceholderTMR();
  }

  if (
    field.type === FieldTypeTMR.SIGNATURE &&
    field.signature?.signatureImageAsBase64 &&
    field.inserted
  ) {
    return renderSignatureImageTMR(field.signature.signatureImageAsBase64);
  }

  if (field.type === FieldTypeTMR.FREE_SIGNATURE && !field.inserted) {
    return renderEmptyTMR();
  }

  return renderGenericTextTMR(field);
}

// ---------------------------------------------------------------------------
// shape-0c181da94ce8: exhaustive switch factory. Each case returns a typed
// FieldMeta object for a distinct FieldType. All nine returns are structurally
// required by the discriminated union; there is no control-flow complexity,
// just one literal per variant.
// ---------------------------------------------------------------------------

declare const DEFAULT_EMAIL_OVERFLOW_MODE_TMR: 'truncate' | 'wrap';
declare const DEFAULT_DATE_OVERFLOW_MODE_TMR: 'truncate' | 'wrap';

type FieldMetaTMR =
  | { type: 'initials'; fontSize: number; textAlign: 'left' | 'center' | 'right' }
  | { type: 'name'; fontSize: number; textAlign: 'left' | 'center' | 'right' }
  | {
      type: 'email';
      fontSize: number;
      textAlign: 'left' | 'center' | 'right';
      overflow: 'truncate' | 'wrap';
    }
  | {
      type: 'date';
      fontSize: number;
      textAlign: 'left' | 'center' | 'right';
      overflow: 'truncate' | 'wrap';
    }
  | {
      type: 'text';
      label: string;
      placeholder: string;
      text: string;
      characterLimit: number;
      fontSize: number;
      required: boolean;
      readOnly: boolean;
      textAlign: 'left' | 'center' | 'right';
    }
  | {
      type: 'number';
      label: string;
      placeholder: string;
      numberFormat: string;
      value: string;
      minValue: number;
      maxValue: number;
      required: boolean;
      readOnly: boolean;
      fontSize: number;
      textAlign: 'left' | 'center' | 'right';
    }
  | { type: 'radio'; values: ReadonlyArray<string>; required: boolean; readOnly: boolean; direction: 'vertical' | 'horizontal' }
  | {
      type: 'checkbox';
      values: ReadonlyArray<string>;
      validationRule: string;
      validationLength: number;
      required: boolean;
      readOnly: boolean;
      direction: 'vertical' | 'horizontal';
    }
  | { type: 'dropdown'; values: ReadonlyArray<string>; defaultValue: string; required: boolean; readOnly: boolean };

export function getDefaultFieldMetaTMR(fieldType: FieldTypeTMRValue): FieldMetaTMR {
  switch (fieldType) {
    case FieldTypeTMR.INITIALS:
      return {
        type: 'initials',
        fontSize: 14,
        textAlign: 'left',
      };
    case FieldTypeTMR.NAME:
      return {
        type: 'name',
        fontSize: 14,
        textAlign: 'left',
      };
    case FieldTypeTMR.EMAIL:
      return {
        type: 'email',
        fontSize: 14,
        textAlign: 'left',
        overflow: DEFAULT_EMAIL_OVERFLOW_MODE_TMR,
      };
    case FieldTypeTMR.DATE:
      return {
        type: 'date',
        fontSize: 14,
        textAlign: 'left',
        overflow: DEFAULT_DATE_OVERFLOW_MODE_TMR,
      };
    case FieldTypeTMR.TEXT:
      return {
        type: 'text',
        label: '',
        placeholder: '',
        text: '',
        characterLimit: 0,
        fontSize: 14,
        required: false,
        readOnly: false,
        textAlign: 'left',
      };
    case FieldTypeTMR.NUMBER:
      return {
        type: 'number',
        label: '',
        placeholder: '',
        numberFormat: '',
        value: '0',
        minValue: 0,
        maxValue: 0,
        required: false,
        readOnly: false,
        fontSize: 14,
        textAlign: 'left',
      };
    case FieldTypeTMR.RADIO:
      return {
        type: 'radio',
        values: [],
        required: false,
        readOnly: false,
        direction: 'vertical',
      };
    case FieldTypeTMR.CHECKBOX:
      return {
        type: 'checkbox',
        values: [],
        validationRule: '',
        validationLength: 0,
        required: false,
        readOnly: false,
        direction: 'vertical',
      };
    case FieldTypeTMR.DROPDOWN:
      return {
        type: 'dropdown',
        values: [],
        defaultValue: '',
        required: false,
        readOnly: false,
      };
    default:
      throw new Error(`Unsupported field type: ${String(fieldType)}`);
  }
}
