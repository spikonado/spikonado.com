import { describe, expect, mock, test } from 'bun:test';
import type { AstroCookies } from 'astro';
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from './session-cookie';

const httpsUrl = new URL('https://spikonado.com/pricing');
const secureName = '__Host-spikonado-pricing-session';
const localName = 'spikonado-pricing-session';

function cookieStore(entries: [string, string][] = []) {
	const values = new Map(entries);
	const cookies = {
		get: mock((name: string) => {
			const value = values.get(name);
			return value === undefined
				? undefined
				: {
						value,
						json: () => JSON.parse(value),
						number: () => Number(value),
						boolean: () => value !== 'false' && value !== '0' && Boolean(value)
					};
		}),
		set: mock<AstroCookies['set']>((name, value) => {
			values.set(name, String(value));
		}),
		delete: mock<AstroCookies['delete']>((name) => {
			values.delete(name);
		})
	} satisfies Pick<AstroCookies, 'get' | 'set' | 'delete'>;
	return { cookies, values };
}

describe('pricing session cookies', () => {
	test.each([1, 2999, 3000, 3001, 6000, 6001, 24000])(
		'roundtrips a %i-character sealed session across chunk boundaries',
		(length) => {
			const { cookies, values } = cookieStore();
			const sealedSession = '0123456789abcdef'.repeat(Math.ceil(length / 16)).slice(0, length);
			writeSessionCookie(cookies, httpsUrl, sealedSession);
			expect(readSessionCookie(cookies, httpsUrl)).toBe(sealedSession);
			if (length <= 3000) {
				expect([...values]).toEqual([[secureName, sealedSession]]);
			} else {
				const count = Math.ceil(length / 3000);
				expect(values.get(secureName)).toBe(`chunks:${count}`);
				expect(values.size).toBe(count + 1);
				for (let i = 0; i < count; i++) {
					expect(values.get(`${secureName}.${i}`)).toBe(
						sealedSession.slice(i * 3000, (i + 1) * 3000)
					);
				}
			}
			expect(cookies.delete).not.toHaveBeenCalled();
		}
	);

	test.each([
		'https://spikonado.com/pricing',
		'https://localhost:4321/pricing',
		'http://localhost:4321/pricing',
		'http://127.0.0.1:4321/pricing',
		'http://127.0.0.2:4321/pricing',
		'http://[::1]:4321/pricing'
	])('uses host-only security options and a 30-day lifetime on %s', (address) => {
		const url = new URL(address);
		const secure = url.protocol === 'https:';
		const name = secure ? secureName : localName;
		const { cookies, values } = cookieStore();
		writeSessionCookie(cookies, url, 's'.repeat(3001));
		expect(values.get(name)).toBe('chunks:2');
		expect(readSessionCookie(cookies, url)).toBe('s'.repeat(3001));
		for (const [, , options] of cookies.set.mock.calls) {
			expect(options).toEqual({
				sameSite: 'lax',
				path: '/',
				httpOnly: true,
				secure,
				maxAge: 2592000
			});
		}
	});

	test.each([
		'http://spikonado.com',
		'http://localhost.example.com',
		'http://192.168.1.1',
		'http://[::2]',
		'ftp://localhost'
	])('requires a secure transport outside HTTP loopback on %s', (address) => {
		const { cookies } = cookieStore();
		const url = new URL(address);
		for (const operation of [
			() => readSessionCookie(cookies, url),
			() => writeSessionCookie(cookies, url, 'sealed-session'),
			() => clearSessionCookie(cookies, url)
		]) {
			expect(operation).toThrow(/require HTTPS/);
		}
		expect(cookies.get).not.toHaveBeenCalled();
		expect(cookies.set).not.toHaveBeenCalled();
		expect(cookies.delete).not.toHaveBeenCalled();
	});

	test('rejects an oversized write before changing the existing session', () => {
		const { cookies, values } = cookieStore([[secureName, 'previous-session']]);
		expect(() => writeSessionCookie(cookies, httpsUrl, 's'.repeat(24001))).toThrow(
			/maximum cookie size/
		);
		expect(values.get(secureName)).toBe('previous-session');
		expect(cookies.set).not.toHaveBeenCalled();
		expect(cookies.delete).not.toHaveBeenCalled();
	});

	test.each([
		undefined,
		'',
		'chunks:0',
		'chunks:1',
		'chunks:9',
		'chunks:999999999',
		'chunks:-2',
		'chunks:02',
		'chunks:2.0',
		'chunks:2junk',
		'chunks:2\n',
		'chunks:',
		's'.repeat(3001)
	])('returns null for an absent or invalid base cookie, case %#', (value) => {
		const { cookies } = cookieStore(value === undefined ? [] : [[secureName, value]]);
		expect(readSessionCookie(cookies, httpsUrl)).toBeNull();
		expect(cookies.get.mock.calls).toEqual([[secureName]]);
	});

	test.each([undefined, '', 's'.repeat(3001)])(
		'returns null for an incomplete or oversized chunk, case %#',
		(chunk) => {
			const entries: [string, string][] = [
				[secureName, 'chunks:2'],
				[`${secureName}.0`, 'first-chunk']
			];
			if (chunk !== undefined) entries.push([`${secureName}.1`, chunk]);
			const { cookies } = cookieStore(entries);
			expect(readSessionCookie(cookies, httpsUrl)).toBeNull();
			expect(cookies.get.mock.calls.length).toBe(3);
		}
	);

	test('deletes only unused chunks when a session shrinks', () => {
		const { cookies, values } = cookieStore();
		writeSessionCookie(cookies, httpsUrl, 's'.repeat(12000));
		writeSessionCookie(cookies, httpsUrl, 'replacement'.repeat(600));
		expect(cookies.delete.mock.calls.map(([name]) => name)).toEqual([`${secureName}.3`]);
		expect(readSessionCookie(cookies, httpsUrl)).toBe('replacement'.repeat(600));
		cookies.delete.mockClear();
		writeSessionCookie(cookies, httpsUrl, 'small-session');
		expect(cookies.delete.mock.calls.map(([name]) => name)).toEqual([
			`${secureName}.0`,
			`${secureName}.1`,
			`${secureName}.2`
		]);
		expect([...values]).toEqual([[secureName, 'small-session']]);
		cookies.delete.mockClear();
		writeSessionCookie(cookies, httpsUrl, 'another-small-session');
		expect(cookies.delete).not.toHaveBeenCalled();
	});

	test('reuses existing chunks without deletion when the count stays the same or grows', () => {
		const { cookies } = cookieStore();
		for (const length of [3001, 6000, 24000]) {
			writeSessionCookie(cookies, httpsUrl, 's'.repeat(length));
			expect(readSessionCookie(cookies, httpsUrl)).toBe('s'.repeat(length));
		}
		expect(cookies.delete).not.toHaveBeenCalled();
	});

	test('cleans up at most eight old chunks when the prior marker is corrupt', () => {
		const { cookies } = cookieStore([[secureName, 'chunks:999999999']]);
		writeSessionCookie(cookies, httpsUrl, 'replacement');
		expect(cookies.delete.mock.calls.map(([name]) => name)).toEqual(
			Array.from({ length: 8 }, (_, i) => `${secureName}.${i}`)
		);
		expect(readSessionCookie(cookies, httpsUrl)).toBe('replacement');
	});

	test.each(['https://spikonado.com/pricing', 'http://localhost:4321/pricing'])(
		'logout deletes the base and all eight chunks with matching options on %s',
		(address) => {
			const url = new URL(address);
			const secure = url.protocol === 'https:';
			const name = secure ? secureName : localName;
			const names = [name, ...Array.from({ length: 8 }, (_, i) => `${name}.${i}`)];
			const { cookies, values } = cookieStore(
				names.map((cookieName) => [cookieName, 'stale-session'])
			);
			clearSessionCookie(cookies, url);
			expect(cookies.delete.mock.calls).toEqual(
				names.map((cookieName) => [
					cookieName,
					{ sameSite: 'lax', path: '/', httpOnly: true, secure }
				])
			);
			expect(values.size).toBe(0);
			expect(readSessionCookie(cookies, url)).toBeNull();
		}
	);
});
