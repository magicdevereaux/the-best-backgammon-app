import React from "react";

const SIZE = 46;
const R_DIE = 6;   // corner radius
const R_PIP = 3.8; // pip radius

// Pip positions as fractions of die size (0..1)
const PIP_LAYOUT = {
  1: [[.5, .5]],
  2: [[.72, .28], [.28, .72]],
  3: [[.72, .28], [.5, .5], [.28, .72]],
  4: [[.28, .28], [.72, .28], [.28, .72], [.72, .72]],
  5: [[.28, .28], [.72, .28], [.5, .5],   [.28, .72], [.72, .72]],
  6: [[.28, .25], [.72, .25], [.28, .5],  [.72, .5],  [.28, .75], [.72, .75]],
};

function DieFace({ value, used }) {
  const pips = PIP_LAYOUT[value] || [];
  const bg      = used ? "var(--die-face-used)"   : "var(--die-face)";
  const pipFill = used ? "var(--die-pip-used)"    : "var(--die-pip)";
  const border  = used ? "var(--die-border-used)" : "var(--die-border)";

  return (
    <div
      style={{
        position: "relative",
        width: SIZE,
        height: SIZE,
        flexShrink: 0,
        opacity: used ? 0.38 : 1,
      }}
      aria-label={String(value)}
    >
      {/* Findable text for tests */}
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        {value}
      </span>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        style={{ display: "block" }}
      >
        {/* Drop shadow filter */}
        <defs>
          <filter id={`ds${value}${used ? "u" : "f"}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="rgba(0,0,0,0.5)" />
          </filter>
        </defs>
        <rect
          x={1} y={1} width={SIZE - 2} height={SIZE - 2}
          rx={R_DIE} ry={R_DIE}
          strokeWidth={1.5}
          filter={used ? undefined : `url(#ds${value}f)`}
          style={{ fill: bg, stroke: border }}
        />
        {/* Inner bevel highlight */}
        {!used && (
          <rect
            x={3} y={3} width={SIZE - 6} height={SIZE / 2}
            rx={R_DIE - 2} ry={R_DIE - 2}
            fill="rgba(255,255,255,0.18)"
          />
        )}
        {/* Pips */}
        {pips.map(([fx, fy], i) => (
          <circle
            key={i}
            cx={fx * SIZE}
            cy={fy * SIZE}
            r={R_PIP}
            style={{ fill: pipFill }}
          />
        ))}
      </svg>
    </div>
  );
}

export default function Dice({ diceValues, usedCount = 0 }) {
  if (!diceValues || diceValues.length === 0) {
    return (
      <p style={{ color: "var(--text-secondary)", margin: "0.5rem 0", fontFamily: "sans-serif", fontSize: "0.9rem" }}>
        No dice rolled yet.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem", margin: "0.75rem 0", alignItems: "center" }}>
      {diceValues.map((val, i) => (
        <DieFace key={i} value={val} used={i < usedCount} />
      ))}
    </div>
  );
}
