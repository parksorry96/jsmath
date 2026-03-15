"use client";

import { useMemo } from "react";
import { ImageIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

interface ProblemSourceAsset {
  id: string;
  kind: string;
  s3Key: string;
}

interface ProblemSourcePreviewProps {
  assets?: ProblemSourceAsset[] | null;
}

const ASSET_LABELS: Record<string, string> = {
  problem_crop: "문항 원본",
  page_image: "페이지 원본",
};

export function ProblemSourcePreview({
  assets,
}: ProblemSourcePreviewProps) {
  const previewAssets = useMemo(() => {
    if (!assets?.length) {
      return [];
    }

    const preferredKinds = ["problem_crop", "page_image"];
    const preferredAssets = preferredKinds
      .map((kind) => assets.find((asset) => asset.kind === kind))
      .filter((asset): asset is ProblemSourceAsset => Boolean(asset));

    return preferredAssets.length > 0 ? preferredAssets : assets.slice(0, 2);
  }, [assets]);

  const assetUrlsQuery = useQuery({
    queryKey: [
      "problem-source-assets",
      previewAssets.map((asset) => asset.s3Key).join("|"),
    ],
    queryFn: async () => {
      const results = await Promise.all(
        previewAssets.map(async (asset) => {
          try {
            const { url } = await api.get<{ url: string }>(
              `/files/assets/url?key=${encodeURIComponent(asset.s3Key)}`,
            );
            return { ...asset, url };
          } catch {
            return null;
          }
        }),
      );

      return results.filter(
        (
          asset,
        ): asset is ProblemSourceAsset & {
          url: string;
        } => Boolean(asset?.url),
      );
    },
    enabled: previewAssets.length > 0,
    staleTime: 300_000,
  });

  if (previewAssets.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ImageIcon className="h-4 w-4 text-brand-beige" />
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          원본 이미지
        </p>
      </div>

      {assetUrlsQuery.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {previewAssets.map((asset) => (
            <Skeleton key={asset.id} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : assetUrlsQuery.data && assetUrlsQuery.data.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {assetUrlsQuery.data.map((asset) => (
            <div
              key={asset.id}
              className="overflow-hidden rounded-xl border border-border bg-brand-dark"
            >
              <div className="border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
                {ASSET_LABELS[asset.kind] ?? asset.kind}
              </div>
              <img
                src={asset.url}
                alt={ASSET_LABELS[asset.kind] ?? "문제 원본"}
                className="h-auto max-h-[32rem] w-full object-contain bg-black/20"
                loading="lazy"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-brand-dark/50 px-4 py-6 text-sm text-muted-foreground">
          원본 이미지를 불러오지 못했습니다.
        </div>
      )}
    </div>
  );
}
