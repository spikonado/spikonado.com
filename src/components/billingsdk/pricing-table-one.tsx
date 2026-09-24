/*
 * Adapted from BillingSDK's PricingTableOne component.
 * SPDX-License-Identifier: GPL-3.0-only
 * Source: https://github.com/dodopayments/billingsdk
 */
import { useId, type ReactNode } from 'react';
import type { BillingPlan } from '@/lib/billingsdk-config';
import type { BillingInterval } from '@/lib/pricing/catalog';
import { cn } from '@/utils';

export interface PricingTableOneProps {
	plans: BillingPlan[];
	interval: BillingInterval;
	onIntervalChange: (interval: BillingInterval) => void;
	onPlanSelect: (planId: string) => void;
	buttonLabel?: (plan: BillingPlan) => string;
	buttonDisabled?: (plan: BillingPlan) => boolean;
	headerFooter?: ReactNode;
	className?: string;
}

function yearlyDiscount(plan: BillingPlan): number {
	const monthly = Number.parseFloat(plan.monthlyPrice);
	const yearly = Number.parseFloat(plan.yearlyPrice);
	if (!Number.isFinite(monthly) || !Number.isFinite(yearly) || monthly <= 0) return 0;
	return Math.max(0, Math.round(((monthly * 12 - yearly) / (monthly * 12)) * 100));
}

export function PricingTableOne({
	plans,
	interval,
	onIntervalChange,
	onPlanSelect,
	buttonLabel,
	buttonDisabled,
	headerFooter,
	className
}: PricingTableOneProps) {
	const intervalId = useId();
	const largestDiscount = plans.reduce(
		(largest, plan) => Math.max(largest, yearlyDiscount(plan)),
		0
	);

	return (
		<section
			className={cn('w-full', className)}
			aria-labelledby="pricing-heading"
			data-ph-section="pricing_plans"
		>
			<div className="flex flex-col items-center text-center">
				<h1
					id="pricing-heading"
					className="font-brand text-5xl font-semibold tracking-tight text-foreground sm:text-6xl"
				>
					Pricing
				</h1>
				<p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
					Build with every Sprocket feature. Pay for more AI capacity when you need it.
				</p>

				<fieldset className="mt-8 inline-flex rounded-full border border-border/70 bg-surface p-1">
					<legend className="sr-only">Billing interval</legend>
					{(['monthly', 'annual'] as const).map((value) => (
						<label className="cursor-pointer" key={value}>
							<input
								className="peer sr-only"
								type="radio"
								name={`${intervalId}-billing-interval`}
								value={value}
								checked={interval === value}
								onChange={() => onIntervalChange(value)}
							/>
							<span className="block rounded-full px-5 py-2 text-sm font-medium text-muted-foreground transition-colors peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 peer-focus-visible:outline-none">
								{value === 'monthly' ? 'Monthly' : 'Yearly'}
								{value === 'annual' && largestDiscount > 0 ? (
									<span className="ml-2 text-xs">Save {largestDiscount}%</span>
								) : null}
							</span>
						</label>
					))}
				</fieldset>
				{headerFooter}
			</div>

			<div className="mt-12 grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-6">
				{plans.map((plan) => {
					const price = interval === 'annual' ? plan.yearlyPrice : plan.monthlyPrice;
					const numericPrice = Number.parseFloat(price);
					const discount = yearlyDiscount(plan);
					return (
						<article
							key={plan.id}
							className={cn(
								'relative flex min-w-0 flex-col rounded-2xl border border-border/70 bg-surface/90 p-6 shadow-[0_18px_55px_-45px_oklch(0.18_0.02_260/0.65)] sm:p-7',
								plan.highlight && 'border-accent/40 ring-2 ring-accent/30'
							)}
						>
							{plan.badge ? (
								<span className="absolute top-5 right-5 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent-strong">
									{plan.badge}
								</span>
							) : null}
							<h2 className="font-brand text-xl font-semibold text-foreground">{plan.title}</h2>
							<div className="mt-3 min-h-16">
								<p className="font-brand text-3xl font-semibold tracking-tight text-foreground">
									{Number.isFinite(numericPrice) ? `${plan.currency ?? ''}${price}` : price}
								</p>
								{Number.isFinite(numericPrice) ? (
									<p className="mt-1 text-sm text-muted-foreground">
										per {interval === 'annual' ? 'year' : 'month'}
										{interval === 'annual' && discount > 0 ? `, ${discount}% off` : ''}
									</p>
								) : null}
							</div>
							<p className="mt-3 min-h-11 text-sm leading-relaxed text-muted-foreground">
								{plan.description}
							</p>
							<ul className="mt-6 flex-1 space-y-2.5">
								{plan.features.map((feature) => (
									<li
										className="flex gap-2.5 text-sm leading-snug text-foreground"
										key={feature.name}
									>
										<span
											className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-action-soft text-xs"
											aria-hidden="true"
										>
											✓
										</span>
										<span>{feature.name}</span>
									</li>
								))}
							</ul>
							<button
								type="button"
								className={cn(
									'mt-8 inline-flex min-h-11 w-full items-center justify-center rounded-full px-5 text-center text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60',
									plan.highlight
										? 'bg-foreground text-background hover:bg-foreground/90'
										: 'border border-border bg-surface text-foreground hover:bg-action-soft'
								)}
								onClick={() => onPlanSelect(plan.id)}
								disabled={buttonDisabled?.(plan)}
								aria-label={`Select ${plan.title} plan`}
							>
								{buttonLabel?.(plan) ?? plan.buttonText}
							</button>
						</article>
					);
				})}
			</div>
		</section>
	);
}
