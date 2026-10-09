<script lang="ts">
	import SprocketDownload from '@/components/sprocket-download.svelte';
	import { CTA_CLICKED_EVENT } from '@/lib/analytics/events';
	import { type SprocketRelease } from '@/lib/sprocket-releases';
	import { marketingPanelClass, marketingTextLinkClass } from '@/styles/marketing';
	import { cn } from '@/utils';

	interface Props {
		release?: SprocketRelease | null;
	}

	let { release = null }: Props = $props();
</script>

<div class={cn(marketingPanelClass, 'w-full max-w-md p-5 sm:p-6')}>
	<p class="font-brand text-xl font-semibold text-foreground">Start with your project</p>
	<p class="mt-3 text-base leading-relaxed text-muted-foreground">
		Download Sprocket, sign in, and choose a project folder.
	</p>
	<SprocketDownload {release} showAlternates={false} location="home_hero" class="mt-6" />
	<a
		href="/sprocket#examples"
		class={cn(marketingTextLinkClass, 'mt-5 inline-flex text-sm')}
		data-ph-capture={CTA_CLICKED_EVENT}
		data-ph-location="home_hero"
		data-ph-cta="explore_example_tasks">Explore example tasks →</a
	>
	<p class="mt-5 border-t border-border/60 pt-4 text-sm leading-relaxed text-muted-foreground">
		Prefer the browser or terminal? <a
			href="/sprocket#install"
			class={marketingTextLinkClass}
			data-ph-capture={CTA_CLICKED_EVENT}
			data-ph-location="home_hero"
			data-ph-cta="installation_options">See all ways to get started.</a
		>
	</p>
</div>
