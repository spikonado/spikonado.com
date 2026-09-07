import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { compressToWebp } from './sync-sprocket-image.ts';

function isWebp(bytes: Uint8Array): boolean {
	return (
		bytes.byteLength >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	);
}

describe('compressToWebp', () => {
	test('scales to 1280px wide WebP via Sharp toUint8Array', async () => {
		const source = await sharp({
			create: {
				width: 2560,
				height: 1440,
				channels: 3,
				background: { r: 20, g: 30, b: 40 }
			}
		})
			.png()
			.toBuffer();

		const webp = await compressToWebp(source);
		expect(isWebp(webp)).toBe(true);

		const info = await sharp(webp).metadata();
		expect(info.format).toBe('webp');
		expect(info.width).toBe(1280);
		expect(info.height).toBe(720);
	});
});
