import { Pressable, Text, View } from 'react-native';
import { MotiView } from 'moti';
import { Bot, Eye, Hand } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';

type ActivityState = 'writing' | 'paused' | 'idle' | 'struggling';

interface AiStatusIndicatorProps {
  activityState: ActivityState;
  isAnalyzing: boolean;
  isStreaming: boolean;
  hasUnread: boolean;
  nudgeMessage?: string | null;
  onPress: () => void;
}

export function AiStatusIndicator({
  activityState,
  isAnalyzing,
  isStreaming,
  hasUnread,
  nudgeMessage,
  onPress,
}: AiStatusIndicatorProps) {
  const { colors } = useTheme();

  const isWriting = activityState === 'writing';
  const isStruggling = activityState === 'struggling';

  function getIcon() {
    if (isWriting) return <Eye color={colors.textMuted} size={18} />;
    if (isStruggling) return <Hand color={colors.accent} size={18} />;
    return <Bot color={isAnalyzing || isStreaming ? colors.accent : colors.textSecondary} size={18} />;
  }

  function getLabelColor() {
    if (isAnalyzing || isStreaming) return colors.accent;
    if (isWriting) return colors.textMuted;
    if (isStruggling) return colors.accent;
    return colors.textPrimary;
  }

  function getLabel() {
    if (isStreaming) return 'AI 응답 중...';
    if (isAnalyzing) return '분석 중...';
    if (isWriting) return '관찰 중';
    if (isStruggling) return nudgeMessage ?? '도움이 필요하신가요?';
    return 'AI 피드백';
  }

  return (
    <Pressable onPress={onPress}>
      <MotiView
        animate={{
          opacity: isWriting ? 0.5 : 1,
          scale: isAnalyzing ? 1.05 : 1,
        }}
        transition={{
          opacity: { type: 'timing', duration: 2000, loop: isWriting },
          scale: { type: 'timing', duration: 300, loop: isAnalyzing },
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: colors.card,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 14,
          paddingVertical: 12,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
      >
        {getIcon()}
        <Text style={{ fontSize: 13, fontWeight: '700', color: getLabelColor() }}>
          {getLabel()}
        </Text>
        {hasUnread ? (
          <View
            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }}
          />
        ) : null}
      </MotiView>
    </Pressable>
  );
}
