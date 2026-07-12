import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import {
  DEMO_RESULT,
  EXAMPLE_POST,
  MAX_INPUT_LENGTH,
  VISIBILITY_LABELS,
  type AnalysisResponse,
  type AnalysisSource,
  type Visibility,
} from "../lib/analyze";
import { analyzeFootprint } from "../lib/analyze.functions";
import type { ImageGuardSnapshot } from "../components/ImageGuard";
import {
  AUDIENCE_GUIDANCE,
  derivePostSignals,
  type ConsentChoice,
} from "../lib/post-analysis";

const ImageGuard = lazy(() => import("../components/ImageGuard"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Footprint Guard — SNS 게시 전 개인정보 점검" },
      {
        name: "description",
        content:
          "SNS에 올리기 전, 나도 모르게 남긴 개인정보와 디지털 발자국을 확인하세요.",
      },
      { property: "og:title", content: "Footprint Guard" },
      {
        property: "og:description",
        content:
          "SNS 게시 전 직접 노출된 정보와 추론 가능한 디지털 발자국을 확인하고 안전한 문장으로 수정하세요.",
      },
    ],
  }),
  component: Home,
});

const VISIBILITIES: Visibility[] = ["public", "friends", "group", "dm"];

function Home() {
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisStarted, setAnalysisStarted] = useState(false);
  const [submittedText, setSubmittedText] = useState("");
  const [submittedVisibility, setSubmittedVisibility] =
    useState<Visibility>("public");
  const [initialText, setInitialText] = useState("");
  const [initialResponse, setInitialResponse] =
    useState<AnalysisResponse | null>(null);
  const [consentChoice, setConsentChoice] =
    useState<ConsentChoice | null>(null);
  const [scanSignal, setScanSignal] = useState(0);
  const [imageSnapshot, setImageSnapshot] = useState<ImageGuardSnapshot>({
    hasImage: false,
    previewUrl: null,
    status: "idle",
    candidateCount: 0,
    selectedCount: 0,
    categories: [],
    categoryCounts: {},
  });
  const composerRef = useRef<HTMLDivElement | null>(null);
  const imageGetterRef = useRef<(() => Promise<string | null>) | null>(null);

  const analyze = useServerFn(analyzeFootprint);

  const charCount = text.length;
  const overLimit = charCount > MAX_INPUT_LENGTH;
  const imageLoading =
    imageSnapshot.status === "image-loading" ||
    imageSnapshot.status === "ocr-loading" ||
    imageSnapshot.status === "ocr-running";
  const combinedLoading = loading || imageLoading;
  const canAnalyze =
    (text.trim().length > 0 || imageSnapshot.hasImage) &&
    !overLimit &&
    !combinedLoading;

  const handleImageSnapshot = useCallback((snapshot: ImageGuardSnapshot) => {
    setImageSnapshot(snapshot);
  }, []);

  async function handleAnalyze() {
    if (!text.trim() && !imageSnapshot.hasImage) {
      setError("게시글을 입력하거나 사진을 첨부해 주세요.");
      return;
    }
    if (overLimit) {
      setError(`게시글은 ${MAX_INPUT_LENGTH}자 이하로 입력해 주세요.`);
      return;
    }
    setError(null);
    setResponse(null);
    if (!analysisStarted) setInitialText(text);
    setAnalysisStarted(true);
    setSubmittedText(text);
    setSubmittedVisibility(visibility);
    if (imageSnapshot.hasImage) setScanSignal((value) => value + 1);

    const hasImage = imageSnapshot.hasImage;
    if (!text.trim() && !hasImage) return;

    setLoading(true);
    try {
      let imageDataUrl: string | null = null;
      if (hasImage && imageGetterRef.current) {
        try {
          imageDataUrl = await imageGetterRef.current();
        } catch (err) {
          console.error(
            "Image encode failed",
            err instanceof Error ? err.name : "UnknownError",
          );
        }
      }
      const payload: {
        text: string;
        visibility: Visibility;
        image?: string;
      } = { text, visibility };
      if (imageDataUrl) payload.image = imageDataUrl;
      const r = await analyze({ data: payload });
      setResponse(r);
      if (!analysisStarted) setInitialResponse(r);
    } catch (e) {
      console.error(
        "Analysis failed",
        e instanceof Error ? e.name : "UnknownError",
      );
      const fallbackResponse: AnalysisResponse = {
        source: "demo",
        result: DEMO_RESULT,
        notice: "AI 분석을 사용할 수 없어 데모 결과를 표시합니다.",
      };
      setResponse(fallbackResponse);
      if (!analysisStarted) setInitialResponse(fallbackResponse);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setResponse(null);
    setText("");
    setError(null);
    setAnalysisStarted(false);
    setInitialText("");
    setInitialResponse(null);
    setConsentChoice(null);
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
          <div className="flex items-center gap-2.5">
            <ShieldMark />
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">
                Footprint Guard
              </div>
              <div className="text-[11px] text-muted-foreground">
                게시 전 개인정보 점검 도우미
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground hidden sm:block">
            교육용 · 저장하지 않음
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        <section className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            SNS에 올리기 전,{" "}
            <span className="text-primary">디지털 발자국</span>부터 확인하세요.
          </h1>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground">
            게시글과 이미지 속 개인정보 후보를 게시 전에 확인하고 안전하게
            수정할 수 있도록 도와드립니다.
          </p>
        </section>

        <div ref={composerRef}>
        <InputPanel
          text={text}
          onText={setText}
          visibility={visibility}
          onVisibility={setVisibility}
          charCount={charCount}
          overLimit={overLimit}
          onExample={() => {
            setText(EXAMPLE_POST);
            setError(null);
          }}
          onAnalyze={handleAnalyze}
          canAnalyze={canAnalyze}
          loading={combinedLoading}
          error={error}
          imageEditor={
          <Suspense
            fallback={
              <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                이미지 편집기를 불러오는 중...
              </div>
            }
          >
            <ImageGuard
              embedded
              scanSignal={scanSignal}
              onSnapshotChange={handleImageSnapshot}
              imageGetterRef={imageGetterRef}
            />
          </Suspense>
          }
        />
        </div>

        {combinedLoading && <LoadingCard />}

        {analysisStarted && !combinedLoading && (
          <UnifiedResultHeader
            text={submittedText}
            visibility={submittedVisibility}
            image={imageSnapshot}
            response={response}
            onEdit={() =>
              composerRef.current?.scrollIntoView({ behavior: "smooth" })
            }
          />
        )}

        {response && submittedText.trim() && (
          <ResultView
            response={response}
            onReset={handleReset}
            onApplyText={(nextText) => {
              setText(nextText);
              composerRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
          />
        )}

        {analysisStarted && !combinedLoading && (
          <PostActionCards
            submittedText={submittedText}
            currentText={text}
            visibility={visibility}
            image={imageSnapshot}
            response={response}
            initialText={initialText}
            initialResponse={initialResponse}
            consentChoice={consentChoice}
            onConsent={setConsentChoice}
            onRecheck={handleAnalyze}
          />
        )}

        <footer className="mt-16 border-t border-border/60 pt-6 text-[11px] text-muted-foreground">
          Footprint Guard는 게시 전 참고용 보조 도구입니다. 입력한 게시글과
          이미지는 서버에 저장하지 않습니다.
        </footer>
      </main>
    </div>
  );
}

/* ---------- Input ---------- */

function InputPanel(props: {
  text: string;
  onText: (v: string) => void;
  visibility: Visibility;
  onVisibility: (v: Visibility) => void;
  charCount: number;
  overLimit: boolean;
  onExample: () => void;
  onAnalyze: () => void;
  canAnalyze: boolean;
  loading: boolean;
  error: string | null;
  imageEditor: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <label className="block text-sm font-medium mb-2">
        SNS 게시글 입력
      </label>
      <textarea
        value={props.text}
        onChange={(e) => props.onText(e.target.value)}
        placeholder="예: 오늘 저녁 7시에 ○○고 정문에서 만나자..."
        className="w-full min-h-40 resize-y rounded-lg bg-input/60 border border-border p-3 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring/60 placeholder:text-muted-foreground/70"
      />
      <div className="mt-1.5 flex items-center justify-between text-xs">
        <span
          className={
            props.overLimit ? "text-warn" : "text-muted-foreground"
          }
        >
          {props.charCount.toLocaleString()} / {MAX_INPUT_LENGTH.toLocaleString()}자
        </span>
        <button
          type="button"
          onClick={props.onExample}
          className="text-primary hover:underline"
        >
          가상 예시 불러오기
        </button>
      </div>

      <div className="mt-5">{props.imageEditor}</div>

      <div className="mt-5">
        <div className="text-sm font-medium mb-2">게시 범위</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {VISIBILITIES.map((v) => {
            const active = props.visibility === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => props.onVisibility(v)}
                className={
                  "rounded-lg border px-3 py-2 text-sm transition " +
                  (active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted/40 text-foreground hover:bg-muted")
                }
              >
                {VISIBILITY_LABELS[v]}
              </button>
            );
          })}
        </div>
      </div>

      {props.error && (
        <div className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {props.error}
        </div>
      )}

      <div className="mt-6 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-end">
        <button
          type="button"
          onClick={props.onAnalyze}
          disabled={!props.canAnalyze}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {props.loading
            ? "게시물의 디지털 발자국을 점검하고 있습니다."
            : "게시 전 개인정보 점검"}
        </button>
      </div>
    </section>
  );
}

function LoadingCard() {
  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
        게시물의 디지털 발자국을 점검하고 있습니다. 이미지 분석은 기기 안에서 처리됩니다.
      </div>
    </div>
  );
}

