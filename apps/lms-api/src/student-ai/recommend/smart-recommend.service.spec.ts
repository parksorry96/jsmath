import { SmartRecommendService } from "./smart-recommend.service";

describe("SmartRecommendService", () => {
  let service: SmartRecommendService;

  beforeEach(() => {
    service = new SmartRecommendService(null as any);
  });

  describe("selectDifficulty", () => {
    it("returns [1,2] for accuracy below 40%", () => {
      expect(service.selectDifficulty(0.0)).toEqual([1, 2]);
      expect(service.selectDifficulty(0.2)).toEqual([1, 2]);
      expect(service.selectDifficulty(0.39)).toEqual([1, 2]);
    });

    it("returns [2,3] for accuracy 40-70%", () => {
      expect(service.selectDifficulty(0.4)).toEqual([2, 3]);
      expect(service.selectDifficulty(0.5)).toEqual([2, 3]);
      expect(service.selectDifficulty(0.7)).toEqual([2, 3]);
    });

    it("returns [3,4] for accuracy above 70%", () => {
      expect(service.selectDifficulty(0.71)).toEqual([3, 4]);
      expect(service.selectDifficulty(0.9)).toEqual([3, 4]);
      expect(service.selectDifficulty(1.0)).toEqual([3, 4]);
    });
  });

  describe("mergeAndRank", () => {
    it("deduplicates by problemId keeping highest priority", () => {
      const items = [
        { problemId: "p1", priority: 3, reason: "review", reasonDetail: "d", difficulty: 2 },
        { problemId: "p1", priority: 1, reason: "basic", reasonDetail: "d", difficulty: 1 },
        { problemId: "p2", priority: 2, reason: "mistake", reasonDetail: "d", difficulty: 2 },
      ];

      const result = service.mergeAndRank(items, 10);

      expect(result).toHaveLength(2);
      const p1 = result.find((r) => r.problemId === "p1");
      expect(p1!.priority).toBe(1);
      expect(p1!.reason).toBe("basic");
    });

    it("sorts by priority ascending", () => {
      const items = [
        { problemId: "p3", priority: 4, reason: "expansion", reasonDetail: "d", difficulty: 3 },
        { problemId: "p1", priority: 1, reason: "basic", reasonDetail: "d", difficulty: 1 },
        { problemId: "p2", priority: 2, reason: "mistake", reasonDetail: "d", difficulty: 2 },
      ];

      const result = service.mergeAndRank(items, 10);

      expect(result[0].priority).toBe(1);
      expect(result[1].priority).toBe(2);
      expect(result[2].priority).toBe(4);
    });

    it("limits to maxCount", () => {
      const items = [
        { problemId: "p1", priority: 1, reason: "a", reasonDetail: "d", difficulty: 1 },
        { problemId: "p2", priority: 2, reason: "b", reasonDetail: "d", difficulty: 2 },
        { problemId: "p3", priority: 3, reason: "c", reasonDetail: "d", difficulty: 3 },
        { problemId: "p4", priority: 4, reason: "d", reasonDetail: "d", difficulty: 4 },
      ];

      const result = service.mergeAndRank(items, 2);

      expect(result).toHaveLength(2);
      expect(result[0].problemId).toBe("p1");
      expect(result[1].problemId).toBe("p2");
    });
  });

  describe("filterCommonMistakes", () => {
    it("returns problems matching the target error type", () => {
      const problems = [
        { id: "p1", commonMistakes: [{ type: "sign_error" }, { type: "formula_error" }] },
        { id: "p2", commonMistakes: [{ type: "calculation_error" }] },
        { id: "p3", commonMistakes: [{ type: "sign_error" }] },
      ];

      const result = service.filterCommonMistakes(problems, "sign_error");

      expect(result).toHaveLength(2);
      expect(result.map((p) => p.id)).toEqual(["p1", "p3"]);
    });

    it("returns empty array when no matches", () => {
      const problems = [
        { id: "p1", commonMistakes: [{ type: "sign_error" }] },
      ];

      const result = service.filterCommonMistakes(problems, "logic_error");

      expect(result).toHaveLength(0);
    });

    it("skips problems with null or non-array commonMistakes", () => {
      const problems = [
        { id: "p1", commonMistakes: null },
        { id: "p2", commonMistakes: "not_an_array" },
        { id: "p3", commonMistakes: [{ type: "sign_error" }] },
      ];

      const result = service.filterCommonMistakes(problems, "sign_error");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("p3");
    });
  });
});
