# AGENTS.md

## Project Overview

This is a website.
Our core frameworks include pnpm, Astro, Svelte, TailwindCSS, and shadcn-svelte (alongside some other UI component libraries).

## Testing

1. `prek run -a --hook-stage manual` for formatting and linting
2. `pnpm build`

## Priorities in Order

1. Reliability of code
2. Maintainability of code
3. Performance of code
4. Search Engine Optimization (SEO)
5. AI Optimization (AIO)

All of these are core priorities, try your best to achiveve all of them without having to make tradeoffs.

## Maintaining Code

Don't be afraid to change existing code in order to improve on any of the priorities.
If you add new functionality, first check if there is shared logic that can be extracted to a separate module.
Duplicate logic across multiple files should be avoided.
Don't take shortcuts by just adding local logic to solve a problem.
