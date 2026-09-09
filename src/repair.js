const sub = (a, b) => a.map((v, i) => v - b[i]),
  cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  length = (a) => Math.hypot(...a);
export const clone = (m) => ({
  vertices: m.vertices.map((v) => v.slice()),
  faces: m.faces.map((f) => f.slice()),
});
export const edgeKey = (a, b) => (a < b ? `${a}/${b}` : `${b}/${a}`);
export function edgesOf(mesh) {
  const edges = new Map();
  mesh.faces.forEach((f, face) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i],
        b = f[(i + 1) % f.length],
        key = edgeKey(a, b);
      if (!edges.has(key))
        edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), uses: [] });
      edges.get(key).uses.push({ a, b, face });
    }
  });
  return edges;
}
export function parseOBJ(text) {
  if (typeof text !== "string" || text.length > 2_000_000)
    throw Error("Use an OBJ file smaller than 2 MB.");
  const vertices = [],
    faces = [];
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    const parts = line.split("#")[0].trim().split(/\s+/);
    if (parts[0] === "v") {
      const v = parts.slice(1, 4).map(Number);
      if (
        v.length !== 3 ||
        v.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e6)
      )
        throw Error(`Invalid vertex on line ${lineIndex + 1}.`);
      vertices.push(v);
      if (vertices.length > 20000)
        throw Error("Use a mesh with at most 20,000 vertices.");
    } else if (parts[0] === "f") {
      const refs = parts.slice(1).filter((s) => !s.startsWith("#"));
      if (refs.length < 3 || refs.length > 64)
        throw Error(`Face on line ${lineIndex + 1} must have 3–64 corners.`);
      const face = refs.map((s) => {
        const token = s.split("/")[0];
        if (!/^-?\d+$/.test(token))
          throw Error(`Invalid face index on line ${lineIndex + 1}.`);
        const i = Number(token),
          v = i > 0 ? i - 1 : vertices.length + i;
        if (i === 0 || v < 0 || v >= vertices.length)
          throw Error(`Face index out of range on line ${lineIndex + 1}.`);
        return v;
      });
      faces.push(face);
      if (faces.length > 30000)
        throw Error("Use a mesh with at most 30,000 faces.");
    }
  }
  if (vertices.length < 3 || !faces.length)
    throw Error("The OBJ needs vertices and polygon faces.");
  return { vertices, faces };
}
function newell(mesh, f) {
  const n = [0, 0, 0];
  for (let i = 0; i < f.length; i++) {
    const a = mesh.vertices[f[i]],
      b = mesh.vertices[f[(i + 1) % f.length]];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}
const faceKey = (f) => {
  const rotations = [];
  for (const loop of [f, f.slice().reverse()])
    for (let i = 0; i < loop.length; i++)
      rotations.push([...loop.slice(i), ...loop.slice(0, i)].join("/"));
  return rotations.sort()[0];
};
export function weld(mesh, tolerance = 1e-5) {
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 0.2)
    throw Error(
      "Weld tolerance must be above zero and at most 0.2 model units.",
    );
  const vertices = [],
    map = [],
    bins = new Map();
  mesh.vertices.forEach((v) => {
    const cell = v.map((x) => Math.floor(x / tolerance));
    let chosen = -1;
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          const candidates =
            bins.get([cell[0] + x, cell[1] + y, cell[2] + z].join("/")) || [];
          for (const i of candidates)
            if (length(sub(vertices[i], v)) <= tolerance) {
              if (chosen < 0 || i < chosen) chosen = i;
            }
        }
    if (chosen < 0) {
      chosen = vertices.length;
      vertices.push(v.slice());
      const key = cell.join("/");
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push(chosen);
    }
    map.push(chosen);
  });
  return { vertices, faces: mesh.faces.map((f) => f.map((i) => map[i])) };
}
export function cleanFaces(mesh) {
  const seen = new Set(),
    faces = [];
  for (const face of mesh.faces) {
    const f = face.filter(
      (v, i) => v !== face[(i + face.length - 1) % face.length],
    );
    if (
      new Set(f).size !== f.length ||
      f.length < 3 ||
      length(newell(mesh, f)) < 1e-10
    )
      continue;
    const key = faceKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push(f);
  }
  return compact({ vertices: mesh.vertices, faces });
}
function compact(mesh) {
  const used = [...new Set(mesh.faces.flat())].sort((a, b) => a - b),
    map = new Map(used.map((v, i) => [v, i]));
  return {
    vertices: used.map((i) => mesh.vertices[i].slice()),
    faces: mesh.faces.map((f) => f.map((v) => map.get(v))),
  };
}
export function connectedComponents(mesh) {
  const adjacency = mesh.faces.map(() => []);
  for (const e of edgesOf(mesh).values()) {
    const first = e.uses[0].face;
    for (const use of e.uses.slice(1))
      if (use.face !== first) {
        adjacency[first].push(use.face);
        adjacency[use.face].push(first);
      }
  }
  const seen = new Set(),
    components = [];
  for (let f = 0; f < mesh.faces.length; f++) {
    if (seen.has(f)) continue;
    const queue = [f];
    seen.add(f);
    for (let i = 0; i < queue.length; i++)
      for (const n of adjacency[queue[i]])
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
    components.push(queue);
  }
  return components;
}
export function signedVolume(mesh, faceIds = mesh.faces.map((_, i) => i)) {
  let sum = 0;
  for (const fi of faceIds) {
    const f = mesh.faces[fi],
      a = mesh.vertices[f[0]];
    for (let i = 1; i < f.length - 1; i++)
      sum += dot(a, cross(mesh.vertices[f[i]], mesh.vertices[f[i + 1]])) / 6;
  }
  return sum;
}
export function orientFaces(mesh) {
  const out = clone(mesh),
    edges = edgesOf(mesh),
    adjacency = mesh.faces.map(() => []);
  for (const e of edges.values())
    if (e.uses.length === 2) {
      const [a, b] = e.uses,
        same = a.a === b.a;
      adjacency[a.face].push([b.face, same]);
      adjacency[b.face].push([a.face, same]);
    }
  const parity = new Int8Array(mesh.faces.length).fill(-1);
  for (let f = 0; f < mesh.faces.length; f++) {
    if (parity[f] >= 0) continue;
    parity[f] = 0;
    const queue = [f];
    for (let i = 0; i < queue.length; i++)
      for (const [n, same] of adjacency[queue[i]]) {
        const p = parity[queue[i]] ^ (same ? 1 : 0);
        if (parity[n] < 0) {
          parity[n] = p;
          queue.push(n);
        }
      }
  }
  out.faces = out.faces.map((f, i) => (parity[i] ? f.slice().reverse() : f));
  const edge2 = edgesOf(out);
  for (const component of connectedComponents(out)) {
    const set = new Set(component),
      closed = [...edge2.values()]
        .filter((e) => e.uses.some((u) => set.has(u.face)))
        .every((e) => e.uses.length === 2);
    if (closed && signedVolume(out, component) < 0)
      for (const fi of component) out.faces[fi].reverse();
  }
  return out;
}
export function boundaryLoops(mesh) {
  const edgeMap = edgesOf(mesh),
    boundary = [...edgeMap.values()].filter((e) => e.uses.length === 1),
    neighbors = new Map();
  for (const e of boundary)
    for (const [a, b] of [
      [e.a, e.b],
      [e.b, e.a],
    ]) {
      if (!neighbors.has(a)) neighbors.set(a, []);
      neighbors.get(a).push(b);
    }
  const seen = new Set(),
    loops = [];
  let ambiguous = 0;
  for (const first of boundary) {
    const key = edgeKey(first.a, first.b);
    if (seen.has(key)) continue;
    let previous = first.a,
      current = first.b;
    const loop = [previous],
      visited = [key];
    seen.add(key);
    let valid = true;
    for (let guard = 0; guard <= boundary.length; guard++) {
      loop.push(current);
      const around = neighbors.get(current) || [];
      if (around.length !== 2) {
        valid = false;
        break;
      }
      const next = around.find((n) => n !== previous);
      if (next === loop[0]) {
        seen.add(edgeKey(current, next));
        break;
      }
      const k = edgeKey(current, next);
      if (seen.has(k)) {
        valid = false;
        break;
      }
      seen.add(k);
      visited.push(k);
      previous = current;
      current = next;
      if (guard === boundary.length) valid = false;
    }
    if (valid) {
      const use = edgeMap.get(edgeKey(loop[0], loop[1])).uses[0];
      if (use.a !== loop[0]) loop.reverse();
      loops.push(loop);
    } else ambiguous++;
  }
  return { loops, ambiguous };
}
export function diagnose(mesh, tolerance = 1e-5) {
  const edges = edgesOf(mesh),
    seen = new Set();
  let duplicateFaces = 0,
    degenerateFaces = 0;
  for (const f of mesh.faces) {
    const key = faceKey(f);
    if (seen.has(key)) duplicateFaces++;
    seen.add(key);
    if (new Set(f).size !== f.length || length(newell(mesh, f)) < 1e-10)
      degenerateFaces++;
  }
  const boundary = [...edges.values()].filter((e) => e.uses.length === 1),
    nonmanifold = [...edges.values()].filter((e) => e.uses.length > 2),
    orientationConflicts = [...edges.values()].filter(
      (e) => e.uses.length === 2 && e.uses[0].a === e.uses[1].a,
    ),
    loops = boundaryLoops(mesh);
  return {
    vertices: mesh.vertices.length,
    faces: mesh.faces.length,
    edges: edges.size,
    boundaryEdges: boundary.length,
    nonmanifoldEdges: nonmanifold.length,
    orientationConflicts: orientationConflicts.length,
    duplicateVertices:
      mesh.vertices.length - weld(mesh, tolerance).vertices.length,
    duplicateFaces,
    degenerateFaces,
    components: connectedComponents(mesh).length,
    unusedVertices: mesh.vertices.length - new Set(mesh.faces.flat()).size,
    holes: loops.loops.length,
    ambiguousBoundaries: loops.ambiguous,
    volume: signedVolume(mesh),
  };
}
function capLoop(mesh, loop, maxEdges, planarity) {
  if (loop.length < 3 || loop.length > maxEdges) return null;
  const f = loop.slice().reverse(),
    normal = newell(mesh, f),
    n = length(normal);
  if (n < 1e-12) return null;
  const unit = normal.map((x) => x / n),
    p0 = mesh.vertices[f[0]],
    extent = Math.max(...f.map((v) => length(sub(mesh.vertices[v], p0))));
  if (
    f.some(
      (v) =>
        Math.abs(dot(sub(mesh.vertices[v], p0), unit)) >
        Math.max(1e-7, extent * planarity),
    )
  )
    return null;
  const axis = unit.map(Math.abs).indexOf(Math.max(...unit.map(Math.abs))),
    uv = f.map((v) => mesh.vertices[v].filter((_, i) => i !== axis)),
    area = uv.reduce((s, p, i) => {
      const q = uv[(i + 1) % uv.length];
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0),
    sign = Math.sign(area),
    cross2 = (a, b, c) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    inTriangle = (p, a, b, c) =>
      [cross2(a, b, p), cross2(b, c, p), cross2(c, a, p)].every(
        (s) => s * sign >= -1e-10,
      ),
    remaining = f.map((_, i) => i),
    triangles = [];
  while (remaining.length > 3) {
    let found = false;
    for (let j = 0; j < remaining.length; j++) {
      const a = remaining[(j + remaining.length - 1) % remaining.length],
        b = remaining[j],
        c = remaining[(j + 1) % remaining.length];
      if (cross2(uv[a], uv[b], uv[c]) * sign <= 1e-10) continue;
      if (
        remaining.some(
          (p) =>
            p !== a &&
            p !== b &&
            p !== c &&
            inTriangle(uv[p], uv[a], uv[b], uv[c]),
        )
      )
        continue;
      triangles.push([f[a], f[b], f[c]]);
      remaining.splice(j, 1);
      found = true;
      break;
    }
    if (!found) return null;
  }
  triangles.push(remaining.map((i) => f[i]));
  return triangles;
}
export function fillHoles(mesh, { maxEdges = 32, planarity = 0.005 } = {}) {
  const out = clone(mesh),
    { loops } = boundaryLoops(mesh),
    edges = edgesOf(mesh),
    components = connectedComponents(mesh),
    componentOf = new Map();
  components.forEach((c, i) => c.forEach((f) => componentOf.set(f, i)));
  let filled = 0,
    skipped = 0;
  for (const loop of loops) {
    const cap = capLoop(mesh, loop, maxEdges, planarity);
    if (cap) {
      const adjacent = edges.get(edgeKey(loop[0], loop[1])).uses[0].face,
        normal = newell(mesh, loop),
        l = length(normal),
        p0 = mesh.vertices[loop[0]],
        ids = new Set(
          components[componentOf.get(adjacent)].flatMap((fi) => mesh.faces[fi]),
        ),
        flat =
          l > 1e-12 &&
          [...ids].every(
            (v) => Math.abs(dot(sub(mesh.vertices[v], p0), normal)) / l < 1e-7,
          );
      if (
        flat &&
        dot(newell(mesh, cap[0]), newell(mesh, mesh.faces[adjacent])) < 0
      ) {
        skipped++;
        continue;
      }
      out.faces.push(...cap);
      filled++;
    } else skipped++;
  }
  return { mesh: out, filled, skipped };
}
export function largestComponent(mesh) {
  const components = connectedComponents(mesh).sort(
    (a, b) => b.length - a.length,
  );
  return compact({
    vertices: mesh.vertices,
    faces: (components[0] || []).map((i) => mesh.faces[i]),
  });
}
export function makePreset(name = "Open housing") {
  const vertices = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
    faces = [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 4, 7, 3],
      [1, 2, 6, 5],
      [0, 1, 5, 4],
      [3, 7, 6, 2],
    ];
  if (name === "Unwelded cube") {
    const m = { vertices: [], faces: [] };
    for (const f of faces) {
      const local = f.map((v) => {
        m.vertices.push(vertices[v].slice());
        return m.vertices.length - 1;
      });
      m.faces.push(local);
    }
    return m;
  }
  if (name === "Nonmanifold fin") {
    vertices.push([2.3, 0, -1]);
    faces.push([1, 2, 8]);
    return { vertices, faces };
  }
  if (name === "Clean cube") return { vertices, faces };
  faces.pop();
  faces[1].reverse();
  vertices.push(vertices[0].slice());
  faces[0][0] = 8;
  vertices.push([-1.6, -0.8, 0.9], [-1.7, -0.3, 0.9], [-1.5, -0.6, 1.4]);
  faces.push([9, 10, 11], [0, 0, 1]);
  return { vertices, faces };
}
export function toOBJ(mesh) {
  return (
    [
      "# Mesh Repair Inspector",
      ...mesh.vertices.map((v) => `v ${v.join(" ")}`),
      ...mesh.faces.map((f) => `f ${f.map((v) => v + 1).join(" ")}`),
    ].join("\n") + "\n"
  );
}
