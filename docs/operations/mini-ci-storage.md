# Mini CI storage

The Mini release jobs keep their workspace, compiler temporary files, and package caches on the Mini's internal SSD under `/Users/mackieg/t3-ci`. `MINI_CI_STORAGE_ROOT` overrides that root. Before dependency installation, the job guard checks that the workspace and cache root share one volume and that the volume has at least 45 GiB free. That floor covers a job's own allocation plus the 25 GiB of internal headroom the fleet's native builds need (GMA-730). If the check fails, free space on the Mini rather than lowering the floor.

Do not move this storage to a disk image on the T9. Both the `T9-APFS` sparse bundle and the `FleetNativeFast-20261009` sparse image live on the T9's exFAT filesystem. On them, creating files is about 100 times slower than on the internal SSD, and the Mac and iOS builds took 40 to 130 minutes instead of minutes.

## Activate the runner configuration

Drain the runner through its normal service shutdown and wait for its current job to finish. Check the owning Forgejo run is terminal and no child process or open file still references its workspace. Do not change storage paths or restart the service while a job is active. Preserve the current configuration before changing it.

Use the installed runner's supported `host.workdir_parent` setting:

```yaml
host:
  workdir_parent: /Users/mackieg/t3-ci/workspaces
```

Keep the existing runner capacity, credentials, labels, timeout, and shutdown timeout. The workflow guard exports the storage paths through `GITHUB_ENV`, so desktop packaging, iOS `mktemp`, CocoaPods, Corepack, npm and pnpm share the validated root without changing global user configuration. The build steps must not override `TMPDIR` with `/tmp`. If the root changes, change both `host.workdir_parent` and `MINI_CI_STORAGE_ROOT`.

## Verify placement without a build

Dispatch `mini-ci-storage.yml` on the merged revision. Its five-minute Mini job checks out that revision under the configured runner workspace, exports the guarded paths, and verifies actual Python/Node temporary allocation plus npm/pnpm cache resolution. The installed tools run without network-enabled Corepack or project package-manager switching. The receipt is printed to the job log. This job installs no dependencies and starts no native builds. The Linux storage regression suite also runs on dispatch.
