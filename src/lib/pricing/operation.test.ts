import { describe, expect, test } from 'bun:test';
import { createBillingOperations } from './operation.ts';

describe('billing operations', () => {
	test('a new same-account operation supersedes the previous one', () => {
		const ops = createBillingOperations();
		const first = ops.begin('user-a');
		const second = ops.begin('user-a');
		expect(second.context.accountId).toBe('user-a');
		expect(second.context.generation).toBeGreaterThan(first.context.generation);
		expect(first.isCurrent()).toBe(false);
		expect(second.isCurrent()).toBe(true);
		expect(() => first.assertCurrent()).toThrow('This billing action was cancelled.');
		second.assertCurrent();
	});

	test('generation invalidation cancels the operation and a new account can begin', () => {
		const ops = createBillingOperations();
		const first = ops.begin('user-a');
		ops.bumpGeneration();
		expect(() => first.assertCurrent()).toThrow('This billing action was cancelled.');
		const next = ops.begin('user-b');
		expect(next.context.accountId).toBe('user-b');
		expect(first.isCurrent()).toBe(false);
		expect(next.isCurrent()).toBe(true);
	});
});
