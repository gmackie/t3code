#!/usr/bin/env bash
set -euo pipefail
# The same behavioral gate runs before promotion on every daily candidate.
pnpm exec tsc --noEmit -p apps/server/tsconfig.json
pnpm exec tsc --noEmit -p apps/web/tsconfig.json
pnpm exec tsc --noEmit -p apps/desktop/tsconfig.json
pnpm exec vp test run \
  apps/server/src/provider/Layers/lockedDownProviders.test.ts \
  apps/server/src/provider/lockedDownOpenCode.test.ts \
  apps/server/src/provider/lockedDownAdapter.test.ts \
  apps/server/src/sourceControl/lockedDownIntegrations.test.ts \
  apps/desktop/src/backend/DesktopServerExposure.test.ts \
  apps/web/src/environments/primary/lockedDownTarget.test.ts \
  apps/desktop/src/appIdentity.test.ts \
  apps/server/src/provider/Drivers/OpenCodeDriver.test.ts \
  apps/server/src/serverRuntimeStartup.test.ts \
  apps/server/src/cli/lockedDownConfig.test.ts \
  apps/server/src/serverLogger.test.ts \
  scripts/lib/lockdown-ci.test.ts
