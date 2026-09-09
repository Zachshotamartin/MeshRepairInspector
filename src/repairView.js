import {
  edgesOf,
  connectedComponents,
  orientFaces,
  newell,
  faceKey,
} from "./repair.js";

export function diagnosticRegions(mesh) {
  const components = connectedComponents(mesh).sort(
      (a, b) => b.length - a.length,
    ),
    minor = new Set(components.slice(1).flat()),
    duplicates = new Set(),
    degenerate = new Set(),
    reversed = new Set(),
    byKey = new Map();
  const oriented = orientFaces(mesh);
  mesh.faces.forEach((face, id) => {
    const key = faceKey(face);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(id);
    const n = newell(mesh, face),
      other = newell(oriented, oriented.faces[id]);
    if (new Set(face).size !== face.length || Math.hypot(...n) < 1e-10)
      degenerate.add(id);
    if (n.reduce((sum, v, i) => sum + v * other[i], 0) < -1e-9)
      reversed.add(id);
  });
  for (const ids of byKey.values())
    if (ids.length > 1) ids.forEach((id) => duplicates.add(id));
  return {
    components,
    minor,
    duplicates,
    degenerate,
    reversed,
    edges: edgesOf(mesh),
  };
}

export function createRepairView(
  T,
  mesh,
  { overlay = "Problem areas", showEdges = true } = {},
) {
  const group = new T.Group(),
    regions = diagnosticRegions(mesh),
    center = new T.Vector3();
  for (const p of mesh.vertices) center.add(new T.Vector3(...p));
  center.multiplyScalar(1 / Math.max(1, mesh.vertices.length));
  const box = new T.Box3().setFromPoints(
      mesh.vertices.map((p) => new T.Vector3(...p)),
    ),
    size = Math.max(0.01, box.getSize(new T.Vector3()).length()),
    radius = size * 0.006;
  const shifts = mesh.faces.map(() => new T.Vector3()),
    exploded = overlay === "Separate disconnected parts";
  if (exploded && regions.components.length > 1)
    for (const ids of regions.components) {
      const vertices = [...new Set(ids.flatMap((id) => mesh.faces[id]))],
        position = new T.Vector3();
      for (const id of vertices)
        position.add(new T.Vector3(...mesh.vertices[id]));
      position.multiplyScalar(1 / vertices.length).sub(center);
      if (position.lengthSq() < 1e-10) position.set(0, 1, 0);
      position.normalize().multiplyScalar(size * 0.1);
      for (const id of ids) shifts[id] = position;
    }
  const surfacePositions = [],
    surfaceColors = [],
    linePositions = [],
    lineColors = [],
    highlights = [],
    points = [],
    arrows = [];
  function vertex(id, face) {
    return new T.Vector3(...mesh.vertices[id]).add(shifts[face]);
  }
  const palette = {
    plain: new T.Color(0xb9c8a1),
    fault: new T.Color(0xee947b),
    edge: new T.Color(0x466753),
    boundary: new T.Color(0xffb174),
    nonmanifold: new T.Color(0xf49bd1),
    winding: new T.Color(0xf4d384),
  };
  mesh.faces.forEach((face, id) => {
    const fault =
      overlay !== "Plain surface" &&
      (regions.duplicates.has(id) ||
        regions.reversed.has(id) ||
        (!exploded && regions.minor.has(id)));
    const color = fault ? palette.fault : palette.plain;
    for (let j = 1; j < face.length - 1; j++)
      for (const v of [face[0], face[j], face[j + 1]]) {
        surfacePositions.push(...vertex(v, id).toArray());
        surfaceColors.push(color.r, color.g, color.b);
      }
    const midpoint = new T.Vector3();
    for (const v of face) midpoint.add(vertex(v, id));
    midpoint.multiplyScalar(1 / face.length);
    if (regions.degenerate.has(id) && overlay !== "Plain surface") {
      points.push({ p: midpoint, color: palette.fault });
      for (let i = 0; i < face.length; i++) {
        const a = vertex(face[i], id),
          b = vertex(face[(i + 1) % face.length], id);
        if (a.distanceToSquared(b) > 1e-12)
          highlights.push({ a, b, color: palette.fault });
      }
    }
    if (overlay === "Face directions" && arrows.length < 160) {
      const n = new T.Vector3(...newell(mesh, face));
      if (n.lengthSq() > 1e-12)
        arrows.push({
          p: midpoint,
          n: n.normalize(),
          color: regions.reversed.has(id) ? palette.fault : palette.winding,
        });
    }
  });
  const geometry = new T.BufferGeometry();
  geometry.setAttribute(
    "position",
    new T.Float32BufferAttribute(surfacePositions, 3),
  );
  geometry.setAttribute(
    "color",
    new T.Float32BufferAttribute(surfaceColors, 3),
  );
  geometry.computeVertexNormals();
  group.add(
    new T.Mesh(
      geometry,
      new T.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.5,
        metalness: 0.04,
        side: T.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    ),
  );
  if (showEdges)
    for (const e of regions.edges.values()) {
      const conflict = e.uses.length === 2 && e.uses[0].a === e.uses[1].a;
      const color =
        overlay === "Plain surface"
          ? palette.edge
          : e.uses.length > 2
            ? palette.nonmanifold
            : e.uses.length === 1
              ? palette.boundary
              : conflict
                ? palette.winding
                : palette.edge;
      for (const use of exploded ? e.uses : [e.uses[0]]) {
        const a = vertex(e.a, use.face),
          b = vertex(e.b, use.face);
        linePositions.push(...a.toArray(), ...b.toArray());
        lineColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        if (
          overlay !== "Plain surface" &&
          (e.uses.length !== 2 || conflict) &&
          a.distanceToSquared(b) > 1e-12 &&
          highlights.length < 1600
        )
          highlights.push({ a, b, color });
      }
    }
  if (exploded) {
    const seen = new Set();
    mesh.faces.forEach((face, id) => {
      for (const v of face) {
        const p = vertex(v, id),
          key = p
            .toArray()
            .map((n) => n.toFixed(6))
            .join("/");
        if (!seen.has(key) && points.length < 1600) {
          seen.add(key);
          points.push({ p, color: palette.winding });
        }
      }
    });
  }
  const edgeGeometry = new T.BufferGeometry();
  edgeGeometry.setAttribute(
    "position",
    new T.Float32BufferAttribute(linePositions, 3),
  );
  edgeGeometry.setAttribute(
    "color",
    new T.Float32BufferAttribute(lineColors, 3),
  );
  group.add(
    new T.LineSegments(
      edgeGeometry,
      new T.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
      }),
    ),
  );
  function segments(items, geometry) {
    if (!items.length) {
      geometry.dispose();
      return;
    }
    const instance = new T.InstancedMesh(
        geometry,
        new T.MeshBasicMaterial({
          depthTest: false,
          transparent: true,
          opacity: 0.94,
        }),
        items.length,
      ),
      matrix = new T.Matrix4(),
      rotation = new T.Quaternion(),
      scale = new T.Vector3(),
      up = new T.Vector3(0, 1, 0);
    items.forEach(({ a, b, color, width = radius }, i) => {
      const vector = b.clone().sub(a),
        length = vector.length();
      rotation.setFromUnitVectors(up, vector.normalize());
      scale.set(width, length, width);
      matrix.compose(a.clone().add(b).multiplyScalar(0.5), rotation, scale);
      instance.setMatrixAt(i, matrix);
      instance.setColorAt(i, color);
    });
    instance.renderOrder = 5;
    instance.instanceMatrix.needsUpdate = true;
    group.add(instance);
  }
  segments(highlights, new T.CylinderGeometry(1, 1, 1, 8));
  segments(
    arrows.map(({ p, n, color }) => ({
      a: p,
      b: p.clone().addScaledVector(n, size * 0.09),
      color,
      width: radius * 0.65,
    })),
    new T.CylinderGeometry(1, 1, 1, 8),
  );
  segments(
    arrows.map(({ p, n, color }) => ({
      a: p.clone().addScaledVector(n, size * 0.09),
      b: p.clone().addScaledVector(n, size * 0.12),
      color,
      width: radius * 2.6,
    })),
    new T.ConeGeometry(1, 1, 10),
  );
  if (points.length) {
    const instance = new T.InstancedMesh(
        new T.SphereGeometry(radius * 2, 10, 8),
        new T.MeshBasicMaterial({ depthTest: false }),
        points.length,
      ),
      m = new T.Matrix4();
    points.forEach(({ p, color }, i) => {
      m.makeTranslation(...p.toArray());
      instance.setMatrixAt(i, m);
      instance.setColorAt(i, color);
    });
    instance.renderOrder = 6;
    group.add(instance);
  }
  return {
    group,
    regions,
    dispose() {
      const materials = new Set(),
        geometries = new Set();
      group.traverse((o) => {
        if (o.geometry) geometries.add(o.geometry);
        if (o.material) materials.add(o.material);
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
