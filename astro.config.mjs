// @ts-check

import { defineConfig } from 'astro/config';
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
	security: {
		csp: {
			// Sources follow https://posthog.com/docs/advanced/content-security-policy so replay,
			// surveys, and the PostHog and Vercel toolbars all load.
			directives: ["worker-src 'self' blob: data:"],
			scriptDirective: {
				resources: [
					"'self'",
					'https://kpg.spikonado.com',
					'https://*.posthog.com',
					'https://vercel.live'
				]
			},
			// Surveys and both toolbars inject <style> elements, which hashes can't cover.
			styleDirective: {
				resources: ["'self'", "'unsafe-inline'", 'https://*.posthog.com', 'https://vercel.live']
			}
		}
	},
	integrations: [
		sitemap({
			filter: (page) => !page.includes('/api/')
		}),
		svelte()
	],
	adapter: vercel({
		// Prerendered pages otherwise only get CSP as a meta tag.
		staticHeaders: true
	}),

	vite: {
		plugins: [tailwindcss(), ...posthogSourceMaps]
	}
});
