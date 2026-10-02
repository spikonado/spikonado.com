import { describe, expect, test } from 'bun:test';
import { resolveCheckoutMode } from './config.ts';

describe('resolveCheckoutMode', () => {
	test('accepts the explicit test and live modes', () => {
		expect(resolveCheckoutMode('test', 'spikonado.com')).toBe('test');
		expect(resolveCheckoutMode('live', 'spikonado.com')).toBe('live');
		expect(resolveCheckoutMode(' live ', 'spikonado.com')).toBe('live');
	});

	test('defaults to test mode only for local development', () => {
		expect(resolveCheckoutMode(undefined, 'localhost')).toBe('test');
		expect(resolveCheckoutMode('', '127.0.0.1')).toBe('test');
	});

	test('fails explicitly instead of silently defaulting on deployed sites', () => {
		expect(() => resolveCheckoutMode(undefined, 'spikonado.com')).toThrow(
			/missing PUBLIC_DODO_CHECKOUT_MODE/
		);
		expect(() => resolveCheckoutMode(undefined, null)).toThrow(/missing PUBLIC_DODO_CHECKOUT_MODE/);
	});

	test('rejects unknown modes instead of falling back to test', () => {
		expect(() => resolveCheckoutMode('staging', 'localhost')).toThrow(/must be "test" or "live"/);
		expect(() => resolveCheckoutMode('production', 'localhost')).toThrow(
			/must be "test" or "live"/
		);
	});
});
