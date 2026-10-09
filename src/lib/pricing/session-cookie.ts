import type { AstroCookies } from 'astro';

type SessionCookies = Pick<AstroCookies, 'get' | 'set' | 'delete'>;

const CHUNK_SIZE = 3000;
const MAX_CHUNKS = 8;
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

function cookieSettings(url: URL) {
	const secure = url.protocol === 'https:';
	const loopback =
		url.hostname === 'localhost' ||
		url.hostname === '[::1]' ||
		/^127\.\d+\.\d+\.\d+$/.test(url.hostname);
	if (!secure && (url.protocol !== 'http:' || !loopback)) {
		throw new Error('Pricing session cookies require HTTPS outside localhost.');
	}
	return {
		name: secure ? '__Host-spikonado-pricing-session' : 'spikonado-pricing-session',
		options: { sameSite: 'lax' as const, path: '/', httpOnly: true, secure }
	};
}

function chunkCount(value: string | undefined): number | null {
	if (!value?.startsWith('chunks:')) return 0;
	const match = /^chunks:([2-8])$/.exec(value);
	return match ? Number(match[1]) : null;
}

export function readSessionCookie(cookies: SessionCookies, url: URL): string | null {
	const { name } = cookieSettings(url);
	const value = cookies.get(name)?.value;
	if (!value || value.length > CHUNK_SIZE) return null;
	const count = chunkCount(value);
	if (count === null) return null;
	if (count === 0) return value;
	const chunks: string[] = [];
	for (let i = 0; i < count; i++) {
		const chunk = cookies.get(`${name}.${i}`)?.value;
		if (!chunk || chunk.length > CHUNK_SIZE) return null;
		chunks.push(chunk);
	}
	return chunks.join('');
}

export function writeSessionCookie(cookies: SessionCookies, url: URL, sealedSession: string): void {
	const { name, options } = cookieSettings(url);
	if (sealedSession.length > CHUNK_SIZE * MAX_CHUNKS) {
		throw new Error('Pricing session exceeds the maximum cookie size.');
	}
	const oldCount = chunkCount(cookies.get(name)?.value) ?? MAX_CHUNKS;
	const count =
		sealedSession.length <= CHUNK_SIZE ? 0 : Math.ceil(sealedSession.length / CHUNK_SIZE);
	const setOptions = { ...options, maxAge: SESSION_MAX_AGE };
	for (let i = 0; i < count; i++) {
		cookies.set(
			`${name}.${i}`,
			sealedSession.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
			setOptions
		);
	}
	cookies.set(name, count ? `chunks:${count}` : sealedSession, setOptions);
	for (let i = count; i < oldCount; i++) {
		cookies.delete(`${name}.${i}`, options);
	}
}

export function clearSessionCookie(cookies: SessionCookies, url: URL): void {
	const { name, options } = cookieSettings(url);
	cookies.delete(name, options);
	for (let i = 0; i < MAX_CHUNKS; i++) {
		cookies.delete(`${name}.${i}`, options);
	}
}
