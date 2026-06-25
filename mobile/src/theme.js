// Shared visual language derived from the app icon ("The Crossed Points").
// Single source of truth for mobile colors — keep in sync with the web theme
// variables in frontend/src/theme.css.

export const colors = {
  // ── Core palette ──────────────────────────────────────────────────────────
  bg:        "#181818",  // app background
  bgRaised:  "#242424",  // surface / cards / panels / inputs
  surface:   "#242424",  // alias of bgRaised
  border:    "#3A2E22",  // warm hairline border
  text:      "#F5ECD7",  // primary text (ivory)
  textMuted: "#A89880",  // secondary text
  danger:    "#8B1A1A",  // error / destructive

  // Named palette aliases (for clarity at call sites)
  mahogany:  "#5C2010",
  ivory:     "#F5ECD7",
  walnut:    "#2A1A0E",

  // ── Accent (gold) ─────────────────────────────────────────────────────────
  gold:      "#C9A227",
  goldDark:  "#9A7A1E",
  goldText:  "#181818",  // text/icons on a gold fill

  // ── Board frame + surface ─────────────────────────────────────────────────
  frame:     "#1C1109",  // board frame (darker walnut)
  felt:      "#2A1A0E",  // playing surface (dark walnut)
  feltHome:  "#241608",  // home quadrant, a touch lighter
  barFill:   "#1F1208",
  offBg:     "#160C05",

  // ── Triangles (alternating points) ────────────────────────────────────────
  triA:      "#5C2010",  // mahogany
  triB:      "#F5ECD7",  // ivory

  // ── Checkers ──────────────────────────────────────────────────────────────
  p1Fill:    "#F5ECD7",  // light checker (ivory)
  p1Stroke:  "#9A7A1E",  // gold-dark rim
  p2Fill:    "#20130A",  // dark checker (near-black walnut)
  p2Stroke:  "#C9A227",  // gold rim
  checkerSelected: "#C9A227", // gold selection ring

  // ── Move highlighting ─────────────────────────────────────────────────────
  selOverlay: "rgba(201,162,39,0.26)",  // gold tint
  destSafe:   "rgba(201,162,39,0.42)",  // gold tint
  destBlot:   "rgba(139,26,26,0.52)",   // error-red tint
  offLegal:   "rgba(201,162,39,0.16)",  // faint gold wash on bear-off zone

  // ── Dice ──────────────────────────────────────────────────────────────────
  dieFace:     "#F5ECD7",
  dieFaceUsed: "#242424",
  diePip:      "#181818",
  diePipUsed:  "#6B6B6B",
  dieBorder:   "#C9A227",
  dieBorderUsed: "#1A1A1A",
};
