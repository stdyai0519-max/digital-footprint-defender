import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createAiFindingManualCandidate } from "../lib/image-finding-selection";
import {
  createImageAnalysisPlan,
  getSelectedCandidates,
  type ImageAnalysisMode,
} from "../lib/image-analysis-mode";

/* ---------------- Types ---------------- */

type Effect = "blur" | "mosaic" | "black";
type Source = "ocr" | "native" | "manual";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Candidate {
  id: string;
  text: string;
  category: string;
  reason: string;
  confidence: number | null;
  box: Box;
  selected: boolean;
  source: Source;
}

interface ManualSelection {
  finding: string;
}

export interface ImageGuardHandle {
  beginManualSelection: (finding: string) => boolean;
  cancelManualSelection: () => void;
}

export type ImageAnalysisGetter = (
  options?: { mode?: ImageAnalysisMode },
) => Promise<string | null>;

export interface ImageGuardSnapshot {
  hasImage: boolean;
  previewUrl: string | null;
  status: Status;
  candidateCount: number;
  selectedCount: number;
  categories: string[];
  categoryCounts: Record<string, number>;
}

interface ImageGuardProps {
  embedded?: boolean;
  scanSignal?: number;
  onSnapshotChange?: (snapshot: ImageGuardSnapshot) => void;
  imageGetterRef?: React.MutableRefObject<ImageAnalysisGetter | null>;
}

type Status =
  | "idle"
  | "image-loading"
  | "ocr-loading"
  | "ocr-running"
  | "done"
  | "ocr-failed"
  | "format-error"
  | "size-error"
  | "downloading";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DIM = 2400; // downscale huge images for browser processing
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/* ---------------- Detection rules ---------------- */

interface RawMatch {
  text: string;
  category: string;
  reason: string;
  box: Box;
  confidence: number;
}

interface NativeDetection {
  boundingBox: { x: number; y: number; width: number; height: number };
}

interface ShapeDetectionWindow extends Window {
  FaceDetector?: new () => {
    detect(source: CanvasImageSource): Promise<NativeDetection[]>;
  };
  BarcodeDetector?: new (options?: { formats?: string[] }) => {
    detect(source: CanvasImageSource): Promise<NativeDetection[]>;
  };
}

const RX_PHONE_MOBILE = /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g;
const RX_PHONE_LAND = /0(2|[3-6][1-5])[-\s]?\d{3,4}[-\s]?\d{4}/g;
const RX_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RX_ZIP = /(?<!\d)\d{5}(?!\d)/g;
const RX_CAR = /\d{2,3}\s?[가-힣]\s?\d{4}/g;

const ADDRESS_TOKENS = [
  "시", "군", "구", "읍", "면", "동", "로", "길", "번길", "아파트", "호",
];
const SCHOOL_TOKENS = [
  "초등학교", "중학교", "고등학교", "대학교", "학원",
  "학생증", "사원증", "학년", "반", "이름", "성명", "소속",
];
const SNS_TOKENS = ["@", "인스타", "instagram", "twitter", "카톡", "kakao"];

function classify(word: { text: string; box: Box; conf: number }): RawMatch[] {
  const t = word.text.trim();
  if (!t) return [];
  const out: RawMatch[] = [];
  const push = (category: string, reason: string) =>
    out.push({
      text: t,
      category,
      reason,
      box: word.box,
      confidence: Math.max(0, Math.min(1, word.conf / 100)),
    });

  if (RX_PHONE_MOBILE.test(t)) push("전화번호", "휴대전화 형식으로 보입니다.");
  else if (RX_PHONE_LAND.test(t)) push("전화번호", "일반 전화번호 형식으로 보입니다.");
  RX_PHONE_MOBILE.lastIndex = 0;
  RX_PHONE_LAND.lastIndex = 0;

  if (RX_EMAIL.test(t)) push("이메일", "이메일 주소 형식으로 보입니다.");
  RX_EMAIL.lastIndex = 0;

  if (RX_CAR.test(t)) push("차량번호", "차량번호 후보로 보입니다. 직접 확인이 필요합니다.");
  RX_CAR.lastIndex = 0;

  if (SCHOOL_TOKENS.some((k) => t.includes(k)))
    push("학교·소속", "학교 또는 소속 정보로 보이는 표현입니다.");

  const addrHits = ADDRESS_TOKENS.filter((k) => t.endsWith(k) || t.includes(k)).length;
  if (addrHits >= 1 && /\d/.test(t)) push("주소", "주소 일부일 가능성이 있습니다.");
  else if (addrHits >= 2) push("주소", "주소 관련 표현이 여러 개 포함되어 있습니다.");

  if (RX_ZIP.test(t)) push("우편번호", "우편번호 형식으로 보입니다.");
  RX_ZIP.lastIndex = 0;

  if (SNS_TOKENS.some((k) => t.toLowerCase().includes(k.toLowerCase())))
    push("SNS 계정", "SNS 아이디 또는 계정으로 보이는 표현입니다.");

  return out;
}

