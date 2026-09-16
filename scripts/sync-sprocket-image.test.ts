import { describe, expect, test } from 'bun:test';
import { compressToWebp } from './sync-sprocket-image.ts';

const ONE_PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64'
);

describe('compressToWebp', () => {
	test('scales the source to a 1280px-wide WebP', async () => {
		const webp = await compressToWebp(ONE_PIXEL_PNG);
		const metadata = await new Bun.Image(webp).metadata();

		expect(metadata).toEqual({ format: 'webp', width: 1280, height: 1280 });
	});
});
