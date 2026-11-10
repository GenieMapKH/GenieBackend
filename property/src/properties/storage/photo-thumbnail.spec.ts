import sharp from 'sharp';
import { makePhotoThumbnail } from './photo-thumbnail';

describe('makePhotoThumbnail', () => {
  async function photo(width: number, height: number) {
    // Noise, like a real photo: a flat colour would compress to nothing.
    const pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7919) % 256;
    return sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  it('shrinks the shorter side to 600 px, keeping the shape', async () => {
    const original = await photo(1707, 1280);

    const thumbnail = await makePhotoThumbnail(original);

    const { width, height, format } = await sharp(thumbnail).metadata();
    expect(format).toBe('jpeg');
    expect(height).toBe(600);
    expect(width).toBe(800);
    expect(thumbnail.length).toBeLessThan(original.length / 3);
  });

  it('does not enlarge a photo that is already small', async () => {
    const thumbnail = await makePhotoThumbnail(await photo(400, 300));

    const { width, height } = await sharp(thumbnail).metadata();
    expect([width, height]).toEqual([400, 300]);
  });

  it('refuses a file that is not a picture', async () => {
    await expect(
      makePhotoThumbnail(Buffer.from('<html></html>')),
    ).rejects.toThrow();
  });
});