function UnifiedResultHeader(props: {
  text: string;
  visibility: Visibility;
  image: ImageGuardSnapshot;
  response: AnalysisResponse | null;
  onEdit: () => void;
}) {
  const directCount = props.response?.result.direct_exposures.length ?? 0;
  const connectedCount = props.response?.result.inferred_exposures.length ?? 0;
  const status =
    props.response?.result.status ??
    (props.image.candidateCount > 0 ? "일부 수정 권장" : "그대로 게시 가능");

  return (
    <section className="mt-8 space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            입력 게시물 미리보기
          </h2>
          <button onClick={props.onEdit} className="text-xs text-primary hover:underline">
            게시글 수정
          </button>
        </div>
        {props.text.trim() && (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{props.text}</p>
        )}
        {props.image.previewUrl && (
          <img
            src={props.image.previewUrl}
            alt="첨부 이미지 미리보기"
            className="mt-3 max-h-64 w-full rounded-xl border border-border object-contain"
          />
        )}
        <div className="mt-3 text-xs text-muted-foreground">
          공개 범위: {VISIBILITY_LABELS[props.visibility]}
        </div>
      </div>

      <div className="rounded-2xl border border-primary/40 bg-primary/10 p-5 sm:p-6">
        <div className="text-[11px] uppercase tracking-wider text-primary">게시 준비 상태</div>
        <h2 className="mt-1 text-2xl font-bold">{status}</h2>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {props.text.trim() && (
            <span className="rounded-full bg-card px-3 py-1">직접 노출 {directCount}개</span>
          )}
          {props.text.trim() && connectedCount > 0 && (
            <span className="rounded-full bg-card px-3 py-1">연결 단서 {connectedCount}개</span>
          )}
          {props.image.hasImage && (
            <span className="rounded-full bg-card px-3 py-1">
              이미지 후보 {props.image.candidateCount}개
            </span>
          )}
        </div>
        <div className="mt-4 space-y-1 text-[11px] text-muted-foreground">
          {props.text.trim() && (
            <div>
              텍스트: {props.response?.source === "ai" ? "실시간 AI 분석" : "데모 대체 결과"}
            </div>
          )}
          {props.image.hasImage && (
            <div>
              이미지: {props.image.status === "ocr-failed" ? "OCR 실패 — 브라우저 탐지·수동 편집 가능" : "기기 내 OCR·브라우저 탐지"}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PostActionCards(props: {
  submittedText: string;
  currentText: string;
  visibility: Visibility;
  image: ImageGuardSnapshot;
  response: AnalysisResponse | null;
  initialText: string;
  initialResponse: AnalysisResponse | null;
  consentChoice: ConsentChoice | null;
  onConsent: (choice: ConsentChoice) => void;
  onRecheck: () => void;
}) {
  const { mentions, thirdPartyDetected, hasCrossMediaConnection } =
    derivePostSignals({
      text: props.submittedText,
      hasImage: props.image.hasImage,
      categories: props.image.categories,
      categoryCounts: props.image.categoryCounts,
    });
  const textConnections = props.response?.result.inferred_exposures ?? [];
  const textChanged = props.initialText !== props.currentText;
  const beforeDirect = props.initialResponse?.result.direct_exposures.length ?? 0;
  const afterDirect = props.response?.result.direct_exposures.length ?? 0;

  return (
    <section className="mt-5 space-y-5">
      {(props.response?.result.direct_exposures.length ||
        props.image.candidateCount > 0 ||
        mentions.length > 0) && (
        <Card title="발견된 개인정보">
          <div className="space-y-4">
            {(props.response?.result.direct_exposures.length ?? 0) > 0 && (
              <div>
                <h4 className="text-sm font-semibold">내 정보 또는 소유자 확인 필요</h4>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {props.response?.result.direct_exposures.map((exposure, index) => (
                    <div key={index} className="rounded-xl border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{exposure.text}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                          {exposure.category}
                        </span>
                        <span className="text-[11px] text-muted-foreground">텍스트</span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">{exposure.reason}</p>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        확신 수준: {exposure.certainty ?? "확인 필요"}
                      </p>
                      <p className="mt-1 text-[11px] text-primary">
                        권장 행동: 구체적인 표현을 줄이거나 공개 범위를 재검토하세요.
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(mentions.length > 0 || thirdPartyDetected) && (
              <div>
                <h4 className="text-sm font-semibold">타인 정보</h4>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {mentions.map((mention) => (
                    <div key={mention} className="rounded-xl border border-warn/40 bg-warn/5 p-3">
                      <div className="text-sm font-medium">친구 계정 {mention}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">출처: 텍스트 · 확신 수준: 명확함</div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        특정 계정과 게시물을 연결할 수 있습니다.
                      </p>
                      <p className="mt-1 text-[11px] text-primary">
                        권장 행동: 당사자에게 태그와 게시 여부를 확인하세요.
                      </p>
                    </div>
                  ))}
                  {props.image.categories
                    .filter((category) =>
                      ["얼굴", "명찰·신분증", "연락처"].includes(category),
                    )
                    .map((category) => (
                      <div key={category} className="rounded-xl border border-warn/40 bg-warn/5 p-3">
                        <div className="text-sm font-medium">{category} 후보</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">출처: 이미지 · 확신 수준: 확인 필요</div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          타인의 정보인지 직접 확인해야 합니다.
                        </p>
                        <p className="mt-1 text-[11px] text-primary">
                          권장 행동: 영역을 가리거나 게시 허락을 확인하세요.
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {(textConnections.length > 0 || hasCrossMediaConnection) && (
        <Card title="서로 연결되는 단서">
          <div className="space-y-3">
            {hasCrossMediaConnection && (
              <div className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap gap-2 text-[11px]">
                  {mentions.map((mention) => (
                    <span key={mention} className="rounded-md bg-muted px-2 py-1">
                      {mention} · 텍스트
                    </span>
                  ))}
                  {props.image.categories.map((category) => (
                    <span key={category} className="rounded-md bg-muted px-2 py-1">
                      {category} · 이미지
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-sm leading-relaxed">
                  계정 태그와 이미지 속 인물·소속 후보를 서로 연결하는 단서가 될 가능성이 있습니다.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  태그를 확인하고 얼굴·명찰·학교 표시를 가리거나 공개 범위를 재검토하세요.
                </p>
              </div>
            )}
            {textConnections.map((connection, index) => (
              <div key={index} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap gap-1.5">
                  {connection.used_clues.map((clue) => (
                    <span key={clue} className="rounded-md bg-muted px-2 py-1 text-[11px]">
                      {clue} · 텍스트
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-sm font-medium">{connection.inference}</p>
                <p className="mt-1 text-xs text-muted-foreground">{connection.reason}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {thirdPartyDetected && (
        <Card title="타인 동의 확인">
          <p className="text-sm leading-relaxed">
            타인의 정보가 포함되어 있을 수 있습니다. 친구 계정 태그, 얼굴 또는 명찰 후보를 확인하고 업로드 전에 당사자의 허락을 받았는지 확인하세요.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {([
              ["confirmed", "게시 허락을 확인했습니다"],
              ["pending", "아직 확인하지 못했습니다"],
              ["remove", "타인의 정보를 제거하겠습니다"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => props.onConsent(value)}
                className={
                  "rounded-lg border px-3 py-2 text-sm " +
                  (props.consentChoice === value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted")
                }
              >
                {label}
              </button>
            ))}
          </div>
          {props.consentChoice === "pending" && (
            <p className="mt-3 text-xs text-warn">
              친구 태그 삭제, 얼굴·프로필 정보 가리기, 공개 범위 축소 또는 당사자 확인을 권장합니다.
            </p>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            이 선택은 현재 페이지 메모리에만 유지되며 실제 동의 여부를 AI가 판단하거나 증명하지 않습니다.
          </p>
        </Card>
      )}

      <Card title="공개 범위 비교">
        <div className="grid gap-2 sm:grid-cols-2">
          {AUDIENCE_GUIDANCE.map(({ scope, explanation }) => (
            <div
              key={scope}
              className={
                "rounded-xl border p-3 " +
                (props.visibility === scope ? "border-primary bg-primary/5" : "border-border")
              }
            >
              <div className="text-sm font-semibold">{VISIBILITY_LABELS[scope]}</div>
              <p className="mt-1 text-xs text-muted-foreground">{explanation}</p>
            </div>
          ))}
        </div>
      </Card>

      {(textChanged || props.image.selectedCount > 0 || props.consentChoice) && (
        <Card title="수정 전후 비교">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-muted/40 p-4 text-sm">
              <div className="font-semibold">수정 전</div>
              <div className="mt-2 text-xs text-muted-foreground">직접 노출 {beforeDirect}개</div>
            </div>
            <div className="rounded-xl bg-primary/5 p-4 text-sm">
              <div className="font-semibold">현재 상태</div>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div>직접 노출 {afterDirect}개</div>
                <div>문장 변경 {textChanged ? "있음" : "없음"}</div>
                {props.image.hasImage && <div>가림 선택 영역 {props.image.selectedCount}개</div>}
                {thirdPartyDetected && <div>타인 확인: {props.consentChoice ? "선택됨" : "확인 필요"}</div>}
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="flex justify-center">
        <button
          onClick={props.onRecheck}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          수정된 게시물 다시 점검
        </button>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
        AI 분석은 개인정보 후보를 제안하는 보조 기능이며 정확한 신원, 주소 또는 동의 여부를 판단하지 않습니다. 자동 분석이 놓친 정보가 있을 수 있으므로 최종 게시 전 직접 확인하세요. 게시글은 서버 측 AI 분석에 전달될 수 있고, 이미지는 현재 기기 안에서 OCR·Canvas로 처리됩니다. 원본·수정본·결과는 별도로 저장하지 않으며 새로고침하면 초기화됩니다.
      </div>
    </section>
  );
}

/* ---------- Result ---------- */

function SourceBadge({ source }: { source: AnalysisSource }) {
  const isAi = source === "ai";
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium " +
        (isAi
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-warn/40 bg-warn/10 text-warn")
      }
    >
      <span
        className={
          "h-1.5 w-1.5 rounded-full " + (isAi ? "bg-primary" : "bg-warn")
        }
      />
      {isAi ? "실시간 AI 분석" : "데모 대체 결과"}
    </span>
  );
}

function ResultView({
  response,
  onReset,
  onApplyText,
}: {
  response: AnalysisResponse;
  onReset: () => void;
  onApplyText: (text: string) => void;
}) {
  const { result, source, notice } = response;
  return (
    <section className="mt-8 space-y-5">
      <div className="flex items-center justify-between">
        <SourceBadge source={source} />
        {notice && (
          <span className="text-[11px] text-muted-foreground text-right">
            {notice}
          </span>
        )}
      </div>

      {/* Summary */}
      <Card title="분석 요약">
        <p className="text-sm leading-relaxed">{result.summary}</p>
      </Card>

      {/* Priority actions */}
      {result.priority_actions.length > 0 && (
        <Card title="가장 먼저 수정할 항목">
          <ol className="space-y-2">
            {result.priority_actions.slice(0, 5).map((a, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{a}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* Safe rewrites */}
      {result.safe_rewrites.length > 0 && (
        <Card title="안전한 수정문">
          <div className="space-y-3">
            {result.safe_rewrites.map((r, i) => (
              <RewriteCard key={i} rewrite={r} onApply={onApplyText} />
            ))}
          </div>
        </Card>
      )}

      {/* Uncertainty */}
      {result.uncertainty && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
          {result.uncertainty}
        </div>
      )}

      <div className="flex justify-center pt-2">
        <button
          onClick={onReset}
          className="rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium hover:bg-muted"
        >
          새로운 글 다시 분석하기
        </button>
      </div>
    </section>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3 tracking-wide">
        {title}
      </h3>
      {children}
    </div>
  );
}

function RewriteCard({
  rewrite,
  onApply,
}: {
  rewrite: { style: string; text: string };
  onApply: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isPriority = useMemo(() => rewrite.style.includes("안전"), [rewrite]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(rewrite.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={
        "rounded-xl border p-4 " +
        (isPriority
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-muted/30")
      }
    >
      <div className="flex items-center justify-between">
        <span
          className={
            "rounded-full px-2 py-0.5 text-[11px] font-medium " +
            (isPriority
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground")
          }
        >
          {rewrite.style}
        </span>
        <div className="flex items-center gap-3">
          <button onClick={() => onApply(rewrite.text)} className="text-xs font-medium text-primary hover:underline">
            {rewrite.style.includes("안전") ? "안전 우선 수정문 적용" : "최소 수정문 적용"}
          </button>
          <button onClick={copy} className="text-xs text-muted-foreground hover:underline">
            {copied ? "복사됨" : "복사"}
          </button>
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
        {rewrite.text}
      </p>
    </div>
  );
}

function ShieldMark() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    </div>
  );
}
