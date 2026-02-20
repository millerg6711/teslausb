/**
 * Object detection coordinator.
 * Delegates inference to a Web Worker running TF.js + COCO-SSD off the main thread.
 * The main thread only handles capturing ImageBitmaps and drawing bounding boxes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Detection {
  bbox: [number, number, number, number]; // [x, y, width, height] in pixels
  class: string;
  score: number;
}

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

// ---------------------------------------------------------------------------
// Status listeners
// ---------------------------------------------------------------------------

type StatusListener = (status: ModelStatus, progress: number) => void;

let currentStatus: ModelStatus = 'idle';
let currentProgress = 0;
const listeners = new Set<StatusListener>();

function setStatus(status: ModelStatus, progress: number) {
  currentStatus = status;
  currentProgress = progress;
  listeners.forEach((fn) => fn(status, progress));
}

/** Subscribe to model loading status changes. Returns unsubscribe fn. */
export function onStatusChange(fn: StatusListener): () => void {
  listeners.add(fn);
  fn(currentStatus, currentProgress);
  return () => { listeners.delete(fn); };
}

export function getModelStatus(): { status: ModelStatus; progress: number } {
  return { status: currentStatus, progress: currentProgress };
}

export function isModelReady(): boolean {
  return currentStatus === 'ready';
}

// ---------------------------------------------------------------------------
// Worker management
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let requestId = 0;
const pendingRequests = new Map<number, (detections: Detection[]) => void>();

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL('./detect-worker.ts', import.meta.url));

  worker.onmessage = (e: MessageEvent) => {
    const { type, id, detections, status, progress } = e.data;

    if (type === 'status') {
      setStatus(status as ModelStatus, progress as number);
    }

    if (type === 'result') {
      const resolve = pendingRequests.get(id);
      if (resolve) {
        pendingRequests.delete(id);
        resolve(detections as Detection[]);
      }
    }
  };

  worker.onerror = (e) => {
    console.error('[ObjectDetector] Worker error:', e);
    setStatus('error', 0);
  };

  return worker;
}

/** Preload the model in the worker. */
export function loadModel(): void {
  if (typeof window === 'undefined') return;
  getWorker(); // Worker auto-loads model on creation
}

/**
 * Run object detection on a canvas element.
 * Captures an ImageBitmap (fast, off-main-thread safe) and sends it to the worker.
 */
export async function detect(canvas: HTMLCanvasElement): Promise<Detection[]> {
  if (currentStatus !== 'ready') return [];

  try {
    // Capture frame as ImageBitmap (very fast, doesn't block main thread)
    const bitmap = await createImageBitmap(canvas);

    return new Promise<Detection[]>((resolve) => {
      const id = ++requestId;

      // Timeout: if worker doesn't respond in 2s, resolve empty
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        resolve([]);
      }, 2000);

      pendingRequests.set(id, (dets) => {
        clearTimeout(timeout);
        resolve(dets);
      });

      getWorker().postMessage(
        { type: 'detect', id, bitmap },
        [bitmap] // Transfer ownership (zero-copy)
      );
    });
  } catch (e) {
    console.warn('[ObjectDetector] Failed to capture bitmap:', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Drawing (stays on main thread — uses DOM canvas)
// ---------------------------------------------------------------------------

const CLASS_COLORS: Record<string, string> = {
  person: '#FF6B6B',
  bicycle: '#4ECDC4',
  car: '#45B7D1',
  motorcycle: '#96CEB4',
  bus: '#FFEAA7',
  truck: '#DDA0DD',
  'traffic light': '#00FF88',
  'stop sign': '#FF4757',
  'fire hydrant': '#FF6348',
  'parking meter': '#C4E538',
  bench: '#7D8B8A',
  dog: '#FFA502',
  cat: '#A29BFE',
  horse: '#D4A574',
  bird: '#74B9FF',
  backpack: '#E17055',
  umbrella: '#00CEC9',
  handbag: '#E84393',
  suitcase: '#6C5CE7',
  skateboard: '#FDCB6E',
  'potted plant': '#00B894',
};

const DEFAULT_COLOR = '#45B7D1';

/**
 * Draw bounding boxes on an overlay canvas.
 */
export function drawDetections(
  ctx: CanvasRenderingContext2D,
  detections: Detection[],
  canvasWidth: number,
  canvasHeight: number,
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  for (const det of detections) {
    const [x, y, w, h] = det.bbox;
    const color = CLASS_COLORS[det.class] || DEFAULT_COLOR;
    const label = `${det.class} ${Math.round(det.score * 100)}%`;

    // Draw box
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Corner accents (HUD style)
    const cornerLen = Math.min(12, w * 0.2, h * 0.2);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + cornerLen);
    ctx.lineTo(x, y);
    ctx.lineTo(x + cornerLen, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + w - cornerLen, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + cornerLen);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + h - cornerLen);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + cornerLen, y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + w - cornerLen, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - cornerLen);
    ctx.stroke();

    // Label background
    ctx.font = 'bold 11px system-ui, sans-serif';
    const textMetrics = ctx.measureText(label);
    const textH = 16;
    const textW = textMetrics.width + 8;
    const labelY = y > textH + 2 ? y - textH - 2 : y + h + 2;

    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, labelY, textW, textH);
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#000';
    ctx.fillText(label, x + 4, labelY + 12);
  }
}

/**
 * Clear the overlay canvas.
 */
export function clearOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.clearRect(0, 0, width, height);
}
