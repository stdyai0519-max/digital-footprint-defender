export interface ImageSelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AiFindingManualCandidate {
  id: string;
  text: string;
  category: "AI 사진 분석";
  reason: string;
  confidence: null;
  box: ImageSelectionBox;
  selected: true;
  source: "manual";
}

export function shortFindingLabel(finding: string): string {
  const compact = finding.replace(/\s+/g, " ").trim();
  return compact.length > 42 ? `${compact.slice(0, 39)}...` : compact;
}

export function createAiFindingManualCandidate(input: {
  id: string;
  finding: string;
  box: ImageSelectionBox;
}): AiFindingManualCandidate {
  return {
    id: input.id,
    text: shortFindingLabel(input.finding),
    category: "AI 사진 분석",
    reason: input.finding,
    confidence: null,
    box: input.box,
    selected: true,
    source: "manual",
  };
}
