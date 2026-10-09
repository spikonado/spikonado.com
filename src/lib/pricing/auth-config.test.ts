import { describe, expect, test } from 'bun:test';
import { pricingAuthOptions } from './auth-config';

describe('pricing auth session configuration', () => {
	test('uses development storage only for localhost or explicit opt-in', () => {
		expect(pricingAuthOptions('', '', 'localhost')).toEqual({ devMode: true });
		expect(pricingAuthOptions('', '', '127.0.0.1')).toEqual({ devMode: true });
		expect(pricingAuthOptions(' true ', '', 'preview.vercel.app')).toEqual({ devMode: true });
	});

	test('uses the configured custom domain for hosted cookie sessions', () => {
		expect(pricingAuthOptions('', ' auth.spikonado.com ', 'spikonado.com')).toEqual({
			devMode: false,
			apiHostname: 'auth.spikonado.com'
		});
		expect(pricingAuthOptions('false', 'auth.spikonado.com', 'localhost').devMode).toBe(false);
	});

	test('reports the missing hosted session configuration before sign-in starts', () => {
		for (const apiHostname of ['', 'api.workos.com']) {
			expect(() => pricingAuthOptions('', apiHostname, 'preview.vercel.app')).toThrow(
				/Set PUBLIC_WORKOS_API_HOSTNAME.*PUBLIC_WORKOS_DEV_MODE=true/
			);
		}
	});

	test('rejects invalid mode and URL-shaped API hostnames', () => {
		expect(() => pricingAuthOptions('test', '', 'localhost')).toThrow(
			/PUBLIC_WORKOS_DEV_MODE must be/
		);
		expect(() =>
			pricingAuthOptions('false', 'https://auth.spikonado.com/', 'spikonado.com')
		).toThrow(/hostname without a URL scheme or path/);
	});
});
