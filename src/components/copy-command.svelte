<script lang="ts">
	import { captureEvent, captureExceptionSafe } from '@/lib/analytics/client';
	import { INSTALL_COMMAND_COPIED_EVENT, type AnalyticsLocation } from '@/lib/analytics/events';
	import { cn } from '@/utils';

	interface Props {
		command?: string;
		class?: string;
		location?: AnalyticsLocation;
	}

	let {
		command = 'npx @spikonado/sprocket',
		class: className = '',
		location = 'home_hero'
	}: Props = $props();

	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyCommand() {
		try {
			await navigator.clipboard.writeText(command);
			copied = true;
			captureEvent(INSTALL_COMMAND_COPIED_EVENT, {
				command,
				location,
				path: typeof window !== 'undefined' ? window.location.pathname : undefined
			});
			if (copyTimer) {
				clearTimeout(copyTimer);
			}
			copyTimer = setTimeout(() => {
				copied = false;
			}, 1800);
		} catch (error) {
			copied = false;
			captureExceptionSafe(error, {
				context: 'install_command_copy',
				location
			});
		}
	}
</script>

<div
	class={cn(
		'flex min-w-0 items-center gap-2 rounded-xl border border-border bg-background px-3 py-3 font-mono text-sm text-foreground sm:text-[0.95rem]',
		className
	)}
>
	<span class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{command}</span>
	<button
		type="button"
		class="inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-surface p-2 text-foreground transition-colors hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
		onclick={copyCommand}
		aria-label={copied ? 'Copied' : 'Copy command'}
	>
		{#if copied}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="h-4 w-4"
				aria-hidden="true"
			>
				<path d="M20 6 9 17l-5-5" />
			</svg>
		{:else}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="h-4 w-4"
				aria-hidden="true"
			>
				<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
				<path d="M4 16V4a2 2 0 0 1 2-2h12" />
			</svg>
		{/if}
	</button>
</div>
