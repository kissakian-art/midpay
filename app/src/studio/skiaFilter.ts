import { File, Paths } from "expo-file-system";
import { isColorFilter, NONE, type Filter } from "./filters";

// Type-only module reference — erased at runtime, so it never triggers native
// init. The runtime value comes from the lazy require() in loadSkia().
type SkiaModule = typeof import("@shopify/react-native-skia");

/**
 * On-device filter BAKING (Stage 1 of the GPU pipeline): render a captured
 * photo through the filter's 4x5 colour matrix with Skia, offscreen, and write
 * the result to a new file. The engine (colorMatrix / filters / faceBlur) is
 * untouched — this just wires its matrices to real pixels.
 *
 * Scope of Stage 1:
 *   - COLOUR filters (aesthetic + cinematic) bake fully.
 *   - The "Original" filter and PRIVACY filters (face blur/pixelate/bar) are
 *     passthrough here — privacy needs live face detection (Stage 2, VisionCamera
 *     + ML Kit). Nothing claims to be filtered when it isn't.
 *
 * Fail-safe: Skia is lazy-required inside a try/catch. If the native module is
 * missing (e.g. a build without Skia linked) or anything throws, we return the
 * ORIGINAL uri with filtered:false so posting is never blocked and the Studio
 * screen can't be crashed by the filter path.
 */
export interface BakeResult {
  uri: string;
  filtered: boolean;
}

let skiaCache: SkiaModule | null | undefined;

function loadSkia(): SkiaModule | null {
  if (skiaCache === undefined) {
    try {
      // Lazy runtime require so a build without the native module degrades
      // gracefully instead of throwing at import time.
      skiaCache = require("@shopify/react-native-skia") as SkiaModule;
    } catch {
      skiaCache = null;
    }
  }
  return skiaCache;
}

const passthrough = (uri: string): BakeResult => ({ uri, filtered: false });

export async function bakeFilterIntoPhoto(uri: string, filter: Filter): Promise<BakeResult> {
  // Only colour filters bake in Stage 1; "Original" and privacy filters pass through.
  if (filter.id === NONE.id || !isColorFilter(filter)) return passthrough(uri);

  const mod = loadSkia();
  if (!mod) return passthrough(uri);
  const { Skia, ImageFormat } = mod;

  try {
    const data = await Skia.Data.fromURI(uri);
    const image = Skia.Image.MakeImageFromEncoded(data);
    if (!image) return passthrough(uri);

    const width = image.width();
    const height = image.height();
    const surface = Skia.Surface.MakeOffscreen(width, height);
    if (!surface) return passthrough(uri);

    const paint = Skia.Paint();
    paint.setColorFilter(Skia.ColorFilter.MakeMatrix(filter.matrix));

    const canvas = surface.getCanvas();
    canvas.drawImage(image, 0, 0, paint);
    surface.flush();

    const snapshot = surface.makeImageSnapshot();
    const bytes = snapshot.encodeToBytes(ImageFormat.JPEG, 92);

    const file = new File(Paths.cache, `midpay-filtered-${Date.now()}.jpg`);
    file.create();
    file.write(bytes);

    return { uri: file.uri, filtered: true };
  } catch {
    // Any native/encoding/IO failure must never block a post.
    return passthrough(uri);
  }
}

/** Whether on-device colour-filter baking is wired and the native module loads. */
export function isFilterBakingAvailable(): boolean {
  return loadSkia() !== null;
}
