import { useMemo } from "react";
import { Text, View, type TextStyle } from "react-native";
import { MathFragment } from "@/components/math/math-fragment";
import { useTheme } from "@/lib/theme";

interface LatexTextProps {
  children: string;
  style?: TextStyle;
}

interface Segment {
  type: "text" | "inline" | "display";
  content: string;
}

const LATEX_SEGMENT_PATTERN =
  /\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\$([^\n$]+?)\$/g;
const DISPLAY_MATH_ENVIRONMENT_PATTERN =
  /\\begin\{(?:array|aligned|alignedat|gathered|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|cases|subarray|split)\}/;

function tokenizeTextForInlineLayout(text: string): Array<
  | { type: "text"; content: string }
  | { type: "line-break" }
> {
  const tokens: Array<{ type: "text"; content: string } | { type: "line-break" }> = [];
  const lines = text.split("\n");

  lines.forEach((line, lineIndex) => {
    const lineTokens = line.match(/\S+\s*|\s+/g) ?? (line ? [line] : []);
    lineTokens.forEach((token) => {
      if (token.length > 0) {
        tokens.push({ type: "text", content: token });
      }
    });

    if (lineIndex < lines.length - 1) {
      tokens.push({ type: "line-break" });
    }
  });

  return tokens;
}

/**
 * Renders a string that may contain inline LaTeX ($...$, \(...\))
 * and display LaTeX ($$...$$, \[...\]).
 */
export function LatexText({ children, style }: LatexTextProps) {
  const { colors } = useTheme();

  const segments = useMemo(() => {
    if (!children) return [];
    return parseLatex(children);
  }, [children]);

  if (segments.length === 0) return null;

  if (segments.every((segment) => segment.type === "text")) {
    return (
      <Text style={[{ color: colors.textPrimary, fontSize: 15, lineHeight: 24 }, style]}>
        {children}
      </Text>
    );
  }

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return tokenizeTextForInlineLayout(segment.content).map((token, tokenIndex) => {
            if (token.type === "line-break") {
              return <View key={`${index}-br-${tokenIndex}`} style={{ width: "100%", height: 0 }} />;
            }

            return (
              <Text
                key={`${index}-text-${tokenIndex}`}
                style={[{ color: colors.textPrimary, fontSize: 15, lineHeight: 24 }, style]}
              >
                {token.content}
              </Text>
            );
          });
        }

        if (segment.type === "display") {
          return (
            <View
              key={index}
              style={{ width: "100%", alignItems: "center", marginVertical: 8 }}
            >
              <MathFragment
                math={segment.content}
                color={colors.textPrimary}
                inline={false}
              />
            </View>
          );
        }

        return (
          <View
            key={index}
            style={{ alignSelf: "center", justifyContent: "center", marginHorizontal: 1 }}
          >
            <MathFragment
              math={segment.content}
              color={colors.textPrimary}
              inline
            />
          </View>
        );
      })}
    </View>
  );
}

function parseLatex(input: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = LATEX_SEGMENT_PATTERN.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: input.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined || match[2] !== undefined) {
      segments.push({
        type: "display",
        content: String(match[1] ?? match[2]).trim(),
      });
    } else if (match[3] !== undefined || match[4] !== undefined) {
      const content = String(match[3] ?? match[4]).trim();
      segments.push({
        type:
          DISPLAY_MATH_ENVIRONMENT_PATTERN.test(content) || /\\\\/.test(content)
            ? "display"
            : "inline",
        content,
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < input.length) {
    segments.push({ type: "text", content: input.slice(lastIndex) });
  }

  return segments.filter((segment) => segment.content.length > 0);
}
