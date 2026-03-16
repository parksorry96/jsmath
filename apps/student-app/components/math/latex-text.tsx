import { useMemo } from "react";
import { Text, View, type TextStyle } from "react-native";
import MathView from "react-native-math-view";
import { useTheme } from "@/lib/theme";

interface LatexTextProps {
  children: string;
  style?: TextStyle;
}

/**
 * Renders a string that may contain inline LaTeX ($...$) and display LaTeX ($$...$$).
 * Plain text segments render as Text; math segments render via MathView (MathJax SVG fallback on iOS).
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
              <MathViewSafe math={seg.content} color={colors.textPrimary} />
            </View>
          );
        }
        // inline math
        return <MathViewSafe key={i} math={seg.content} color={colors.textPrimary} />;
      })}
    </View>
  );
}

/**
 * Wraps MathView in a try/catch boundary.
 * If MathJax/SVG rendering fails, falls back to raw LaTeX text.
 */
function MathViewSafe({ math, color }: { math: string; color: string }) {
  try {
    return <MathView math={`\\(${math}\\)`} color={color} resizeMode="contain" />;
  } catch {
    return (
      <Text style={{ color, fontSize: 14, fontStyle: "italic" }}>{math}</Text>
    );
  }
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
      if (displayIdx > 0) {
        segments.push({ type: "text", content: remaining.slice(0, displayIdx) });
      }
      const endIdx = remaining.indexOf("$$", displayIdx + 2);
      if (endIdx === -1) {
        segments.push({ type: "text", content: remaining.slice(displayIdx) });
        break;
      }
      segments.push({ type: "display", content: remaining.slice(displayIdx + 2, endIdx) });
      remaining = remaining.slice(endIdx + 2);
    } else if (inlineIdx !== -1) {
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
      segments.push({ type: "text", content: remaining });
      break;
    }
  }

  return segments.filter((s) => s.content.length > 0);
}
