export const MODEL_CATALOG_URL = 'https://ai-gateway.spikonado.com/api/v1/models';
export const MODEL_CATALOG_TIMEOUT_MS = 5_000;

export type PricingModel = {
	id: string;
	label: string;
};

export type PricingModelCatalog = {
	models: PricingModel[];
	tierAllowedModels: Record<string, string[]>;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePricingModelCatalog(payload: unknown): PricingModelCatalog {
	if (!isRecord(payload) || !isRecord(payload.sprocket)) {
		throw new Error('The model gateway returned an invalid catalog.');
	}
	const { models, tierAllowedModels } = payload.sprocket;
	if (!Array.isArray(models) || !isRecord(tierAllowedModels)) {
		throw new Error('The model gateway returned an invalid catalog.');
	}

	const parsedModels = models.map((model) => {
		if (!isRecord(model) || typeof model.id !== 'string' || typeof model.label !== 'string') {
			throw new Error('The model gateway returned an invalid model.');
		}
		return { id: model.id, label: model.label };
	});
	const parsedTierModels = Object.fromEntries(
		Object.entries(tierAllowedModels).map(([tierId, modelIds]) => {
			if (!Array.isArray(modelIds) || !modelIds.every((modelId) => typeof modelId === 'string')) {
				throw new Error('The model gateway returned an invalid tier model list.');
			}
			return [tierId, modelIds];
		})
	);

	return { models: parsedModels, tierAllowedModels: parsedTierModels };
}

export async function fetchPricingModelCatalog(
	fetcher: Fetcher = fetch,
	timeoutMs: number = MODEL_CATALOG_TIMEOUT_MS
): Promise<PricingModelCatalog> {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), timeoutMs);
	try {
		const response = await fetcher(MODEL_CATALOG_URL, {
			headers: { accept: 'application/json' },
			signal: abort.signal
		});
		if (!response.ok) throw new Error(`The model gateway returned ${response.status}.`);
		return parsePricingModelCatalog(await response.json());
	} finally {
		clearTimeout(timer);
	}
}

export function modelLabelsForTier(catalog: PricingModelCatalog, tierId: string): string[] {
	const configured = catalog.tierAllowedModels[tierId];
	if (!configured) return catalog.models.map((model) => model.label);
	const allowed = new Set(configured);
	return catalog.models.filter((model) => allowed.has(model.id)).map((model) => model.label);
}
