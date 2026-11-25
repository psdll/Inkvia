import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schema = readFileSync(path.join(root, "prisma", "schema.prisma"), "utf8");
const migration = readFileSync(
  path.join(root, "prisma", "migrations", "20260720190000_canvas_mutation_projection_foundation", "migration.sql"),
  "utf8",
);

describe("canvas production persistence schema", () => {
  it("adds an additive 64-bit revision path and projection checkpoints to Canvas", () => {
    const canvas = schema.match(/model Canvas \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(canvas).toContain("revision64");
    expect(canvas).toMatch(/revision64\s+BigInt\s+@default\(1\)/);
    expect(canvas).toMatch(/projectionRevision\s+BigInt\s+@default\(0\)/);
    expect(canvas).toMatch(/snapshotRevision\s+BigInt\s+@default\(0\)/);
    expect(canvas).toMatch(/nodeCount\s+Int\s+@default\(0\)/);
    expect(canvas).toMatch(/edgeCount\s+Int\s+@default\(0\)/);
    expect(canvas).toContain("currentSnapshotId");
  });

  it("defines immutable mutation and snapshot history with required uniqueness", () => {
    const mutation = schema.match(/model CanvasMutation \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(mutation).toMatch(/baseRevision\s+BigInt/);
    expect(mutation).toMatch(/revision\s+BigInt/);
    expect(mutation).toContain("payloadHash");
    expect(mutation).toContain("operations");
    expect(mutation).toContain("touchedPaths");
    expect(mutation).toContain("@@unique([canvasId, revision])");
    expect(mutation).toContain("@@unique([canvasId, clientMutationId])");

    const snapshot = schema.match(/model CanvasSnapshot \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(snapshot).toContain("compressedJson");
    expect(snapshot).toContain("checksumSha256");
    expect(snapshot).toContain("@@unique([canvasId, revision])");
  });

  it("defines independently queryable node and edge projections", () => {
    const nodes = schema.match(/model CanvasNodeState \{[\s\S]*?\n\}/)?.[0] ?? "";
    const edges = schema.match(/model CanvasEdgeState \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(nodes).toContain("@@id([canvasId, nodeId])");
    expect(nodes).toContain("searchText");
    expect(nodes).toContain("nodeVersion");
    expect(edges).toContain("@@id([canvasId, edgeId])");
    expect(edges).toContain("sourceId");
    expect(edges).toContain("targetId");
    expect(edges).toContain("bboxMinX");
    expect(edges).toContain("edgeVersion");
  });

  it("introduces owner/editor/viewer membership without replacing existing ownership", () => {
    const members = schema.match(/model CanvasMember \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(members).toContain("@@id([canvasId, userId])");
    expect(members).toContain("role");
    expect(members).toContain("@@index([userId, role])");
  });

  it("uses an additive migration and creates transaction hot-path indexes", () => {
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);
    expect(migration).not.toMatch(/ALTER\s+COLUMN[\s\S]*?TYPE/i);
    expect(migration).toContain('CREATE TABLE "CanvasMutation"');
    expect(migration).toContain('CREATE TABLE "CanvasSnapshot"');
    expect(migration).toContain('CREATE TABLE "CanvasNodeState"');
    expect(migration).toContain('CREATE TABLE "CanvasEdgeState"');
    expect(migration).toContain('CREATE UNIQUE INDEX "CanvasMutation_canvasId_revision_key"');
    expect(migration).toContain('CREATE INDEX "CanvasMutation_canvasId_revision_idx"');
    expect(migration).toContain('CREATE INDEX "CanvasEdgeState_canvasId_sourceId_idx"');
    expect(migration).toContain('CREATE INDEX "CanvasEdgeState_canvasId_targetId_idx"');
  });
});
