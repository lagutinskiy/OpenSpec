# Maintenance scripts

- `pack-local.mjs`: build a private tarball without install-time scripts.
- `generate-skillssh.mjs`: rebuild committed skills from CLI templates.
- `regen-parity-hashes.mjs`: refresh template parity hashes after an intentional change.

Run `pnpm build` before either script. Run tests after regeneration.
