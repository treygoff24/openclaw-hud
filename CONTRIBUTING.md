# Contributing

Thanks for contributing to OpenClaw HUD.

## Setup

1. Fork and clone the repository.
2. Install dependencies:
```bash
npm ci
```
3. Start the app:
```bash
npm start
```
4. Run tests:
```bash
npm test
```

## Development Workflow

1. Create a focused branch from `master`.
2. Keep PRs small and scoped to one concern.
3. Add or update tests for behavior changes.
4. Run the full test suite before opening a PR.

## Code Standards

- Preserve existing patterns and folder structure.
- Prefer clear, minimal code over clever abstractions.
- Avoid unrelated refactors in feature/fix PRs.
- Keep comments concise and only where needed.

## Commit Guidelines

Use clear, imperative commit messages:
- `fix: include device proof in gateway ws connect`
- `docs: add security policy`

## Pull Request Checklist

- [ ] Problem statement and scope are clear
- [ ] Tests added/updated for changes
- [ ] `npm test` passes locally
- [ ] Docs updated if behavior/config changed
- [ ] No secrets or local machine artifacts committed

## Security

Do not disclose vulnerabilities in public issues.
See [SECURITY.md](./SECURITY.md) for reporting instructions.
