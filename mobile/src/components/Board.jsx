import React, { useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import Svg, { Rect, Polygon, Circle, Line, Text as SvgText } from "react-native-svg";
import { colors } from "../theme";
import { isBlotHit } from "../game/logic";

// ── Geometry (shared with web Board.jsx) ────────────────────────────────────
const PW = 58;
const BH = 500;
const TH = 198;
const BAR_W = 40;
const HALF_W = PW * 6;          // 348
const BAR_START = HALF_W;       // 348
const BAR_END = HALF_W + BAR_W; // 388
const BOARD_W = HALF_W * 2 + BAR_W; // 736
const OFF_GAP = 10;
const OFF_W = 54;
const VIEW_W = BOARD_W + OFF_GAP + OFF_W; // 800
const VIEW_H = BH;

const TOP_APEX_Y = TH;
const BOT_APEX_Y = BH - TH;

const CR = 17;
const C_STEP = 37;
const MAX_VIS = 5;
const TOP_CY0 = CR + 6;
const BOT_CY0 = BH - CR - 6;

const OCR = 7;
const O_STEP = 14;

// Point layout: { num, idx, lx, isTop, ci }
const POINT_DEFS = [
  ...Array.from({ length: 6 }, (_, p) => ({ num: 13 + p, idx: 12 + p, lx: p * PW,           isTop: true,  ci: p })),
  ...Array.from({ length: 6 }, (_, p) => ({ num: 19 + p, idx: 18 + p, lx: BAR_END + p * PW, isTop: true,  ci: p })),
  ...Array.from({ length: 6 }, (_, p) => ({ num: 12 - p, idx: 11 - p, lx: p * PW,           isTop: false, ci: p })),
  ...Array.from({ length: 6 }, (_, p) => ({ num: 6 - p,  idx: 5 - p,  lx: BAR_END + p * PW, isTop: false, ci: p })),
];

function triPts(lx, isTop) {
  return isTop
    ? `${lx},0 ${lx + PW},0 ${lx + PW / 2},${TOP_APEX_Y}`
    : `${lx},${BH} ${lx + PW},${BH} ${lx + PW / 2},${BOT_APEX_Y}`;
}

function checkerCY(isTop, i) {
  return isTop ? TOP_CY0 + i * C_STEP : BOT_CY0 - i * C_STEP;
}

// ── Checker (SVG) ────────────────────────────────────────────────────────────
function Pip({ player, cx, cy, r, ring = true, highlight }) {
  const fill = player === "p1" ? colors.p1Fill : colors.p2Fill;
  const stroke = player === "p1" ? colors.p1Stroke : colors.p2Stroke;
  return (
    <>
      <Circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={2.5} />
      {ring && (
        <Circle cx={cx} cy={cy} r={r - 5} fill="none" stroke={stroke} strokeWidth={1} opacity={0.45} />
      )}
      {player === "p1" && (
        <Circle cx={cx} cy={cy - r * 0.28} r={r * 0.45} fill="rgba(255,255,255,0.18)" />
      )}
      {highlight && (
        <Circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#FFE44A" strokeWidth={2.5} />
      )}
    </>
  );
}

export default function Board({ boardState, currentPlayer, legalMoves = [], onMove, interactive: interactiveProp }) {
  const [selected, setSelected] = useState(null);
  const [width, setWidth] = useState(0);

  if (!boardState) return null;

  const { points, bar, off } = boardState;
  const interactive = (interactiveProp ?? true) && Boolean(onMove && currentPlayer);

  const scale = width > 0 ? width / VIEW_W : 0;
  const height = VIEW_H * scale;

  const legalFromPoints = new Set(legalMoves.map((m) => m[0]));
  const destinations =
    selected !== null
      ? new Set(legalMoves.filter((m) => m[0] === selected).map((m) => m[1]))
      : new Set();

  function handlePointPress(num) {
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

  function handleBarPress() {
    if (!interactive) return;
    if (selected === 0) setSelected(null);
    else if (selected === null && legalFromPoints.has(0)) setSelected(0);
  }

  function handleOffPress(player) {
    if (!interactive) return;
    if (selected !== null && player === currentPlayer && destinations.has(25)) {
      onMove(selected, 25);
      setSelected(null);
    }
  }

  // ── Overlay touch zones (scaled px) ────────────────────────────────────────
  const zones = [];
  if (scale > 0) {
    POINT_DEFS.forEach(({ num, lx, isTop }) => {
      zones.push({
        key: `pt-${num}`,
        onPress: () => handlePointPress(num),
        style: {
          left: lx * scale,
          top: (isTop ? 0 : BH / 2) * scale,
          width: PW * scale,
          height: (BH / 2) * scale,
        },
      });
    });
    zones.push({
      key: "bar",
      onPress: handleBarPress,
      style: { left: BAR_START * scale, top: 0, width: BAR_W * scale, height: BH * scale },
    });
    const offX = BOARD_W + OFF_GAP;
    zones.push({
      key: "off-p2",
      onPress: () => handleOffPress("p2"),
      style: { left: offX * scale, top: 0, width: OFF_W * scale, height: (BH / 2) * scale },
    });
    zones.push({
      key: "off-p1",
      onPress: () => handleOffPress("p1"),
      style: { left: offX * scale, top: (BH / 2) * scale, width: OFF_W * scale, height: (BH / 2) * scale },
    });
  }

  const barIsLegalSrc = legalFromPoints.has(0) && selected === null;
  const barSelected = selected === 0;
  const barCX = BAR_START + BAR_W / 2;
  const offX = BOARD_W + OFF_GAP;
  const offCX = offX + OFF_W / 2;
  const p1OffLegal = currentPlayer === "p1" && destinations.has(25);
  const p2OffLegal = currentPlayer === "p2" && destinations.has(25);

  return (
    <View style={styles.frame} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <View style={{ width, height }}>
          <Svg width={width} height={height} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
            {/* Felt */}
            <Rect x={0} y={0} width={BAR_START} height={BH} fill={colors.felt} />
            <Rect x={BAR_END} y={0} width={HALF_W} height={BH} fill={colors.feltHome} />

            {/* Off tray */}
            <Rect x={offX - 2} y={0} width={OFF_W + 4} height={BH} fill={colors.offBg} rx={4} />
            <Line x1={offX - 2} y1={BH / 2} x2={offX + OFF_W + 2} y2={BH / 2} stroke="#3A2010" strokeWidth={1} />

            {/* Points */}
            {POINT_DEFS.map(({ num, idx, lx, isTop, ci }) => {
              const val = points[idx];
              const player = val > 0 ? "p1" : val < 0 ? "p2" : null;
              const count = Math.abs(val);
              const isSelected = selected === num;
              const isDest = destinations.has(num);
              const triColor = ci % 2 === 0 ? colors.triA : colors.triB;
              const cx = lx + PW / 2;
              const shown = Math.min(count, MAX_VIS);
              const overflow = count > MAX_VIS;

              let overlay = null;
              if (isSelected) overlay = colors.selOverlay;
              else if (isDest) overlay = isBlotHit(boardState, currentPlayer, num) ? colors.destBlot : colors.destSafe;

              return (
                <React.Fragment key={num}>
                  <Polygon points={triPts(lx, isTop)} fill={triColor} />
                  <Polygon points={triPts(lx, isTop)} fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth={0.5} />
                  {overlay && <Polygon points={triPts(lx, isTop)} fill={overlay} />}
                  {player &&
                    Array.from({ length: shown }).map((_, i) => (
                      <Pip
                        key={i}
                        player={player}
                        cx={cx}
                        cy={checkerCY(isTop, i)}
                        r={CR}
                        highlight={isSelected && i === shown - 1}
                      />
                    ))}
                  {overflow && (
                    <SvgText x={cx} y={checkerCY(isTop, shown - 1)} fill="#fff" fontSize={11} fontWeight="bold" textAnchor="middle" alignmentBaseline="central">
                      {count}
                    </SvgText>
                  )}
                  <SvgText x={cx} y={isTop ? BH - 6 : 12} fill="#5A8060" fontSize={9} textAnchor="middle">
                    {num}
                  </SvgText>
                </React.Fragment>
              );
            })}

            {/* Centre dividers */}
            <Line x1={0} y1={BH / 2} x2={BAR_START} y2={BH / 2} stroke="rgba(0,0,0,0.18)" strokeWidth={1.5} />
            <Line x1={BAR_END} y1={BH / 2} x2={BOARD_W} y2={BH / 2} stroke="rgba(0,0,0,0.18)" strokeWidth={1.5} />

            {/* Bar */}
            <Rect x={BAR_START} y={0} width={BAR_W} height={BH} fill={colors.barFill} />
            <Line x1={barCX} y1={16} x2={barCX} y2={BH - 16} stroke="#4A2A14" strokeWidth={1} />
            {barIsLegalSrc && <Rect x={BAR_START} y={0} width={BAR_W} height={BH} fill={colors.destSafe} />}
            {barSelected && <Rect x={BAR_START} y={0} width={BAR_W} height={BH} fill={colors.selOverlay} />}
            {Array.from({ length: Math.min(bar.p2, 6) }).map((_, i) => (
              <Pip key={`p2b${i}`} player="p2" cx={barCX} cy={BH / 2 - 28 - i * C_STEP} r={CR - 1} />
            ))}
            {Array.from({ length: Math.min(bar.p1, 6) }).map((_, i) => (
              <Pip key={`p1b${i}`} player="p1" cx={barCX} cy={BH / 2 + 28 + i * C_STEP} r={CR - 1} />
            ))}
            {bar.p1 === 0 && bar.p2 === 0 && (
              <SvgText x={barCX} y={BH / 2} fill="#4A2A14" fontSize={8} fontWeight="bold" textAnchor="middle" alignmentBaseline="central">
                BAR
              </SvgText>
            )}

            {/* Off — P2 (top) */}
            {p2OffLegal && <Rect x={offX} y={0} width={OFF_W} height={BH / 2 - 2} fill="rgba(55,210,85,0.20)" rx={3} />}
            <SvgText x={offCX} y={14} fill="#4A6050" fontSize={8} fontWeight="bold" textAnchor="middle">OFF</SvgText>
            {Array.from({ length: Math.min(off.p2, 15) }).map((_, i) => (
              <Circle key={`o2${i}`} cx={offCX} cy={22 + i * O_STEP} r={OCR} fill={colors.p2Fill} stroke={colors.p2Stroke} strokeWidth={1.5} />
            ))}
            {off.p2 > 0 && (
              <SvgText x={offCX} y={BH / 2 - 10} fill="#8A9A88" fontSize={10} textAnchor="middle">{off.p2}</SvgText>
            )}

            {/* Off — P1 (bottom) */}
            {p1OffLegal && <Rect x={offX} y={BH / 2 + 2} width={OFF_W} height={BH / 2 - 2} fill="rgba(55,210,85,0.20)" rx={3} />}
            <SvgText x={offCX} y={BH / 2 + 14} fill="#4A6050" fontSize={8} fontWeight="bold" textAnchor="middle">OFF</SvgText>
            {Array.from({ length: Math.min(off.p1, 15) }).map((_, i) => (
              <Circle key={`o1${i}`} cx={offCX} cy={BH / 2 + 22 + i * O_STEP} r={OCR} fill={colors.p1Fill} stroke={colors.p1Stroke} strokeWidth={1.5} />
            ))}
            {off.p1 > 0 && (
              <SvgText x={offCX} y={BH - 10} fill="#8A9A88" fontSize={10} textAnchor="middle">{off.p1}</SvgText>
            )}
          </Svg>

          {/* Transparent touch overlay */}
          {interactive &&
            zones.map((z) => (
              <Pressable key={z.key} onPress={z.onPress} style={[styles.zone, z.style]} />
            ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: 10,
    borderWidth: 8,
    borderColor: colors.frame,
    backgroundColor: colors.frame,
    overflow: "hidden",
  },
  zone: {
    position: "absolute",
  },
});
