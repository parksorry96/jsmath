import { Text } from "react-native";

interface MathFragmentProps {
  math: string;
  color: string;
  inline: boolean;
}

export function MathFragment({ math, color, inline }: MathFragmentProps) {
  return (
    <Text
      style={{
        color,
        fontSize: inline ? 15 : 16,
        lineHeight: inline ? 24 : 28,
        fontStyle: "italic",
      }}
    >
      {math}
    </Text>
  );
}
