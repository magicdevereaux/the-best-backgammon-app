import React from "react";

const P1 = { fill: "#f0dca0", stroke: "#b8902a" };
const P2 = { fill: "#3a1e0a", stroke: "#8b5a30" };
const TRI_A = "#9b3510";
const TRI_B = "#c8a050";

function Checker({ player }) {
  const c = player === "p1" ? P1 : P2;
  return (
    <div
      data-testid={`${player}-checker`}
      style={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: c.fill,
        border: `2px solid ${c.stroke}`,
        margin: "1px 0",
        flexShrink: 0,
      }}
    />
  );
}

function Triangle({ down, color }) {
  return (
    <div
      style={{
        width: 0,
        height: 0,
        borderLeft: "17px solid transparent",
        borderRight: "17px solid transparent",
        flexShrink: 0,
        ...(down
          ? { borderTop: `55px solid ${color}` }
          : { borderBottom: `55px solid ${color}` }),
      }}
    />
  );
}

function Point({ num, value, isTop, colorIndex }) {
  const player = value > 0 ? "p1" : value < 0 ? "p2" : null;
  const n = Math.abs(value);
  const shown = Math.min(n, 5);
  const overflow = n > 5 ? n - 5 : 0;
  const color = colorIndex % 2 === 0 ? TRI_A : TRI_B;

  const checkerStack = (
    <div
      style={{
        minHeight: 120,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: isTop ? "flex-end" : "flex-start",
      }}
    >
      {player &&
        Array.from({ length: shown }).map((_, i) => (
          <Checker key={i} player={player} />
        ))}
      {overflow > 0 && (
        <div style={{ fontSize: "0.55rem", color: "#eee", fontWeight: "bold" }}>
          +{overflow}
        </div>
      )}
    </div>
  );

  return (
    <div
      data-testid={`point-${num}`}
      style={{
        width: 34,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "2px 0",
      }}
    >
      {isTop ? (
        <>
          <div style={{ fontSize: "0.5rem", color: "#bbb", height: 14, lineHeight: "14px" }}>
            {num}
          </div>
          {checkerStack}
          <Triangle down color={color} />
        </>
      ) : (
        <>
          <Triangle down={false} color={color} />
          {checkerStack}
          <div style={{ fontSize: "0.5rem", color: "#bbb", height: 14, lineHeight: "14px" }}>
            {num}
          </div>
        </>
      )}
    </div>
  );
}

export default function Board({ boardState }) {
  if (!boardState) {
    return (
      <div style={{ padding: "1rem", color: "#888", fontFamily: "sans-serif" }}>
        No board state available.
      </div>
    );
  }

  const { points, bar, off } = boardState;

  // top row left-to-right: points 13–18 | 19–24  (indices 12–17 | 18–23)
  const topLeft  = [12, 13, 14, 15, 16, 17];
  const topRight = [18, 19, 20, 21, 22, 23];
  // bottom row left-to-right: points 12–7 | 6–1  (indices 11–6 | 5–0)
  const botLeft  = [11, 10,  9,  8,  7,  6];
  const botRight = [ 5,  4,  3,  2,  1,  0];

  const renderPoints = (indices, isTop) =>
    indices.map((idx, pos) => (
      <Point key={idx} num={idx + 1} value={points[idx]} isTop={isTop} colorIndex={pos} />
    ));

  return (
    <div
      style={{
        background: "#2d5a27",
        border: "6px solid #5c3a1e",
        borderRadius: 4,
        display: "inline-block",
        userSelect: "none",
        fontFamily: "sans-serif",
      }}
    >
      {/* Main board: left half | bar | right half */}
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex" }}>{renderPoints(topLeft, true)}</div>
          <div style={{ display: "flex" }}>{renderPoints(botLeft, false)}</div>
        </div>

        <div
          data-testid="bar"
          style={{
            width: 34,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#1a3f14",
            flexShrink: 0,
            gap: 2,
            padding: "4px 0",
          }}
        >
          {bar.p2 > 0 &&
            Array.from({ length: bar.p2 }).map((_, i) => (
              <Checker key={`p2-${i}`} player="p2" />
            ))}
          {bar.p1 === 0 && bar.p2 === 0 && (
            <div
              style={{
                fontSize: "0.45rem",
                color: "#555",
                writingMode: "vertical-rl",
                letterSpacing: 3,
              }}
            >
              BAR
            </div>
          )}
          {bar.p1 > 0 &&
            Array.from({ length: bar.p1 }).map((_, i) => (
              <Checker key={`p1-${i}`} player="p1" />
            ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex" }}>{renderPoints(topRight, true)}</div>
          <div style={{ display: "flex" }}>{renderPoints(botRight, false)}</div>
        </div>
      </div>

      {/* Off strip */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          background: "#1d3d18",
          padding: "5px 8px",
          gap: 16,
          fontSize: "0.65rem",
          color: "#ccc",
        }}
      >
        <div data-testid="off-p1" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: P1.fill }}>●</span>
          <span>P1 off: {off.p1}</span>
        </div>
        <div data-testid="off-p2" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: P2.fill }}>●</span>
          <span>P2 off: {off.p2}</span>
        </div>
      </div>
    </div>
  );
}
