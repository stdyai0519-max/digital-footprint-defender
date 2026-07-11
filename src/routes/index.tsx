import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  EXAMPLE_POST,
  VISIBILITY_LABELS,
  getDemoAnalysis,
  type AnalysisResult,
  type Visibility,
} from "../lib/analyze";

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
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const charCount = text.length;
  const canAnalyze = text.trim().length > 0 && !loading;

  async function handleAnalyze() {
    if (!text.trim()) {
      setError("분석할 게시글을 먼저 입력해 주세요.");
      return;
    }
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const r = await getDemoAnalysis(text, visibility);
      setResult(r);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setResult(null);
    setText("");
    setError(null);
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
            교육용 · 로컬 데모
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        <section className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            SNS에 올리기 전,{" "}
            <span className="text-primary">디지털 발자국</span>부터 확인하세요.
          </h1>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground">
            글 속에 직접 드러난 개인정보와, 여러 단서의 조합으로 추론 가능한
            정보를 함께 짚어드립니다.
          </p>
        </section>

        <InputPanel
          text={text}
          onText={setText}
          visibility={visibility}
          onVisibility={setVisibility}
          charCount={charCount}
          onExample={() => {
            setText(EXAMPLE_POST);
            setError(null);
          }}
          onAnalyze={handleAnalyze}
          canAnalyze={canAnalyze}
          loading={loading}
          error={error}
        />

        {loading && <LoadingCard />}

        {result && (
          <ResultView result={result} onReset={handleReset} />
        )}

        <footer className="mt-16 border-t border-border/60 pt-6 text-[11px] text-muted-foreground">
          Footprint Guard는 게시 전 참고용 보조 도구입니다. 실제 예시가 아닌
          가상 데이터를 사용합니다.
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
  onExample: () => void;
  onAnalyze: () => void;
  canAnalyze: boolean;
  loading: boolean;
  error: string | null;
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
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>{props.charCount.toLocaleString()}자</span>
        <button
          type="button"
          onClick={props.onExample}
          className="text-primary hover:underline"
        >
          가상 예시 불러오기
        </button>
      </div>

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
          {props.loading ? "분석 중..." : "분석하기"}
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
        게시글을 살펴보고 있어요...
      </div>
    </div>
  );
}

/* ---------- Result ---------- */

function ResultView({
  result,
  onReset,
}: {
  result: AnalysisResult;
  onReset: () => void;
}) {
  return (
    <section className="mt-8 space-y-5">
      {/* 1. Status */}
      <div className="rounded-2xl border border-warn/40 bg-warn/10 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warn/20 text-warn">
            !
          </div>
          <div className="flex-1">
            <div className="text-[11px] uppercase tracking-wider text-warn/90">
              게시 전 상태
            </div>
            <h2 className="mt-0.5 text-xl sm:text-2xl font-bold text-foreground">
              {result.status}
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              이 결과는 절대적인 안전 판정이 아니라, 게시 전 참고용 분석입니다.
            </p>
          </div>
        </div>
      </div>

      {/* 2. Summary */}
      <Card title="분석 요약">
        <p className="text-sm leading-relaxed">{result.summary}</p>
      </Card>

      {/* 3. Direct exposures */}
      <Card title="직접 노출된 정보">
        <div className="grid gap-3 sm:grid-cols-2">
          {result.direct_exposures.map((d, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-muted/40 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-sm break-keep">
                  {d.text}
                </div>
                <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                  {d.category}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                {d.reason}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* 4. Inferred */}
      <Card title="조합으로 추론 가능한 정보">
        <div className="space-y-4">
          {result.inferred_exposures.map((inf, i) => (
            <div key={i} className="rounded-xl border border-border p-4">
              <div className="text-sm font-semibold">{inf.inference}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {inf.used_clues.map((c, j) => (
                  <span
                    key={j}
                    className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {c}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                {inf.reason}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* 5. Priority actions */}
      <Card title="가장 먼저 수정할 항목">
        <ol className="space-y-2">
          {result.priority_actions.map((a, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                {i + 1}
              </span>
              <span className="leading-relaxed">{a}</span>
            </li>
          ))}
        </ol>
      </Card>

      {/* 6. Safe rewrites */}
      <Card title="안전한 수정문">
        <div className="space-y-3">
          {result.safe_rewrites.map((r, i) => (
            <RewriteCard key={i} rewrite={r} />
          ))}
        </div>
      </Card>

      {/* 7. Uncertainty */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
        {result.uncertainty}
      </div>

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

function RewriteCard({ rewrite }: { rewrite: { style: string; text: string } }) {
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
        <button
          onClick={copy}
          className="text-xs text-primary hover:underline"
        >
          {copied ? "복사됨" : "복사"}
        </button>
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
