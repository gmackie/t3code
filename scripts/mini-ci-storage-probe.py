#!/usr/bin/env python3
"""Read back CI path exports using installed tools, without downloads or builds."""
import json
import os
from pathlib import Path
import subprocess
import tempfile


def command(arguments, directory):
    return subprocess.run(arguments, cwd=directory, check=True, capture_output=True,
                          text=True, timeout=20).stdout.strip()


def main():
    workspace = Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True)
    internal = Path('/System/Volumes/Data').stat().st_dev
    device = workspace.stat().st_dev
    if device == internal:
        raise ValueError('CI checkout is on internal storage')
    names = ('TMPDIR', 'npm_config_cache', 'pnpm_config_store_dir', 'COREPACK_HOME',
             'CP_HOME_DIR', 'CP_CACHE_DIR', 'XDG_CACHE_HOME')
    paths = {name: Path(os.environ[name]).resolve(strict=True) for name in names}
    root = paths['TMPDIR'].parent
    for name, path in paths.items():
        if path.stat().st_dev != device or path.parent != root:
            raise ValueError(f'{name} escaped the validated SSD root')
    # An owned temporary cwd avoids project packageManager auto-install behavior.
    with tempfile.TemporaryDirectory(prefix='placement-probe-') as temporary:
        directory = Path(temporary).resolve()
        if directory.parent != paths['TMPDIR'] or directory.stat().st_dev != device:
            raise ValueError('Python temporary allocation escaped the SSD')
        resolved = {
            'node': command(['node', '-p', 'require("os").tmpdir()'], directory),
            'npm': command(['npm', 'config', 'get', 'cache'], directory),
            'pnpm': command(['pnpm', 'config', 'get', 'store-dir'], directory),
        }
        expected = {'node': paths['TMPDIR'], 'npm': paths['npm_config_cache'],
                    'pnpm': paths['pnpm_config_store_dir']}
        for tool, value in resolved.items():
            if Path(value).resolve(strict=True) != expected[tool]:
                raise ValueError(f'{tool} ignored its exported storage path')
        receipt = {'workspace': str(workspace), 'workspaceDevice': device,
                   'internalDevice': internal, 'temporaryDirectory': str(directory),
                   'paths': {name: str(path) for name, path in paths.items()},
                   'toolPaths': resolved, 'nativeBuildStarted': False}
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
