# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog.

## [Unreleased]

### Added

- OSS readiness baseline files:
  - `LICENSE`
  - `SECURITY.md`
  - `CONTRIBUTING.md`
  - `.env.example`
  - `CONFIGURATION.md`
  - GitHub issue/PR templates
  - GitHub Actions CI workflow
- Oxc formatter and lint tooling:
  - `oxfmt` scripts (`fmt`, `fmt:check`)
  - `oxlint` scripts (`lint`, `lint:type-aware`)
  - `tsconfig.oxlint.json` for type-aware lint analysis
  - `.oxfmtignore` and `.oxlintignore`

### Changed

- Expanded README with open-source quickstart, configuration, and support docs.
- Hardened `.gitignore` for local artifacts and HAR/log files.
- CI now enforces blocking quality gates (format, lint, coverage, bundle) and runs Node 20 compatibility tests.
- Added non-blocking type-aware lint CI job (alpha).
- Coverage thresholds are now enforced in Vitest config.
