# AGENTS.md

## Project Overview

This is the website for Spikoando, a company building products to simplify every step of robotics development.
The goal of the website is to make it easier for customers to understand and use our products.

## Testing

1. `prek run -a` -> This covers ALL formatting and linting
2. `bun run build`

Run only the tests relevant to your changes unless instructed otherwise.

### Nix Environment

It provides all dependencies/tools you may need. Use it through `nix develop -c <command>`.

## Priorities in Order

1. Reliability of code -> Behavior should be predictable under load and during failures
2. Maintainability of code
3. Performance of code
4. AI Optimization (AIO)
5. Search Engine Optimization (SEO)

All of these are core priorities, try your best to achiveve all of them without having to make tradeoffs.

## Maintaining Code

Don't be afraid to change existing code in order to improve on any of the priorities.
