import { describe, expect, test } from 'bun:test';
import { compressToWebp } from './sync-sprocket-image.ts';

const TWO_BY_ONE_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWMQkdMQkdMAAAJVALUH2hhGAAAAAElFTkSuQmCC',
	'base64'
);

describe('compressToWebp', () => {
	test('scales the source to a 1280px-wide WebP', async () => {
		const webp = await compressToWebp(TWO_BY_ONE_PNG);
		const metadata = await new Bun.Image(webp).metadata();

		expect(metadata).toEqual({ format: 'webp', width: 1280, height: 640 });
	});
});
