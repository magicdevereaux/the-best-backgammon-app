import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Svg, { Rect, Circle, Text as SvgText } from "react-native-svg";
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
  const pips = PIP_LAYOUT[value];
  const bg = used ? colors.dieFaceUsed : colors.dieFace;
  const pipFill = used ? colors.diePipUsed : colors.diePip;
  const border = used ? colors.dieBorderUsed : colors.dieBorder;

  return (
    <View style={[styles.dieWrap, used && styles.dieUsed]}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Rect x={1} y={1} width={SIZE - 2} height={SIZE - 2} rx={R_DIE} ry={R_DIE} fill={bg} stroke={border} strokeWidth={1.5} />
        {!used && <Rect x={3} y={3} width={SIZE - 6} height={SIZE / 2} rx={R_DIE - 2} ry={R_DIE - 2} fill="rgba(255,255,255,0.18)" />}
        {pips ? (
          pips.map(([fx, fy], i) => (
            <Circle key={i} cx={fx * SIZE} cy={fy * SIZE} r={R_PIP} fill={pipFill} />
          ))
        ) : (
          <SvgText
            x={SIZE / 2}
            y={SIZE / 2 + 1}
            fontSize={22}
            fontWeight="bold"
            fill={colors.goldDark}
            textAnchor="middle"
            alignmentBaseline="central"
          >
            ?
          </SvgText>
        )}
      </Svg>
    </View>
  );
}

/**
 * Dice display with three states:
 *   - canRoll:        a tappable "Tap to roll" prompt (two ? dice).
 *   - rolled.length:  every rolled die, with consumed dice greyed out. Which
 *                     specific dice are "used" is the multiset difference of the
 *                     original roll minus the dice still remaining — so for a
 *                     [3,5] roll where the 3 was played, the 3 greys (not the 5),
 *                     and doubles grey one face per move.
 *   - otherwise:      "No dice rolled yet."
 */
export default function Dice({ rolled = [], remaining = [], canRoll = false, onRoll }) {
  if (canRoll) {
    return (
      <Pressable onPress={onRoll} style={styles.rollPrompt} accessibilityRole="button">
        <DieFace value="?" />
        <DieFace value="?" />
        <Text style={styles.rollLabel}>Tap to roll</Text>
      </Pressable>
    );
  }

  if (!rolled || rolled.length === 0) {
    return <Text style={styles.empty}>No dice rolled yet.</Text>;
  }

  // Walk the original roll; a die is "remaining" (bright) the first time we see
  // it in the remaining multiset, otherwise it's been used (greyed).
  const rem = [...remaining];
  return (
    <View style={styles.row}>
      {rolled.map((val, i) => {
        const idx = rem.indexOf(val);
        let used;
        if (idx >= 0) {
          rem.splice(idx, 1);
          used = false;
        } else {
          used = true;
        }
        return <DieFace key={i} value={val} used={used} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, marginVertical: 12, alignItems: "center" },
  rollPrompt: { flexDirection: "row", gap: 8, marginVertical: 12, alignItems: "center" },
  rollLabel: { color: colors.gold, fontSize: 15, fontWeight: "700", marginLeft: 6, letterSpacing: 0.3 },
  dieWrap: { width: SIZE, height: SIZE },
  dieUsed: { opacity: 0.38 },
  empty: { color: colors.textMuted, marginVertical: 12, fontSize: 14 },
});
