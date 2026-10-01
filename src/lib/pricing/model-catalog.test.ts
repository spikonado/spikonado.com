import { describe, expect, test } from 'bun:test';
import {
	fetchPricingModelCatalog,
	MODEL_CATALOG_URL,
	modelLabelsForTier,
	parsePricingModelCatalog
} from './model-catalog.ts';

const payload = {
	object: 'list',
	sprocket: {
		models: [
			{ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'openai' },
			{ id: 'grok-4.6', label: 'Grok 4.6', provider: 'xai' },
			{ id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', provider: 'openai' }
		],
		tierAllowedModels: {
			free: ['grok-4.6', 'gpt-5.6-luna']
		}
	}
};

describe('pricing model catalog', () => {
	test('parses the gateway response and resolves tier model labels', () => {
		const catalog = parsePricingModelCatalog(payload);
		expect(modelLabelsForTier(catalog, 'free')).toEqual(['Grok 4.6', 'GPT-5.6 Luna']);
		expect(modelLabelsForTier(catalog, 'pro')).toEqual(['GPT-5.6 Sol', 'Grok 4.6', 'GPT-5.6 Luna']);
	});

	test('fetches the public gateway catalog', async () => {
		let requestedUrl = '';
		const catalog = await fetchPricingModelCatalog(async (input) => {
			requestedUrl = String(input);
			return Response.json(payload);
		});
		expect(requestedUrl).toBe(MODEL_CATALOG_URL);
		expect(catalog.models).toHaveLength(3);
	});

	test('rejects failed and malformed gateway responses', async () => {
		let requestError: unknown;
		try {
			await fetchPricingModelCatalog(async () => new Response(null, { status: 503 }));
		} catch (error) {
			requestError = error;
		}
		expect(requestError).toBeInstanceOf(Error);
		expect((requestError as Error).message).toBe('The model gateway returned 503.');
		expect(() => parsePricingModelCatalog({ sprocket: { models: [] } })).toThrow(
			'The model gateway returned an invalid catalog.'
		);
	});

	test('aborts gateway requests that never answer', async () => {
		let requestError: unknown;
		try {
			await fetchPricingModelCatalog(
				(_input, init) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () => {
							reject(new DOMException('The operation was aborted.', 'AbortError'));
						});
					}),
				5
			);
		} catch (error) {
			requestError = error;
		}
		expect(requestError).toBeInstanceOf(DOMException);
		expect((requestError as DOMException).name).toBe('AbortError');
	});

	test('aborts gateway responses whose body never arrives', async () => {
		let requestError: unknown;
		try {
			await fetchPricingModelCatalog(async (_input, init) => {
				const signal = init?.signal;
				const body = new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('{"sprocket":{"models":[]'));
						signal?.addEventListener('abort', () => {
							controller.error(new DOMException('The operation was aborted.', 'AbortError'));
						});
					}
				});
				return new Response(body, {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}, 5);
		} catch (error) {
			requestError = error;
		}
		expect(requestError).toBeDefined();
	});
});
