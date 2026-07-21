import {
  brightness,
  compose,
  contrast,
  grayscale,
  IDENTITY,
  saturation,
  sepia,
  tint,
  type ColorMatrix,
} from "./colorMatrix";

/**
 * The curated studio filter set (§4.3): 5 aesthetic + 3 privacy + 12 cinematic
 * = 20. Colour filters carry a composed 4x5 matrix; privacy filters carry a
 * face-concealment config (driven by the fail-safe tracker in faceBlur.ts).
 *
 * `approximate: true` flags filters that are a reasonable colour-matrix stand-in
 * but are NOT the full production algorithm (e.g. teeth whitening really needs
 * mouth segmentation, lens correction needs a geometric warp). Honest labelling
 * so nobody ships thinking those are finished.
 */
export type FilterGroup = "aesthetic" | "privacy" | "cinematic";
export type PrivacyMode = "blur" | "pixelate" | "bar";

export interface ColorFilter {
  id: string;
  name: string;
  group: Exclude<FilterGroup, "privacy">;
  kind: "color";
  matrix: ColorMatrix;
  approximate?: boolean;
}

export interface PrivacyFilter {
  id: string;
  name: string;
  group: "privacy";
  kind: "privacy";
  mode: PrivacyMode;
  /** Blur radius (px) or pixelation block size (px), relative to a 1080px frame. */
  strength: number;
}

export type Filter = ColorFilter | PrivacyFilter;

export const NONE: ColorFilter = {
  id: "none",
  name: "Original",
  group: "aesthetic",
  kind: "color",
  matrix: IDENTITY,
};

// --- 5 Core Aesthetic Enhancements ---
const AESTHETIC: ColorFilter[] = [
  {
    id: "lowlight",
    name: "Low-Light Boost",
    group: "aesthetic",
    kind: "color",
    matrix: compose(brightness(0.08), contrast(1.12), saturation(1.05)),
  },
  {
    id: "smooth",
    name: "Blemish Smooth",
    group: "aesthetic",
    kind: "color",
    // Colour-matrix approximation (gentle desaturate + lift); true smoothing is
    // a bilateral blur, applied in the GPU pipeline when available.
    matrix: compose(saturation(0.9), brightness(0.03)),
    approximate: true,
  },
  {
    id: "teeth",
    name: "Teeth Whiten",
    group: "aesthetic",
    kind: "color",
    // Approx: lift blue + brightness to counter yellow. Real version needs
    // mouth segmentation.
    matrix: tint(1.02, 1.02, 1.06, 0.01, 0.01, 0.03),
    approximate: true,
  },
  {
    id: "lens",
    name: "Lens Correct",
    group: "aesthetic",
    kind: "color",
    // Placeholder: geometric barrel/pincushion correction is a mesh warp, not a
    // colour matrix — passthrough until the GPU warp lands.
    matrix: IDENTITY,
    approximate: true,
  },
  {
    id: "glow",
    name: "Soft Glow",
    group: "aesthetic",
    kind: "color",
    matrix: compose(brightness(0.05), saturation(1.08), tint(1.03, 1.0, 0.99)),
  },
];

// --- 3 Privacy / Anonymity filters ---
const PRIVACY: PrivacyFilter[] = [
  { id: "blur", name: "Face Blur", group: "privacy", kind: "privacy", mode: "blur", strength: 45 },
  { id: "pixelate", name: "Pixelate", group: "privacy", kind: "privacy", mode: "pixelate", strength: 28 },
  { id: "bar", name: "Block Bar", group: "privacy", kind: "privacy", mode: "bar", strength: 1 },
];

// --- 12 Cinematic LUTs ---
const CINEMATIC: ColorFilter[] = [
  { id: "golden", name: "Golden Hour", matrix: compose(tint(1.15, 1.05, 0.9, 0.03, 0.01, 0), saturation(1.1)) },
  { id: "corporate", name: "Sharp Corporate", matrix: compose(contrast(1.2), saturation(0.85)) },
  { id: "tealorange", name: "Teal & Orange", matrix: compose(tint(1.12, 1.0, 0.9), saturation(1.15), contrast(1.08)) },
  { id: "matte", name: "Matte B&W", matrix: compose(grayscale(), contrast(0.9), brightness(0.06)) },
  { id: "cyan", name: "Cool Cyan", matrix: compose(tint(0.9, 1.02, 1.12), saturation(1.05)) },
  { id: "vintage", name: "Vintage Film", matrix: compose(sepia(), saturation(0.75), brightness(0.04)) },
  { id: "vivid", name: "Vivid Pop", matrix: compose(saturation(1.4), contrast(1.15)) },
  { id: "noir", name: "Noir", matrix: compose(grayscale(), contrast(1.35)) },
  { id: "sepia", name: "Sepia", matrix: sepia() },
  { id: "pastel", name: "Faded Pastel", matrix: compose(contrast(0.85), saturation(0.85), brightness(0.08)) },
  { id: "moody", name: "Moody Blue", matrix: compose(tint(0.92, 0.96, 1.1), contrast(1.1), brightness(-0.03)) },
  { id: "sunset", name: "Sunset Glow", matrix: compose(tint(1.14, 0.98, 1.02, 0.03, 0, 0.01), saturation(1.12)) },
].map(
  (f): ColorFilter => ({ ...f, group: "cinematic", kind: "color" }),
);

export const FILTERS: Filter[] = [NONE, ...AESTHETIC, ...PRIVACY, ...CINEMATIC];

export const FILTER_GROUPS: { group: FilterGroup; label: string; filters: Filter[] }[] = [
  { group: "aesthetic", label: "Enhance", filters: [NONE, ...AESTHETIC] },
  { group: "privacy", label: "Privacy", filters: PRIVACY },
  { group: "cinematic", label: "Cinematic", filters: CINEMATIC },
];

export function isColorFilter(f: Filter): f is ColorFilter {
  return f.kind === "color";
}
