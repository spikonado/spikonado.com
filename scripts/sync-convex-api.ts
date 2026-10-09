import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

export type Validator = { type: string; value?: unknown };
export type Contract = {
	version: number;
	sourceRevision: string;
	functions: Record<string, { kind: string; args: Validator; returns: Validator }>;
};

const FUNCTION_KINDS = ['query', 'mutation', 'action'];

export function parseContract(raw: string, origin: string, sourceRevision?: string): Contract {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`Billing contract from ${origin} is not valid JSON.`);
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
		throw new Error(`Billing contract from ${origin} has an unsupported shape.`);
	const contract = {
		...parsed,
		...(sourceRevision === undefined ? {} : { sourceRevision })
	} as Contract;
	if (
		contract.version !== 1 ||
		typeof contract.sourceRevision !== 'string' ||
		!contract.sourceRevision ||
		!contract.functions ||
		typeof contract.functions !== 'object' ||
		Array.isArray(contract.functions)
	)
		throw new Error(`Billing contract from ${origin} has an unsupported shape.`);
	for (const [path, fn] of Object.entries(contract.functions)) {
		if (!fn?.args || !fn.returns)
			throw new Error(`Billing contract function ${path} is missing validators.`);
	}
	return contract;
}

export function validatorType(validator: Validator): string {
	switch (validator.type) {
		case 'null':
			return 'null';
		case 'string':
			return 'string';
		case 'boolean':
			return 'boolean';
		case 'number':
		case 'float64':
			return 'number';
		case 'int64':
			return 'bigint';
		case 'bytes':
			return 'ArrayBuffer';
		case 'literal':
			return JSON.stringify(validator.value);
		case 'array':
			return `Array<${validatorType(validator.value as Validator)}>`;
		case 'union':
			return (validator.value as Validator[]).map(validatorType).join(' | ');
		case 'object': {
			const fields = Object.entries(
				validator.value as Record<string, { fieldType: Validator; optional: boolean }>
			);
			if (!fields.length) return 'Record<string, never>';
			return `{ ${fields.map(([name, field]) => `${JSON.stringify(name)}${field.optional ? '?' : ''}: ${validatorType(field.fieldType)};`).join(' ')} }`;
		}
		default:
			throw new Error(`Unsupported public billing validator: ${validator.type}`);
	}
}

export function renderContract(contract: Contract): string {
	if (contract.version !== 1)
		throw new Error(`Unsupported billing contract version ${contract.version}.`);
	if (!Object.keys(contract.functions).length)
		throw new Error('Billing contract has no functions.');
	const modules = new Map<string, string[]>();
	for (const [path, fn] of Object.entries(contract.functions)) {
		const [module, name, extra] = path.split(':');
		if (!module || !name || extra !== undefined)
			throw new Error(`Invalid public function path ${path}.`);
		if (!FUNCTION_KINDS.includes(fn.kind))
			throw new Error(`Invalid kind ${JSON.stringify(fn.kind)} for ${path}.`);
		const entries = modules.get(module) ?? [];
		entries.push(
			`${JSON.stringify(name)}: FunctionReference<${JSON.stringify(fn.kind)}, 'public', ${validatorType(fn.args)}, ${validatorType(fn.returns)}>;`
		);
		modules.set(module, entries);
	}
	return `import { anyApi, type FunctionReference, type FunctionReturnType } from 'convex/server';
export type PublicApiType = { ${[...modules].map(([name, entries]) => `${JSON.stringify(name)}: { ${entries.join('\n')} };`).join('\n')} };
export const api: PublicApiType = anyApi as unknown as PublicApiType;
export type PublicPricingCatalog = FunctionReturnType<PublicApiType['pricing']['getPublicCatalog']>;
export type PublicPricingPlan = PublicPricingCatalog['plans'][number];
export type DodoPublicPrice = NonNullable<PublicPricingPlan['prices']['monthly']>;
export type PublicPlanId = PublicPricingPlan['id'];
export type SubscriptionTier = FunctionReturnType<PublicApiType['billing']['getMySubscription']>['tier'];
export type BillingInterval = 'monthly' | 'annual';
export type AccessPhase = NonNullable<FunctionReturnType<PublicApiType['billing']['getMySubscription']>['accessPhase']>;
export type CheckoutAttemptStatus = FunctionReturnType<PublicApiType['billing']['getCheckoutStatus']>['status'];
`;
}

function run(cwd: string, command: string, args: string[]): string {
	const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			`${command} ${args.join(' ')} failed in ${cwd}:\n${result.stderr || `exit ${result.status}`}`
		);
	return result.stdout.trim();
}

if (import.meta.main) {
	const root = join(dirname(fileURLToPath(import.meta.url)), '..');
	const snapshot = join(root, 'src/lib/convex/billing-contract.json');
	const output = join(root, 'src/lib/convex/api.ts');
	const args = process.argv.slice(2);
	const check = args.filter((arg) => arg === '--check').length;
	if (check > 1) throw new Error('Pass --check at most once.');
	const sourceArgs = args.flatMap((arg, index) => (arg === '--source' ? [index] : []));
	if (sourceArgs.length > 1) throw new Error('Pass --source at most once.');
	const sourceIndex = sourceArgs[0];
	const sourceValue = sourceIndex === undefined ? null : args[sourceIndex + 1];
	if (sourceIndex !== undefined && (!sourceValue || sourceValue.startsWith('--')))
		throw new Error('--source requires a backend checkout path.');
	for (const [index, arg] of args.entries())
		if (arg !== '--check' && arg !== '--source' && index !== sourceArgs[0]! + 1)
			throw new Error(`Unknown billing contract argument ${JSON.stringify(arg)}.`);
	const source = sourceValue ? resolve(sourceValue) : null;
	let contract: Contract;
	if (source) {
		if (run(source, 'git', ['status', '--porcelain', '--untracked-files=normal'])) {
			throw new Error('Commit backend changes before pinning the billing contract.');
		}
		const sourceRevision = run(source, 'git', ['rev-parse', 'HEAD']);
		contract = parseContract(
			run(join(source, 'apps/web'), 'bun', ['scripts/exportBillingContract.ts']),
			'the backend exporter',
			sourceRevision
		);
		if (check) {
			const saved = parseContract(readFileSync(snapshot, 'utf8'), snapshot);
			if (JSON.stringify(saved) !== JSON.stringify(contract))
				throw new Error(
					'Pinned backend billing contract drift. Regenerate after updating the backend revision.'
				);
		}
	} else {
		contract = parseContract(readFileSync(snapshot, 'utf8'), snapshot);
	}
	const generated = await format(renderContract(contract), {
		parser: 'typescript',
		useTabs: true,
		singleQuote: true,
		trailingComma: 'none',
		printWidth: 100
	});
	if (check) {
		if (readFileSync(output, 'utf8') !== generated)
			throw new Error('Generated billing API drift. Run sync:convex-api.');
		console.log('Billing API matches the pinned backend contract.');
	} else {
		if (source) writeFileSync(snapshot, `${JSON.stringify(contract, null, '\t')}\n`);
		writeFileSync(output, generated);
		console.log(`Wrote ${output}${source ? ` and ${snapshot}` : ''}.`);
	}
}
