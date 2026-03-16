import { View, Text } from "react-native";
import { Bot } from "lucide-react-native";
import { useTheme } from "@/lib/theme";

interface ChatBubbleProps {
  role: "student" | "tutor";
  content: string;
}

export function ChatBubble({ role, content }: ChatBubbleProps) {
  const { colors } = useTheme();
  const isStudent = role === "student";

  return (
    <View style={{
      flexDirection: "row",
      justifyContent: isStudent ? "flex-end" : "flex-start",
      marginBottom: 12, paddingHorizontal: 16,
    }}>
      {!isStudent && (
        <View style={{
          width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent,
          alignItems: "center", justifyContent: "center", marginRight: 8, marginTop: 4,
        }}>
          <Bot color="#fff" size={16} />
        </View>
      )}
      <View style={{
        maxWidth: "75%",
        backgroundColor: isStudent ? colors.accent : colors.surface,
        borderRadius: 16,
        borderTopLeftRadius: isStudent ? 16 : 4,
        borderTopRightRadius: isStudent ? 4 : 16,
        padding: 14,
      }}>
        <Text style={{
          fontSize: 15, lineHeight: 22,
          color: isStudent ? "#fff" : colors.textPrimary,
        }}>
          {content}
        </Text>
      </View>
    </View>
  );
}
