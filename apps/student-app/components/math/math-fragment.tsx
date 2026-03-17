import { Text } from "react-native";
import MathView from "react-native-math-view";

interface MathFragmentProps {
  math: string;
  color: string;
  inline: boolean;
}

function normalizeMathForMobile(math: string, inline: boolean): string {
  const normalized = math
    .replace(/\\begin\{tabular\}/g, "\\begin{array}")
    .replace(/\\end\{tabular\}/g, "\\end{array}")
    .replace(/\\begin\{align\*?\}/g, "\\begin{aligned}")
    .replace(/\\end\{align\*?\}/g, "\\end{aligned}")
    .replace(/\\begin\{gather\*?\}/g, "\\begin{gathered}")
    .replace(/\\end\{gather\*?\}/g, "\\end{gathered}")
    .trim();

  return normalized;
}

export function MathFragment({ math, color, inline }: MathFragmentProps) {
  try {
    const normalizedMath = normalizeMathForMobile(math, inline);
    return (
      <MathView
        math={normalizedMath}
        color={color}
        resizeMode={inline ? "cover" : "contain"}
        style={inline ? { alignSelf: "center" } : undefined}
        config={{ inline, displayAlign: inline ? "auto" : "center" }}
      />
    );
  } catch {
    return <Text style={{ color, fontSize: 14, fontStyle: "italic" }}>{math}</Text>;
  }
}
