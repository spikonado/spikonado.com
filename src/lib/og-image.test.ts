import { describe, expect, test } from 'bun:test';
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, renderOgImagePng } from './og-image.ts';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('renderOgImagePng', () => {
	test('renders a PNG at the Open Graph dimensions', async () => {
		const png = await renderOgImagePng();

		expect([...png.subarray(0, PNG_MAGIC.length)]).toEqual(PNG_MAGIC);
		expect(png.byteLength).toBeGreaterThan(8_000);

		const { default: sharp } = await import('sharp');
		const metadata = await sharp(png).metadata();
		expect(metadata.format).toBe('png');
		expect(metadata.width).toBe(OG_IMAGE_WIDTH);
		expect(metadata.height).toBe(OG_IMAGE_HEIGHT);
	});
});
