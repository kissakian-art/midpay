/**
 * Face-concealment fail-safe (§4.3, hard requirement): "a tracking hiccup can
 * never reveal identity." Pure state machine — no camera, no GPU — so it's
 * fully unit-testable. Feeds the GPU layer a region (or the whole frame) to
 * conceal every frame that privacy is active.
 *
 * Rules:
 *  - When a face is detected: conceal an OVER-SIZED, temporally-SMOOTHED box
 *    around it (over-size absorbs tracking jitter; smoothing avoids popping).
 *  - When detection drops for a FEW frames: hold the last-known region.
 *  - When detection stays lost (or was never acquired): conceal the WHOLE frame.
 *    Safe-by-default — we never emit "nothing to conceal" while privacy is on.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConcealResult {
  mode: "region" | "whole";
  region: Rect | null; // set when mode === "region"
}

const OVERSIZE = 1.4; // grow detected box 40% each dimension
const SMOOTH = 0.5; // lerp factor toward the new box (0..1)
const HOLD_FRAMES = 6; // ~200ms at 30fps: hold last region before going full-frame

export class FaceConcealer {
  private held: Rect | null = null;
  private misses = 0;

  constructor(
    private readonly frameWidth: number,
    private readonly frameHeight: number,
  ) {}

  /** Advance one frame with the faces the detector reported (may be empty). */
  update(faces: Rect[]): ConcealResult {
    if (faces.length > 0) {
      this.misses = 0;
      const target = oversize(largest(faces), OVERSIZE, this.frameWidth, this.frameHeight);
      this.held = this.held ? lerpRect(this.held, target, SMOOTH) : target;
      return { mode: "region", region: this.held };
    }

    this.misses++;
    if (this.held && this.misses <= HOLD_FRAMES) {
      // Brief hiccup — keep concealing the last spot.
      return { mode: "region", region: this.held };
    }
    // Lost for too long, or never saw a face: conceal everything.
    return { mode: "whole", region: null };
  }

  reset(): void {
    this.held = null;
    this.misses = 0;
  }
}

export function largest(faces: Rect[]): Rect {
  return faces.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
}

export function oversize(r: Rect, factor: number, frameW: number, frameH: number): Rect {
  const dw = r.width * (factor - 1);
  const dh = r.height * (factor - 1);
  const x = Math.max(0, r.x - dw / 2);
  const y = Math.max(0, r.y - dh / 2);
  const width = Math.min(frameW - x, r.width + dw);
  const height = Math.min(frameH - y, r.height + dh);
  return { x, y, width, height };
}

function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t,
    height: a.height + (b.height - a.height) * t,
  };
}
