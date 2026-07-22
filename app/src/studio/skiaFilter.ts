import type { Filter } from "./filters";

/**
 * Filter BAKING is deferred to the GPU-pipeline milestone. Doing it on-device
 * needs react-native-skia + its peers (reanimated + worklets) — a native stack
 * that must be configured and verified together on a dev build. Adding Skia
 * alone (without its peers) hard-crashed the app on the studio screen, so it's
 * removed for now and this is a SAFE PASSTHROUGH: media uploads unfiltered and
 * the chosen filter is recorded on the post. No native module is touched.
 *
 * The filter ENGINE (colorMatrix / filters / faceBlur) is untouched and tested,
 * so re-enabling baking later is just wiring the renderer back to this call.
 */
export interface BakeResult {
  uri: string;
  filtered: boolean;
}

export async function bakeFilterIntoPhoto(uri: string, _filter: Filter): Promise<BakeResult> {
  return { uri, filtered: false };
}

/** Whether on-device filter baking is wired (false until the GPU pipeline lands). */
export function isFilterBakingAvailable(): boolean {
  return false;
}
