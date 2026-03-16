import { useMemo } from "react";
import { Text, View, type TextStyle } from "react-native";
import MathView, { MathText } from "react-native-math-view";
import { useTheme } from "@/lib/theme";

interface LatexTextProps {
  children: string;
  style?: TextStyle;
}

/**
 * Renders a string that may contain inline LaTeX ($...$) and display LaTeX ($$...$$).
 * Plain text is rendered as Text, math segments as MathView.
 */
export function LatexText({ children, style }: LatexTextProps) {
  const { colors } = useTheme();

  const segments = useMemo(() => {
    if (!children) return [];
    return parseLatex(children);
  }, [children]);

  if (segments.length === 0) return null;

  // If only plain text, render simple Text
  if (segments.every((s) => s.type === "text")) {
    return (
      <Text style={[{ color: colors.textPrimary, fontSize: 15, lineHeight: 24 }, style]}>
        {children}
      </Text>
    );
  }

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return (
            <Text key={i} style={[{ color: colors.textPrimary, fontSize: 15, lineHeight: 24 }, style]}>
              {seg.content}
            </Text>
          );
        }
        if (seg.type === "display") {
          return (
            <View key={i} style={{ width: "100%", alignItems: "center", marginVertical: 8 }}>
              <MathView
                math={seg.content}
                style={{ color: colors.textPrimary }}
              />
            </View>
          );
        }
        // inline math
        return (
          <MathView
            key={i}
            math={seg.content}
            style={{ color: colors.textPrimary }}
          />
        );
      })}
    </View>
  );
}

interface Segment {
  type: "text" | "inline" | "display";
  content: string;
}

function parseLatex(input: string): Segment[] {
  const segments: Segment[] = [];
  let remaining = input;

  while (remaining.length > 0) {
    // Check for display math $$...$$
    const displayIdx = remaining.indexOf("$$");
    // Check for inline math $...$
    const inlineIdx = remaining.indexOf("$");

    if (displayIdx !== -1 && (displayIdx <= inlineIdx || inlineIdx === -1)) {
      // Text before $$
      if (displayIdx > 0) {
        segments.push({ type: "text", content: remaining.slice(0, displayIdx) });
      }
      const endIdx = remaining.indexOf("$$", displayIdx + 2);
      if (endIdx === -1) {
        // No closing $$, treat rest as text
        segments.push({ type: "text", content: remaining.slice(displayIdx) });
        break;
      }
      segments.push({ type: "display", content: remaining.slice(displayIdx + 2, endIdx) });
      remaining = remaining.slice(endIdx + 2);
    } else if (inlineIdx !== -1) {
      // Text before $
      if (inlineIdx > 0) {
        segments.push({ type: "text", content: remaining.slice(0, inlineIdx) });
      }
      const endIdx = remaining.indexOf("$", inlineIdx + 1);
      if (endIdx === -1) {
        segments.push({ type: "text", content: remaining.slice(inlineIdx) });
        break;
      }
      segments.push({ type: "inline", content: remaining.slice(inlineIdx + 1, endIdx) });
      remaining = remaining.slice(endIdx + 1);
    } else {
      // No more math
      segments.push({ type: "text", content: remaining });
      break;
    }
  }

  return segments.filter((s) => s.content.length > 0);
}