async function detectNativeVisuals(
  image: HTMLImageElement,
  size: { w: number; h: number },
): Promise<Candidate[]> {
  const browserWindow = window as ShapeDetectionWindow;
  const candidates: Candidate[] = [];

  if (browserWindow.FaceDetector) {
    try {
      const faces = await new browserWindow.FaceDetector().detect(image);
      faces.forEach((face, index) => {
        candidates.push({
          id: `native-face-${Date.now()}-${index}`,
          text: `얼굴 후보 ${index + 1}`,
          category: "얼굴",
          reason:
            "브라우저가 얼굴 형태의 영역을 찾았습니다. 실제 인물 여부는 직접 확인하세요.",
          confidence: null,
          box: padBox(face.boundingBox, size),
          selected: true,
          source: "native",
        });
      });
    } catch {
      console.warn("Native face detection unavailable");
    }
  }

  if (browserWindow.BarcodeDetector) {
    try {
      const codes = await new browserWindow.BarcodeDetector({
        formats: ["qr_code"],
      }).detect(image);
      codes.forEach((code, index) => {
        candidates.push({
          id: `native-qr-${Date.now()}-${index}`,
          text: `QR코드 후보 ${index + 1}`,
          category: "QR코드",
          reason:
            "QR코드는 계정이나 연락처 등 추가 정보로 연결될 수 있어 확인이 필요합니다.",
          confidence: null,
          box: padBox(code.boundingBox, size),
          selected: true,
          source: "native",
        });
      });
    } catch {
      console.warn("Native QR detection unavailable");
    }
  }

  return candidates;
}

/* ---------------- Component ---------------- */

