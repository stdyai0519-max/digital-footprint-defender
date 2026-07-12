import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  DEMO_RESULT,
  MAX_INPUT_LENGTH,
  VISIBILITY_LABELS,
  type AnalysisResponse,
  type AnalysisResult,
  type Certainty,
  type DirectExposure,
  type InferredExposure,
  type SafeRewrite,
  type Visibility,
} from "./analyze";

const InputSchema = z.object({
  text: z.string().min(1).max(MAX_INPUT_LENGTH),
  visibility: z.enum(["public", "friends", "group", "dm"]),
});

const GATEWAY_TIMEOUT_MS = 15_000;
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

const ALLOWED_STATUS = new Set([
  "그대로 게시 가능",
  "일부 수정 권장",
  "공개 게시 전 수정 필요",
]);

const SYSTEM_PROMPT = `당신은 청소년 SNS 게시글의 개인정보·디지털 발자국 노출 위험을 분석하는 조력자입니다.
반드시 지켜야 할 원칙:
- 입력 텍스트에 실제로 등장한 표현과 문맥에만 근거해 분석하세요.
- 입력에 없는 주소, 학교, 사람 이름, 신원 등을 새로 추측하지 마세요.
- 범죄 발생이나 피해를 확정적으로 단정하지 마세요. 공포심을 과장하지 마세요.
- 법적 판단이나 절대적인 안전 판정을 내리지 마세요.
- 관련 없는 개인정보 보호 일반론을 길게 늘어놓지 마세요. 게시글에 밀착한 조언만 하세요.
- 위험 점수나 백분율은 절대 사용하지 마세요.
- 원본의 말투와 의미를 최대한 유지하면서 민감 정보만 제거한 안전 수정문을 제시하세요.
- 게시 범위(전체 공개/친구/단체 채팅/개인 메시지)에 따라 위험 해석이 달라진다는 점을 반영하세요.
- 모든 문자열은 한국어로 작성하세요.

응답은 오직 아래 JSON 스키마만 출력합니다. 마크다운, 코드블록, 설명 문장 금지.
{
  "status": "그대로 게시 가능" | "일부 수정 권장" | "공개 게시 전 수정 필요",
  "summary": string,
  "direct_exposures": [{ "text": string, "category": string, "reason": string, "certainty": "명확함" | "문맥상 가능" | "확인 필요" }],
  "inferred_exposures": [{ "inference": string, "used_clues": string[], "reason": string }],
  "priority_actions": string[],
  "safe_rewrites": [
    { "style": "최소 수정", "text": string },
    { "style": "안전 우선", "text": string }
  ],
  "uncertainty": string
}`;

function buildUserPrompt(text: string, visibility: Visibility) {
  return `[게시 범위] ${VISIBILITY_LABELS[visibility]}
[게시글]
${text}

위 게시글을 분석해 지정된 JSON 스키마만 출력하세요.`;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function coerceDirectExposures(value: unknown): DirectExposure[] {
  if (!Array.isArray(value)) return [];
  const out: DirectExposure[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (
      typeof o.text !== "string" ||
      typeof o.category !== "string" ||
      typeof o.reason !== "string"
    )
      continue;
    const certainty: Certainty | undefined =
      o.certainty === "명확함" || o.certainty === "문맥상 가능" || o.certainty === "확인 필요"
        ? (o.certainty as Certainty)
        : undefined;
    out.push({ text: o.text, category: o.category, reason: o.reason, certainty });
  }
  return out;
}

function coerceInferred(value: unknown): InferredExposure[] {
  if (!Array.isArray(value)) return [];
  const out: InferredExposure[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.inference !== "string" || typeof o.reason !== "string") continue;
    out.push({
      inference: o.inference,
      used_clues: coerceStringArray(o.used_clues),
      reason: o.reason,
    });
  }
  return out;
}

function coerceRewrites(value: unknown): SafeRewrite[] {
  if (!Array.isArray(value)) return [];
  const out: SafeRewrite[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.style !== "string" || typeof o.text !== "string") continue;
    out.push({ style: o.style, text: o.text });
  }
  return out;
}

function parseAnalysis(raw: string): AnalysisResult | null {
  let text = raw.trim();
  // strip accidental code fences
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  // extract first {...} block if extra content around it
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const jsonSlice = text.slice(first, last + 1);
  let obj: unknown;
  try {
    obj = JSON.parse(jsonSlice);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const status = typeof o.status === "string" && ALLOWED_STATUS.has(o.status) ? o.status : null;
  const summary = typeof o.summary === "string" ? o.summary : null;
  if (!status || !summary) return null;
  return {
    status,
    summary,
    direct_exposures: coerceDirectExposures(o.direct_exposures),
    inferred_exposures: coerceInferred(o.inferred_exposures),
    priority_actions: coerceStringArray(o.priority_actions),
    safe_rewrites: coerceRewrites(o.safe_rewrites),
    uncertainty: typeof o.uncertainty === "string" ? o.uncertainty : "",
  };
}

async function callGateway(
  apiKey: string,
  text: string,
  visibility: Visibility,
): Promise<string> {
  const model = process.env.LOVABLE_MODEL?.trim() || DEFAULT_MODEL;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(text, visibility) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const status = res.status;
    throw new Error(`gateway_${status}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) throw new Error("empty_response");
  return content;
}

export const analyzeFootprint = createServerFn({ method: "POST" })
  .validator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<AnalysisResponse> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return {
        source: "demo",
        result: DEMO_RESULT,
        notice: "AI 분석 키가 설정되지 않아 데모 결과를 표시합니다.",
      };
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await callGateway(apiKey, data.text, data.visibility);
        const parsed = parseAnalysis(raw);
        if (parsed) return { source: "ai", result: parsed };
      } catch (err) {
        // Log without leaking user content.
        console.error(
          "analyzeFootprint attempt failed:",
          err instanceof Error ? err.message : "unknown_error",
        );
      }
    }

    return {
      source: "demo",
      result: DEMO_RESULT,
      notice: "AI 분석을 사용할 수 없어 데모 결과를 표시합니다.",
    };
  });
