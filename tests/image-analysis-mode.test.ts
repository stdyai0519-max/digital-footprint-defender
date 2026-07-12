import { describe, expect, test } from "bun:test";
import {
  createImageAnalysisPlan,
  getSelectedCandidates,
  shouldRefreshLocalDetections,
} from "../src/lib/image-analysis-mode";

describe("image analysis mode", () => {
  test("uses the original path for the first analysis", () => {
    expect(
      createImageAnalysisPlan({
        mode: "original",
        selectedCount: 2,
        effect: "blur",
        strength: 12,
      }).useProcessedImage,
    ).toBe(false);
  });

  test("uses renderProcessed inputs when a processed image has selected regions", () => {
    expect(
      createImageAnalysisPlan({
        mode: "processed",
        selectedCount: 2,
        effect: "mosaic",
        strength: 24,
      }),
    ).toEqual({ useProcessedImage: true, effect: "mosaic", strength: 24 });
  });

  test("falls back to the original path when no region is selected", () => {
    expect(
      createImageAnalysisPlan({
        mode: "processed",
        selectedCount: 0,
        effect: "black",
        strength: 10,
      }).useProcessedImage,
    ).toBe(false);
  });

  test("does not refresh OCR and native detections during a processed recheck", () => {
    expect(shouldRefreshLocalDetections("original")).toBe(true);
    expect(shouldRefreshLocalDetections("processed")).toBe(false);
  });

  test("passes only selected candidates to image masking", () => {
    expect(
      getSelectedCandidates([
        { id: "selected", selected: true },
        { id: "ignored", selected: false },
      ]),
    ).toEqual([{ id: "selected", selected: true }]);
  });
});
