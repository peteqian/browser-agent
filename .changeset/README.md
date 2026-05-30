# Changesets

This monorepo uses [Changesets](https://github.com/changesets/changesets) for versioning + publishing.

## Workflow

```bash
bun run changeset           # describe a change (interactive)
bun run version-packages    # apply pending changesets: bump versions, regenerate CHANGELOGs
bun run release             # turbo build && changeset publish (CI only)
```

`.github/workflows/release.yml` runs the changesets GitHub Action on push to `main`. The action either opens a "Version Packages" PR (when pending changesets exist) or publishes (when a previously-merged version PR lands).

## Linked packages

`config.json` declares:

```json
"linked": [["@peteqian/browser-agent-sdk", "@peteqian/browser-agent"]]
```

This forces `@peteqian/browser-agent-sdk` and `@peteqian/browser-agent` to share the same version number. Any changeset on one bumps both, even if only one was touched.

### Why linked

While the SDK surface is pre-1.0, the CLI/MCP runtime depends tightly on internal SDK details. Shared versions:

- Guarantee CLI/MCP `0.X.Y` always pairs with SDK `0.X.Y`. No "which SDK does this CLI work with" matrix.
- Keep release notes consolidated.
- Let breaking SDK changes ship without needing to think about CLI compatibility every release — bumping the major hits both packages.

### Unlink trigger

Remove the `linked` entry from `config.json` **when the SDK ships 1.0**. From 1.0 onward:

- The SDK exposes a stable public surface; CLI/MCP can pin a semver range (`^1.0.0`) and float across SDK minors.
- The runtime package can iterate (UX, MCP tools, future HTTP server) on its own version cadence.
- Patch fixes in one shouldn't force a release of the other.

Until that day, keep them linked.