const ImageGuard = forwardRef<ImageGuardHandle, ImageGuardProps>(function ImageGuard({
  embedded = false,
  scanSignal = 0,
  onSnapshotChange,
  imageGetterRef,
}, ref) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [history, setHistory] = useState<Candidate[][]>([]);

  const [effect, setEffect] = useState<Effect>("blur");
  const [manualCategory, setManualCategory] = useState("사용자 지정");
  const [strength, setStrength] = useState(12);
  const [showModified, setShowModified] = useState(false);
  const [manualSelection, setManualSelection] = useState<ManualSelection | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  // drawing state
  const dragRef = useRef<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
    active: boolean;
  } | null>(null);
  const [, forceTick] = useState(0);
  const lastScanSignal = useRef(scanSignal);

  useImperativeHandle(
    ref,
    () => ({
      beginManualSelection(finding) {
        if (!imgRef.current || !imgSize) return false;
        setShowModified(false);
        setManualSelection({ finding });
        requestAnimationFrame(() => {
          containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return true;
      },
      cancelManualSelection() {
        setManualSelection(null);
      },
    }),
    [imgSize],
  );

  /* -------- upload -------- */

  const handleFile = useCallback(async (file: File) => {
    setErrMsg(null);
    if (!ACCEPTED.includes(file.type)) {
      setStatus("format-error");
      setErrMsg("지원하지 않는 파일 형식입니다. JPG, PNG, WebP만 사용할 수 있습니다.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus("size-error");
      setErrMsg("파일이 너무 큽니다. 10MB 이하 이미지를 사용해 주세요.");
      return;
    }
    setStatus("image-loading");
    setCandidates([]);
    setHistory([]);
    setShowModified(false);

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // downscale for browser processing while preserving aspect ratio
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (Math.max(w, h) > MAX_DIM) {
        const r = MAX_DIM / Math.max(w, h);
        w = Math.round(w * r);
        h = Math.round(h * r);
      }
      if (w !== img.naturalWidth || h !== img.naturalHeight) {
        // re-encode to smaller canvas
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        c.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob) {
            setStatus("format-error");
            setErrMsg("이미지 처리에 실패했습니다.");
            return;
          }
          const newUrl = URL.createObjectURL(blob);
          const img2 = new Image();
          img2.onload = () => {
            imgRef.current = img2;
            setImgSize({ w: img2.naturalWidth, h: img2.naturalHeight });
            setImgUrl(newUrl);
            setStatus("idle");
          };
          img2.src = newUrl;
        }, "image/png");
      } else {
        imgRef.current = img;
        setImgSize({ w, h });
        setImgUrl(url);
        setStatus("idle");
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus("format-error");
      setErrMsg("이미지를 불러오지 못했습니다.");
    };
    img.src = url;
  }, []);

  useEffect(() => {
    return () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    };
  }, [imgUrl]);

  /* -------- OCR -------- */

  async function runOcr() {
    if (!imgRef.current || !imgSize) return;
    setStatus("ocr-loading");
    setProgress(0);
    pushHistory();
    const nativeCandidates = await detectNativeVisuals(
      imgRef.current,
      imgSize,
    );
    let worker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | null = null;
    try {
      const mod = await import("tesseract.js");
      worker = await mod.createWorker(["kor", "eng"], 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") {
            setStatus("ocr-running");
            setProgress(Math.round(m.progress * 100));
          }
        },
      });
      const result = await worker.recognize(imgRef.current);

      const words: { text: string; box: Box; conf: number }[] = [];
      const data = result.data as unknown as {
        words?: Array<{
          text: string;
          confidence: number;
          bbox: { x0: number; y0: number; x1: number; y1: number };
        }>;
        lines?: Array<{
          text: string;
          confidence: number;
          bbox: { x0: number; y0: number; x1: number; y1: number };
        }>;
      };
      const source = data.words && data.words.length ? data.words : data.lines || [];
      for (const w of source) {
        const box = {
          x: w.bbox.x0,
          y: w.bbox.y0,
          width: w.bbox.x1 - w.bbox.x0,
          height: w.bbox.y1 - w.bbox.y0,
        };
        words.push({ text: w.text, box, conf: w.confidence });
      }

      const found: Candidate[] = [];
      let idx = 0;
      for (const w of words) {
        const matches = classify(w);
        for (const m of matches) {
          found.push({
            id: `ocr-${Date.now()}-${idx++}`,
            text: m.text,
            category: m.category,
            reason: m.reason,
            confidence: m.confidence,
            box: padBox(m.box, imgSize),
            selected: true,
            source: "ocr",
          });
        }
      }
      // dedupe overlapping same-category
      const deduped: Candidate[] = [];
      for (const c of found) {
        if (
          !deduped.some(
            (d) => d.category === c.category && iou(d.box, c.box) > 0.6,
          )
        )
          deduped.push(c);
      }
      setCandidates((prev) => [
        ...prev.filter((candidate) => candidate.source === "manual"),
        ...nativeCandidates,
        ...deduped,
      ]);
      setStatus("done");
    } catch (e) {
      console.error("OCR failed");
      setCandidates((prev) => [
        ...prev.filter((candidate) => candidate.source === "manual"),
        ...nativeCandidates,
      ]);
      setStatus("ocr-failed");
      setErrMsg(
        "자동 글자 인식에 실패했습니다. 직접 영역 선택으로 개인정보를 가릴 수 있습니다.",
      );
    } finally {
      await worker?.terminate().catch(() => undefined);
    }
  }

  useEffect(() => {
    if (scanSignal === lastScanSignal.current) return;
    lastScanSignal.current = scanSignal;
    if (imgRef.current && imgSize) void runOcr();
    // scanSignal is an imperative request from the unified composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanSignal, imgSize]);

  /* -------- history -------- */
  function pushHistory() {
    setHistory((h) => [...h.slice(-19), candidates.map((c) => ({ ...c }))]);
  }
  function undo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setCandidates(prev);
      return h.slice(0, -1);
    });
  }
  function clearAll() {
    pushHistory();
    setCandidates([]);
    setShowModified(false);
  }

  /* -------- selection helpers -------- */
  function toggle(id: string) {
    setCandidates((cs) =>
      cs.map((c) => (c.id === id ? { ...c, selected: !c.selected } : c)),
    );
  }
  function removeItem(id: string) {
    pushHistory();
    setCandidates((cs) => cs.filter((c) => c.id !== id));
  }
  function selectAll(v: boolean) {
    setCandidates((cs) => cs.map((c) => ({ ...c, selected: v })));
  }

  /* -------- draw canvas -------- */

  const draw = useCallback(() => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img || !imgSize) return;

    const container = containerRef.current;
    const maxW = container ? container.clientWidth : imgSize.w;
    const s = Math.min(1, maxW / imgSize.w);
    setScale(s);

    c.width = Math.round(imgSize.w * s);
    c.height = Math.round(imgSize.h * s);
    const ctx = c.getContext("2d");
    if (!ctx) return;

    if (showModified) {
      renderProcessed(ctx, img, imgSize, candidates, effect, strength, s);
    } else {
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // overlays
      for (const cand of candidates) {
        const x = cand.box.x * s;
        const y = cand.box.y * s;
        const w = cand.box.width * s;
        const h = cand.box.height * s;
        ctx.lineWidth = 2;
        ctx.strokeStyle = cand.selected
          ? "rgba(52, 211, 153, 0.95)"
          : "rgba(148, 163, 184, 0.85)";
        ctx.fillStyle = cand.selected
          ? "rgba(52, 211, 153, 0.18)"
          : "rgba(148, 163, 184, 0.10)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.font = "11px system-ui, sans-serif";
        const label = cand.category;
        const tw = ctx.measureText(label).width + 8;
        ctx.fillStyle = cand.selected
          ? "rgba(16, 185, 129, 0.95)"
          : "rgba(100, 116, 139, 0.9)";
        ctx.fillRect(x, Math.max(0, y - 16), tw, 16);
        ctx.fillStyle = "#0b1220";
        ctx.fillText(label, x + 4, Math.max(11, y - 4));
      }
      // in-progress rect
      const d = dragRef.current;
      if (d && d.active) {
        const rx = Math.min(d.startX, d.curX);
        const ry = Math.min(d.startY, d.curY);
        const rw = Math.abs(d.curX - d.startX);
        const rh = Math.abs(d.curY - d.startY);
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "rgba(56, 189, 248, 0.95)";
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
      }
    }
  }, [candidates, imgSize, showModified, effect, strength]);

  useEffect(() => {
    draw();
  }, [draw]);
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  /* -------- pointer -------- */

  function toCanvasXY(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (showModified) return;
    const { x, y } = toCanvasXY(e);
    if (manualSelection) {
      canvasRef.current!.setPointerCapture(e.pointerId);
      dragRef.current = { startX: x, startY: y, curX: x, curY: y, active: true };
      forceTick((n) => n + 1);
      return;
    }
    // click hit test — toggle selection
    const imgX = x / scale;
    const imgY = y / scale;
    const hit = [...candidates]
      .reverse()
      .find(
        (c) =>
          imgX >= c.box.x &&
          imgY >= c.box.y &&
          imgX <= c.box.x + c.box.width &&
          imgY <= c.box.y + c.box.height,
      );
    if (hit) {
      toggle(hit.id);
      return;
    }
    canvasRef.current!.setPointerCapture(e.pointerId);
    dragRef.current = { startX: x, startY: y, curX: x, curY: y, active: true };
    forceTick((n) => n + 1);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = dragRef.current;
    if (!d || !d.active) return;
    const { x, y } = toCanvasXY(e);
    d.curX = x;
    d.curY = y;
    draw();
  }
  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = dragRef.current;
    if (!d) return;
    d.active = false;
    const rw = Math.abs(d.curX - d.startX);
    const rh = Math.abs(d.curY - d.startY);
    if (rw > 4 && rh > 4 && imgSize) {
      pushHistory();
      const rx = Math.min(d.startX, d.curX) / scale;
      const ry = Math.min(d.startY, d.curY) / scale;
      const nw = rw / scale;
      const nh = rh / scale;
      setCandidates((cs) => [
        ...cs,
        manualSelection
          ? createAiFindingManualCandidate({
              id: `manual-${Date.now()}`,
              finding: manualSelection.finding,
              box: {
                x: Math.max(0, rx),
                y: Math.max(0, ry),
                width: Math.min(imgSize.w - rx, nw),
                height: Math.min(imgSize.h - ry, nh),
              },
            })
          : {
              id: `manual-${Date.now()}`,
              text: "",
              category: manualCategory,
              reason: `${manualCategory} 후보로 사용자가 직접 선택한 영역입니다.`,
              confidence: null,
              box: {
                x: Math.max(0, rx),
                y: Math.max(0, ry),
                width: Math.min(imgSize.w - rx, nw),
                height: Math.min(imgSize.h - ry, nh),
              },
              selected: true,
              source: "manual" as const,
            },
      ]);
    }
    dragRef.current = null;
    try {
      canvasRef.current!.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    draw();
  }

  /* -------- download -------- */

  async function download() {
    if (!imgRef.current || !imgSize) return;
    setStatus("downloading");
    const c = document.createElement("canvas");
    c.width = imgSize.w;
    c.height = imgSize.h;
    const ctx = c.getContext("2d")!;
    renderProcessed(ctx, imgRef.current, imgSize, candidates, effect, strength, 1);
    c.toBlob((blob) => {
      if (!blob) {
        setStatus("done");
        return;
      }
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = "protected-image.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("done");
    }, "image/png");
  }

  /* -------- drag & drop upload -------- */

  const [dropHover, setDropHover] = useState(false);
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropHover(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  /* -------- render -------- */

  const selectedCount = useMemo(
    () => candidates.filter((c) => c.selected).length,
    [candidates],
  );

  const categories = useMemo(
    () => Array.from(new Set(candidates.map((c) => c.category))),
    [candidates],
  );
  const categoryCounts = useMemo(
    () =>
      candidates.reduce<Record<string, number>>((counts, candidate) => {
        counts[candidate.category] = (counts[candidate.category] ?? 0) + 1;
        return counts;
      }, {}),
    [candidates],
  );

  useEffect(() => {
    onSnapshotChange?.({
      hasImage: Boolean(imgUrl && imgSize),
      previewUrl: imgUrl,
      status,
      candidateCount: candidates.length,
      selectedCount,
      categories,
      categoryCounts,
    });
  }, [
    categories,
    categoryCounts,
    candidates.length,
    imgSize,
    imgUrl,
    onSnapshotChange,
    selectedCount,
    status,
  ]);

  useEffect(() => {
    if (!imageGetterRef) return;
    imageGetterRef.current = async ({ mode = "original" } = {}) => {
      const img = imgRef.current;
      if (!img || !imgSize) return null;
      const MAX = 1280;
      const r = Math.min(1, MAX / Math.max(imgSize.w, imgSize.h));
      const w = Math.round(imgSize.w * r);
      const h = Math.round(imgSize.h * r);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      const plan = createImageAnalysisPlan({
        mode,
        selectedCount,
        effect,
        strength,
      });
      if (plan.useProcessedImage) {
        renderProcessed(
          ctx,
          img,
          imgSize,
          candidates,
          plan.effect,
          plan.strength,
          r,
        );
      } else {
        ctx.drawImage(img, 0, 0, w, h);
      }
      return c.toDataURL("image/jpeg", 0.82);
    };
    return () => {
      if (imageGetterRef.current) imageGetterRef.current = null;
    };
  }, [candidates, effect, imageGetterRef, imgSize, selectedCount, strength]);



  return (
    <div className="space-y-5">
      <section
        className={
          embedded
            ? "rounded-xl border border-border bg-muted/20 p-4"
            : "rounded-2xl border border-border bg-card p-5 sm:p-6"
        }
      >
        <h2 className={embedded ? "text-sm font-semibold" : "text-lg font-bold"}>
          사진 첨부 (선택)
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          사진 속 전화번호, 주소, 학교명 등 개인정보 후보를 기기 안에서 찾아
          가릴 수 있습니다.
        </p>
        <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground leading-relaxed">
          기본 OCR과 편집은 기기에서 처리됩니다. AI 사진 분석 시 축소된
          이미지가 분석 서버로 일시 전송되며 앱에 저장되지 않습니다.
        </div>
      </section>

      {!imgUrl && (
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDropHover(true);
          }}
          onDragLeave={() => setDropHover(false)}
          onDrop={onDrop}
          className={
            "rounded-2xl border-2 border-dashed p-8 text-center transition " +
            (dropHover
              ? "border-primary bg-primary/10"
              : "border-border bg-card")
          }
        >
          <p className="text-sm text-muted-foreground">
            이미지를 여기로 드래그하거나 파일을 선택하세요.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            JPG · PNG · WebP · 최대 10MB
          </p>
          <label className="mt-4 inline-flex cursor-pointer items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:brightness-110">
            파일 선택
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.currentTarget.value = "";
              }}
            />
          </label>
          {errMsg && (
            <p className="mt-4 text-xs text-warn">{errMsg}</p>
          )}
        </section>
      )}

      {imgUrl && imgSize && (
        <>
          {manualSelection && (
            <section className="rounded-xl border border-primary/40 bg-primary/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm leading-relaxed">
                  “{manualSelection.finding}”에 해당하는 부분을 사진에서 드래그하세요.
                </p>
                <button
                  type="button"
                  onClick={() => setManualSelection(null)}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
                >
                  선택 취소
                </button>
              </div>
            </section>
          )}
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                직접 영역 종류
                <select
                  value={manualCategory}
                  onChange={(event) => setManualCategory(event.target.value)}
                  className="rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground"
                >
                  {[
                    "사용자 지정",
                    "얼굴",
                    "명찰·신분증",
                    "학교·소속",
                    "QR코드",
                    "연락처",
                  ].map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              {!embedded && (
                <button
                  onClick={runOcr}
                  disabled={status === "ocr-loading" || status === "ocr-running"}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-50"
                >
                  {status === "ocr-loading"
                    ? "OCR 준비 중..."
                    : status === "ocr-running"
                      ? `분석 중 ${progress}%`
                      : "개인정보 후보 찾기"}
                </button>
              )}
              {embedded &&
                (status === "ocr-loading" || status === "ocr-running") && (
                  <span className="rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
                    {status === "ocr-loading"
                      ? "이미지 분석 준비 중..."
                      : `이미지 분석 중 ${progress}%`}
                  </span>
                )}
              <button
                onClick={undo}
                disabled={history.length === 0}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40"
              >
                실행 취소
              </button>
              <button
                onClick={() => selectAll(true)}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                전체 선택
              </button>
              <button
                onClick={() => selectAll(false)}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                전체 해제
              </button>
              <button
                onClick={clearAll}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                초기화
              </button>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {(["blur", "mosaic", "black"] as Effect[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setEffect(v)}
                    className={
                      "rounded-lg border px-3 py-2 text-sm " +
                      (effect === v
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted")
                    }
                  >
                    {v === "blur" ? "블러" : v === "mosaic" ? "모자이크" : "검은 박스"}
                  </button>
                ))}
              </div>
            </div>
            {effect !== "black" && (
              <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="w-16">
                  {effect === "blur" ? "블러 강도" : "모자이크 크기"}
                </span>
                <input
                  type="range"
                  min={2}
                  max={40}
                  value={strength}
                  onChange={(e) => setStrength(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="w-8 text-right text-foreground">{strength}</span>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowModified((v) => !v)}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                {showModified ? "원본 보기" : "수정본 미리보기"}
              </button>
              <button
                onClick={download}
                disabled={selectedCount === 0}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:brightness-110 disabled:opacity-40"
              >
                수정 이미지 다운로드
              </button>
              <button
                onClick={() => {
                  setImgUrl(null);
                  imgRef.current = null;
                  setImgSize(null);
                  setCandidates([]);
                  setHistory([]);
                  setManualSelection(null);
                  setStatus("idle");
                  setErrMsg(null);
                }}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                새 이미지 업로드
              </button>
            </div>
            {errMsg && (
              <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                {errMsg}
              </div>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              다운로드 이미지는 새로 생성되며 원본 메타데이터를 그대로 복사하지
              않습니다. 이미지 위를 드래그하면 새 영역을 추가할 수 있고, 기존
              영역을 클릭하면 선택 여부를 바꿀 수 있습니다.
            </p>
          </section>

          <section
            ref={containerRef}
            className="rounded-2xl border border-border bg-card p-3 overflow-hidden"
          >
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="block w-full touch-none select-none rounded-lg bg-muted"
              style={{ maxWidth: "100%" }}
            />
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground tracking-wide">
                탐지 결과 ({candidates.length}개 · 선택 {selectedCount}개)
              </h3>
            </div>
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                아직 후보가 없습니다. 「개인정보 후보 찾기」를 누르거나 이미지
                위를 드래그해 영역을 직접 추가하세요.
              </p>
            ) : (
              <ul className="space-y-2">
                {candidates.map((c) => (
                  <li
                    key={c.id}
                    className={
                      "flex items-start gap-3 rounded-lg border p-3 text-sm " +
                      (c.selected
                        ? "border-primary/40 bg-primary/5"
                        : "border-border bg-muted/30")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={c.selected}
                      onChange={() => toggle(c.id)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                          {c.category}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {c.source === "manual"
                            ? "직접 지정"
                            : c.source === "native"
                              ? "브라우저 자동 탐지"
                              : "OCR 자동 탐지"}
                          {c.confidence !== null &&
                            ` · 신뢰도 ${Math.round(c.confidence * 100)}%`}
                        </span>
                      </div>
                      {c.text && (
                        <div className="mt-1 truncate font-medium">{c.text}</div>
                      )}
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {c.reason}
                      </div>
                    </div>
                    <button
                      onClick={() => removeItem(c.id)}
                      className="text-xs text-muted-foreground hover:text-warn"
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
});

ImageGuard.displayName = "ImageGuard";

export default ImageGuard;

/* ---------------- helpers ---------------- */

function padBox(b: Box, size: { w: number; h: number }): Box {
  const px = Math.max(4, Math.round(b.height * 0.15));
  const x = Math.max(0, b.x - px);
  const y = Math.max(0, b.y - px);
  const w = Math.min(size.w - x, b.width + px * 2);
  const h = Math.min(size.h - y, b.height + px * 2);
  return { x, y, width: w, height: h };
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  const ua = a.width * a.height + b.width * b.height - inter;
  return ua > 0 ? inter / ua : 0;
}

function renderProcessed(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  size: { w: number; h: number },
  candidates: Candidate[],
  effect: Effect,
  strength: number,
  displayScale: number,
) {
  const W = Math.round(size.w * displayScale);
  const H = Math.round(size.h * displayScale);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);

  const active = getSelectedCandidates(candidates);
  for (const c of active) {
    const x = c.box.x * displayScale;
    const y = c.box.y * displayScale;
    const w = c.box.width * displayScale;
    const h = c.box.height * displayScale;
    if (w < 1 || h < 1) continue;

    if (effect === "black") {
      ctx.fillStyle = "#000";
      ctx.fillRect(x, y, w, h);
    } else if (effect === "blur") {
      const tmp = document.createElement("canvas");
      tmp.width = Math.ceil(w);
      tmp.height = Math.ceil(h);
      const tctx = tmp.getContext("2d")!;
      tctx.filter = `blur(${Math.max(2, strength)}px)`;
      tctx.drawImage(
        img,
        c.box.x,
        c.box.y,
        c.box.width,
        c.box.height,
        0,
        0,
        tmp.width,
        tmp.height,
      );
      ctx.drawImage(tmp, x, y);
    } else {
      // mosaic
      const block = Math.max(4, strength);
      const smallW = Math.max(1, Math.round(w / block));
      const smallH = Math.max(1, Math.round(h / block));
      const tmp = document.createElement("canvas");
      tmp.width = smallW;
      tmp.height = smallH;
      const tctx = tmp.getContext("2d")!;
      tctx.imageSmoothingEnabled = false;
      tctx.drawImage(
        img,
        c.box.x,
        c.box.y,
        c.box.width,
        c.box.height,
        0,
        0,
        smallW,
        smallH,
      );
      const prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, smallW, smallH, x, y, w, h);
      ctx.imageSmoothingEnabled = prev;
    }
  }
}
