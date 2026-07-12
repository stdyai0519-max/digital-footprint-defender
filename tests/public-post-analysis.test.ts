import { describe, expect, test } from "bun:test";
import { PUBLIC_POST_VISIBILITY } from "../src/lib/analyze";

describe("public post analysis", () => {
  test("uses public visibility as the only frontend analysis mode", () => {
    expect(PUBLIC_POST_VISIBILITY).toBe("public");
  });
});
