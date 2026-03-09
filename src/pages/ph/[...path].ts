import type { APIRoute } from 'astro';

export const prerender = false;

export const ALL: APIRoute = async ({ params, request, url, clientAddress }) => {
	const path = params.path ?? '';
	const pathname = `/ph/${path}`;
	const hostname = pathname.startsWith('/ph/static/')
		? 'eu-assets.i.posthog.com'
		: 'eu.i.posthog.com';
	const proxyUrl = new URL(pathname.replace(/^\/ph/, ''), `https://${hostname}`);
	const headers = new Headers(request.headers);

	headers.set('host', hostname);
	headers.set('accept-encoding', '');

	const forwardedFor = request.headers.get('x-forwarded-for') ?? clientAddress;
	if (forwardedFor) {
		headers.set('x-forwarded-for', forwardedFor);
	}

	proxyUrl.search = url.search;

	const requestInit: RequestInit & { duplex?: 'half' } = {
		method: request.method,
		headers,
		body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
		duplex: 'half'
	};

	return fetch(proxyUrl, requestInit);
};
