import test from "node:test";
import assert from "node:assert/strict";
import {
  makePreset,
  diagnose,
  weld,
  cleanFaces,
  orientFaces,
  fillHoles,
  largestComponent,
  parseOBJ,
  toOBJ,
  signedVolume,
  boundaryLoops,
} from "../src/repair.js";
test("OBJ parser supports negative references and rejects malformed or unbounded input", () => {
  const m = parseOBJ("v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3/1 -2/2 -1/3");
  assert.deepEqual(m.faces, [[0, 1, 2]]);
  assert.throws(() => parseOBJ("v 0 0 0\nf 1 2 3"), /range/);
  assert.throws(() => parseOBJ("v NaN 0 0"), /vertex/);
  assert.throws(() => parseOBJ("x".repeat(2_000_001)), /2 MB/);
});
test("vertex welding stitches a genuinely disconnected cube into a closed mesh", () => {
  const m = makePreset("Unwelded cube"),
    a = diagnose(m),
    fixed = weld(m),
    b = diagnose(fixed);
  assert.equal(a.duplicateVertices, 16);
  assert.equal(a.boundaryEdges, 24);
  assert.equal(a.components, 6);
  assert.equal(b.vertices, 8);
  assert.equal(b.boundaryEdges, 0);
  assert.equal(b.components, 1);
  assert.equal(m.vertices.length, 24);
});
test("repair pipeline removes defects and caps the missing planar roof", () => {
  let m = makePreset();
  assert.ok(diagnose(m).degenerateFaces > 0);
  m = largestComponent(cleanFaces(weld(m)));
  m = orientFaces(m);
  assert.equal(boundaryLoops(m).loops.length, 1);
  const result = fillHoles(m);
  assert.equal(result.filled, 1);
  m = orientFaces(result.mesh);
  const r = diagnose(m);
  assert.equal(r.boundaryEdges, 0);
  assert.equal(r.nonmanifoldEdges, 0);
  assert.equal(r.orientationConflicts, 0);
  assert.equal(r.degenerateFaces, 0);
  assert.equal(r.duplicateVertices, 0);
  assert.ok(Math.abs(signedVolume(m) - 8) < 1e-8);
  assert.deepEqual(parseOBJ(toOBJ(m)).faces, m.faces);
});
test("orientation repair changes winding and preserves positions", () => {
  const m = makePreset("Clean cube");
  m.faces[2].reverse();
  assert.equal(diagnose(m).orientationConflicts, 4);
  const r = orientFaces(m);
  assert.equal(diagnose(r).orientationConflicts, 0);
  assert.deepEqual(r.vertices, m.vertices);
  assert.ok(signedVolume(r) > 0);
});
test("nonmanifold fin is reported and not falsely declared repaired", () => {
  const m = makePreset("Nonmanifold fin");
  assert.equal(diagnose(m).nonmanifoldEdges, 1);
  assert.ok(diagnose(orientFaces(cleanFaces(weld(m)))).nonmanifoldEdges > 0);
});
test("nonplanar holes are deliberately not filled", () => {
  const m = makePreset("Clean cube");
  m.faces.pop();
  m.vertices[6][1] = 1.4;
  const r = fillHoles(m);
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});
test("a loose flat island is not capped into a coincident duplicate face", () => {
  const m = orientFaces(cleanFaces(weld(makePreset()))),
    result = fillHoles(m);
  assert.equal(result.filled, 1);
  assert.equal(result.skipped, 1);
  assert.equal(diagnose(result.mesh).duplicateFaces, 0);
  assert.equal(diagnose(result.mesh).boundaryEdges, 3);
});

test("targeted loose-fin removal restores the cube without removing a closed shell", async () => {
  const { removeLooseFins } = await import("../src/repair.js");
  const original = makePreset("Nonmanifold fin"),
    copy = JSON.stringify(original),
    fixed = removeLooseFins(original);
  assert.equal(fixed.removed, 1);
  assert.equal(diagnose(fixed.mesh).nonmanifoldEdges, 0);
  assert.equal(diagnose(fixed.mesh).boundaryEdges, 0);
  assert.ok(Math.abs(signedVolume(fixed.mesh) - 8) < 1e-8);
  assert.equal(JSON.stringify(original), copy);
  assert.equal(removeLooseFins(makePreset("Clean cube")).removed, 0);
});
test("each guided example has a measurable problem and its suggested operations resolve it", async () => {
  const { EXAMPLES } = await import("../src/examples.js"),
    { removeLooseFins } = await import("../src/repair.js");
  for (const [name, example] of Object.entries(EXAMPLES)) {
    let mesh = makePreset(name);
    const before = diagnose(mesh);
    for (const op of ["weld", "clean", "fins", "largest", "orient", "holes"])
      if (example.operations.includes(op)) {
        if (op === "weld") mesh = weld(mesh);
        if (op === "clean") mesh = cleanFaces(mesh);
        if (op === "fins") mesh = removeLooseFins(mesh).mesh;
        if (op === "largest") mesh = largestComponent(mesh);
        if (op === "orient") mesh = orientFaces(mesh);
        if (op === "holes") mesh = orientFaces(fillHoles(mesh).mesh);
      }
    const after = diagnose(mesh);
    for (const key of [
      "boundaryEdges",
      "nonmanifoldEdges",
      "orientationConflicts",
      "duplicateVertices",
      "duplicateFaces",
      "degenerateFaces",
      "unusedVertices",
    ])
      assert.equal(after[key], 0, `${name}: ${key}`);
    assert.equal(after.components, 1, name);
    if (name !== "Clean cube") assert.notDeepEqual(after, before, name);
    assert.ok(
      example.problem.length > 50 &&
        example.look.length > 50 &&
        example.repair.length > 30,
    );
  }
});
test("inspection highlights identify the actual reversed and duplicate panels", async () => {
  const { diagnosticRegions } = await import("../src/repairView.js");
  assert.deepEqual(
    [...diagnosticRegions(makePreset("Reversed panel")).reversed],
    [1],
  );
  const duplicates = diagnosticRegions(
    makePreset("Duplicate panels"),
  ).duplicates;
  assert.equal(duplicates.size, 4);
  assert.ok(duplicates.has(1) && duplicates.has(5));
  assert.equal(
    diagnosticRegions(makePreset("Collapsed face")).degenerate.size,
    1,
  );
});

test("fin repair leaves competing closed regions at a shared edge intact", async () => {
  const { removeLooseFins } = await import("../src/repair.js");
  const shared = {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0, -1, 0],
      [0, 0, -1],
    ],
    faces: [
      [0, 2, 1],
      [0, 1, 3],
      [0, 3, 2],
      [1, 2, 3],
      [0, 4, 1],
      [0, 1, 5],
      [0, 5, 4],
      [1, 4, 5],
    ],
  };
  assert.equal(diagnose(shared).nonmanifoldEdges, 1);
  const result = removeLooseFins(shared);
  assert.equal(result.removed, 0);
  assert.deepEqual(result.mesh, shared);
});
