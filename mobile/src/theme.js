// Shared visual language ported from the web app's premium dark board.
// Keep these in sync with frontend/src/components/Board.jsx where practical.

export const colors = {
  // App chrome
  bg:        "#0F1A12",
  bgRaised:  "#1A2A1E",
  border:    "#2A4030",
  text:      "#D0E8D4",
  textMuted: "#6A8870",
  danger:    "#E07060",

  // Accent (gold)
  gold:      "#C8952A",
  goldDark:  "#A07020",
  goldText:  "#1A0A02",

  // Board frame + felt
  frame:     "#2E1506",
  felt:      "#1C4828",
  feltHome:  "#1A3D22",
  barFill:   "#24100A",
  offBg:     "#1A0C06",

  // Triangles (alternating)
  triA:      "#7B2222",
  triB:      "#C8952A",

  // Checkers
  p1Fill:    "#F0E0B0",
  p1Stroke:  "#A06820",
  p2Fill:    "#160903",
  p2Stroke:  "#7A4020",

  // Move highlighting
  selOverlay: "rgba(255,255,200,0.20)",
  destSafe:   "rgba(55,210,85,0.45)",
  destBlot:   "rgba(220,165,30,0.55)",

  // Dice
  dieFace:   "#F5F0E8",
  dieFaceUsed: "#2A2A2A",
  diePip:    "#1A1208",
  diePipUsed: "#555555",
  dieBorder: "#C8A855",
};
