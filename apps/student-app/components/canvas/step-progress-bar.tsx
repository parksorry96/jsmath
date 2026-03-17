import { Text, View } from 'react-native';
import { MotiView } from 'moti';
import { Check } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { DEFAULT_STEP_LABELS } from '@/constants/canvas';

interface StepProgressBarProps {
  currentStep: number;
  totalSteps: number;
}

export function StepProgressBar({ currentStep, totalSteps }: StepProgressBarProps) {
  const { colors } = useTheme();

  const labels =
    totalSteps === 4
      ? DEFAULT_STEP_LABELS
      : Array.from({ length: totalSteps }, (_, i) => `${i + 1}단계`);

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, gap: 4 }}
    >
      {labels.map((label, index) => {
        const stepNum = index + 1;
        const isCompleted = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;
        const isPending = stepNum > currentStep;

        return (
          <View key={stepNum} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MotiView
              animate={{ scale: isCurrent ? 1.1 : 1, opacity: isPending ? 0.4 : 1 }}
              transition={{ scale: { type: 'timing', duration: 600, loop: isCurrent } }}
              style={{
                width: 22, height: 22, borderRadius: 11,
                backgroundColor: isCompleted || isCurrent ? colors.accent : colors.surface,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              {isCompleted ? (
                <Check color="#fff" size={12} strokeWidth={3} />
              ) : (
                <Text style={{ fontSize: 10, fontWeight: '700', color: isCurrent ? '#fff' : colors.textMuted }}>
                  {stepNum}
                </Text>
              )}
            </MotiView>
            <Text
              style={{ fontSize: 11, fontWeight: isCurrent ? '700' : '400', color: isPending ? colors.textMuted : colors.textPrimary }}
              numberOfLines={1}
            >
              {label}
            </Text>
            {index < labels.length - 1 ? (
              <View style={{ flex: 1, height: 1, backgroundColor: isCompleted ? colors.accent : colors.border, marginHorizontal: 2 }} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
