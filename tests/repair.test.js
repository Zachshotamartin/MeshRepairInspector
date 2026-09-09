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
