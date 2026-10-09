/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly PUBLIC_CONVEX_URL?: string;
	readonly PUBLIC_DODO_CHECKOUT_MODE?: string;
	readonly PUBLIC_WORKOS_DEV_MODE?: string;
	readonly PUBLIC_WORKOS_API_HOSTNAME?: string;
	readonly PUBLIC_POSTHOG_KEY?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
