import {
  clone,
  parseOBJ,
  diagnose,
  edgesOf,
  weld,
  cleanFaces,
  orientFaces,
  fillHoles,
  largestComponent,
  makePreset,
  toOBJ,
} from "./repair.js";
export const metadata = {
  id: "mesh-repair-inspector",
  title: "Mesh Repair Inspector",
  description:
    "Inspect a damaged polygon mesh, locate its defects, and apply repairs you can verify before exporting.",
  technique:
    "Edge incidence, vertex welding, orientation propagation, and planar hole triangulation",
  instructions: [
    "Load a broken example or your own OBJ. Orange edges are open; pink edges are nonmanifold.",
    "Choose the operations you want, then apply repairs. The report compares real before and after counts.",
    "Switch between original and repaired, undo a repair, and export the actual resulting mesh.",
  ],
  limitations: [
    "OBJ uploads are limited to 2 MB, 20,000 vertices and 30,000 faces. Materials, UVs, and imported normals are not retained.",
    "Polygon rendering assumes convex faces. Triangulate concave polygons before import.",
    "Hole capping accepts simple nearly planar loops of at most 32 edges. Large, branched, or nonplanar boundaries remain visible.",
    "This tool does not detect self-intersections or guarantee printability. Nonmanifold edges are reported but not automatically removed.",
  ],
};
export function createExperiment(ctx) {
  const { THREE, root, ui } = ctx;
  let original = makePreset(),
    mesh = clone(original),
    view = "Working mesh",
    history = [],
    object,
    edgeLines,
    showEdges = true,
    tolerance = 0.0001;
  const operations = {
      weld: true,
      clean: true,
      orient: true,
      holes: true,
      largest: false,
    },
    material = new THREE.MeshStandardMaterial({
      color: 0xb9c8a1,
      roughness: 0.47,
      metalness: 0.07,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
    });
  let before = diagnose(original, tolerance),
    after = before;
  ui.select(
    "Example",
    ["Open housing", "Unwelded cube", "Nonmanifold fin", "Clean cube"],
    "Open housing",
    (name) => {
      original = makePreset(name);
      mesh = clone(original);
      history = [];
      view = "Working mesh";
      viewSelect.value = view;
      before = diagnose(original, tolerance);
      rebuild();
      ctx.fit();
      ctx.setStatus(
        `${name} loaded. Inspect the report before choosing repairs.`,
      );
    },
  );
  ui.file(
    "Import OBJ",
    async (file) => {
      try {
        if (file.size > 2_000_000)
          throw Error("Use an OBJ file smaller than 2 MB.");
        original = parseOBJ(await file.text());
        mesh = clone(original);
        history = [];
        view = "Working mesh";
        viewSelect.value = view;
        before = diagnose(original, tolerance);
        rebuild();
        ctx.fit();
        ctx.setStatus(
          `${file.name} parsed: ${mesh.vertices.length} vertices and ${mesh.faces.length} faces.`,
        );
      } catch (error) {
        ctx.setStatus(error.message);
      }
    },
    { accept: ".obj,text/plain" },
  );
  ui.section("Repair operations");
  ui.toggle("Weld nearby vertices", true, (v) => (operations.weld = v));
  ui.range("Weld tolerance (model units)", {
    min: 0.00001,
    max: 0.02,
    step: 0.00001,
    value: tolerance,
    onChange: (v) => {
      tolerance = v;
      before = diagnose(original, tolerance);
      rebuild();
    },
  });
  ui.toggle(
    "Remove degenerate and duplicate faces",
    true,
    (v) => (operations.clean = v),
  );
  ui.toggle(
    "Make face winding consistent",
    true,
    (v) => (operations.orient = v),
  );
  ui.toggle("Cap small planar holes", true, (v) => (operations.holes = v));
  ui.toggle(
    "Keep only largest connected component",
    false,
    (v) => (operations.largest = v),
  );
  ui.note(
    "Keep-largest can remove intentional separate pieces. Hole capping changes the shape; leave it off for openings that belong to the model.",
  );
  ui.button(
    "Apply selected repairs",
    () => {
      try {
        let next = clone(mesh),
          filled = 0,
          skipped = 0;
        if (operations.weld) next = weld(next, tolerance);
        if (operations.clean) next = cleanFaces(next);
        if (operations.largest) next = largestComponent(next);
        if (operations.orient) next = orientFaces(next);
        if (operations.holes) {
          const result = fillHoles(next);
          next = result.mesh;
          filled = result.filled;
          skipped = result.skipped;
          if (operations.orient) next = orientFaces(next);
        }
        if (!next.faces.length)
          throw Error(
            "Those operations would remove every face. The current mesh was kept.",
          );
        history.push(clone(mesh));
        if (history.length > 12) history.shift();
        mesh = next;
        view = "Working mesh";
        viewSelect.value = view;
        rebuild();
        ctx.setStatus(
          `Repairs applied. ${filled} planar hole${filled === 1 ? "" : "s"} capped; ${skipped} unsupported loops skipped. ${after.boundaryEdges} open and ${after.nonmanifoldEdges} nonmanifold edges remain.`,
        );
      } catch (error) {
        ctx.setStatus(error.message);
      }
    },
    { primary: true },
  );
  ui.button("Undo repair", () => {
    const previous = history.pop();
    if (!previous) {
      ctx.setStatus("No repair to undo.");
      return;
    }
    mesh = previous;
    view = "Working mesh";
    viewSelect.value = view;
    rebuild();
    ctx.setStatus("Previous working mesh restored.");
  });
  ui.button("Reset to original", () => {
    mesh = clone(original);
    history = [];
    view = "Working mesh";
    viewSelect.value = view;
    rebuild();
    ctx.setStatus("Original geometry restored.");
  });
  ui.section("Comparison");
  const viewSelect = ui.select(
    "Visible geometry",
    ["Working mesh", "Original mesh"],
    view,
    (v) => {
      view = v;
      rebuild();
    },
  );
  ui.toggle("Show diagnostic edges", true, (v) => {
    showEdges = v;
    edgeLines.visible = v;
    ctx.invalidate();
  });
  ui.button("Export repaired OBJ", () =>
    ctx.download("repaired-mesh.obj", toOBJ(mesh)),
  );
  const heading = ui.section("Inspection report"),
    report = document.createElement("div");
  report.style.cssText = "overflow-x:auto;max-width:100%;grid-column:1 / -1";
  heading.parentElement.append(report);
  ui.note(
    "Orange: boundary. Pink: more than two incident faces. Gold: inconsistent winding. Dark: ordinary mesh edges.",
  );
  function rebuild() {
    after = diagnose(mesh, tolerance);
    const visible = view === "Original mesh" ? original : mesh;
    if (object) {
      root.remove(object);
      object.geometry.dispose();
    }
    if (edgeLines) {
      root.remove(edgeLines);
      edgeLines.geometry.dispose();
    }
    const positions = [];
    for (const f of visible.faces)
      for (let j = 1; j < f.length - 1; j++)
        for (const v of [f[0], f[j], f[j + 1]])
          positions.push(...visible.vertices[v]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.computeVertexNormals();
    object = new THREE.Mesh(geometry, material);
    object.castShadow = true;
    root.add(object);
    const lines = [],
      colors = [];
    for (const e of edgesOf(visible).values()) {
      const isConflict = e.uses.length === 2 && e.uses[0].a === e.uses[1].a,
        color = new THREE.Color(
          e.uses.length > 2
            ? 0xf49bd1
            : e.uses.length === 1
              ? 0xff9e66
              : isConflict
                ? 0xf4d384
                : 0x37584a,
        );
      lines.push(...visible.vertices[e.a], ...visible.vertices[e.b]);
      for (let j = 0; j < 2; j++) colors.push(color.r, color.g, color.b);
    }
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(lines, 3),
    );
    edgeGeometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(colors, 3),
    );
    edgeLines = new THREE.LineSegments(edgeGeometry, lineMaterial);
    edgeLines.visible = showEdges;
    root.add(edgeLines);
    drawReport();
    ctx.invalidate();
  }
  function drawReport() {
    report.replaceChildren();
    const table = document.createElement("table");
    table.style.cssText =
      "width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums";
    const header = document.createElement("tr");
    for (const title of ["Diagnostic", "Original", "Working"]) {
      const th = document.createElement("th");
      th.textContent = title;
      th.style.cssText =
        "text-align:left;padding:8px 6px;border-bottom:1px solid #53695b";
      header.append(th);
    }
    table.append(header);
    for (const [label, key] of [
      ["Vertices", "vertices"],
      ["Faces", "faces"],
      ["Open edges", "boundaryEdges"],
      ["Boundary loops", "holes"],
      ["Nonmanifold edges", "nonmanifoldEdges"],
      ["Winding conflicts", "orientationConflicts"],
      ["Nearby duplicate vertices", "duplicateVertices"],
      ["Degenerate faces", "degenerateFaces"],
      ["Duplicate faces", "duplicateFaces"],
      ["Components", "components"],
      ["Unused vertices", "unusedVertices"],
    ]) {
      const tr = document.createElement("tr");
      for (const val of [label, before[key], after[key]]) {
        const td = document.createElement("td");
        td.textContent = val;
        td.style.cssText = "padding:7px 6px;border-bottom:1px solid #334a3e";
        tr.append(td);
      }
      table.append(tr);
    }
    report.append(table);
  }
  rebuild();
  ctx.fit();
  ctx.setStatus(
    "The housing has an open roof, a split vertex, reversed winding, a loose island, and a degenerate face.",
  );
  return {};
}
