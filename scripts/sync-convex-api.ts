/**
 * Regenerate the checked-in Sprocket Convex TypeScript API for this repo.
 *
 * Uses the Convex multiple-repos workflow:
 * https://docs.convex.dev/production/multiple-repos
 *
 * Run from a machine logged into the Sprocket Convex project, with the
 * deployment selected (or pass --prod). Copies nothing from Sprocket source —
 * it introspects the live deployment function spec.
 *
 * Examples:
 *   bun run sync:convex-api
 *   bun run sync:convex-api -- --prod
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src/lib/convex');
// Full deployment dump for reference; marketing keeps a curated public subset in api.ts.
const generatedPath = join(outDir, 'api.full.generated.ts');

mkdirSync(outDir, { recursive: true });

const extraArgs = process.argv.slice(2);
const result = spawnSync(
	'bunx',
	['convex-helpers', 'ts-api-spec', '--output-file', generatedPath, ...extraArgs],
	{
		cwd: root,
		stdio: 'inherit',
		env: process.env
	}
);

if (result.status !== 0) {
	console.error(
		'Failed to generate API. Ensure you are logged into Convex and pointed at the Sprocket deployment (convex login / CONVEX_DEPLOYMENT).'
	);
	process.exit(result.status ?? 1);
}

console.log(`Wrote ${generatedPath}`);
console.log(
	'Update src/lib/convex/api.ts (curated marketing public surface) if authBootstrap/billing/pricing signatures changed.'
);
