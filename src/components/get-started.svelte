<script lang="ts">
	import CopyCommand from '@/components/copy-command.svelte';
	import { marketingPanelClass, marketingTextLinkClass } from '@/styles/marketing';
	import { cn } from '@/utils';

	const githubHref = 'https://github.com/spikonado/sprocket';
</script>

<div class={cn(marketingPanelClass, 'w-full max-w-md p-5 sm:p-6')}>
	<div class="flex items-center justify-between gap-3">
		<p class="font-brand text-lg font-semibold text-foreground">Get started</p>
		<a
			href={githubHref}
			target="_blank"
			rel="noopener noreferrer"
			class={cn(marketingTextLinkClass, 'shrink-0 text-sm')}
		>
			View on GitHub ↗
		</a>
	</div>

	<CopyCommand class="mt-4" />

	<p class="mt-3 font-sans text-sm text-muted-foreground">
		Launch Sprocket in your browser. No install required.
	</p>
</div>
