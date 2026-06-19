import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { initParsers, parseFile } from '../../packages/analyzer/src/index.js';
import { extractFieldExposuresFromFile } from '../../packages/contract-verifier/src/extractor/field-exposure/ts-fields.js';
import { extractPyFieldExposuresFromFile } from '../../packages/contract-verifier/src/extractor/field-exposure/py-fields.js';
import { extractCsFieldExposuresFromFile } from '../../packages/contract-verifier/src/extractor/field-exposure/cs-fields.js';
import { extractFieldExposuresFromDir } from '../../packages/contract-verifier/src/extractor/field-exposure/index.js';
import type { ExtractedFieldExposure } from '../../packages/contract-verifier/src/extractor/field-exposure/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, '../fixtures/field-exposure');

beforeAll(async () => {
  await initParsers();
});

function extract(source: string, filePath = '/test/x.ts'): ExtractedFieldExposure[] {
  const tree = parseFile(filePath, source, 'typescript');
  const recs = extractFieldExposuresFromFile(filePath, source, tree);
  tree.delete();
  return recs;
}

function byField(recs: ExtractedFieldExposure[], field: string): ExtractedFieldExposure | undefined {
  return recs.find((r) => r.contract.target.field === field);
}

describe('FieldExposure code extractor — JS/TS', () => {
  it('derives query-select + api-response exposures from the realistic order-read fixture', () => {
    const fp = path.join(FIXTURE_DIR, 'order-read-service.ts');
    const source = fs.readFileSync(fp, 'utf-8');
    const recs = extract(source, fp);

    // A `select: { internalNotes: false }` is a DESELECT — never exposed.
    expect(recs.some((r) => r.contract.target.field === 'internalNotes')).toBe(false);
    // The `error` key of the 404 body is a response field too — that's a real
    // exposure on a read path; we don't pretend it isn't. (It is not asserted
    // away — the point is the extractor only reports literal response keys.)

    // Selected scalar columns are query-select exposures.
    const totalCentsViaSelect = recs.find(
      (r) => r.contract.target.field === 'totalCents' && r.contract.exposedVia[0] === 'query-select',
    );
    expect(totalCentsViaSelect).toBeDefined();
    expect(totalCentsViaSelect!.contract).toEqual({
      target: { field: 'totalCents' },
      exposedVia: ['query-select'],
    });

    // The same field appears in the response object too — both channels seen.
    const totalCentsViaResponse = recs.find(
      (r) => r.contract.target.field === 'totalCents' && r.contract.exposedVia[0] === 'api-response',
    );
    expect(totalCentsViaResponse).toBeDefined();

    expect(totalCentsViaSelect!.identity).toBe('totalCents.exposure');
  });

  it('merges channels per field via the directory dispatcher (union of query-select + api-response)', async () => {
    const recs = await extractFieldExposuresFromDir(FIXTURE_DIR);
    const byId = new Map(recs.map((r) => [r.identity, r]));

    // id / totalCents / status are BOTH selected and returned → both channels.
    expect(byId.get('id.exposure')!.contract.exposedVia).toEqual(['query-select', 'api-response']);
    expect(byId.get('totalCents.exposure')!.contract.exposedVia).toEqual([
      'query-select',
      'api-response',
    ]);
    expect(byId.get('status.exposure')!.contract.exposedVia).toEqual([
      'query-select',
      'api-response',
    ]);

    // createdAt is selected but not in the response shape → query-select only.
    expect(byId.get('createdAt.exposure')!.contract.exposedVia).toEqual(['query-select']);

    // internalNotes is deselected → no record at all.
    expect(byId.has('internalNotes.exposure')).toBe(false);
  });

  it('reads a plain Prisma select projection', () => {
    const recs = extract(`
      const u = await prisma.user.findUnique({ select: { email: true, passwordHash: false } });
    `);
    expect(recs.map((r) => r.contract.target.field)).toEqual(['email']);
    expect(recs[0].contract.exposedVia).toEqual(['query-select']);
  });

  it('reads an api-response object passed to res.json', () => {
    const recs = extract(`res.json({ id: order.id, name: order.name });`);
    expect(recs.map((r) => r.contract.target.field).sort()).toEqual(['id', 'name']);
    expect(recs.every((r) => r.contract.exposedVia[0] === 'api-response')).toBe(true);
  });

  it('reads a reply.send response (framework-agnostic receiver / method)', () => {
    const recs = extract(`reply.send({ status: o.status });`);
    expect(byField(recs, 'status')!.contract.exposedVia).toEqual(['api-response']);
  });

  it('reads shorthand response keys', () => {
    const recs = extract(`function h(res, id, total) { res.json({ id, total }); }`);
    expect(recs.map((r) => r.contract.target.field).sort()).toEqual(['id', 'total']);
  });

  it('ignores a select with no true-valued fields', () => {
    const recs = extract(`prisma.order.findMany({ select: { secret: false } });`);
    expect(recs).toHaveLength(0);
  });

  it('does not treat a non-response method object as an exposure', () => {
    // `.where({ id })` is a filter, not a response serializer.
    const recs = extract(`prisma.order.findMany({ where: { id: 1 } });`);
    expect(recs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: the same projection / response shapes in Python syntax.
// ---------------------------------------------------------------------------

function extractPy(source: string, filePath = '/test/x.py'): ExtractedFieldExposure[] {
  const tree = parseFile(filePath, source, 'python');
  const recs = extractPyFieldExposuresFromFile(filePath, source, tree);
  tree.delete();
  return recs;
}

describe('FieldExposure code extractor — Python', () => {
  it('reads a Django .values() column projection as query-select', () => {
    const recs = extractPy(`def read():\n    return Order.objects.values("id", "status")`);
    expect(recs.map((r) => r.contract.target.field).sort()).toEqual(['id', 'status']);
    expect(recs.every((r) => r.contract.exposedVia[0] === 'query-select')).toBe(true);
  });

  it('reads a SQLAlchemy with_entities(Model.field) projection', () => {
    const recs = extractPy(
      `def read():\n    return session.query(Order).with_entities(Order.id, Order.total_cents).all()`,
    );
    expect(recs.map((r) => r.contract.target.field).sort()).toEqual(['id', 'total_cents']);
    expect(recs.every((r) => r.contract.exposedVia[0] === 'query-select')).toBe(true);
  });

  it('reads a jsonify({...}) response shape as api-response', () => {
    const recs = extractPy(
      `def read(row):\n    return jsonify({"id": row.id, "total_cents": row.total_cents})`,
    );
    expect(recs.map((r) => r.contract.target.field).sort()).toEqual(['id', 'total_cents']);
    expect(recs.every((r) => r.contract.exposedVia[0] === 'api-response')).toBe(true);
  });

  it('reads a bare `return {...}` dict response shape', () => {
    const recs = extractPy(`def read(order):\n    return {"status": order.status}`);
    expect(byField(recs, 'status')!.contract.exposedVia).toEqual(['api-response']);
  });

  it('ignores a dict that is not a response (an assigned local)', () => {
    // A dict that is neither returned nor passed to a response serializer is
    // not an exposure site.
    const recs = extractPy(`def read():\n    opts = {"retries": 3}\n    return opts.get("retries")`);
    expect(recs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// C#: the same exposure channels in C# syntax — EF Core `.Select(o => new {…})`
// projections and ASP.NET `Ok(new {…})` / `Json(new Dto {…})` response shapes.
// ---------------------------------------------------------------------------

function extractCs(source: string, filePath = "/test/x.cs"): ExtractedFieldExposure[] {
  const tree = parseFile(filePath, source, "csharp");
  const recs = extractCsFieldExposuresFromFile(filePath, source, tree);
  tree.delete();
  return recs;
}

describe("FieldExposure code extractor — C#", () => {
  it("derives query-select exposures from an EF Core projection", () => {
    const recs = extractCs(`public class R { public object Get() { return db.Orders.Select(o => new { o.Id, o.Status, Total = o.TotalCents }).ToList(); } }`);
    expect(recs.map((r) => r.contract.target.field).sort()).toEqual(["Id", "Status", "Total"]);
    expect(byField(recs, "Status")!.contract).toEqual({ target: { field: "Status" }, exposedVia: ["query-select"] });
  });

  it("derives api-response exposures from an anonymous Ok(new {…}) body", () => {
    const recs = extractCs(`public class C { public IActionResult Get(Order o) { return Ok(new { o.Id, o.Status }); } }`);
    expect(recs.map((r) => r.contract.target.field).sort()).toEqual(["Id", "Status"]);
    expect(byField(recs, "Id")!.contract.exposedVia).toEqual(["api-response"]);
  });

  it("derives api-response exposures from a named DTO initializer", () => {
    const recs = extractCs(`public class C { public IActionResult Get(Order o) { return Json(new OrderDto { Id = o.Id, Status = o.Status }); } }`);
    expect(recs.map((r) => r.contract.target.field).sort()).toEqual(["Id", "Status"]);
  });

  it("unions channels for a field selected AND returned (via the dispatcher)", async () => {
    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "csfe-"));
    fs.writeFileSync(path.join(dir, "svc.cs"), `public class C { public IActionResult Get() { var q = db.Orders.Select(o => new { o.Status }).First(); return Ok(new { q.Status }); } }`);
    const recs = await extractFieldExposuresFromDir(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(byField(recs, "Status")!.contract.exposedVia).toEqual(["query-select", "api-response"]);
  });

  it("ignores a bare `new {…}` not in a Select/response site", () => {
    const recs = extractCs(`public class C { public void M(Order o) { var internalView = new { o.Secret }; } }`);
    expect(recs).toHaveLength(0);
  });
});
