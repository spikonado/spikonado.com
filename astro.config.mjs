// @ts-check

import { defineConfig, envField } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
	site: 'https://spikonado.com',
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
		plugins: [tailwindcss()]
	}
});
