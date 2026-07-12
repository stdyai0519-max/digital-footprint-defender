import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  DEMO_RESULT,
  MAX_INPUT_LENGTH,
  type AnalysisResponse,
  type AnalysisResult,
  type Certainty,
  type DirectExposure,
  type InferredExposure,
  type SafeRewrite,
} from "./analyze";

const InputSchema = z
  .object({
    text: z.string().max(MAX_INPUT_LENGTH).default(""),
    visibility: z.enum(["public", "friends", "group", "dm"]),
    // data:image/...;base64,... — supplied by the browser after downscaling
    image: z
      .string()
      .startsWith("data:image/")
      .max(3_500_000)
      .optional(),
  })
  .refine((v) => v.text.trim().length > 0 || !!v.image, {
    message: "text or image required",
  });

const GATEWAY_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

const ALLOWED_STATUS = new Set([
  "그대로 게시 가능",
  "일부 수정 권장",
  "공개 게시 전 수정 필요",
]);

const SYSTEM_PROMPT = `당신은 청소년 SNS 게시글의 개인정보·디지털 발자국 노출 위험을 분석하는 조력자입니다.
반드시 지켜야 할 원칙:
- 입력 텍스트와 첨부 이미지에 실제로 등장한 표현·시각적 요소에만 근거해 분석하세요.
- 입력에 없는 주소, 학교, 사람 이름, 신원 등을 새로 추측하거나 단정하지 마세요.
- 사진 속 실제 인물의 신원, 정확한 주소나 학교명을 추측하지 마세요. "○○ 학교 로고로 추정" 정도로 완곡히 표현하세요.
- 범죄 발생이나 피해를 확정적으로 단정하지 마세요. 공포심을 과장하지 마세요.
- 법적 판단이나 절대적인 안전 판정을 내리지 마세요.
- 관련 없는 개인정보 보호 일반론을 길게 늘어놓지 마세요. 게시글·사진에 밀착한 조언만 하세요.
- 위험 점수나 백분율은 절대 사용하지 마세요.
- 원본의 말투와 의미를 최대한 유지하면서 민감 정보만 제거한 안전 수정문을 제시하세요.
- 모든 분석은 SNS 공개 게시물을 기준으로 해석하세요.
- 모든 문자열은 한국어로 작성하세요.

이미지가 제공되면 다음 항목의 노출 가능성을 확인하세요:
전화번호/이메일/주소/차량번호, 명찰·학생증·학교·회사·학원명과 로고, 택배 송장·영수증·승차권·예약 정보,
SNS 계정과 QR 코드, 얼굴과 타인의 정보, 도로 표지판·건물·집 내부·창밖 풍경 등 위치 추론 단서,
그리고 게시글과 사진을 함께 봤을 때 연결되는 단서.

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
  "image_findings": string[],
  "uncertainty": string
}

image_findings에는 사진에서 발견한 개인정보 노출 가능성을 항목별로 한국어 문장으로 나열하세요.
사진이 제공되지 않았거나 특이 사항이 없으면 빈 배열을 반환합니다.
게시글이 비어 있고 이미지만 있는 경우에도 사진만 근거로 status, summary, direct_exposures(사진 속 텍스트),
image_findings 등을 채워 응답하세요. safe_rewrites는 없으면 빈 배열로 두어도 됩니다.`;

function buildUserText(text: string, hasImage: boolean) {
  const body = text.trim() ? text : "(게시글 없음 — 사진만 제공됨)";
  const extra = hasImage ? "\n[첨부 이미지가 함께 제공됩니다. 이미지 속 시각적 단서도 함께 분석하세요.]" : "";
  return `[분석 기준] SNS 공개 게시물
[게시글]
${body}${extra}

위 게시글${hasImage ? "과 첨부 이미지를" : "을"} 분석해 지정된 JSON 스키마만 출력하세요.`;
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
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
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
    image_findings: coerceStringArray(o.image_findings),
    uncertainty: typeof o.uncertainty === "string" ? o.uncertainty : "",
  };
}

async function callGateway(
  apiKey: string,
  text: string,
  image: string | undefined,
): Promise<string> {
  const model = process.env.LOVABLE_MODEL?.trim() || DEFAULT_MODEL;
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text: buildUserText(text, !!image) }];
  if (image) userContent.push({ type: "image_url", image_url: { url: image } });

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
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`gateway_${res.status}`);
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
        const raw = await callGateway(apiKey, data.text, data.image);
        const parsed = parseAnalysis(raw);
        if (parsed) return { source: "ai", result: parsed };
      } catch (err) {
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
