import React, { useState } from "react";

// ── Layout constants ────────────────────────────────────────────────────────
const PW = 58;                        // point (triangle) base width
const BH = 500;                       // board height
const TH = 198;                       // triangle height
const BAR_W = 40;
const HALF_W = PW * 6;               // 348
const BAR_START = HALF_W;            // 348
const BAR_END = HALF_W + BAR_W;      // 388
const BOARD_W = HALF_W * 2 + BAR_W; // 736
const OFF_GAP = 10;
const OFF_W = 54;
const SVG_W = BOARD_W + OFF_GAP + OFF_W; // 800
const SVG_H = BH;

const TOP_APEX_Y = TH;               // 198
const BOT_APEX_Y = BH - TH;         // 302

const CR = 17;                       // checker radius
const C_STEP = 37;                   // checker stack step
const MAX_VIS = 5;

const TOP_CY0 = CR + 6;             // 23
const BOT_CY0 = BH - CR - 6;       // 477

const OCR = 7;                       // off-tray checker radius
const O_STEP = 14;

// ── Palette ─────────────────────────────────────────────────────────────────
const FELT       = "#1C4828";
const FELT_HOME  = "#1A3D22";
const FRAME_COL  = "#2E1506";
const BAR_FILL   = "#24100A";
const TRI_A      = "#7B2222";
const TRI_B      = "#C8952A";
const SEL_OVL    = "rgba(255,255,200,0.20)";
const DEST_SAFE  = "rgba(55,210,85,0.38)";
const DEST_BLOT  = "rgba(220,165,30,0.46)";
const OFF_BG     = "#1A0C06";
const P1_FILL    = "#F0E0B0";
const P1_STR     = "#A06820";
const P2_FILL    = "#160903";
const P2_STR     = "#7A4020";

