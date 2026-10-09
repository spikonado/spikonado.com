# [spikonado.com](https://spikonado.com)

## Running Locally

### Nix

Install Nix: https://nixos.org/nix/download.html

#### 1. Clone the repository

```bash
git clone https://github.com/spikonado/spikonado.com.git
cd spikonado.com
```

#### 2. Activate the nix environment

```bash
nix develop
```

#### 3. Start the website

```bash
bun install
bun dev
```

## Pricing checkout

`/pricing` uses BillingSDK's source-installed pricing table, the Sprocket Convex deployment, WorkOS AuthKit, and Dodo hosted checkout.

Plan allowances and Dodo prices are read live from Sprocket via `pricing:getPublicCatalog`. The checked-in typed API lives at `src/lib/convex/api.ts` ([Convex multiple repos](https://docs.convex.dev/production/multiple-repos)).

Plan-specific model-access copy comes from the operator-owned catalog `features`; the website does not invent model names or assume equal access across tiers.

Generate from the checked-out backend's registered validators and pin its actual
commit. Push that backend commit before this website so CI can fetch the pin:

```bash
bun run sync:convex-api --source /path/to/sprocket-worktree
bun run sync:convex-api --check --source /path/to/sprocket-worktree
```

Set `PUBLIC_CONVEX_URL` and `PUBLIC_DODO_CHECKOUT_MODE` (`test` or `live`) to match the backend deployment. Checkout and recovered links validate the mode returned by the backend before redirecting. Returning from or reloading an unpaid checkout offers **Continue checkout** using the same account-owned hosted link.

In the WorkOS environment selected by that deployment's `WORKOS_CLIENT_ID`, allow the website origin in CORS and its `/pricing/callback` URL in Redirects. For hosted cookie sessions, set `PUBLIC_WORKOS_API_HOSTNAME` to your custom WorkOS authentication API domain. Development previews without a custom domain must set `PUBLIC_WORKOS_DEV_MODE=true`, which stores refresh tokens in localStorage. Localhost uses development mode by default. Do not enable development mode in production. These public values are build-time settings, so redeploy after changing them. A failed session restore after the callback stops checkout resumption instead of starting another sign-in.

Merchant settings, deployment order, and launch tests are maintained in the Sprocket project artifact **Dodo dashboard setup for Sprocket** (`ks74f9xxtjp9hmgj0ackvxk9698f0f2g`). Dodo's **Allow Multiple Subscriptions** setting must be off; the website does not locally gate purchases by subscription status.

Regenerate the contract when public signatures change and commit both `src/lib/convex/api.ts` and `billing-contract.json`. Without `--source`, the command renders only the existing pinned snapshot; `--prod` is not supported.
