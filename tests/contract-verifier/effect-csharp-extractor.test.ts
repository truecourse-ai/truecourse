import { describe, it, expect, beforeAll } from 'vitest';
import { initParsers, parseFile } from '../../packages/analyzer/src/index.js';
import { matchCsEffects } from '../../packages/contract-verifier/src/extractor/effect/cs-effects.js';
import { extractEffectsFromDir } from '../../packages/contract-verifier/src/extractor/effect/index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

beforeAll(async () => {
  await initParsers();
});

function effects(source: string) {
  const tree = parseFile('/x.cs', source, 'csharp');
  const res = matchCsEffects({ filePath: '/x.cs', source, tree, lang: 'csharp' });
  tree.delete();
  return res;
}

// C# event buses come in two idioms — string-named (`bus.Emit("x")`) and typed
// messages (`_mediator.Publish(new OrderPlaced())`). Both are real effect
// emissions; the typed form names the event by its message TYPE.
describe('Effect code extractor — C#', () => {
  it('extracts a string-named bus emit', () => {
    const e = effects(`public class S { public void M() { _eventBus.Emit("order.confirmed"); } }`);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ event: 'order.confirmed', channel: '_eventBus' });
  });

  it('extracts a MediatR typed Publish (event = message type name), unwrapping await', () => {
    const e = effects(`public class S { public async Task M(Order o) { await _mediator.Publish(new OrderPlaced(o.Id)); } }`);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ event: 'OrderPlaced', channel: '_mediator' });
  });

  it('takes the last segment of a namespaced typed event', () => {
    const e = effects(`public class S { public void M() { _bus.Publish(new Events.OrderShipped()); } }`);
    expect(e[0]).toMatchObject({ event: 'OrderShipped', channel: '_bus' });
  });

  it('skips a dynamic emit (neither string nor `new T()`)', () => {
    const e = effects(`public class S { public void M(object evt) { _bus.Publish(evt); } }`);
    expect(e).toHaveLength(0);
  });

  it('ignores `Send` (MediatR command semantics, not an event)', () => {
    const e = effects(`public class S { public void M() { _mediator.Send(new GetOrder()); } }`);
    expect(e).toHaveLength(0);
  });

  it('extracts C# effects via the directory dispatcher', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cseff-'));
    fs.writeFileSync(path.join(dir, 'svc.cs'), `public class S { public void M() { _bus.Publish(new OrderCancelled()); _bus.Emit("order.paid"); } }`);
    const e = await extractEffectsFromDir(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(e.map((x) => x.event).sort()).toEqual(['OrderCancelled', 'order.paid']);
  });
});
