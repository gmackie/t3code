#!/usr/bin/env python3
"""Validate SSD-bound Mini jobs before installers or compilers allocate storage."""
import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile

GIB = 1024 ** 3
DEFAULT_ROOT = '/Volumes/FleetNativeFast-20261009/t3-ci'


def prepare(root, workspace, internal_device, minimum_free=30 * GIB):
    root = Path(root)
    workspace = Path(workspace).resolve(strict=True)
    if '\n' in str(root) or '\r' in str(root):
        raise ValueError('CI storage paths cannot contain newlines')
    if not root.is_absolute() or root.is_symlink():
        raise ValueError('CI storage root must be an absolute directory, not a symlink')
    parent = root
    while not parent.exists():
        parent = parent.parent
    if parent.stat().st_dev == internal_device:
        raise ValueError('CI SSD is unavailable; refusing internal-storage fallback')
    root = root.resolve()
    if workspace.stat().st_dev == internal_device:
        raise ValueError('Runner workspace is internal; drain the runner and configure host.workdir_parent on the SSD before restarting')
    if workspace.stat().st_dev != parent.stat().st_dev:
        raise ValueError('Runner workspace and CI caches must use the same SSD volume')
    if shutil.disk_usage(parent).free < minimum_free:
        raise ValueError('CI SSD has less than the required free capacity')
    if not os.access(parent, os.W_OK) or not parent.stat().st_mode & 0o200:
        raise PermissionError('CI SSD directory is not writable by the runner')
    root.mkdir(parents=True, exist_ok=True)
    variables = {
        'TMPDIR': root / 'tmp',
        'npm_config_cache': root / 'npm-cache',
        'pnpm_config_store_dir': root / 'pnpm-store',
        'COREPACK_HOME': root / 'corepack',
        'CP_HOME_DIR': root / 'cocoapods-home',
        'CP_CACHE_DIR': root / 'cocoapods-cache',
        'XDG_CACHE_HOME': root / 'cache',
    }
    for directory in variables.values():
        if directory.is_symlink():
            raise ValueError('CI storage directories must not redirect to other locations')
        directory.mkdir(exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=directory) as probe:
            probe.write(b't3-ci-storage-readback')
            probe.flush()
            os.fsync(probe.fileno())
            probe.seek(0)
            if probe.read() != b't3-ci-storage-readback':
                raise OSError('CI SSD write/read verification failed')
    return {key: str(value) for key, value in variables.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=os.environ.get('T3CODE_MINI_CI_ROOT', DEFAULT_ROOT))
    parser.add_argument('--workspace', default=os.environ.get('GITHUB_WORKSPACE', os.getcwd()))
    parser.add_argument('--github-env', default=os.environ.get('GITHUB_ENV'))
    args = parser.parse_args()
    try:
        # macOS separates the sealed system snapshot from writable internal data.
        internal_volume = Path('/System/Volumes/Data')
        if not internal_volume.exists():
            internal_volume = Path('/')
        variables = prepare(args.root, args.workspace, internal_volume.stat().st_dev)
    except (OSError, ValueError) as error:
        parser.exit(1, f'Mini CI storage guard: {error}\n')
    if args.github_env:
        with open(args.github_env, 'a', encoding='utf-8') as output:
            for key, value in variables.items():
                # Environment files are line-delimited; reject injected entries.
                if '\n' in value or '\r' in value:
                    parser.exit(1, 'CI storage paths cannot contain newlines\n')
                output.write(f'{key}={value}\n')
    print(json.dumps({'storageRoot': args.root, 'workspace': args.workspace, 'variables': variables}))


if __name__ == '__main__':
    main()
