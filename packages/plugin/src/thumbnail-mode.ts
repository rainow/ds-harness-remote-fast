/**
 * Forced thumbnail mode: re-encode images before they leave the Host.
 *
 * Remote clients fetch session images one by one through `session/attachment`
 * (history only carries an `ImageAttachmentRef`). In this mode the Host answers
 * that call with a downscaled JPEG while keeping the recorded reference intact,
 * because clients verify `bytes` / `width` / `height` against the record and
 * reject a mismatch.
 *
 * Trade-off: an image opened full-screen is the same thumbnail. The mode is
 * therefore opt-in and meant for bandwidth, not for reading fine detail.
 */

/** Images at or below this size are forwarded untouched (thumbnails are not worth it). */
export const THUMBNAIL_MIN_BYTES = 256 * 1024

/** Longest edge of a thumbnail, in pixels. */
export const THUMBNAIL_MAX_EDGE = 1024

/** JPEG quality of a thumbnail. */
export const THUMBNAIL_QUALITY = 75

/**
 * Process-wide switch, mirroring lite mode: one Host process serves every
 * connection, so a module-level flag applies to the next call without a restart.
 */
let enabled = false

/** Whether forced thumbnails are currently on. */
export function isThumbnailModeEnabled(): boolean {
  return enabled
}

/** Flip forced thumbnails for subsequent attachment reads. */
export function setThumbnailModeEnabled(next: boolean): void {
  enabled = next === true
}
