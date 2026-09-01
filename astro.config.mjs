// @ts-check

import { defineConfig, envField } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import posthog from '@posthog/rollup-plugin';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

const { POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID, VERCEL_GIT_COMMIT_SHA } = process.env;

// Uploads source maps so PostHog error tracking shows original code. Builds without the keys skip it.
const posthogSourceMaps =
	POSTHOG_PERSONAL_API_KEY && POSTHOG_PROJECT_ID
		? [
				posthog({
					personalApiKey: POSTHOG_PERSONAL_API_KEY,
					projectId: POSTHOG_PROJECT_ID,
					host: 'https://eu.i.posthog.com',
					sourcemaps: { releaseName: 'spikonado.com', releaseVersion: VERCEL_GIT_COMMIT_SHA }
				})
			]
		: [];

// https://astro.build/config
export default defineConfig({
	site: 'https://spikonado.com',
	// No Astro.session usage on this site, so leave the session runtime out of the SSR bundle.
	session: false,
	integrations: [
		sitemap({
			filter: (page) => !page.includes('/api/')
		}),
		svelte()
	],
	adapter: vercel(),
	env: {
		schema: {
			PUBLIC_POSTHOG_KEY: envField.string({
				context: 'client',
				access: 'public',
				optional: true
			}),
			RESEND_API_KEY: envField.string({
				context: 'server',
				access: 'secret',
				optional: true
			})
		}
	},

	vite: {
		plugins: [tailwindcss(), ...posthogSourceMaps]
	}
});
