import { describe, expect, test } from 'bun:test';
import { createBillingOperations, OperationStaleError } from './operation.ts';

function fakeOverlay() {
	const calls: string[] = [];
	return {
		calls,
		overlay: {
			open: () => 'overlay' as const,
			close: () => {
				calls.push('close');
			}
		}
	};
}

describe('billing operations registry', () => {
	test('an account switch supersedes the previous account operation', () => {
		const ops = createBillingOperations();
		const first = ops.begin('checkout', 'user-a', null);
		const second = ops.begin('checkout', 'user-b', null);
		expect(first.isCurrent()).toBe(false);
		expect(second.isCurrent()).toBe(true);
		expect(() => first.assertCurrent()).toThrow(OperationStaleError);
	});

	test('a new same-account operation supersedes and closes the previous overlay', () => {
		const ops = createBillingOperations();
		const old = fakeOverlay();
		const first = ops.begin('checkout', 'user-a', old.overlay);
		const second = ops.begin('checkout', 'user-a', null);
		expect(first.isCurrent()).toBe(false);
		expect(second.isCurrent()).toBe(true);
		expect(old.calls).toEqual(['close']);
	});

	test('bumping the generation invalidates everything and closes overlays', () => {
		const ops = createBillingOperations();
		const old = fakeOverlay();
		const first = ops.begin('checkout', 'user-a', old.overlay);
		const portal = ops.begin('portal', 'user-a', null);
		ops.bumpGeneration();
		expect(first.isCurrent()).toBe(false);
		expect(portal.isCurrent()).toBe(false);
		expect(old.calls).toEqual(['close']);
		expect(() => first.assertCurrent()).toThrow(OperationStaleError);
	});
});
