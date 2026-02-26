# Release Process

OpenClaw HUD uses GitHub releases (not npm publishing). `package.json` is marked `"private": true` to prevent accidental npm publish.

## Preconditions

- Merge target commit to `master`.
- Update `CHANGELOG.md` with the release notes.
- Confirm you are on latest `origin/master`.
- Confirm CI is green on the target commit.

### Release checklist

1. From `master`, run required local checks (`npm run quality` if not already clean in CI).
2. Confirm a final changelog section exists for the release version.
3. Record the release SHA: `RELEASE_SHA=$(git rev-parse HEAD)`.

## Manual Release Workflow

Use the GitHub Actions workflow **Release (Manual)**:

1. Open **Actions** -> **Release (Manual)**.
2. Click **Run workflow** and select `ref=master` or the recorded `RELEASE_SHA`.
3. Leave `full_e2e=true` for normal releases (only disable for emergency scenarios).
4. Wait for workflow success and download the generated `.tgz` artifact.
5. Keep the Actions run URL + artifact name for release notes.

The workflow runs formatting, lint, type-aware lint, unit coverage, smoke E2E, bundle analysis, and package validation before producing the tarball artifact.

## Create Git Tag + GitHub Release

After the manual workflow succeeds:

1. Create and push an annotated tag:

```bash
git tag -a vX.Y.Z -m "vX.Y.Z" "$RELEASE_SHA"
git push origin vX.Y.Z
```

2. Create a GitHub Release from that tag and paste the matching `CHANGELOG.md` section.
3. Attach the workflow tarball artifact to the release (recommended), and link the Actions run.
