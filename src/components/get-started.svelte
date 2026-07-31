<script lang="ts">
	import CopyCommand from '@/components/copy-command.svelte';
	import SprocketDownload from '@/components/sprocket-download.svelte';
	import {
		SPROCKET_GITHUB_URL,
		SPROCKET_NPM_COMMAND,
		type SprocketRelease
	} from '@/lib/sprocket-releases';
	import { marketingPanelClass, marketingTextLinkClass } from '@/styles/marketing';
	import { cn } from '@/utils';

	interface Props {
		release?: SprocketRelease | null;
	}

	let { release = null }: Props = $props();
</script>

<div class={cn(marketingPanelClass, 'w-full max-w-md p-5 sm:p-6')}>
	<div class="flex items-center justify-between gap-3">
		<p class="font-brand text-lg font-semibold text-foreground">Get started</p>
		<a
			href={SPROCKET_GITHUB_URL}
			target="_blank"
			rel="noopener noreferrer"
			class={cn(marketingTextLinkClass, 'shrink-0 text-sm')}
		>
			View on GitHub ↗
		</a>
	</div>

	<SprocketDownload {release} class="mt-4" />

	<div class="relative my-5 flex items-center gap-3" aria-hidden="true">
		<div class="h-px flex-1 bg-border/80"></div>
		<span class="font-sans text-xs tracking-wide text-muted-foreground uppercase">or</span>
		<div class="h-px flex-1 bg-border/80"></div>
	</div>

	<CopyCommand command={SPROCKET_NPM_COMMAND} />
</div>
