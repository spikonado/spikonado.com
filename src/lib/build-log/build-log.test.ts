import { afterEach, describe, expect, test } from 'bun:test';
import { BUILD_LOG_SUBSCRIBED_EVENT, triggerBuildLogSubscription } from './resend.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe('Resend integration contract', () => {
	test('sends the native Automation event', async () => {
		let capturedUrl = '';
		let capturedInit: RequestInit | undefined;
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			capturedUrl = String(input);
			capturedInit = init;
			return Response.json({ object: 'event', event: BUILD_LOG_SUBSCRIBED_EVENT });
		}) as typeof fetch;

		expect(await triggerBuildLogSubscription('re_test', 'robot@example.com')).toEqual({
			ok: true
		});
		expect(capturedUrl).toBe('https://api.resend.com/events/send');
		expect(capturedInit?.method).toBe('POST');
		expect(JSON.parse(String(capturedInit?.body))).toEqual({
			event: BUILD_LOG_SUBSCRIBED_EVENT,
			email: 'robot@example.com'
		});
	});
});
