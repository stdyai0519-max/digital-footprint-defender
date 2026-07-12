export type ImageAnalysisMode = "original" | "processed";
export type ImageEffect = "blur" | "mosaic" | "black";

export interface ImageAnalysisPlan {
  useProcessedImage: boolean;
  effect: ImageEffect;
  strength: number;
}

export function createImageAnalysisPlan(input: {
  mode: ImageAnalysisMode;
  selectedCount: number;
  effect: ImageEffect;
  strength: number;
}): ImageAnalysisPlan {
  return {
    useProcessedImage: input.mode === "processed" && input.selectedCount > 0,
    effect: input.effect,
    strength: input.strength,
  };
}

export function shouldRefreshLocalDetections(mode: ImageAnalysisMode): boolean {
  return mode === "original";
}

export function getSelectedCandidates<T extends { selected: boolean }>(
  candidates: T[],
): T[] {
  return candidates.filter((candidate) => candidate.selected);
}
