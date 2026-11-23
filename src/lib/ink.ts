// PDF üzerine serbest çizim. Her sayfanın üstüne hafif bir <canvas> eklenir.
// Çizgiler sayfa boyutuna göre oransal (0–1) saklanır; yakınlaştırınca bozulmaz.

export type InkMode = "pen" | "eraser";

export interface Stroke {
  /** Renk (silgi için yok) */
  c?: string;
  /** Kalınlık, sayfa genişliğine oranla */
  w: number;
  /** Silgi çizgisi */
  e?: 1;
  /** Düzleştirilmiş noktalar: [x0, y0, x1, y1, ...] (0–1) */
  p: number[];
}

export type InkData = Record<number, Stroke[]>;

export const INK_COLORS = [
  "#111111",
  "#e03131",
  "#f08c00",
  "#fcc419",
  "#2f9e44",
  "#1c7ed6",
  "#7048e8",
  "#d6336c",
  "#868e96",
  "#ffffff",
];

export interface InkTool {
  mode: InkMode;
  color: string;
  /** Ekrandaki kalınlık (px) */
  size: number;
}

const round = (n: number) => Math.round(n * 10000) / 10000;

type EraseAction = { type: "erase"; page: number; removed: { stroke: Stroke; index: number }[] };
type Action = { type: "add"; page: number; stroke: Stroke } | EraseAction;

/** Noktanın (px, py) bir doğru parçasına uzaklığının karesi */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return x * x + y * y;
}

/** Silgi noktası bu çizgiye değiyor mu? (W, H: sayfanın ekrandaki boyutu) */
function strokeHit(s: Stroke, px: number, py: number, W: number, H: number, radius: number) {
  const tol = radius + (s.w * W) / 2;
  const t2 = tol * tol;
  const p = s.p;
  if (p.length === 2) return segDist2(px, py, p[0] * W, p[1] * H, p[0] * W, p[1] * H) <= t2;
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (segDist2(px, py, p[i] * W, p[i + 1] * H, p[i + 2] * W, p[i + 3] * H) <= t2) return true;
  }
  return false;
}

export class InkManager {
  data: InkData = {};
  enabled = false;
  tool: InkTool = { mode: "pen", color: INK_COLORS[1], size: 3 };
  private canvases = new Map<number, HTMLCanvasElement>();
  private onChange: () => void;
  /** Geri alma geçmişi: çizilen ve silinen çizgiler */
  private history: Action[] = [];

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  load(data: InkData) {
    this.data = data ?? {};
    this.history = [];
    for (const n of this.canvases.keys()) this.redraw(n);
  }

  /** pdf.js bir sayfayı çizdiğinde çağrılır: katmanı ekler / boyutlandırır / yeniden çizer */
  attach(pageNumber: number, pageDiv: HTMLElement) {
    let canvas = this.canvases.get(pageNumber);
    if (!canvas || canvas.parentElement !== pageDiv) {
      canvas = document.createElement("canvas");
      canvas.className = "ink-layer";
      this.bind(canvas, pageNumber);
      pageDiv.appendChild(canvas);
      this.canvases.set(pageNumber, canvas);
    }
    canvas.classList.toggle("active", this.enabled);
    canvas.classList.toggle("eraser", this.tool.mode === "eraser");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(pageDiv.clientWidth * dpr);
    const h = Math.round(pageDiv.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.redraw(pageNumber);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    for (const c of this.canvases.values()) {
      c.classList.toggle("active", on);
      c.classList.toggle("eraser", this.tool.mode === "eraser");
    }
  }

  undo() {
    const a = this.history.pop();
    if (!a) return;
    const list = (this.data[a.page] ??= []);
    if (a.type === "add") {
      const i = list.lastIndexOf(a.stroke);
      if (i >= 0) list.splice(i, 1);
    } else {
      // Silinen çizgileri silindikleri sıranın tersine, eski yerlerine geri koy
      for (let k = a.removed.length - 1; k >= 0; k--) {
        const r = a.removed[k];
        list.splice(Math.min(r.index, list.length), 0, r.stroke);
      }
    }
    this.redraw(a.page);
    this.onChange();
  }

  clearPage(page: number) {
    if (!this.data[page]?.length) return;
    delete this.data[page];
    this.history = this.history.filter((a) => a.page !== page);
    this.redraw(page);
    this.onChange();
  }

  hasInk(page: number) {
    return !!this.data[page]?.length;
  }

  destroy() {
    for (const c of this.canvases.values()) c.remove();
    this.canvases.clear();
  }

  private redraw(page: number) {
    const canvas = this.canvases.get(page);
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of this.data[page] ?? []) this.drawStroke(ctx, canvas, s);
  }

