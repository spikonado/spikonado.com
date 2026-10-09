export function pricingAuthOptions(
	devMode = import.meta.env.PUBLIC_WORKOS_DEV_MODE,
	apiHostname = import.meta.env.PUBLIC_WORKOS_API_HOSTNAME,
	hostname = window.location.hostname
): { devMode: boolean; apiHostname?: string } {
	const mode = devMode?.trim();
	if (mode && mode !== 'true' && mode !== 'false') {
		throw new Error('PUBLIC_WORKOS_DEV_MODE must be "true" or "false".');
	}
	const useLocalStorage = mode
		? mode === 'true'
		: hostname === 'localhost' || hostname === '127.0.0.1';
	const api = apiHostname?.trim();
	if (api && !/^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(api)) {
		throw new Error('PUBLIC_WORKOS_API_HOSTNAME must be a hostname without a URL scheme or path.');
	}
	if (!useLocalStorage && (!api || api === 'api.workos.com')) {
		throw new Error(
			'Sign-in needs a custom WorkOS authentication API domain. Set PUBLIC_WORKOS_API_HOSTNAME, or set PUBLIC_WORKOS_DEV_MODE=true for a development preview. Development mode stores refresh tokens in browser localStorage.'
		);
	}
	return { devMode: useLocalStorage, ...(api && { apiHostname: api }) };
}
