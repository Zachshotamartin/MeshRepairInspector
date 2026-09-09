export const EXAMPLES = {
  "Open housing": {
    problem:
      "The box is missing its roof. It also contains a disconnected corner, a backward-facing panel, a stray triangle, and a face collapsed into a line.",
    look: "The orange rim marks the missing roof. The detached triangle beside the box is a separate piece. After repair, a new roof closes the rim and the stray piece disappears.",
    repair:
      "Join matching corners, remove invalid faces and the loose piece, correct face directions, then fill the flat roof opening.",
    overlay: "Problem areas",
    operations: ["weld", "clean", "orient", "holes", "largest"],
  },
  "Unwelded cube": {
    problem:
      "Six separate panels sit in the shape of a cube, but they do not share corners. There are 24 stored vertices where one connected cube needs only 8.",
    look: "The inspection view spreads the disconnected panels apart. Welding joins them, so the working view becomes one connected cube. The actual vertex positions do not need to move.",
    repair:
      "Weld nearby vertices. Expect vertices 24 → 8, separate pieces 6 → 1, and open edges 24 → 0.",
    overlay: "Separate disconnected parts",
    operations: ["weld"],
  },
  "Reversed panel": {
    problem:
      "The front panel faces inward while its neighbors face outward. A face has a front and a back, even when a viewer draws both sides.",
    look: "The coral panel and its arrow point into the cube. After repair the panel returns to green and its arrow points out. Its shape and position stay the same.",
    repair:
      "Make face winding consistent. The four conflicting edges around the panel should become zero.",
    overlay: "Face directions",
    operations: ["orient"],
  },
  "Duplicate panels": {
    problem:
      "The front and roof panels each occur twice in the file. The copies occupy exactly the same space, which can cause flickering and ambiguous surface connections.",
    look: "Coral surfaces mark panels with duplicate copies. Cleanup removes the extra records; the cube should keep the same shape while its face count drops from 8 to 6.",
    repair:
      "Remove duplicate faces. Two duplicate panels and their extra edge connections should disappear.",
    overlay: "Problem areas",
    operations: ["clean"],
  },
  "Nonmanifold fin": {
    problem:
      "An extra triangular fin shares an edge with two cube panels. Three faces meet at that edge; an ordinary closed surface should have two.",
    look: "The pink edge is the three-face junction. The fin sticks out from the front-right corner. The targeted repair removes that appendage and preserves the cube.",
    repair:
      "Remove loose fins. This handles a single attached face with otherwise open edges; ambiguous junctions between solid regions are left for manual editing.",
    overlay: "Problem areas",
    operations: ["fins"],
  },
  "Loose fragments": {
    problem:
      "Two small closed fragments float beside the main cube. Each fragment is valid by itself, but here they are unwanted separate pieces.",
    look: "Coral marks the two smaller pieces. After keeping the largest connected piece, they disappear and the component count falls from 3 to 1.",
    repair:
      "Keep only the largest connected component. Use this only when the smaller pieces are unwanted; assemblies can legitimately contain separate parts.",
    overlay: "Problem areas",
    operations: ["largest"],
  },
  "Collapsed face": {
    problem:
      "One triangle repeats a corner, leaving no surface area. It is stored as a face even though it has collapsed into a line.",
    look: "The coral line and dot below the front panel mark that invalid face. Cleanup removes it and its unused vertex; the solid cube stays intact.",
    repair:
      "Remove degenerate faces. The degenerate-face count drops to zero and the mesh returns to six valid panels.",
    overlay: "Problem areas",
    operations: ["clean"],
  },
  "Clean cube": {
    problem:
      "This is the reference example: eight shared corners, six outward-facing panels, one closed piece, and no listed defects.",
    look: "No coral, orange, or pink problem highlights should appear. Applying repairs should correctly leave the geometry unchanged.",
    repair:
      "No repair is needed. Compare its report with the damaged examples to see what a simple closed mesh looks like.",
    overlay: "Problem areas",
    operations: ["weld", "clean", "orient", "holes"],
  },
};
export const DIAGNOSTICS = [
  [
    "Vertices",
    "vertices",
    "Stored corner positions. Welding can replace several matching corners with one shared vertex.",
  ],
  [
    "Faces",
    "faces",
    "Polygon surface records. Cleanup removes invalid copies; filling a hole adds new faces.",
  ],
  [
    "Open edges",
    "boundaryEdges",
    "Edges used by only one face. They can mark holes, disconnected seams, or intentional openings.",
  ],
  [
    "Boundary loops",
    "holes",
    "Closed rims made from open edges. Only small, simple, nearly flat rims can be capped here.",
  ],
  [
    "Nonmanifold edges",
    "nonmanifoldEdges",
    "Edges shared by more than two faces. Loose fins can be removed; ambiguous solid junctions remain.",
  ],
  [
    "Winding conflicts",
    "orientationConflicts",
    "Neighboring panels disagree about their front and back directions.",
  ],
  [
    "Matching extra vertices",
    "duplicateVertices",
    "Additional vertices within the selected weld tolerance of another vertex.",
  ],
  [
    "Degenerate faces",
    "degenerateFaces",
    "Faces with repeated corners or no area. They cannot represent a useful surface.",
  ],
  [
    "Duplicate faces",
    "duplicateFaces",
    "Extra copies of the same polygon, including copies with reversed corner order.",
  ],
  [
    "Separate pieces",
    "components",
    "Groups of faces connected by shared edges. Separate pieces can be intentional.",
  ],
  [
    "Unused vertices",
    "unusedVertices",
    "Vertices that are not referenced by any face. Cleanup removes them.",
  ],
];
