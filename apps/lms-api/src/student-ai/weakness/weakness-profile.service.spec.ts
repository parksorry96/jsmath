import { WeaknessProfileService } from "./weakness-profile.service";

describe("WeaknessProfileService", () => {
  let service: WeaknessProfileService;

  beforeEach(() => {
    // Instantiate with null deps — only testing pure logic methods
    service = new WeaknessProfileService(
      null as any,
      null as any,
      null as any,
    );
  });

  describe("mapErrorType", () => {
    it("maps sign_error to careless_mistake", () => {
      expect(service.mapErrorType("sign_error")).toBe("careless_mistake");
    });

    it("maps transcription_error to careless_mistake", () => {
      expect(service.mapErrorType("transcription_error")).toBe(
        "careless_mistake",
      );
    });

    it("maps formula_error to concept_gap", () => {
      expect(service.mapErrorType("formula_error")).toBe("concept_gap");
    });

    it("maps concept_error to concept_gap", () => {
      expect(service.mapErrorType("concept_error")).toBe("concept_gap");
    });

    it("maps logic_error to pattern_gap", () => {
      expect(service.mapErrorType("logic_error")).toBe("pattern_gap");
    });

    it("maps calculation_error to calculation_error", () => {
      expect(service.mapErrorType("calculation_error")).toBe(
        "calculation_error",
      );
    });

    it("returns input unchanged for unknown types", () => {
      expect(service.mapErrorType("concept_gap")).toBe("concept_gap");
      expect(service.mapErrorType("unknown_type")).toBe("unknown_type");
    });
  });

  describe("aggregateErrorPatterns", () => {
    it("counts error types from wrong answers", () => {
      const wrongAnswers = [
        { errorType: "concept_gap" },
        { errorType: "concept_gap" },
        { errorType: "calculation_error" },
        { errorType: "careless_mistake" },
        { errorType: "pattern_gap" },
        { errorType: "pattern_gap" },
        { errorType: "pattern_gap" },
      ];

      const result = service.aggregateErrorPatterns(wrongAnswers);

      expect(result).toEqual({
        concept_gap: 2,
        calculation_error: 1,
        careless_mistake: 1,
        pattern_gap: 3,
      });
    });

    it("returns zeros for empty input", () => {
      const result = service.aggregateErrorPatterns([]);

      expect(result).toEqual({
        concept_gap: 0,
        calculation_error: 0,
        careless_mistake: 0,
        pattern_gap: 0,
      });
    });

    it("maps fine-grained types to canonical types", () => {
      const wrongAnswers = [
        { errorType: "sign_error" },
        { errorType: "formula_error" },
        { errorType: "logic_error" },
      ];

      const result = service.aggregateErrorPatterns(wrongAnswers);

      expect(result).toEqual({
        concept_gap: 1,
        calculation_error: 0,
        careless_mistake: 1,
        pattern_gap: 1,
      });
    });
  });

  describe("computeUnitAccuracy", () => {
    it("groups by unit and computes accuracy", () => {
      const answers = [
        { isCorrect: true, subject: "math1", unitMajor: "algebra" },
        { isCorrect: false, subject: "math1", unitMajor: "algebra" },
        { isCorrect: true, subject: "math1", unitMajor: "algebra" },
        { isCorrect: true, subject: "math2", unitMajor: "calculus" },
        { isCorrect: false, subject: "math2", unitMajor: "calculus" },
      ];

      const result = service.computeUnitAccuracy(answers);

      expect(result).toHaveLength(2);

      const algebra = result.find((r) => r.unitMajor === "algebra");
      expect(algebra).toBeDefined();
      expect(algebra!.subject).toBe("math1");
      expect(algebra!.accuracy).toBeCloseTo(2 / 3);
      expect(algebra!.attemptCount).toBe(3);

      const calculus = result.find((r) => r.unitMajor === "calculus");
      expect(calculus).toBeDefined();
      expect(calculus!.subject).toBe("math2");
      expect(calculus!.accuracy).toBeCloseTo(1 / 2);
      expect(calculus!.attemptCount).toBe(2);
    });

    it("skips answers with null problem or missing subject/unitMajor", () => {
      const answers = [
        { isCorrect: true, subject: null, unitMajor: null },
        { isCorrect: true, subject: null, unitMajor: "algebra" },
        { isCorrect: true, subject: "math1", unitMajor: null },
        { isCorrect: true, subject: "math1", unitMajor: "algebra" },
      ];

      const result = service.computeUnitAccuracy(answers);

      expect(result).toHaveLength(1);
      expect(result[0].attemptCount).toBe(1);
    });

    it("skips answers with null isCorrect", () => {
      const answers = [
        { isCorrect: null, subject: "math1", unitMajor: "algebra" },
        { isCorrect: true, subject: "math1", unitMajor: "algebra" },
      ];

      const result = service.computeUnitAccuracy(answers);

      expect(result).toHaveLength(1);
      expect(result[0].attemptCount).toBe(1);
      expect(result[0].accuracy).toBe(1);
    });

    it("returns empty array for empty input", () => {
      const result = service.computeUnitAccuracy([]);
      expect(result).toEqual([]);
    });
  });

  describe("mergeTutorSignalsIntoUnitAccuracies", () => {
    it("creates a weak unit entry from tutor-only signals", () => {
      const result = service.mergeTutorSignalsIntoUnitAccuracies([], [
        {
          source: "worked_solution",
          problemId: "p1",
          curriculumNodeId: "node-1",
          subject: "math1",
          unitMajor: "algebra",
          errorType: "concept_gap",
          confidence: 0.8,
          evidence: "concept issue",
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          subject: "math1",
          unitMajor: "algebra",
          topErrorType: "concept_gap",
        }),
      );
      expect(result[0].attemptCount).toBeGreaterThan(0);
      expect(result[0].accuracy).toBeLessThan(0.5);
    });

    it("blends tutor signals into existing unit accuracy", () => {
      const result = service.mergeTutorSignalsIntoUnitAccuracies(
        [
          {
            subject: "math1",
            unitMajor: "algebra",
            accuracy: 0.75,
            attemptCount: 4,
            topErrorType: null,
          },
        ],
        [
          {
            source: "tutor_message",
            problemId: "p1",
            curriculumNodeId: "node-1",
            subject: "math1",
            unitMajor: "algebra",
            errorType: "pattern_gap",
            confidence: 0.6,
            evidence: "pattern issue",
          },
        ],
      );

      expect(result).toHaveLength(1);
      expect(result[0].attemptCount).toBe(5);
      expect(result[0].accuracy).toBeLessThan(0.75);
      expect(result[0].topErrorType).toBe("pattern_gap");
    });
  });
});
