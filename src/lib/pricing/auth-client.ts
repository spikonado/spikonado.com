export type PricingUser = {
	id: string;
	email: string;
	firstName: string | null;
};

export type PricingAuthClient = {
	getUser(): PricingUser | null;
	getAccessToken(options?: { forceRefresh?: boolean }): Promise<string | undefined>;
	signIn(): Promise<void>;
	signOut(): Promise<void>;
	dispose(): void;
};

type PricingSession = {
	user: PricingUser | null;
	accessToken: string | null;
	expiresAt: number | null;
};

function postPricing(path: string, body: object): Promise<Response> {
	return fetch(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Pricing-Auth': '1' },
		body: JSON.stringify(body),
		cache: 'no-store',
		credentials: 'same-origin',
		signal: AbortSignal.timeout(12_000)
	});
}

async function readResponse<T>(response: Response): Promise<T> {
	const body = await response.json();
	if (!response.ok) {
		throw new Error(body.error ?? 'Pricing authentication failed.');
	}
	return body as T;
}

export async function signOutPricingSession(): Promise<void> {
	const response = await postPricing('/api/pricing/sign-out', {});
	const { logoutUrl } = await readResponse<{ logoutUrl: string | null }>(response);
	if (logoutUrl !== null) {
		if (new URL(logoutUrl).origin !== 'https://api.workos.com') {
			throw new Error('Pricing sign-out returned an invalid logout URL.');
		}
		window.location.assign(logoutUrl);
	}
}

export async function createPricingAuthClient(): Promise<PricingAuthClient> {
	try {
		for (let i = window.localStorage.length - 1; i >= 0; i--) {
			const key = window.localStorage.key(i);
			if (key?.startsWith('workos:refresh-token')) window.localStorage.removeItem(key);
		}
		window.sessionStorage.removeItem('workos:code-verifier');
	} catch {
		// Removing credentials from the previous integration must not block cookie sessions.
	}
	let user: PricingUser | null = null;
	let accessToken: string | null = null;
	let expiresAt: number | null = null;
	let disposed = false;
	let sessionRequest: Promise<void> | null = null;
	let signOutRequest: Promise<void> | null = null;

	function clearSession(): void {
		user = null;
		accessToken = null;
		expiresAt = null;
	}

	function refreshSession(forceRefresh: boolean): Promise<void> {
		if (disposed) return Promise.resolve();
		if (sessionRequest) return sessionRequest;
		sessionRequest = (async () => {
			const response = await postPricing('/api/pricing/session', { forceRefresh });
			if (response.status === 401) {
				if (!disposed) clearSession();
				return;
			}
			const session = await readResponse<PricingSession>(response);
			if (disposed) return;
			if (session.user === null) {
				clearSession();
				return;
			}
			user = session.user;
			accessToken = session.accessToken;
			expiresAt = session.expiresAt;
		})().finally(() => {
			sessionRequest = null;
		});
		return sessionRequest;
	}

	const client: PricingAuthClient = {
		getUser: () => (disposed ? null : user),
		async getAccessToken({ forceRefresh = false } = {}) {
			if (disposed) return undefined;
			if (!forceRefresh && accessToken && expiresAt !== null && expiresAt > Date.now() + 60_000) {
				return accessToken;
			}
			await refreshSession(forceRefresh);
			return disposed ? undefined : (accessToken ?? undefined);
		},
		async signIn() {
			if (!disposed) window.location.assign('/api/pricing/sign-in');
		},
		signOut() {
			if (signOutRequest) return signOutRequest;
			if (disposed) return Promise.resolve();
			disposed = true;
			signOutRequest = (async () => {
				// A refresh can rotate the session cookie, so let it finish before clearing it.
				await sessionRequest?.catch(() => undefined);
				try {
					await signOutPricingSession();
				} finally {
					clearSession();
				}
			})();
			return signOutRequest;
		},
		dispose() {
			disposed = true;
			clearSession();
		}
	};

	await refreshSession(false);
	return client;
}