  private drawStroke(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, s: Stroke) {
    const W = canvas.width;
    const H = canvas.height;
    const p = s.p;
    if (p.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = s.e ? "destination-out" : "source-over";
    ctx.strokeStyle = s.c ?? "#000";
    ctx.fillStyle = s.c ?? "#000";
    ctx.lineWidth = Math.max(0.5, s.w * W);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (p.length === 2) {
      ctx.beginPath();
      ctx.arc(p[0] * W, p[1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Noktalar arasında yumuşak eğri
      ctx.beginPath();
      ctx.moveTo(p[0] * W, p[1] * H);
      for (let i = 2; i < p.length - 2; i += 2) {
        const mx = ((p[i] + p[i + 2]) / 2) * W;
        const my = ((p[i + 1] + p[i + 3]) / 2) * H;
        ctx.quadraticCurveTo(p[i] * W, p[i + 1] * H, mx, my);
      }
      ctx.lineTo(p[p.length - 2] * W, p[p.length - 1] * H);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Silgi: (x, y) noktasının (0–1) değdiği çizgileri bütünüyle siler */
  private eraseAt(page: number, canvas: HTMLCanvasElement, x: number, y: number, action: EraseAction) {
    const list = this.data[page];
    if (!list?.length) return false;
    const r = canvas.getBoundingClientRect();
    const radius = Math.max(this.tool.size * 1.5, 7);
    let changed = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s.e) continue; // eski sürümden kalan silgi izleri
      if (strokeHit(s, x * r.width, y * r.height, r.width, r.height, radius)) {
        action.removed.push({ stroke: s, index: i });
        list.splice(i, 1);
        changed = true;
      }
    }
    return changed;
  }

  private bind(canvas: HTMLCanvasElement, page: number) {
    let stroke: Stroke | null = null;
    let erasing: EraseAction | null = null;
    let lastX = 0;
    let lastY = 0;

    const point = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
    };
    const eventsOf = (e: PointerEvent) => {
      const coalesced = e.getCoalescedEvents?.() ?? [];
      return coalesced.length ? coalesced : [e];
    };

    // Hızlı hareketlerde araya düşen ince çizgileri kaçırmamak için yol boyunca örnekle
    const eraseAlong = (x: number, y: number) => {
      if (!erasing) return false;
      const r = canvas.getBoundingClientRect();
      const distPx = Math.hypot((x - lastX) * r.width, (y - lastY) * r.height);
      const steps = Math.max(1, Math.ceil(distPx / 4));
      let changed = false;
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        changed = this.eraseAt(page, canvas, lastX + (x - lastX) * t, lastY + (y - lastY) * t, erasing) || changed;
      }
      lastX = x;
      lastY = y;
      return changed;
    };

    canvas.addEventListener("pointerdown", (e) => {
      if (!this.enabled || e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = point(e);
      lastX = x;
      lastY = y;
      const t = this.tool;
      if (t.mode === "eraser") {
        erasing = { type: "erase", page, removed: [] };
        if (this.eraseAt(page, canvas, x, y, erasing)) this.redraw(page);
        return;
      }
      const r = canvas.getBoundingClientRect();
      stroke = { c: t.color, w: round(t.size / r.width), p: [round(x), round(y)] };
      this.drawStroke(canvas.getContext("2d")!, canvas, stroke);
    });

    canvas.addEventListener("pointermove", (e) => {
      if (erasing) {
        let changed = false;
        for (const ev of eventsOf(e)) {
          const [x, y] = point(ev);
          changed = eraseAlong(x, y) || changed;
        }
        if (changed) this.redraw(page);
        return;
      }
      if (!stroke) return;
      const ctx = canvas.getContext("2d")!;
      const W = canvas.width;
      const H = canvas.height;
      ctx.save();
      ctx.strokeStyle = stroke.c ?? "#000";
      ctx.lineWidth = Math.max(0.5, stroke.w * W);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(lastX * W, lastY * H);
      for (const ev of eventsOf(e)) {
        const [x, y] = point(ev);
        // Çok yakın noktaları atla → az veri, hafif dosya
        if (Math.abs(x - lastX) + Math.abs(y - lastY) < 0.0015) continue;
        ctx.lineTo(x * W, y * H);
        stroke.p.push(round(x), round(y));
        lastX = x;
        lastY = y;
      }
      ctx.stroke();
      ctx.restore();
    });

    const end = () => {
      if (erasing) {
        if (erasing.removed.length) {
          this.history.push(erasing);
          this.onChange();
        }
        erasing = null;
        return;
      }
      if (!stroke) return;
      (this.data[page] ??= []).push(stroke);
      this.history.push({ type: "add", page, stroke });
      stroke = null;
      this.redraw(page); // eğri yumuşatmasıyla son hali
      this.onChange();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }
}
