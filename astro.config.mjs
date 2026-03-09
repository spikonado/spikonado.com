// @ts-check

import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
	site: 'https://spikonado.com',
	integrations: [mdx(), sitemap(), svelte()],
	adapter: vercel(),

	vite: {
		// Astro 5 types Vite 6 here while Tailwind's plugin resolves against Vite 7 via Vitest.
		// Runtime behavior is correct; this narrows the transient type mismatch.
		// @ts-expect-error Vite plugin types are split across Astro/Vitest dependency trees.
		plugins: [tailwindcss()]
	}
});