// ── Static point layout ─────────────────────────────────────────────────────
const POINT_DEFS = [
  // Top-left: points 13-18
  ...Array.from({ length: 6 }, (_, p) => ({ num: 13 + p, idx: 12 + p, lx: p * PW,            isTop: true,  ci: p })),
  // Top-right: points 19-24
  ...Array.from({ length: 6 }, (_, p) => ({ num: 19 + p, idx: 18 + p, lx: BAR_END + p * PW,  isTop: true,  ci: p })),
  // Bottom-left: points 12-7
  ...Array.from({ length: 6 }, (_, p) => ({ num: 12 - p, idx: 11 - p, lx: p * PW,            isTop: false, ci: p })),
  // Bottom-right: points 6-1
  ...Array.from({ length: 6 }, (_, p) => ({ num: 6  - p, idx: 5  - p, lx: BAR_END + p * PW,  isTop: false, ci: p })),
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function triPts(lx, isTop) {
  return isTop
    ? `${lx},0 ${lx + PW},0 ${lx + PW / 2},${TOP_APEX_Y}`
    : `${lx},${BH} ${lx + PW},${BH} ${lx + PW / 2},${BOT_APEX_Y}`;
}

function checkerCY(isTop, i) {
  return isTop ? TOP_CY0 + i * C_STEP : BOT_CY0 - i * C_STEP;
}

function isBlotHit(points, player, toPoint) {
  if (toPoint >= 25 || toPoint <= 0) return false;
  const v = points[toPoint - 1];
  return player === "p1" ? v === -1 : v === 1;
}

// ── Checker circle (used on points) ─────────────────────────────────────────
function Pip({ player, cx, cy, r, isTopmost, isSelected }) {
  const fill   = player === "p1" ? P1_FILL : P2_FILL;
  const stroke = player === "p1" ? P1_STR  : P2_STR;
  return (
    <>
      <circle
        data-testid={`${player}-checker`}
        cx={cx} cy={cy} r={r}
        fill={fill} stroke={stroke} strokeWidth={2.5}
      />
      <circle cx={cx} cy={cy} r={r - 5} fill="none" stroke={stroke} strokeWidth={1} opacity={0.45} />
      {/* Highlight arc on light checker */}
      {player === "p1" && (
        <circle cx={cx} cy={cy - r * 0.28} r={r * 0.45} fill="rgba(255,255,255,0.18)" style={{ pointerEvents: "none" }} />
      )}
      {isTopmost && isSelected && (
        <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#FFE44A" strokeWidth={2.5} />
      )}
    </>
  );
}

// ── Board ────────────────────────────────────────────────────────────────────
export default function Board({ boardState, currentPlayer, legalMoves = [], onMove }) {
  const [selected, setSelected] = useState(null);

  if (!boardState) {
    return (
      <div style={{ padding: "1rem", color: "#888", fontFamily: "sans-serif" }}>
        No board state available.
      </div>
    );
  }

  const { points, bar, off } = boardState;
  const interactive = Boolean(onMove && currentPlayer);

  const legalFromPoints = new Set(legalMoves.map((m) => m[0]));
  const destinations =
    selected !== null
      ? new Set(legalMoves.filter((m) => m[0] === selected).map((m) => m[1]))
      : new Set();

  function handlePointClick(num) {
    if (!interactive) return;
    if (selected === null) {
      if (legalFromPoints.has(num)) setSelected(num);
    } else if (selected === num) {
      setSelected(null);
    } else if (destinations.has(num)) {
      onMove(selected, num);
      setSelected(null);
    } else if (legalFromPoints.has(num)) {
      setSelected(num);
    } else {
      setSelected(null);
    }
  }

  function handleBarClick() {
    if (!interactive) return;
    if (selected === 0) setSelected(null);
    else if (selected === null && legalFromPoints.has(0)) setSelected(0);
  }

  function handleOffClick(player) {
    if (!interactive) return;
    if (selected !== null && player === currentPlayer && destinations.has(25)) {
      onMove(selected, 25);
      setSelected(null);
    }
  }

  // ── Render a point ─────────────────────────────────────────────────────────
  function renderPoint({ num, idx, lx, isTop, ci }) {
    const val    = points[idx];
    const player = val > 0 ? "p1" : val < 0 ? "p2" : null;
    const count  = Math.abs(val);
    const isSelected   = selected === num;
    const isLegalDest  = destinations.has(num);
    const triColor = ci % 2 === 0 ? TRI_A : TRI_B;
    const cx = lx + PW / 2;
    const shown    = Math.min(count, MAX_VIS);
    const overflow = count > MAX_VIS ? count : 0;

    let overlayFill = null;
    if (isSelected)     overlayFill = SEL_OVL;
    else if (isLegalDest) overlayFill = isBlotHit(points, currentPlayer, num) ? DEST_BLOT : DEST_SAFE;

    return (
      <g
        key={num}
        data-testid={`point-${num}`}
        data-legal-destination={isLegalDest ? "true" : undefined}
        onClick={() => handlePointClick(num)}
        style={{ cursor: interactive ? "pointer" : "default" }}
      >
        <polygon points={triPts(lx, isTop)} fill={triColor} />
        {/* Subtle triangle edge */}
        <polygon points={triPts(lx, isTop)} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={0.5} />
        {overlayFill && (
          <polygon points={triPts(lx, isTop)} fill={overlayFill} />
        )}
        {/* Checkers */}
        {player && Array.from({ length: shown }).map((_, i) => (
          <Pip
            key={i}
            player={player}
            cx={cx}
            cy={checkerCY(isTop, i)}
            r={CR}
            isTopmost={i === shown - 1}
            isSelected={isSelected}
          />
        ))}
        {/* Overflow badge */}
        {overflow > 0 && (
          <text
            x={cx}
            y={checkerCY(isTop, shown - 1)}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#fff"
            fontSize={10}
            fontWeight="bold"
            style={{ pointerEvents: "none" }}
          >
            {count}
          </text>
        )}
        {/* Point number */}
        <text
          x={cx}
          y={isTop ? BH - 5 : 5}
          textAnchor="middle"
          dominantBaseline={isTop ? "auto" : "hanging"}
          fill="#5A8060"
          fontSize={8}
          style={{ pointerEvents: "none" }}
        >
          {num}
        </text>
      </g>
    );
  }

  // ── Bar state ───────────────────────────────────────────────────────────────
  const barIsLegalSrc = legalFromPoints.has(0) && selected === null;
  const barSelected   = selected === 0;
  const barCX = BAR_START + BAR_W / 2;

  // ── Off area ────────────────────────────────────────────────────────────────
  const offX     = BOARD_W + OFF_GAP;
  const offCX    = offX + OFF_W / 2;
  const p2StartY = 22;
  const p1StartY = BH / 2 + 22;
  const p1OffLegal = currentPlayer === "p1" && destinations.has(25);
  const p2OffLegal = currentPlayer === "p2" && destinations.has(25);

  function offCheckers(player, count, startY) {
    const fill   = player === "p1" ? P1_FILL : P2_FILL;
    const stroke = player === "p1" ? P1_STR  : P2_STR;
    return Array.from({ length: Math.min(count, 15) }).map((_, i) => (
      <circle
        key={i}
        data-testid={`${player}-checker`}
        cx={offCX}
        cy={startY + i * O_STEP}
        r={OCR}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
      />
    ));
  }

  return (
    <div style={{
      display: "inline-block",
      borderRadius: 10,
      overflow: "hidden",
      boxShadow: "0 10px 48px rgba(0,0,0,0.75), 0 2px 10px rgba(0,0,0,0.5)",
      border: `10px solid ${FRAME_COL}`,
      background: FRAME_COL,
      maxWidth: "100%",
    }}>
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        style={{ display: "block", width: "100%", maxWidth: SVG_W, height: "auto" }}
      >
        {/* ── Felt ──────────────────────────────────────────────────────── */}
        <rect x={0} y={0} width={BAR_START} height={BH} fill={FELT} />
        <rect x={BAR_END} y={0} width={HALF_W} height={BH} fill={FELT_HOME} />

        {/* ── Off tray ──────────────────────────────────────────────────── */}
        <rect x={offX - 2} y={0} width={OFF_W + 4} height={BH} fill={OFF_BG} rx={4} />
        <line x1={offX - 2} y1={BH / 2} x2={offX + OFF_W + 2} y2={BH / 2} stroke="#3A2010" strokeWidth={1} />

        {/* ── 24 points ─────────────────────────────────────────────────── */}
        {POINT_DEFS.map(renderPoint)}

        {/* ── Centre dividers ───────────────────────────────────────────── */}
        <line x1={0}       y1={BH / 2} x2={BAR_START} y2={BH / 2} stroke="rgba(0,0,0,0.18)" strokeWidth={1.5} />
        <line x1={BAR_END} y1={BH / 2} x2={BOARD_W}   y2={BH / 2} stroke="rgba(0,0,0,0.18)" strokeWidth={1.5} />

        {/* ── Bar ───────────────────────────────────────────────────────── */}
        <g
          data-testid="bar"
          data-legal-destination={(barIsLegalSrc || barSelected) ? "true" : undefined}
          onClick={handleBarClick}
          style={{ cursor: interactive ? "pointer" : "default" }}
        >
          <rect x={BAR_START} y={0} width={BAR_W} height={BH} fill={BAR_FILL} />
          {/* Centre spine */}
          <line x1={barCX} y1={16} x2={barCX} y2={BH - 16} stroke="#4A2A14" strokeWidth={1} />
          {barIsLegalSrc && (
            <rect x={BAR_START} y={0} width={BAR_W} height={BH} fill={DEST_SAFE} />
          )}
          {barSelected && (
            <rect x={BAR_START} y={0} width={BAR_W} height={BH} fill={SEL_OVL} />
          )}
          {/* P2 checkers — top half */}
          {Array.from({ length: Math.min(bar.p2, 6) }).map((_, i) => {
            const cy = BH / 2 - 28 - i * C_STEP;
            return (
              <g key={`p2b${i}`}>
                <circle data-testid="p2-checker" cx={barCX} cy={cy} r={CR - 1} fill={P2_FILL} stroke={P2_STR} strokeWidth={2} />
                <circle cx={barCX} cy={cy} r={CR - 6} fill="none" stroke={P2_STR} strokeWidth={1} opacity={0.4} />
              </g>
            );
          })}
          {/* P1 checkers — bottom half */}
          {Array.from({ length: Math.min(bar.p1, 6) }).map((_, i) => {
            const cy = BH / 2 + 28 + i * C_STEP;
            return (
              <g key={`p1b${i}`}>
                <circle data-testid="p1-checker" cx={barCX} cy={cy} r={CR - 1} fill={P1_FILL} stroke={P1_STR} strokeWidth={2} />
                <circle cx={barCX} cy={cy} r={CR - 6} fill="none" stroke={P1_STR} strokeWidth={1} opacity={0.4} />
              </g>
            );
          })}
          {bar.p1 === 0 && bar.p2 === 0 && (
            <text
              x={barCX} y={BH / 2}
              textAnchor="middle" dominantBaseline="central"
              fill="#4A2A14" fontSize={7} fontWeight="bold" letterSpacing={2}
              style={{ pointerEvents: "none" }}
            >
              BAR
            </text>
          )}
        </g>

        {/* ── Off — P2 (top) ────────────────────────────────────────────── */}
        <g
          data-testid="off-p2"
          data-legal-destination={p2OffLegal ? "true" : undefined}
          onClick={() => handleOffClick("p2")}
          style={{ cursor: interactive ? "pointer" : "default" }}
        >
          <rect x={offX} y={0} width={OFF_W} height={BH / 2 - 2} fill={p2OffLegal ? "rgba(55,210,85,0.18)" : "transparent"} rx={3} />
          <text x={offCX} y={8} textAnchor="middle" dominantBaseline="hanging" fill="#4A6050" fontSize={7} fontWeight="bold" style={{ pointerEvents: "none" }}>
            OFF
          </text>
          {offCheckers("p2", off.p2, p2StartY)}
          {off.p2 > 0 && (
            <text x={offCX} y={BH / 2 - 10} textAnchor="middle" fill="#8A9A88" fontSize={9} style={{ pointerEvents: "none" }}>
              {off.p2}
            </text>
          )}
        </g>

        {/* ── Off — P1 (bottom) ─────────────────────────────────────────── */}
        <g
          data-testid="off-p1"
          data-legal-destination={p1OffLegal ? "true" : undefined}
          onClick={() => handleOffClick("p1")}
          style={{ cursor: interactive ? "pointer" : "default" }}
        >
          <rect x={offX} y={BH / 2 + 2} width={OFF_W} height={BH / 2 - 2} fill={p1OffLegal ? "rgba(55,210,85,0.18)" : "transparent"} rx={3} />
          <text x={offCX} y={BH / 2 + 8} textAnchor="middle" dominantBaseline="hanging" fill="#4A6050" fontSize={7} fontWeight="bold" style={{ pointerEvents: "none" }}>
            OFF
          </text>
          {offCheckers("p1", off.p1, p1StartY)}
          {off.p1 > 0 && (
            <text x={offCX} y={BH - 10} textAnchor="middle" fill="#8A9A88" fontSize={9} style={{ pointerEvents: "none" }}>
              {off.p1}
            </text>
          )}
        </g>
      </svg>
    </div>
  );
}
