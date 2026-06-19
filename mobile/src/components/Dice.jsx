import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Rect, Circle } from "react-native-svg";
import { colors } from "../theme";

const SIZE = 46;
const R_DIE = 6;
const R_PIP = 3.8;

// Pip positions as fractions of die size (0..1), matching the web Dice.jsx.
const PIP_LAYOUT = {
  1: [[0.5, 0.5]],
  2: [[0.72, 0.28], [0.28, 0.72]],
  3: [[0.72, 0.28], [0.5, 0.5], [0.28, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
};

function DieFace({ value, used }) {
  const pips = PIP_LAYOUT[value] || [];
  const bg = used ? colors.dieFaceUsed : colors.dieFace;
  const pipFill = used ? colors.diePipUsed : colors.diePip;
  const border = used ? "#1A1A1A" : colors.dieBorder;

  return (
    <View style={[styles.dieWrap, used && styles.dieUsed]}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Rect x={1} y={1} width={SIZE - 2} height={SIZE - 2} rx={R_DIE} ry={R_DIE} fill={bg} stroke={border} strokeWidth={1.5} />
        {!used && <Rect x={3} y={3} width={SIZE - 6} height={SIZE / 2} rx={R_DIE - 2} ry={R_DIE - 2} fill="rgba(255,255,255,0.18)" />}
        {pips.map(([fx, fy], i) => (
          <Circle key={i} cx={fx * SIZE} cy={fy * SIZE} r={R_PIP} fill={pipFill} />
        ))}
      </Svg>
    </View>
  );
}

// usedCount: dice already consumed this turn are greyed out.
export default function Dice({ diceValues, usedCount = 0 }) {
  if (!diceValues || diceValues.length === 0) {
    return <Text style={styles.empty}>No dice rolled yet.</Text>;
  }
  return (
    <View style={styles.row}>
      {diceValues.map((val, i) => (
        <DieFace key={i} value={val} used={i < usedCount} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, marginVertical: 12, alignItems: "center" },
  dieWrap: { width: SIZE, height: SIZE },
  dieUsed: { opacity: 0.38 },
  empty: { color: colors.textMuted, marginVertical: 12, fontSize: 14 },
});
