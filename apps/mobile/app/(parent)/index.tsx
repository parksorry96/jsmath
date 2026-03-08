import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { api } from "@/lib/api";

interface Child {
  id: string;
  name: string;
  className: string;
  nextLesson?: { date: string; time: string };
  pendingAssignments: number;
  latestScore?: number;
}

export default function ParentHome() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [inviteCode, setInviteCode] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const {
    data: children,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<Child[]>({
    queryKey: ["parent-children"],
    queryFn: () => api.get("/parent-links/children"),
  });

  const linkMutation = useMutation({
    mutationFn: (code: string) =>
      api.post("/parent-links/link", { inviteCode: code }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["parent-children"] });
      setInviteCode("");
      setShowAddForm(false);
    },
    onError: (err: Error) => {
      Alert.alert("연결 실패", err.message || "초대 코드를 확인해주세요.");
    },
  });

  function handleLink() {
    const trimmed = inviteCode.trim();
    if (!trimmed) return;
    linkMutation.mutate(trimmed);
  }

  function renderLinkForm() {
    return (
      <View className="bg-[#2a2a2a] rounded-xl p-6 mx-4 mt-4">
        <Text className="text-brand-beige text-lg font-bold mb-2">
          자녀를 등록해주세요
        </Text>
        <Text className="text-gray-400 text-sm mb-4">
          선생님에게 받은 초대 코드를 입력하세요
        </Text>
        <TextInput
          className="bg-[#333] text-brand-beige rounded-lg px-4 py-3 text-base mb-3"
          placeholder="초대 코드 입력"
          placeholderTextColor="#666"
          value={inviteCode}
          onChangeText={setInviteCode}
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
        />
        <TouchableOpacity
          className={`rounded-lg py-3 items-center ${
            inviteCode.trim() ? "bg-brand-accent" : "bg-[#444]"
          }`}
          onPress={handleLink}
          disabled={!inviteCode.trim() || linkMutation.isPending}
        >
          {linkMutation.isPending ? (
            <ActivityIndicator color="#1a1a1a" />
          ) : (
            <Text
              className={`font-bold text-base ${
                inviteCode.trim() ? "text-brand-dark" : "text-gray-500"
              }`}
            >
              연결하기
            </Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  function renderChildCard({ item }: { item: Child }) {
    return (
      <TouchableOpacity
        className="bg-[#2a2a2a] rounded-xl p-4 mx-4 mb-3"
        onPress={() => router.push(`/(parent)/children/${item.id}`)}
        activeOpacity={0.7}
      >
        <Text className="text-brand-beige text-lg font-bold">{item.name}</Text>
        <Text className="text-gray-400 text-sm mb-3">{item.className}</Text>

        <View className="flex-row justify-between">
          <View className="items-center flex-1">
            <Text className="text-gray-400 text-xs">다음 수업</Text>
            <Text className="text-brand-beige text-sm mt-1">
              {item.nextLesson
                ? `${item.nextLesson.date} ${item.nextLesson.time}`
                : "—"}
            </Text>
          </View>
          <View className="items-center flex-1">
            <Text className="text-gray-400 text-xs">미완료 과제</Text>
            <Text className="text-brand-accent text-lg font-bold mt-1">
              {item.pendingAssignments}
            </Text>
          </View>
          <View className="items-center flex-1">
            <Text className="text-gray-400 text-xs">최근 점수</Text>
            <Text className="text-brand-beige text-lg font-bold mt-1">
              {item.latestScore != null ? `${item.latestScore}점` : "—"}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-brand-dark items-center justify-center">
        <ActivityIndicator size="large" color="#d4a574" />
      </SafeAreaView>
    );
  }

  const hasChildren = children && children.length > 0;

  return (
    <SafeAreaView className="flex-1 bg-brand-dark" edges={["bottom"]}>
      <FlatList
        data={children ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderChildCard}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#d4a574"
          />
        }
        ListHeaderComponent={
          !hasChildren ? renderLinkForm() : null
        }
        ListEmptyComponent={
          hasChildren === false ? null : (
            <View className="items-center mt-8">
              <Text className="text-gray-500">등록된 자녀가 없습니다</Text>
            </View>
          )
        }
        ListFooterComponent={
          hasChildren ? (
            <View className="mx-4 mt-2">
              {showAddForm ? (
                renderLinkForm()
              ) : (
                <TouchableOpacity
                  className="bg-[#2a2a2a] rounded-xl py-3 items-center"
                  onPress={() => setShowAddForm(true)}
                >
                  <Text className="text-brand-accent font-bold">+ 자녀 추가</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
