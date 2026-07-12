import { describe, expect, test } from "bun:test";
import { createAiFindingManualCandidate } from "../src/lib/image-finding-selection";

describe("AI image finding manual selection", () => {
  test("keeps the finding as the reason and preserves the user-drawn image coordinates", () => {
    const finding = "명찰에 이름이 노출될 수 있습니다.";
    const box = { x: 128, y: 64, width: 220, height: 72 };

    expect(
      createAiFindingManualCandidate({ id: "manual-1", finding, box }),
    ).toEqual({
      id: "manual-1",
      text: finding,
      category: "AI 사진 분석",
      reason: finding,
      confidence: null,
      box,
      selected: true,
      source: "manual",
    });
  });
});
