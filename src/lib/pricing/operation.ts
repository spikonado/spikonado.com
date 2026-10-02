import type { CheckoutOverlay } from '@/lib/pricing/checkout-overlay';

export type BillingOperationKind = 'checkout' | 'portal';

export type OperationContext = {
	/** Identifies the signed-in account and UI session that owns the operation. */
	generation: number;
	accountId: string;
	kind: BillingOperationKind;
	overlay: CheckoutOverlay | null;
};

export type OperationGuard = {
	context: OperationContext;
	/** True while this account + generation still own the UI. */
	isCurrent(): boolean;
	/** Throws when the operation has been superseded. */
	assertCurrent(): void;
};

export class OperationStaleError extends Error {
	constructor() {
		super('This billing action was cancelled.');
		this.name = 'OperationStaleError';
	}
}

/**
 * Account- and generation-bound registry for billing operations. The UI is
 * bound to one signed-in account at a time, so a new operation supersedes any
 * previous operation of the same kind — including one owned by a different
 * account — and tears down its overlay. Bumping the generation (sign-out,
 * account switch, component unmount) invalidates every in-flight operation.
 * There is deliberately no shared in-flight promise: concurrent callers always
 * get distinct operations and the server serializes attempts per account.
 */
export function createBillingOperations() {
	const active = new Map<BillingOperationKind, OperationContext>();
	let generation = 0;

	function begin(kind: BillingOperationKind, accountId: string, overlay: CheckoutOverlay | null) {
		const previous = active.get(kind);
		if (previous) previous.overlay?.close();
		const context: OperationContext = { generation, accountId, kind, overlay };
		active.set(kind, context);

		const isCurrent = () => active.get(kind) === context && context.generation === generation;
		return {
			context,
			isCurrent,
			assertCurrent() {
				if (!isCurrent()) throw new OperationStaleError();
			}
		} satisfies OperationGuard;
	}

	function bumpGeneration(): void {
		generation += 1;
		for (const context of active.values()) context.overlay?.close();
		active.clear();
	}

	function currentGeneration(): number {
		return generation;
	}

	return { begin, bumpGeneration, currentGeneration };
}
