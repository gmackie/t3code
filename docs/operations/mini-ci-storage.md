# Mini CI storage

The Mini release jobs require an external SSD for their workspace, compiler temporary files, and package caches. If the SSD is unavailable, unwritable, or has less than 30 GiB free, they fail before dependency installation instead of allocating on the internal drive. `MINI_CI_STORAGE_ROOT` selects the SSD root; its default is `/Volumes/FleetNativeFast-20261009/t3-ci`. The workspace must be on the same SSD volume as the cache root, so its 30 GiB capacity check covers both allocations. Existing cache data and recovery archives are never moved or removed by the job guard.

## Activate the runner configuration

Drain the runner through its normal service shutdown and wait for its current job to finish. Check the owning Forgejo run is terminal and no child process or open file still references its workspace. Do not change storage paths or restart the service while a job is active. Preserve the current configuration before changing it.

Use the installed runner's supported `host.workdir_parent` setting:

```yaml
host:
  workdir_parent: /Volumes/FleetNativeFast-20261009/t3-ci/workspaces
```

Create that directory on the mounted SSD with the runner account, preserving any existing workspaces at their original locations. Keep the existing runner capacity, credentials, labels, timeout, and shutdown timeout. Restart only after the idle checks pass. The workflow guard exports SSD paths through `GITHUB_ENV`, so desktop packaging, iOS `mktemp`, CocoaPods, Corepack, npm and pnpm share the validated root without changing global user configuration. The build steps must not override `TMPDIR` with `/tmp`.

Verify the next job's checked workspace and guard receipt both name the SSD, package cache and native temporary files stay below that root, and internal free space remains above the fleet startup threshold. Code publication alone does not verify this operational activation. If the root must change, drain the runner again, preserve the old workspace/cache contents, and change both `host.workdir_parent` and `MINI_CI_STORAGE_ROOT`. Rollback restores the preserved runner configuration while idle; no bulk directory migration or cleanup is required.
