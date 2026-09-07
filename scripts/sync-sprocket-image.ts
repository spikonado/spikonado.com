/**
 * Pull the latest Sprocket screenshot from GitHub into the bundled fallback asset.
 * Compresses to WebP so the repo stays under the large-file limit.
 * On failure, keep the existing local fallback so builds still succeed.
 */
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SPROCKET_IMAGE_REMOTE_URL } from '../src/lib/sprocket-image';

const DEST = new URL('../src/assets/sprocket.webp', import.meta.url);
const MIN_BYTES = 1_000;
const TIMEOUT_MS = 15_000;
const FALLBACK_WIDTH = 1280;
const WEBP_QUALITY = 80;

async function fetchRemoteImage(): Promise<Uint8Array> {
	const response = await fetch(SPROCKET_IMAGE_REMOTE_URL, {
		headers: { Accept: 'image/png,image/*;q=0.9,*/*;q=0.8' },
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`);
	}

	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength < MIN_BYTES) {
		throw new Error(`Response too small (${bytes.byteLength} bytes)`);
	}

	const contentType = response.headers.get('content-type') ?? '';
	if (contentType && !contentType.includes('image') && !contentType.includes('octet-stream')) {
		throw new Error(`Unexpected content-type: ${contentType}`);
	}

	return bytes;
}

/** Scale to a 1280px-wide WebP, matching the old ffmpeg `-vf scale=1280:-1 -quality 80`. */
export async function compressToWebp(sourcePng: Uint8Array): Promise<Uint8Array> {
	const { data } = await sharp(sourcePng)
		.resize({ width: FALLBACK_WIDTH })
		.webp({ quality: WEBP_QUALITY })
		.toUint8Array();
	return data;
}

async function sync() {
	const remote = await fetchRemoteImage();
	const webp = await compressToWebp(remote);
	const destPath = fileURLToPath(DEST);
	await mkdir(dirname(destPath), { recursive: true });
	await Bun.write(DEST, webp);
	console.log(
		`Synced Sprocket fallback (${remote.byteLength} bytes -> ${webp.byteLength} bytes webp) -> ${destPath}`
	);
}

if (import.meta.main) {
	try {
		await sync();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`Keeping bundled Sprocket image fallback (GitHub sync failed: ${message})`);
	}
}
