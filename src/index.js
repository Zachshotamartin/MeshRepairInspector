import {
  clone,
  parseOBJ,
  diagnose,
  weld,
  cleanFaces,
  orientFaces,
  fillHoles,
  largestComponent,
  removeLooseFins,
  makePreset,
  toOBJ,
} from "./repair.js";
import { EXAMPLES, DIAGNOSTICS } from "./examples.js";
import { createRepairView } from "./repairView.js";
export const metadata = {
  id: "mesh-repair-inspector",
  title: "Mesh Repair Inspector",
  description:
    "See what is wrong with a mesh, understand the repair, and compare the actual result before exporting.",
  technique:
    "Edge incidence · vertex welding · orientation propagation · planar hole triangulation",
  instructions: [
    "Choose an example and read What is wrong, What to look for, and How this example is repaired. Each example selects suitable repair operations.",
    "Use Separate disconnected parts to see seams that occupy the same position, or Face directions to reveal backward panels. These are inspection views; exports keep actual coordinates.",
    "Apply repairs, inspect the changes, then compare Original mesh and Working mesh. Undo and Reset retain the source.",
    "Orange marks open edges, pink marks edges shared by too many faces, and coral surfaces mark duplicate or reversed panels and smaller disconnected pieces.",
  ],
  limitations: [
    "OBJ input is limited to 2 MB, 20,000 vertices and 30,000 faces. Materials, UVs, and imported normals are not retained.",
    "Polygon rendering assumes convex faces; triangulate concave polygons before import.",
    "Hole capping supports simple nearly planar loops of up to 32 edges. Other loops remain visible.",
    "Loose-fin removal handles a single-face appendage with one nonmanifold attachment and otherwise open edges. Ambiguous solid junctions are left unchanged.",
    "Self-intersections and printability are not checked. Diagnostic markers are sampled beyond 1,600 edges/points and 160 face arrows.",
  ],
};
export function createExperiment(ctx) {
  const { THREE: T, root, ui } = ctx;
  let example = "Open housing",
    original = makePreset(example),
    mesh = clone(original),
    view = "Working mesh",
    overlay = EXAMPLES[example].overlay,
    history = [],
    visual,
    showEdges = true,
    tolerance = 0.0001;
  const operations = {
      weld: true,
      clean: true,
      orient: true,
      holes: true,
      largest: true,
      fins: false,
    },
    checks = {};
  let before = diagnose(original, tolerance),
    after = before,
    lastResult = "";
  const exampleSelect = ui.select(
    "Example",
    Object.keys(EXAMPLES),
    example,
    (name) => load(name),
  );
  const guide = document.createElement("div");
  guide.className = "repair-example-guide";
  guide.style.cssText = "display:grid;gap:14px;grid-column:1 / -1";
  const anchor = ui.note("");
  anchor.replaceWith(guide);
  const guideFields = {};
  for (const label of [
    "What is wrong",
    "What to look for",
    "How this example is repaired",
  ]) {
    const section = document.createElement("div"),
      title = document.createElement("strong"),
      text = document.createElement("p");
    title.textContent = label;
    title.style.fontSize = "15px";
    text.className = "graphics-workbench__note";
    section.append(title, text);
    guide.append(section);
    guideFields[label] = text;
  }
  ui.file(
    "Import OBJ",
    async (file) => {
      try {
        if (file.size > 2_000_000)
          throw Error("Use an OBJ file smaller than 2 MB.");
        const parsed = parseOBJ(await file.text());
        example = null;
        let uploaded = exampleSelect.querySelector('option[value="uploaded"]');
        if (!uploaded) {
          uploaded = document.createElement("option");
          uploaded.value = "uploaded";
          uploaded.disabled = true;
          exampleSelect.append(uploaded);
        }
        uploaded.textContent = `Uploaded: ${file.name}`;
        exampleSelect.value = "uploaded";
        original = parsed;
        mesh = clone(parsed);
        history = [];
        view = "Working mesh";
        overlay = "Problem areas";
        setOperations(["weld", "clean", "orient"]);
        lastResult = "";
        before = diagnose(original, tolerance);
        rebuild();
        ctx.fit();
        ctx.setStatus(
          `${file.name}: ${mesh.vertices.length} vertices and ${mesh.faces.length} faces. Review the diagnostic report before repairing.`,
        );
      } catch (error) {
        ctx.setStatus(error.message);
      }
    },
    { accept: ".obj,text/plain" },
  );
  ui.section("Inspection view");
  const overlaySelect = ui.select(
    "Inspection overlay",
    [
      "Problem areas",
      "Separate disconnected parts",
      "Face directions",
      "Plain surface",
    ],
    overlay,
    (value) => {
      overlay = value;
      rebuild();
      ctx.fit();
    },
  );
  const overlayHelp = ui.note("");
  ui.toggle("Show diagnostic edges", true, (value) => {
    showEdges = value;
    rebuild();
  });
  const viewSelect = ui.select(
    "Visible geometry",
    ["Working mesh", "Original mesh"],
    view,
    (value) => {
      view = value;
      rebuild();
    },
  );
  ui.section("Repair operations");
  const operationLabels = {
    weld: "Weld nearby vertices",
    clean: "Remove degenerate and duplicate faces",
    orient: "Make face winding consistent",
    holes: "Cap small planar holes",
    fins: "Remove loose fins",
    largest: "Keep only largest connected component",
  };
  for (const [key, label] of Object.entries(operationLabels))
    checks[key] = ui.toggle(
      label,
      operations[key],
      (value) => (operations[key] = value),
    );
  ui.range("Weld tolerance (model units)", {
    min: 0.00001,
    max: 0.02,
    step: 0.00001,
    value: tolerance,
    onChange: (value) => {
      tolerance = value;
      before = diagnose(original, tolerance);
      rebuild();
    },
  });
  ui.note(
    "Keeping the largest piece removes smaller parts. Hole capping fills openings. The example explains when these are intended; review them for your own model.",
  );
  ui.button(
    "Apply selected repairs",
    () => {
      try {
        let next = clone(mesh),
          filled = 0,
          skipped = 0,
          removedFins = 0;
        if (operations.weld) next = weld(next, tolerance);
        if (operations.clean) next = cleanFaces(next);
        if (operations.fins) {
          const result = removeLooseFins(next);
          next = result.mesh;
          removedFins = result.removed;
        }
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
        const unchanged = JSON.stringify(next) === JSON.stringify(mesh),
          previous = after;
        if (!unchanged) {
          history.push(clone(mesh));
          if (history.length > 12) history.shift();
          mesh = next;
        }
        view = "Working mesh";
        after = diagnose(mesh, tolerance);
        const changes = DIAGNOSTICS.filter(
          ([, key]) => previous[key] !== after[key],
        ).map(([label, key]) => `${label}: ${previous[key]} → ${after[key]}`);
        lastResult = unchanged
          ? "No geometry changed. The selected operations either already pass or do not address the remaining issues."
          : changes.join(" · ");
        if (removedFins)
          lastResult += ` · ${removedFins} attached fin removed.`;
        if (filled)
          lastResult += ` · ${filled} flat opening${filled === 1 ? "" : "s"} filled.`;
        if (skipped)
          lastResult += ` · ${skipped} unsupported boundary loop${skipped === 1 ? "" : "s"} left unchanged.`;
        rebuild();
        ctx.setStatus(lastResult);
      } catch (error) {
        ctx.setStatus(error.message);
      }
    },
    { primary: true },
  );
  const resultNote = ui.note(
    "Apply the suggested repairs, then compare the original and working mesh.",
  );
  resultNote.classList.add("repair-result");
  ui.button("Undo repair", () => {
    const previous = history.pop();
    if (!previous) {
      ctx.setStatus("No repair to undo.");
      return;
    }
    mesh = previous;
    view = "Working mesh";
    lastResult =
      "Previous working mesh restored. The original remains available for comparison.";
    rebuild();
    ctx.setStatus(lastResult);
  });
  ui.button("Reset to original", () => {
    mesh = clone(original);
    history = [];
    view = "Working mesh";
    lastResult = "Original geometry restored.";
    rebuild();
    ctx.setStatus(lastResult);
  });
  ui.button("Export repaired OBJ", () =>
    ctx.download("repaired-mesh.obj", toOBJ(mesh)),
  );
  const heading = ui.section("Inspection report"),
    report = document.createElement("div");
  report.style.cssText = "overflow-x:auto;max-width:100%;grid-column:1 / -1";
  heading.parentElement.append(report);
  const glossary = document.createElement("details"),
    summary = document.createElement("summary");
  summary.textContent = "What do these counts mean?";
  glossary.append(summary);
  glossary.style.gridColumn = "1 / -1";
  for (const [label, , meaning] of DIAGNOSTICS) {
    const p = document.createElement("p");
    p.className = "graphics-workbench__note";
    p.style.marginTop = "12px";
    const title = document.createElement("strong");
    title.textContent = label + ". ";
    p.append(title, meaning);
    glossary.append(p);
  }
  heading.parentElement.append(glossary);
  function setOperations(keys) {
    for (const key of Object.keys(operations)) {
      operations[key] = keys.includes(key);
      if (checks[key]) checks[key].checked = operations[key];
    }
  }
  function load(name) {
    if (!EXAMPLES[name]) return;
    example = name;
    exampleSelect.value = name;
    original = makePreset(name);
    mesh = clone(original);
    view = "Working mesh";
    overlay = EXAMPLES[name].overlay;
    history = [];
    lastResult = "";
    before = diagnose(original, tolerance);
    setOperations(EXAMPLES[name].operations);
    rebuild();
    ctx.fit();
    ctx.setStatus(`${name}: ${EXAMPLES[name].repair}`);
  }
  function rebuild() {
    after = diagnose(mesh, tolerance);
    const visible = view === "Original mesh" ? original : mesh;
    if (visual) {
      root.remove(visual.group);
      visual.dispose();
    }
    visual = createRepairView(T, visible, { overlay, showEdges });
    root.add(visual.group);
    viewSelect.value = view;
    overlaySelect.value = overlay;
    overlayHelp.textContent =
      overlay === "Plain surface"
        ? "Diagnostic colors and markers are hidden. The mesh geometry is unchanged."
        : overlay === "Separate disconnected parts"
          ? "Inspection only: disconnected pieces are spread apart to reveal their connections. Exported vertices keep their real positions."
          : overlay === "Face directions"
            ? "Arrows show which way each face points. Coral panels face opposite the consistent orientation; gold arrows show the other panels."
            : "Orange: open edges. Pink: more than two faces share an edge. Coral: reversed or duplicate panels, collapsed faces, or smaller separate pieces.";
    const info = EXAMPLES[example] || {
      problem:
        "An uploaded mesh may contain several different defects. The report counts them using its real vertex and face connections.",
      look: "Use Problem areas to locate marked edges and panels, Separate disconnected parts to inspect connectivity, and Face directions to inspect orientation.",
      repair:
        "Select operations that match your intended shape. Separate parts and open edges can be intentional; this tool does not infer design intent.",
    };
    for (const [label, key] of [
      ["What is wrong", "problem"],
      ["What to look for", "look"],
      ["How this example is repaired", "repair"],
    ])
      guideFields[label].textContent = info[key];
    resultNote.textContent =
      lastResult ||
      "Apply the suggested repairs, then compare the original and working mesh.";
    report.replaceChildren();
    const table = document.createElement("table");
    table.style.cssText =
      "width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums";
    const caption = document.createElement("caption");
    caption.textContent = "Actual mesh counts · original → working";
    caption.style.cssText = "text-align:left;margin-bottom:8px";
    table.append(caption);
    const head = document.createElement("thead"),
      row = document.createElement("tr");
    for (const label of ["Diagnostic", "Before", "After"]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      th.style.cssText =
        "text-align:left;padding:8px 6px;border-bottom:1px solid #53695b";
      row.append(th);
    }
    head.append(row);
    table.append(head);
    const body = document.createElement("tbody");
    for (const [label, key, meaning] of DIAGNOSTICS) {
      const row = document.createElement("tr");
      row.dataset.diagnostic = key;
      for (const [i, value] of [label, before[key], after[key]].entries()) {
        const cell = document.createElement(i === 0 ? "th" : "td");
        if (i === 0) {
          cell.scope = "row";
          cell.title = meaning;
        }
        cell.textContent = value;
        cell.style.cssText =
          "text-align:left;padding:7px 6px;border-bottom:1px solid #334a3e;font-weight:400";
        if (i === 2 && before[key] !== after[key]) {
          cell.style.color = "#c1d8a2";
          cell.style.fontWeight = "600";
        }
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body);
    report.append(table);
    ctx.invalidate();
  }
  load(example);
  return {
    dispose() {
      visual?.dispose();
    },
  };
}
