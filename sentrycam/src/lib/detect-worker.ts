/**
 * Web Worker for object detection using TensorFlow.js + COCO-SSD.
 * Runs entirely off the main thread to avoid impacting video playback.
 *
 * Protocol:
 *   Main → Worker:  { type: 'detect', id, bitmap: ImageBitmap }
 *   Worker → Main:  { type: 'result', id, detections: Detection[] }
 *   Worker → Main:  { type: 'status', status: ModelStatus, progress: number }
 */

// We're in a worker — no DOM, but OffscreenCanvas is available.

export interface Detection {
  bbox: [number, number, number, number];
  class: string;
  score: number;
}

const DASHCAM_CLASSES = new Set([
  'person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck',
  'traffic light', 'stop sign', 'fire hydrant',
  'parking meter', 'bench',
  'dog', 'cat', 'horse', 'bird',
  'backpack', 'umbrella', 'handbag', 'suitcase',
  'skateboard',
  'potted plant',
]);

const MIN_CONFIDENCE = 0.25;

let model: any = null;
let loading = false;

function postStatus(status: string, progress: number) {
  self.postMessage({ type: 'status', status, progress });
}

async function loadModel() {
  if (model || loading) return;
  loading = true;
  postStatus('loading', 0);

  const start = performance.now();
  const RAMP_DURATION = 4000;
  const timer = setInterval(() => {
    const elapsed = performance.now() - start;
    const t = Math.min(elapsed / RAMP_DURATION, 1);
    const eased = 1 - (1 - t) * (1 - t);
    postStatus('loading', Math.min(eased * 90, 90));
    if (t >= 1) clearInterval(timer);
  }, 100);

  try {
    // Import TF.js and COCO-SSD
    await import('@tensorflow/tfjs');
    const cocoSsd = await import('@tensorflow-models/coco-ssd');
    model = await cocoSsd.load({ base: 'mobilenet_v2' });
    clearInterval(timer);
    postStatus('ready', 100);
    console.log('[DetectWorker] COCO-SSD model loaded');
  } catch (e) {
    clearInterval(timer);
    postStatus('error', 0);
    console.error('[DetectWorker] Failed to load model:', e);
  } finally {
    loading = false;
  }
}

async function runDetection(bitmap: ImageBitmap): Promise<Detection[]> {
  if (!model) return [];

  try {
    // Draw bitmap onto an OffscreenCanvas so TF.js can read pixels
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(bitmap, 0, 0);

    const predictions = await model.detect(canvas, 20);

    return predictions
      .filter(
        (p: any) => DASHCAM_CLASSES.has(p.class) && p.score >= MIN_CONFIDENCE
      )
      .map((p: any) => ({
        bbox: p.bbox as [number, number, number, number],
        class: p.class,
        score: p.score,
      }));
  } catch (e) {
    console.warn('[DetectWorker] Detection error:', e);
    return [];
  } finally {
    bitmap.close(); // Release the transferred ImageBitmap
  }
}

// Message handler
self.onmessage = async (e: MessageEvent) => {
  const { type, id, bitmap } = e.data;

  if (type === 'init') {
    await loadModel();
    return;
  }

  if (type === 'detect') {
    // Ensure model is loaded
    if (!model) {
      await loadModel();
    }

    const detections = await runDetection(bitmap);
    self.postMessage({ type: 'result', id, detections });
  }
};

// Start loading immediately when worker is created
loadModel();
