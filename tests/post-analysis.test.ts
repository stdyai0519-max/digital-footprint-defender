import { describe, expect, test } from "bun:test";
import { derivePostSignals, extractMentions } from "../src/lib/post-analysis";

describe("post analysis helpers", () => {
  test("extracts unique account mentions", () => {
    expect(extractMentions("@minsu와 @jisu, 다시 @minsu")).toEqual(["@minsu", "@jisu"]);
  });

  test("flags two manually marked faces as third-party information", () => {
    expect(
      derivePostSignals({
        text: "",
        hasImage: true,
        categories: ["얼굴"],
        categoryCounts: { 얼굴: 2 },
      }).thirdPartyDetected,
    ).toBe(true);
  });

  test("creates a cross-media signal only when text and image clues coexist", () => {
    expect(
      derivePostSignals({
        text: "@minsu 오늘 축제 재밌었음",
        hasImage: true,
        categories: ["학교·소속"],
        categoryCounts: { "학교·소속": 1 },
      }).hasCrossMediaConnection,
    ).toBe(true);

    expect(
      derivePostSignals({
        text: "안전한 문장",
        hasImage: false,
        categories: [],
        categoryCounts: {},
      }).hasCrossMediaConnection,
    ).toBe(false);
  });

  test("does not invent a third-party signal for a safe text-only post", () => {
    expect(
      derivePostSignals({
        text: "오늘 축제 정말 즐거웠다. 사진은 친구들에게 따로 보내야지.",
        hasImage: false,
        categories: [],
        categoryCounts: {},
      }).thirdPartyDetected,
    ).toBe(false);
  });
});
