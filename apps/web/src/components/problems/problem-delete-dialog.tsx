"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/lib/api";

interface ProblemDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  problemIds: string[];
  onSuccess: () => void;
}

export function ProblemDeleteDialog({
  open,
  onOpenChange,
  problemIds,
  onSuccess,
}: ProblemDeleteDialogProps) {
  const queryClient = useQueryClient();
  const isBulk = problemIds.length > 1;

  const mutation = useMutation({
    mutationFn: async () => {
      if (problemIds.length === 1) {
        await api.post(`/problems/${problemIds[0]}/retire`);
      } else {
        await api.post("/problems/batch-retire", { ids: problemIds });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["problems"] });
      onSuccess();
      toast.success("문제가 삭제되었습니다.");
    },
    onError: () => {
      toast.error("삭제 중 오류가 발생했습니다.");
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isBulk
              ? `선택한 ${problemIds.length}개 문제를 삭제(보관)하시겠습니까?`
              : "이 문제를 삭제(보관)하시겠습니까?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            삭제된 문제는 목록에서 숨겨지며, 기존 과제나 제출 기록에는 영향이
            없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>
            취소
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {mutation.isPending ? "삭제 중..." : "삭제"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
