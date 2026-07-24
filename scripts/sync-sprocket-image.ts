/**
 * Pull the latest Sprocket screenshot from GitHub into the bundled fallback asset.
 * Compresses to WebP so the repo stays under the large-file limit.
 * On failure, keep the existing local fallback so builds still succeed.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SPROCKET_IMAGE_REMOTE_URL } from '../src/lib/sprocket-image';

const DEST = new URL('../src/assets/sprocket.webp', import.meta.url);
const MIN_BYTES = 1_000;
const TIMEOUT_MS = 15_000;

async function fetchRemoteImage(): Promise<Buffer> {
	const response = await fetch(SPROCKET_IMAGE_REMOTE_URL, {
		headers: { Accept: 'image/png,image/*;q=0.9,*/*;q=0.8' },
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`);
	}

	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.byteLength < MIN_BYTES) {
		throw new Error(`Response too small (${bytes.byteLength} bytes)`);
	}

	const contentType = response.headers.get('content-type') ?? '';
	if (contentType && !contentType.includes('image') && !contentType.includes('octet-stream')) {
		throw new Error(`Unexpected content-type: ${contentType}`);
	}

	return bytes;
}

async function compressToWebp(sourcePng: Buffer): Promise<Buffer> {
	const dir = await mkdtemp(path.join(tmpdir(), 'sprocket-image-'));
	const inputPath = path.join(dir, 'source.png');
	const outputPath = path.join(dir, 'fallback.webp');

	try {
		await writeFile(inputPath, sourcePng);
		const proc = Bun.spawn(
			['ffmpeg', '-y', '-i', inputPath, '-vf', 'scale=1280:-1', '-quality', '80', outputPath],
			{ stdout: 'ignore', stderr: 'pipe' }
		);
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			const stderr = await new Response(proc.stderr).text();
			throw new Error(`ffmpeg failed (${exitCode}): ${stderr.slice(0, 300)}`);
		}
		return Buffer.from(await Bun.file(outputPath).arrayBuffer());
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function sync() {
	const remote = await fetchRemoteImage();
	const webp = await compressToWebp(remote);
	await mkdir(path.dirname(DEST.pathname), { recursive: true });
	await Bun.write(DEST, webp);
	console.log(
		`Synced Sprocket fallback (${remote.byteLength} bytes -> ${webp.byteLength} bytes webp) -> ${DEST.pathname}`
	);
}

try {
	await sync();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.warn(`Keeping bundled Sprocket image fallback (GitHub sync failed: ${message})`);
}
