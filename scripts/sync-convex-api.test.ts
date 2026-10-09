import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseContract, renderContract, validatorType } from './sync-convex-api';

describe('billing contract generation', () => {
	test('requires a committed backend before exporting its contract', () => {
		const source = mkdtempSync(join(tmpdir(), 'billing-contract-'));
		try {
			const git = (...args: string[]) => spawnSync('git', args, { cwd: source, encoding: 'utf8' });
			expect(git('init').status).toBe(0);
			const web = join(source, 'apps/web');
			mkdirSync(web, { recursive: true });
			const backend = join(web, 'package.json');
			writeFileSync(backend, '{"name":"billing-backend"}\n');
			expect(git('add', '.').status).toBe(0);
			expect(
				git(
					'-c',
					'user.name=Billing test',
					'-c',
					'user.email=billing@example.com',
					'-c',
					'commit.gpgsign=false',
					'commit',
					'-m',
					'Initial backend'
				).status
			).toBe(0);
			writeFileSync(backend, '{"name":"changed-backend"}\n');
			const entry = join(import.meta.dir, 'sync-convex-api.ts');
			const command = spawnSync(process.execPath, [entry, '--check', '--source', source], {
				encoding: 'utf8'
			});
			expect(command.status).not.toBe(0);
			expect(command.stderr).toContain(
				'Commit backend changes before pinning the billing contract.'
			);
		} finally {
			rmSync(source, { recursive: true, force: true });
		}
	});
	test('retains nested fields, optionality, unions, and empty arguments', () => {
		expect(
			validatorType({
				type: 'object',
				value: {
					status: {
						optional: false,
						fieldType: {
							type: 'union',
							value: [
								{ type: 'literal', value: 'pending' },
								{ type: 'literal', value: 'active' }
							]
						}
					},
					attempts: { optional: true, fieldType: { type: 'array', value: { type: 'number' } } }
				}
			})
		).toBe('{ "status": "pending" | "active"; "attempts"?: Array<number>; }');
		expect(validatorType({ type: 'object', value: {} })).toBe('Record<string, never>');
		expect(validatorType({ type: 'literal', value: 'quote"slash\\' })).toBe(
			JSON.stringify('quote"slash\\')
		);
		expect(validatorType({ type: 'int64' })).toBe('bigint');
	});
	test('generates exact function kinds and rejects unknown validators', () => {
		expect(
			renderContract({
				version: 1,
				sourceRevision: 'pinned',
				functions: {
					'billing:checkout': {
						kind: 'action',
						args: { type: 'object', value: {} },
						returns: { type: 'string' }
					}
				}
			})
		).toContain('FunctionReference<"action", \'public\', Record<string, never>, string>');
		expect(() => validatorType({ type: 'any' })).toThrow('Unsupported public billing validator');
		expect(() => validatorType({ type: 'record' })).toThrow('Unsupported public billing validator');
	});

	test('fails closed on malformed functions and contract shapes', () => {
		const base = { version: 1, sourceRevision: 'pinned' };
		expect(() => renderContract({ ...base, functions: {} })).toThrow('no functions');
		expect(() =>
			renderContract({
				...base,
				functions: {
					'billing:extra:checkout': {
						kind: 'query',
						args: { type: 'null' },
						returns: { type: 'null' }
					}
				}
			})
		).toThrow('Invalid public function path');
		expect(() =>
			renderContract({
				...base,
				functions: {
					':checkout': { kind: 'query', args: { type: 'null' }, returns: { type: 'null' } }
				}
			})
		).toThrow('Invalid public function path');
		expect(() =>
			renderContract({
				...base,
				functions: {
					'billing:checkout': {
						kind: 'httpAction',
						args: { type: 'null' },
						returns: { type: 'null' }
					}
				}
			})
		).toThrow('Invalid kind');
		expect(() => renderContract({ ...base, version: 2 } as never)).toThrow(
			'Unsupported billing contract version'
		);
	});

	test('parses contracts strictly and reports origin on bad input', () => {
		expect(() => parseContract('not json', 'snapshot')).toThrow('from snapshot is not valid JSON');
		expect(() =>
			parseContract('{"version":2,"sourceRevision":"x","functions":{}}', 'snapshot')
		).toThrow('from snapshot has an unsupported shape');
		expect(() =>
			parseContract(
				'{"version":1,"sourceRevision":"x","functions":{"billing:checkout":{"kind":"query"}}}',
				'snapshot'
			)
		).toThrow('missing validators');
		expect(
			parseContract('{"version":1,"sourceRevision":"x","functions":{}}', 'snapshot').sourceRevision
		).toBe('x');
	});

	test('pins the backend exporter to its checkout revision', () => {
		const raw =
			'{"version":1,"functions":{"billing:checkout":{"kind":"action","args":{"type":"object","value":{}},"returns":{"type":"string"}}}}';
		expect(parseContract(raw, 'exporter', 'backend-revision').sourceRevision).toBe(
			'backend-revision'
		);
		expect(() => parseContract(raw, 'snapshot')).toThrow('unsupported shape');
		for (const malformed of [
			'null',
			'[]',
			'{"version":1,"sourceRevision":"x"}',
			'{"version":1,"sourceRevision":"x","functions":[]}'
		]) {
			expect(() => parseContract(malformed, 'snapshot')).toThrow('unsupported shape');
		}
	});

	test('renders kind, argument, and return optionality drift into the API surface', () => {
		const fn = {
			kind: 'query',
			args: { type: 'object', value: {} },
			returns: {
				type: 'object',
				value: { url: { optional: false, fieldType: { type: 'string' } } }
			}
		};
		const render = (functions: Record<string, typeof fn>) =>
			renderContract({ version: 1, sourceRevision: 'pinned', functions });
		const baseline = render({ 'billing:portal': fn });
		expect(baseline).toContain(
			'FunctionReference<"query", \'public\', Record<string, never>, { "url": string; }>'
		);
		expect(render({ 'billing:portal': { ...fn, kind: 'action' } })).not.toBe(baseline);
		expect(
			render({
				'billing:portal': {
					...fn,
					args: {
						type: 'object',
						value: { attemptId: { optional: false, fieldType: { type: 'string' } } }
					}
				}
			})
		).not.toBe(baseline);
		expect(
			render({
				'billing:portal': {
					...fn,
					returns: {
						type: 'object',
						value: { url: { optional: true, fieldType: { type: 'string' } } }
					}
				}
			})
		).not.toBe(baseline);
	});
});
