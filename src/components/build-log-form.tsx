import { useState, type FormEvent } from 'react';
import { captureException, track } from '@/lib/analytics/client';
import { cn } from '@/utils';

const SUBSCRIBE_PATH = '/api/build-log/subscribe';
const ERROR_MESSAGE = 'Something went wrong. Please try again in a moment.';

type FormState =
	{ status: 'idle' | 'submitting' } | { status: 'success' | 'invalid' | 'error'; message: string };

const fieldClass = cn(
	'w-full min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5',
	'font-sans text-base text-foreground outline-none transition-colors',
	'placeholder:text-muted-foreground',
	'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40',
	'disabled:cursor-not-allowed disabled:opacity-60',
	'motion-reduce:transition-none'
);

const submitClass = cn(
	'shrink-0 rounded-full border border-foreground bg-foreground px-5 py-2.5',
	'font-sans text-base font-medium text-background transition-opacity',
	'hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
	'disabled:cursor-not-allowed disabled:opacity-50',
	'motion-reduce:transition-none'
);

function captureSubscribeFailure(reason: string) {
	track('newsletter_subscribe_failed', { reason, source: 'client' });
}

export default function BuildLogForm() {
	const [email, setEmail] = useState('');
	const [company, setCompany] = useState('');
	const [form, setForm] = useState<FormState>({ status: 'idle' });

	const isBusy = form.status === 'submitting';
	const isLocked = isBusy || form.status === 'success';

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (isLocked) {
			return;
		}

		setForm({ status: 'submitting' });
		track('newsletter_subscribe_submitted', {});
		const controller = new AbortController();
		const timeout = window.setTimeout(() => controller.abort(), 10_000);

		try {
			const response = await fetch(SUBSCRIBE_PATH, {
				method: 'POST',
				signal: controller.signal,
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json'
				},
				body: JSON.stringify({ email: email.trim(), company })
			});

			if (response.ok) {
				setEmail('');
				setCompany('');
				setForm({
					status: 'success',
					message: "You're subscribed. Check your inbox for the welcome email."
				});
				return;
			}

			if (response.status === 400 || response.status === 422) {
				captureSubscribeFailure('invalid_email');
				setForm({ status: 'invalid', message: 'Please enter a valid email address.' });
				return;
			}

			// Server already records Resend/API failures; avoid duplicate client events.
			setForm({ status: 'error', message: ERROR_MESSAGE });
		} catch (error) {
			captureSubscribeFailure(error instanceof Error ? error.name : 'network_error');
			captureException(error, { context: 'newsletter_subscribe' });
			setForm({ status: 'error', message: ERROR_MESSAGE });
		} finally {
			window.clearTimeout(timeout);
		}
	}

	return (
		<form
			className="relative flex w-full max-w-md flex-col gap-3"
			aria-busy={isBusy}
			onSubmit={onSubmit}
		>
			<div
				className="pointer-events-none absolute left-[-10000px] h-0 w-0 overflow-hidden opacity-0"
				aria-hidden="true"
			>
				<label htmlFor="build-log-company">Company</label>
				<input
					id="build-log-company"
					name="company"
					type="text"
					tabIndex={-1}
					autoComplete="one-time-code"
					value={company}
					onChange={(event) => setCompany(event.target.value)}
				/>
			</div>

			<div className="flex w-full flex-col gap-2">
				<label htmlFor="build-log-email" className="font-sans text-sm font-medium text-foreground">
					Email
				</label>
				<div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
					<input
						id="build-log-email"
						name="email"
						type="email"
						inputMode="email"
						autoComplete="email"
						autoCapitalize="off"
						autoCorrect="off"
						spellCheck={false}
						maxLength={254}
						required
						placeholder="you@example.com"
						className={fieldClass}
						value={email}
						disabled={isBusy}
						aria-invalid={form.status === 'invalid' || undefined}
						aria-describedby="build-log-status"
						onChange={(event) => {
							setEmail(event.target.value);
							if (form.status !== 'idle' && form.status !== 'submitting') {
								setForm({ status: 'idle' });
							}
						}}
					/>
					<button type="submit" className={submitClass} disabled={isLocked}>
						{isBusy ? 'Submitting…' : 'Subscribe'}
					</button>
				</div>
			</div>

			<p
				id="build-log-status"
				className={cn(
					'min-h-5 font-sans text-sm leading-snug',
					form.status === 'success' && 'text-foreground',
					(form.status === 'invalid' || form.status === 'error') && 'text-accent-strong',
					(form.status === 'idle' || form.status === 'submitting') && 'text-muted-foreground'
				)}
				role="status"
				aria-live="polite"
				aria-atomic="true"
			>
				{form.status === 'submitting' ? 'Submitting…' : 'message' in form ? form.message : ''}
			</p>
		</form>
	);
}
