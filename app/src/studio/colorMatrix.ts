/**
 * 4x5 color-matrix algebra (row-major RGBA + offset), the format Skia's
 * `ColorMatrix` consumes. All 20 studio filters (§4.3) are composed from these
 * primitives, which makes them pure data — no GPU needed to define or test.
 *
 * A matrix has 20 numbers: for each output channel (R,G,B,A) five coefficients
 * [cR, cG, cB, cA, offset]. Colors are normalized to [0,1]; `offset` adds in
 * that space (0.05 ≈ +13 on a 0–255 scale).
 */
export type ColorMatrix = number[]; // length 20

export const IDENTITY: ColorMatrix = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

// Rec. 709 luma weights (perceptual grayscale).
const LR = 0.2126, LG = 0.7152, LB = 0.0722;

/** Compose two matrices: apply `a` first, then `b` (b∘a). */
export function multiply(b: ColorMatrix, a: ColorMatrix): ColorMatrix {
  // Treat each as a 5x5 with an implicit last row [0,0,0,0,1].
  const out = new Array(20).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += b[row * 5 + k] * a[k * 5 + col];
      if (col === 4) sum += b[row * 5 + 4]; // implicit a[4][4] = 1
      out[row * 5 + col] = sum;
    }
  }
  return out;
}

export function compose(...matrices: ColorMatrix[]): ColorMatrix {
  // Left-to-right visual order: first listed is applied first.
  return matrices.reduce((acc, m) => multiply(m, acc), IDENTITY);
}

/** Saturation: 0 = grayscale, 1 = unchanged, >1 = boosted. */
export function saturation(s: number): ColorMatrix {
  const ir = (1 - s) * LR, ig = (1 - s) * LG, ib = (1 - s) * LB;
  return [
    ir + s, ig, ib, 0, 0,
    ir, ig + s, ib, 0, 0,
    ir, ig, ib + s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Contrast around mid-grey: 1 = unchanged, >1 = punchier. */
export function contrast(c: number): ColorMatrix {
  const t = 0.5 * (1 - c);
  return [
    c, 0, 0, 0, t,
    0, c, 0, 0, t,
    0, 0, c, 0, t,
    0, 0, 0, 1, 0,
  ];
}

/** Uniform brightness add (in [0,1] space). */
export function brightness(add: number): ColorMatrix {
  return [
    1, 0, 0, 0, add,
    0, 1, 0, 0, add,
    0, 0, 1, 0, add,
    0, 0, 0, 1, 0,
  ];
}

/** Per-channel multiply + add — the workhorse for warm/cool tints. */
export function tint(
  rMul: number, gMul: number, bMul: number,
  rAdd = 0, gAdd = 0, bAdd = 0,
): ColorMatrix {
  return [
    rMul, 0, 0, 0, rAdd,
    0, gMul, 0, 0, gAdd,
    0, 0, bMul, 0, bAdd,
    0, 0, 0, 1, 0,
  ];
}

export function grayscale(): ColorMatrix {
  return saturation(0);
}

export function sepia(): ColorMatrix {
  return [
    0.393, 0.769, 0.189, 0, 0,
    0.349, 0.686, 0.168, 0, 0,
    0.272, 0.534, 0.131, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Apply a matrix to a single normalized RGBA color — used by tests. */
export function applyToColor(m: ColorMatrix, rgba: [number, number, number, number]): [number, number, number, number] {
  const [r, g, b, a] = rgba;
  const out: number[] = [];
  for (let row = 0; row < 4; row++) {
    out[row] =
      m[row * 5] * r +
      m[row * 5 + 1] * g +
      m[row * 5 + 2] * b +
      m[row * 5 + 3] * a +
      m[row * 5 + 4];
  }
  return [out[0], out[1], out[2], out[3]];
}
