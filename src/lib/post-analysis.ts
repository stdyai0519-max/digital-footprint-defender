import type { Visibility } from "./analyze";

export type ConsentChoice = "confirmed" | "pending" | "remove";

export interface AudienceGuidance {
  scope: Visibility;
  explanation: string;
}

export interface PostSignals {
  mentions: string[];
  faceCount: number;
  thirdPartyDetected: boolean;
  hasCrossMediaConnection: boolean;
}

export const AUDIENCE_GUIDANCE: AudienceGuidance[] = [
  {
    scope: "public",
    explanation: "불특정 다수가 볼 수 있어 학교·동선·타인 정보 수정을 검토하세요.",
  },
  {
    scope: "friends",
    explanation: "작성자를 아는 사람이 배경정보와 연결할 수 있어 얼굴과 일정 확인이 필요합니다.",
  },
  {
    scope: "group",
    explanation: "구성원이 캡처하거나 재공유할 가능성을 고려하세요.",
  },
  {
    scope: "dm",
    explanation: "수신자는 제한되지만 재전달될 수 있어 민감정보는 최소화하세요.",
  },
];

export function extractMentions(text: string): string[] {
  return Array.from(new Set(text.match(/@[A-Za-z0-9._-]+/g) ?? []));
}

export function derivePostSignals(input: {
  text: string;
  hasImage: boolean;
  categories: string[];
  categoryCounts: Record<string, number>;
}): PostSignals {
  const mentions = extractMentions(input.text);
  const faceCount = input.categoryCounts["얼굴"] ?? 0;
  const thirdPartyDetected =
    mentions.length > 0 ||
    faceCount >= 2 ||
    input.categories.some((category) => ["명찰·신분증", "연락처"].includes(category));

  return {
    mentions,
    faceCount,
    thirdPartyDetected,
    hasCrossMediaConnection:
      Boolean(input.text.trim()) &&
      input.hasImage &&
      (mentions.length > 0 || input.categories.length > 0),
  };
}
