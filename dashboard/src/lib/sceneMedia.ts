// Shared orientation-aware scene/media accessors.
// Extracted from StudioPage so the Wizard can reuse the SAME logic without
// duplicating it. StudioPage imports these back in — behaviour is identical.

import type { Video, Scene, StatusType, Orientation } from '../types'

// ---- orientation-aware accessors (never hardcode: follow the video's orientation) ----

export type Ori = 'vertical' | 'horizontal'

export function oriOf(video: Video | null): Ori {
  return video?.orientation === 'HORIZONTAL' ? 'horizontal' : 'vertical'
}

export function ORIENT(ori: Ori): Orientation {
  return ori === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL'
}

export function imgStatus(s: Scene, o: Ori): StatusType {
  return o === 'horizontal' ? s.horizontal_image_status : s.vertical_image_status
}

export function imgUrl(s: Scene, o: Ori): string | null {
  return o === 'horizontal' ? s.horizontal_image_url : s.vertical_image_url
}

export function vidStatus(s: Scene, o: Ori): StatusType {
  return o === 'horizontal' ? s.horizontal_video_status : s.vertical_video_status
}

export function vidUrl(s: Scene, o: Ori): string | null {
  return o === 'horizontal' ? s.horizontal_video_url : s.vertical_video_url
}

export function upStatus(s: Scene, o: Ori): StatusType {
  return o === 'horizontal' ? s.horizontal_upscale_status : s.vertical_upscale_status
}

export function normalizeCharNames(raw: string[] | string | null): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [] } catch { return [] }
}
