import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { captureException, track } from '@/lib/analytics/client';
import { cn } from '@/utils';

const iconProps = {
	viewBox: '0 0 24 24',
	fill: 'none',
	stroke: 'currentColor',
	strokeWidth: 2,
	strokeLinecap: 'round',
	strokeLinejoin: 'round',
	className: 'h-4 w-4',
	'aria-hidden': true
} as const;

export default function CopyCommand({
	command,
	className
}: {
	command: string;
	className?: string;
}) {
	const [copied, setCopied] = useState(false);
	const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => () => clearTimeout(resetTimer.current), []);

	async function copy(event: MouseEvent<HTMLButtonElement>) {
		const button = event.currentTarget;

		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
			track('install_command_copied', { command }, button);
			clearTimeout(resetTimer.current);
			resetTimer.current = setTimeout(() => setCopied(false), 1800);
		} catch (error) {
			setCopied(false);
			captureException(error, { context: 'install_command_copy' });
		}
	}

	return (
		<div
			className={cn(
				'flex min-w-0 items-center gap-2 rounded-xl border border-border bg-background px-3 py-3 font-mono text-sm text-foreground sm:text-[0.95rem]',
				className
			)}
		>
			<span className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{command}</span>
			<button
				type="button"
				className="inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-surface p-2 text-foreground transition-colors hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
				onClick={copy}
				aria-label={copied ? 'Copied' : 'Copy command'}
			>
				{copied ? (
					<svg {...iconProps}>
						<path d="M20 6 9 17l-5-5" />
					</svg>
				) : (
					<svg {...iconProps}>
						<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
						<path d="M4 16V4a2 2 0 0 1 2-2h12" />
					</svg>
				)}
			</button>
		</div>
	);
}
