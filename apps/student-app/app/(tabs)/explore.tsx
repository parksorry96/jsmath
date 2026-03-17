import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { Camera, Search as SearchIcon } from "lucide-react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "@/lib/theme";
import { useProblems } from "@/hooks/useProblems";
import { LatexText } from "@/components/math/latex-text";

export default function ExploreScreen() {
  const params = useLocalSearchParams<{ search?: string | string[] }>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const router = useRouter();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isTablet = width > 768;
  const hPad = isTablet ? 32 : 16;
  const { data, isLoading } = useProblems({ search: search || undefined, page });

  useEffect(() => {
    const rawSearch = Array.isArray(params.search)
      ? params.search[0]
      : params.search;

    if (typeof rawSearch === "string") {
      setSearch(rawSearch);
      setPage(1);
    }
  }, [params.search]);

  const difficultyColor = (d: number) => {
    if (d <= 2) return colors.success;
    if (d <= 3) return colors.accent;
    return colors.destructive;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={isTablet ? { maxWidth: 800, alignSelf: "center", width: "100%" } : undefined}>
        {/* Camera button */}
        <Pressable
          onPress={() => router.push("/camera")}
          style={{
            flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
            backgroundColor: colors.accent, marginHorizontal: hPad, marginTop: hPad, marginBottom: 8,
            borderRadius: 16, paddingVertical: 14,
          }}
        >
          <Camera color="#fff" size={20} />
          <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>문제 촬영하기</Text>
        </Pressable>

        {/* Search bar */}
        <View style={{
          flexDirection: "row", alignItems: "center", backgroundColor: colors.surface,
          marginHorizontal: hPad, borderRadius: 12, paddingHorizontal: 14, marginBottom: 12,
        }}>
          <SearchIcon color={colors.textMuted} size={18} />
          <TextInput
            value={search}
            onChangeText={(t) => { setSearch(t); setPage(1); }}
            placeholder="문제 검색..."
            placeholderTextColor={colors.textMuted}
            style={{ flex: 1, paddingVertical: 12, paddingLeft: 8, color: colors.textPrimary, fontSize: 15 }}
          />
        </View>
      </View>

      {/* Problem list */}
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: hPad, gap: 10, paddingBottom: 20, ...(isTablet && { maxWidth: 800, alignSelf: "center", width: "100%" }) }}
        ListEmptyComponent={
          <View style={{ paddingVertical: 48, alignItems: "center" }}>
            {isLoading ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={{ color: colors.textMuted, fontSize: 14 }}>
                {search ? "검색 결과가 없습니다" : "표시할 문제가 없습니다"}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/problem/${item.id}`)}
            style={{
              backgroundColor: colors.card, borderRadius: 14, padding: 16,
              borderWidth: 1, borderColor: colors.border,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 13, color: colors.textMuted }}>{item.subject} · {item.unitMajor}</Text>
              <View style={{ backgroundColor: difficultyColor(item.difficulty), borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>난이도 {item.difficulty}</Text>
              </View>
            </View>
            <View style={{ marginTop: 8 }}>
              <LatexText style={{ fontSize: 14, lineHeight: 20 }}>
                {item.stemText || item.stemLatex?.slice(0, 80) || ""}
              </LatexText>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}
