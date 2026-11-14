#!/usr/bin/env bash
set -euo pipefail
# T3 Code Locked restriction gate (T3CODE-15, T3CODE-110). Every daily candidate passes it
# before its desktop builds start; a failure keeps lockdown where it is.
for package in packages/shared apps/server apps/desktop apps/web scripts; do
  (cd "$package" && "$OLDPWD/node_modules/.bin/effect-tsgo" tsrs --noEmit)
done
pnpm vp test run \
  packages/shared/src/lockdownEdition.test.ts \
  apps/server/src/lockdown/lockdownServer.test.ts \
  apps/desktop/src/lockdown/lockdownDesktop.test.ts \
  apps/web/src/cloud/lockdownPublicConfig.test.ts \
  scripts/lib/lockdown-build-config.test.ts \
  scripts/lib/lockdown-ci.test.ts
