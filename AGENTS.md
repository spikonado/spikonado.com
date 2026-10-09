# AGENTS.md

## Project overview

- This is the website for Spikonado, a company building products to simplify every step of robotics development.
- The goal is to make it easier for customers to understand and use our products.

## Available testing commands

- `prek run -a` covers formatting, linting, and Astro checks.
- `bun run build` checks the production build.
- Run only the checks relevant to your changes unless instructed otherwise.
- Check GitHub CI after opening a PR.

### Nix environment

It provides all dependencies/tools you may need. Use it through `nix develop -c <command>`.

## Priorities in order

1. Reliability of code. Behavior should be predictable under load and during failures.
2. Maintainability of code
3. Performance of code
4. AI optimization (AIO)
5. Search engine optimization (SEO)

All of these are core priorities; try your best to achieve all of them without having to make trade-offs.

## Maintaining code

- Don't be afraid to completely refactor existing code to improve on any of the priorities.
- Make changes in all affected layers of the website when needed.

## PR workflow

- Unless requested otherwise, open non-draft PRs against the default branch.
- After opening a PR, let Greptile review the changes instead of performing code reviews with subagents.

1. Push the changes and open or update a PR. Match past PR title formats and update the branch with the latest default branch.
2. Wait for GitHub CI and Greptile's review to complete.
3. Fix relevant issues from inline comments and the PR description above "Important Files Changed". For false positives, outdated findings, or irrelevant issues, explain why in the inline thread or a top-level PR comment.
4. Commit and push fixes without asking again.
5. Repeat steps 2-4 until Greptile gives a 5/5 confidence score or no actionable issues remain. Comment `@greptileai review` if a review does not start automatically. If the score stays below 5/5 with no actionable issues, explain why and stop.
6. Clean up worktrees and branches created for the PR when done.
