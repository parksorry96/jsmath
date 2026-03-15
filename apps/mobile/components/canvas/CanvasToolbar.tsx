import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

export interface CanvasToolbarProps {
  isEraser: boolean;
  thickness: number;
  onPenToggle: () => void;
  onThicknessChange: (value: number) => void;
  onUndo: () => void;
  onClear: () => void;
  onSend: () => void;
  onCamera: () => void;
}

const THICKNESS_OPTIONS = [2, 4, 6, 8] as const;

export function CanvasToolbar({
  isEraser,
  thickness,
  onPenToggle,
  onThicknessChange,
  onUndo,
  onClear,
  onSend,
  onCamera,
}: CanvasToolbarProps) {
  return (
    <View style={styles.container}>
      {/* Top row: action buttons */}
      <View style={styles.row}>
        <ToolButton
          label={isEraser ? "Eraser" : "Pen"}
          onPress={onPenToggle}
          active={isEraser}
        />
        <ToolButton label="Undo" onPress={onUndo} />
        <ToolButton label="Clear" onPress={onClear} />
        <ToolButton label="Camera" onPress={onCamera} />
        <ToolButton label="Send" onPress={onSend} highlight />
      </View>

      {/* Bottom row: thickness selector */}
      <View style={styles.thicknessRow}>
        <Text style={styles.thicknessLabel}>Thickness</Text>
        {THICKNESS_OPTIONS.map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => onThicknessChange(t)}
            style={[
              styles.thicknessChip,
              thickness === t && styles.thicknessChipActive,
            ]}
          >
            <View
              style={[
                styles.thicknessDot,
                { width: t + 6, height: t + 6 },
                thickness === t && styles.thicknessDotActive,
              ]}
            />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ---------- internal ----------

function ToolButton({
  label,
  onPress,
  active,
  highlight,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  highlight?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.button,
        active && styles.activeButton,
        highlight && styles.highlightButton,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          active && styles.activeText,
          highlight && styles.highlightText,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#f1f5f9",
  },
  activeButton: {
    backgroundColor: "#334155",
  },
  highlightButton: {
    backgroundColor: "#3b82f6",
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
  },
  activeText: {
    color: "#fff",
  },
  highlightText: {
    color: "#fff",
  },
  thicknessRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  thicknessLabel: {
    fontSize: 13,
    color: "#64748b",
    marginRight: 4,
  },
  thicknessChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  thicknessChipActive: {
    backgroundColor: "#dbeafe",
    borderWidth: 2,
    borderColor: "#3b82f6",
  },
  thicknessDot: {
    borderRadius: 999,
    backgroundColor: "#334155",
  },
  thicknessDotActive: {
    backgroundColor: "#3b82f6",
  },
});
