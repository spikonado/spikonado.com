export type OperationContext = {
	generation: number;
	accountId: string;
};

export type OperationGuard = {
	context: OperationContext;
	isCurrent(): boolean;
	assertCurrent(): void;
};

export function createBillingOperations() {
	let generation = 0;

	function begin(accountId: string): OperationGuard {
		const context: OperationContext = { generation: ++generation, accountId };
		const isCurrent = () => context.generation === generation;
		return {
			context,
			isCurrent,
			assertCurrent() {
				if (!isCurrent()) throw new Error('This billing action was cancelled.');
			}
		};
	}

	function bumpGeneration(): void {
		generation += 1;
	}

	return { begin, bumpGeneration };
}
