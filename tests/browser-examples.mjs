import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { EXAMPLES, DIAGNOSTICS } from "../src/examples.js";
import { parseOBJ, diagnose } from "../src/repair.js";
const server = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  cacheDir: ".vite/examples",
});
await server.listen();
const browser = await chromium.launch({ channel: "chromium" });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  const button = (name) => page.getByRole("button", { name, exact: true }),
    select = (name) => page.getByRole("combobox", { name, exact: true }),
    canvas = page.locator("canvas");
  await expect(select("Example")).toBeVisible();
  async function exportMesh() {
    const download = page.waitForEvent("download");
    await button("Export repaired OBJ").click();
    return parseOBJ(await readFile(await (await download).path(), "utf8"));
  }
  async function capture(path) {
    await canvas.scrollIntoViewIfNeeded();
    return canvas.screenshot(path ? { path } : {});
  }
  const opLabels = {
    weld: "Weld nearby vertices",
    clean: "Remove degenerate and duplicate faces",
    orient: "Make face winding consistent",
    holes: "Cap small planar holes",
    fins: "Remove loose fins",
    largest: "Keep only largest connected component",
  };
  for (const [name, example] of Object.entries(EXAMPLES)) {
    await select("Example").selectOption(name);
    const slug = name.toLowerCase().replaceAll(" ", "-");
    for (const text of [example.problem, example.look, example.repair])
      await expect(page.locator(".repair-example-guide")).toContainText(text);
    await expect(select("Inspection overlay")).toHaveValue(example.overlay);
    for (const [key, label] of Object.entries(opLabels))
      assert.equal(
        await page
          .getByRole("checkbox", { name: label, exact: true })
          .isChecked(),
        example.operations.includes(key),
        `${name}: ${key}`,
      );
    const original = await exportMesh(),
      before = await capture(`/tmp/repair-${slug}-before.png`);
    if (name === "Unwelded cube") {
      await select("Inspection overlay").selectOption("Plain surface");
      assert.deepEqual(
        await exportMesh(),
        original,
        "Inspection never edits exported coordinates",
      );
      await expect(
        page.getByText(
          "Diagnostic colors and markers are hidden. The mesh geometry is unchanged.",
          { exact: true },
        ),
      ).toBeVisible();
      await select("Inspection overlay").selectOption(example.overlay);
    }
    await button("Apply selected repairs").click();
    const fixed = await exportMesh(),
      report = diagnose(fixed),
      after = await capture(`/tmp/repair-${slug}-after.png`);
    for (const key of [
      "boundaryEdges",
      "nonmanifoldEdges",
      "orientationConflicts",
      "duplicateVertices",
      "duplicateFaces",
      "degenerateFaces",
      "unusedVertices",
    ])
      assert.equal(report[key], 0, `${name}: actual exported ${key}`);
    assert.equal(report.components, 1, name);
    for (const [, key] of DIAGNOSTICS)
      await expect(
        page.locator(`[data-diagnostic="${key}"] td`).last(),
      ).toHaveText(String(report[key]));
    if (name === "Clean cube") {
      assert.deepEqual(fixed, original);
      await expect(page.locator(".repair-result")).toContainText(
        "No geometry changed",
      );
    } else {
      assert.notDeepEqual(
        fixed,
        original,
        `${name}: geometry must actually change`,
      );
      assert.equal(
        before.equals(after),
        false,
        `${name}: visible diagnostic must change`,
      );
      await select("Visible geometry").selectOption("Original mesh");
      assert.equal(
        before.equals(await capture()),
        true,
        `${name}: original display preserved at the same camera`,
      );
      await button("Undo repair").click();
      assert.deepEqual(await exportMesh(), original, `${name}: undo`);
    }
    console.log(
      `PASS: ${name}, real repairs, exported counts, explanations, visual comparison and undo.`,
    );
  }
  await page.getByText("What do these counts mean?", { exact: true }).click();
  await expect(
    page.getByText(DIAGNOSTICS[4][2], { exact: false }).last(),
  ).toBeVisible();
  await select("Example").selectOption("Nonmanifold fin");
  const source = await exportMesh();
  await page
    .getByLabel("Import OBJ", { exact: true })
    .setInputFiles({
      name: "triangle.obj",
      mimeType: "text/plain",
      buffer: Buffer.from("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"),
    });
  await expect(select("Example")).toHaveValue("uploaded");
  await expect(select("Example").locator("option:checked")).toHaveText(
    "Uploaded: triangle.obj",
  );
  await expect(
    page.getByRole("checkbox", { name: opLabels.holes, exact: true }),
  ).not.toBeChecked();
  const triangle = await exportMesh();
  assert.equal(triangle.faces.length, 1);
  await page
    .getByLabel("Import OBJ", { exact: true })
    .setInputFiles({
      name: "invalid.obj",
      mimeType: "text/plain",
      buffer: Buffer.from("v NaN 0 0\nf 1 2 3\n"),
    });
  await expect(page.getByRole("status")).toContainText("vertex");
  assert.deepEqual(
    await exportMesh(),
    triangle,
    "Invalid import preserves working geometry",
  );
  await select("Example").selectOption("Nonmanifold fin");
  assert.deepEqual(await exportMesh(), source);
  await page.setViewportSize({ width: 390, height: 844 });
  await select("Example").selectOption("Reversed panel");
  await button("Apply selected repairs").click();
  await expect(page.locator(".repair-result")).toContainText(
    "Winding conflicts: 4 → 0",
  );
  await canvas.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/tmp/repair-guided-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "Mobile has no horizontal page overflow",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: comparison glossary, safe OBJ imports, uploaded-file label, mobile layout, no browser errors.",
  );
} finally {
  await browser.close();
  await server.close();
}
