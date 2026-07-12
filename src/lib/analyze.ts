// Types and demo fallback data for the Footprint Guard analyzer.
// The real analysis runs in the `analyzeFootprint` server function
// (see src/lib/analyze.functions.ts). This module stays client-safe.

export type Visibility = "public" | "friends" | "group" | "dm";

export type Certainty = "명확함" | "문맥상 가능" | "확인 필요";

export interface DirectExposure {
  text: string;
  category: string;
  reason: string;
  certainty?: Certainty;
}

export interface InferredExposure {
  inference: string;
  used_clues: string[];
  reason: string;
}

export interface SafeRewrite {
  style: string;
  text: string;
}

export type AnalysisStatus =
  | "그대로 게시 가능"
  | "일부 수정 권장"
  | "공개 게시 전 수정 필요";

export interface AnalysisResult {
  status: AnalysisStatus | string;
  summary: string;
  direct_exposures: DirectExposure[];
  inferred_exposures: InferredExposure[];
  priority_actions: string[];
  safe_rewrites: SafeRewrite[];
  image_findings: string[];
  uncertainty: string;
}

export type AnalysisSource = "ai" | "demo";

export interface AnalysisResponse {
  source: AnalysisSource;
  result: AnalysisResult;
  notice?: string;
}

export const EXAMPLE_POST =
  "오늘 저녁 7시에 가상고 정문에서 만나자. 끝나고 혼자 10번 버스 타고 집에 갈 거야. 부모님은 밤 11시까지 안 계셔.";

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: "전체 공개",
  friends: "친구 공개",
  group: "단체 채팅",
  dm: "개인 메시지",
};

export const MAX_INPUT_LENGTH = 1500;

export const DEMO_RESULT: AnalysisResult = {
  status: "공개 게시 전 수정 필요",
  summary:
    "학교, 시간, 이동 경로와 가족 일정이 함께 노출되어 사용자의 당일 동선과 생활 패턴을 추정할 수 있습니다.",
  direct_exposures: [
    {
      text: "가상고 정문",
      category: "학교·위치",
      reason: "소속과 활동 장소가 드러날 수 있습니다.",
      certainty: "명확함",
    },
    {
      text: "오늘 저녁 7시",
      category: "시간",
      reason: "특정 시점의 위치를 추정할 수 있습니다.",
      certainty: "명확함",
    },
    {
      text: "10번 버스",
      category: "이동 경로",
      reason: "사용자의 귀가 경로를 추정할 수 있습니다.",
      certainty: "문맥상 가능",
    },
    {
      text: "부모님은 밤 11시까지 안 계셔",
      category: "가족·주거 일정",
      reason: "보호자가 없는 시간대가 공개됩니다.",
      certainty: "명확함",
    },
  ],
  inferred_exposures: [
    {
      inference: "사용자의 학교, 당일 귀가 시간과 이동 경로",
      used_clues: ["가상고 정문", "저녁 7시", "10번 버스"],
      reason:
        "개별적으로는 평범한 정보도 함께 공개되면 특정 시간의 생활 동선을 추정할 수 있습니다.",
    },
  ],
  priority_actions: [
    "학교명과 정확한 장소를 공개 게시글에서 제거하세요.",
    "구체적인 시간과 이동 경로는 개인 메시지로 공유하세요.",
    "가족 일정과 집이 비는 시간은 공개하지 마세요.",
  ],
  safe_rewrites: [
    {
      style: "최소 수정",
      text: "오늘 축제 끝나고 같이 갈 사람? 자세한 장소랑 시간은 디엠으로 얘기하자.",
    },
    {
      style: "안전 우선",
      text: "오늘 행사 끝나고 같이 갈 사람 있으면 개인 메시지 줘!",
    },
  ],
  image_findings: [],
  uncertainty:
    "실제 위험은 계정 공개 범위, 게시 대상과 주변 상황에 따라 달라질 수 있습니다. 이 서비스는 개인정보 노출 위험을 확정하는 도구가 아니라 게시 전 확인을 돕는 교육용 보조 도구입니다.",
};
