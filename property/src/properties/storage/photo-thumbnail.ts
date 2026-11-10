import sharp from 'sharp';

/**
 * The shorter side of a thumbnail, in pixels. Cards and list tiles crop the
 * photo to fill their box, so the shorter side is what has to stay sharp: a
 * full-width card on a phone is about 360 points wide.
 */
const THUMBNAIL_SHORT_SIDE = 600;

/** Small enough for a slow connection, without visible blocks on a card. */
const THUMBNAIL_QUALITY = 70;

/**
 * A small JPEG of a listing photo for cards, lists and the map: about a
 * tenth of the original's bytes. Turned upright first, as a phone camera may
 * only record the rotation; a photo already smaller is not enlarged.
 */
export function makePhotoThumbnail(original: Buffer): Promise<Buffer> {
  return sharp(original, { failOn: 'error' })
    .rotate()
    .resize({
      width: THUMBNAIL_SHORT_SIDE,
      height: THUMBNAIL_SHORT_SIDE,
      fit: 'outside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: THUMBNAIL_QUALITY, mozjpeg: true, progressive: true })
    .toBuffer();
}
