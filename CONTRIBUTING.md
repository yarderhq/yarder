# Contributing to yarder

Source lives at [github.com/yarderhq/yarder](https://github.com/yarderhq/yarder).
The public license is [AGPL-3.0-only](LICENSE). Apps you deploy *with* yarder
are not placed under the AGPL.

## CLA

Every pull request must be covered by the [Contributor License Agreement](CLA.md).
Do not send code unless you agree to it.

After you open a PR, the CLA bot will comment. Sign by posting:

```
I have read the CLA Document and I hereby sign the CLA.
```

GitHub user `tw113` is allowlisted (project maintainer). Bot accounts matching
`*bot*` are also skipped.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm test
npm run lint
npx yarder --help
```

Keep changes focused. Match the surrounding code style. Do not commit
`node_modules/`, `dist/`, `.env`, or `.yarder/`.
