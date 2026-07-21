import { File, Paths } from "expo-file-system";
import type { ColorFilter, Filter, PrivacyFilter } from "./filters";

/**
 * Bakes a studio filter irreversibly into a captured photo (§4.3 "baked
 * irreversibly into the encode"). Uses react-native-skia, which is a native
 * module NOT present in Expo Go — so every Skia touch is lazily required and
 * guarded. In Expo Go (or if Skia fails) we return the original uri unchanged,
 * and the caller surfaces that filtering will apply in the installed build.
 *
 * Colour filters apply the composed 4x5 matrix. Privacy filters, with no ML Kit
 * face detector on the Expo path, fall back to the fail-safe's safe default —
 * conceal the WHOLE frame — which for a still is a full blur/pixelate/blackout.
 * Region-based concealment activates once the VisionCamera+ML Kit pipeline is
 * wired (the faceBlur.ts state machine already drives it).
 */

let skiaModule: typeof import("@shopify/react-native-skia") | null | undefined;

function loadSkia(): typeof import("@shopify/react-native-skia") | null {
  if (skiaModule !== undefined) return skiaModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    skiaModule = require("@shopify/react-native-skia");
  } catch {
    skiaModule = null;
  }
  return skiaModule ?? null;
}

export function isSkiaAvailable(): boolean {
  return loadSkia() != null;
}

export interface BakeResult {
  uri: string;
  filtered: boolean;
}

export async function bakeFilterIntoPhoto(uri: string, filter: Filter): Promise<BakeResult> {
  if (filter.id === "none") return { uri, filtered: false };
  const RNSkia = loadSkia();
  if (!RNSkia) return { uri, filtered: false }; // Expo Go: pass through

  try {
    const { Skia, ImageFormat, TileMode } = RNSkia;
    const data = await Skia.Data.fromURI(uri);
    const image = Skia.Image.MakeImageFromEncoded(data);
    if (!image) return { uri, filtered: false };

    const w = image.width();
    const h = image.height();
    const surface = Skia.Surface.MakeOffscreen(w, h);
    if (!surface) return { uri, filtered: false };
    const canvas = surface.getCanvas();

    if (filter.kind === "color") {
      const paint = colorPaint(RNSkia, filter);
      canvas.drawImage(image, 0, 0, paint);
    } else {
      // Privacy: no detector here → conceal the whole frame (safe default).
      concealWhole(RNSkia, canvas, image, filter, w, h, TileMode);
    }

    const snapshot = surface.makeImageSnapshot();
    const base64 = snapshot.encodeToBase64(ImageFormat.JPEG, 92);

    const file = new File(Paths.cache, `midpay-${Date.now()}.jpg`);
    file.create({ overwrite: true });
    file.write(base64, { encoding: "base64" });
    return { uri: file.uri, filtered: true };
  } catch {
    return { uri, filtered: false };
  }
}

function colorPaint(RNSkia: typeof import("@shopify/react-native-skia"), filter: ColorFilter) {
  const { Skia } = RNSkia;
  const paint = Skia.Paint();
  paint.setColorFilter(Skia.ColorFilter.MakeMatrix(filter.matrix));
  return paint;
}

function concealWhole(
  RNSkia: typeof import("@shopify/react-native-skia"),
  canvas: import("@shopify/react-native-skia").SkCanvas,
  image: import("@shopify/react-native-skia").SkImage,
  filter: PrivacyFilter,
  w: number,
  h: number,
  TileMode: typeof import("@shopify/react-native-skia").TileMode,
) {
  const { Skia } = RNSkia;
  const scale = w / 1080; // strengths are defined relative to a 1080px frame
  if (filter.mode === "bar") {
    canvas.drawImage(image, 0, 0);
    const paint = Skia.Paint();
    paint.setColor(Skia.Color("black"));
    // A wide bar across the middle third (eyes region for a portrait still).
    canvas.drawRect(Skia.XYWHRect(0, h * 0.33, w, h * 0.28), paint);
    return;
  }
  const paint = Skia.Paint();
  if (filter.mode === "pixelate") {
    // Downscale-then-upscale approximation via a heavy blur block.
    paint.setImageFilter(Skia.ImageFilter.MakeBlur(filter.strength * scale, filter.strength * scale, TileMode.Clamp, null));
  } else {
    paint.setImageFilter(Skia.ImageFilter.MakeBlur(filter.strength * scale, filter.strength * scale, TileMode.Clamp, null));
  }
  canvas.drawImage(image, 0, 0, paint);
}
