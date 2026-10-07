# Mail Digester development

Keep mailbox retrieval and classification outside this app. The app persists structured submissions and records reader/agent activity separately. Preserve the private Tailscale browser access boundary; ingestion and feedback require managed API keys.

## REST, CLI, and skill alignment

Every active REST method/path belongs in `lib/api/contracts.ts` and exports an `apiOperation` wrapper. Define request schemas there; do not add independent route-local input schemas or CLI-only service logic. The CLI consumes the generated `contracts/operations.json` and calls REST, never SQLite or app services directly. Retired routes belong in `RETIRED_ROUTES`, with no working CLI command.

When adding, changing, or removing an operation, update the shared contract, run `npm run api:contracts`, extend the CLI-over-HTTP conformance test in `e2e/cli.spec.ts`, and update `skills/mail-digester/SKILL.md` examples when the workflow changes. `npm run api:check` fails for stale generated schemas, unregistered routes, wrong wrapper IDs, duplicate commands, or CLI operations without a REST implementation. It runs in the normal check/CI/push gates. Clients also compare the contract fingerprint before mutations, so an old CLI fails before submitting a write to an incompatible server.

Key secrets are generated randomly, shown once, and stored only as hashes. Import environment tokens once; revocation must persist across restart and cannot be undone by bootstrap. Rotation is transactional. Keep request authorization separate from business logic; invalid/under-scoped Bearer credentials never fall back to browser access. Browser requests remain protected by origin checks. Keyed item actions use `actor=agent`; browser actions use `actor=human`.

## Required verification

Run `npm run verify:full`. Cover key create/use/rotate/revoke and last-use timestamps, CLI command coverage and server parity, login persistence/environment precedence, global npm installation and managed skill updates/conflict preservation. Use synthetic SQLite databases and isolated `MAIL_DIGESTER_USER_HOME` directories. Never test mutations against the deployed database. Follow `docs/OPERATIONS.md` for deployment or migration; take WAL-aware backups and compare existing table values.
