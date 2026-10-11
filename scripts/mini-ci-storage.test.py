import importlib.util
from pathlib import Path
import tempfile
import os
import subprocess
import shutil
import json
import sys
import unittest

spec = importlib.util.spec_from_file_location('mini_ci_storage', Path(__file__).with_name('mini-ci-storage.py'))
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)


class MiniStorageTest(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory()
        self.parent = Path(self.fixture.name).resolve()
        self.workspace = self.parent / 'workspace'
        self.workspace.mkdir()
        self.root = self.parent / 'ssd-ci'
        self.other_device = self.parent.stat().st_dev + 1

    def tearDown(self):
        self.fixture.cleanup()

    def test_work_and_caches_land_in_checked_ssd_root(self):
        variables = storage.prepare(self.root, self.workspace, self.other_device, minimum_free=0)
        with tempfile.TemporaryDirectory(dir=variables['TMPDIR']) as build:
            artifact = Path(build) / 'build-output'
            artifact.write_bytes(b'compiled-output')
            self.assertTrue(artifact.is_relative_to(self.root))
            self.assertEqual(artifact.read_bytes(), b'compiled-output')
        for path in variables.values():
            self.assertTrue(Path(path).is_relative_to(self.root))
        self.assertEqual(list(Path(variables['TMPDIR']).iterdir()), [])

    def test_missing_ssd_never_creates_internal_fallback(self):
        with self.assertRaisesRegex(ValueError, 'refusing internal-storage fallback'):
            storage.prepare(self.root, self.workspace, self.parent.stat().st_dev, minimum_free=0)
        self.assertFalse(self.root.exists())

    def test_internal_runner_workspace_requires_operational_activation(self):
        # Validate against a real second filesystem when available; dependency is
        # the internal device ID, not a module mock.
        internal = self.parent
        external = next((p for p in [Path('/Volumes/dev'), Path('/dev/shm')]
                         if p.exists() and p.stat().st_dev != internal.stat().st_dev), None)
        if external is None:
            self.skipTest('requires distinct real filesystems')
        with tempfile.TemporaryDirectory(dir=external) as root:
            with self.assertRaisesRegex(ValueError, 'Runner workspace is internal'):
                storage.prepare(Path(root) / 'ci', internal, internal.stat().st_dev, minimum_free=0)

    def test_insufficient_capacity_leaves_existing_data_untouched(self):
        existing = self.parent / 'historical-film'
        existing.write_bytes(b'preserve-me')
        with self.assertRaisesRegex(ValueError, 'free capacity'):
            storage.prepare(self.root, self.workspace, self.other_device, minimum_free=2 ** 60)
        self.assertEqual(existing.read_bytes(), b'preserve-me')
        self.assertFalse(self.root.exists())

    def test_unwritable_storage_is_rejected_before_creating_caches(self):
        self.parent.chmod(0o500)
        try:
            with self.assertRaises(PermissionError):
                storage.prepare(self.root, self.workspace, self.other_device, minimum_free=0)
            self.assertFalse(self.root.exists())
        finally:
            self.parent.chmod(0o700)

    def test_redirected_cache_cannot_write_to_internal_storage(self):
        self.root.mkdir()
        (self.root / 'tmp').symlink_to(self.workspace, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'must not redirect'):
            storage.prepare(self.root, self.workspace, self.other_device, minimum_free=0)
        self.assertEqual(list(self.workspace.iterdir()), [])


    def test_actual_cli_rejects_internal_workspace_without_exporting_env(self):
        env_file = self.parent / 'github-env'
        completed = subprocess.run([sys.executable, str(Path(storage.__file__)),
                                    '--root', str(self.root), '--workspace', str(self.workspace),
                                    '--github-env', str(env_file)], capture_output=True, text=True)
        self.assertNotEqual(completed.returncode, 0)
        self.assertFalse(env_file.exists())
        self.assertFalse(self.root.exists())

    def test_actual_cli_exports_paths_consumed_by_job_shell(self):
        internal = Path('/System/Volumes/Data')
        if not internal.exists():
            internal = Path('/')
        external = next((p for p in [Path('/Volumes/dev'), Path('/dev/shm')]
                         if p.exists() and p.stat().st_dev != internal.stat().st_dev
                         and shutil.disk_usage(p).free >= 30 * storage.GIB), None)
        if external is None:
            self.skipTest('requires external filesystem with 30GiB free')
        with tempfile.TemporaryDirectory(dir=external) as fixture:
            root = Path(fixture) / 'ci'
            env_file = self.parent / 'github-env'
            completed = subprocess.run([sys.executable, str(Path(storage.__file__)),
                                        '--root', str(root), '--workspace', fixture,
                                        '--github-env', str(env_file)], capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            variables = dict(line.split('=', 1) for line in env_file.read_text().splitlines())
            self.assertEqual(variables, json.loads(completed.stdout)['variables'])
            shell = subprocess.run(['bash', '-c', 'mktemp -d "$TMPDIR/build.XXXXXX"'], env={**os.environ, **variables},
                                   capture_output=True, text=True, check=True)
            self.assertTrue(Path(shell.stdout.strip()).is_relative_to(root))

    def test_real_pnpm_resolves_exported_store_despite_user_config(self):
        pnpm = shutil.which('pnpm')
        if pnpm is None:
            self.skipTest('pnpm is not installed')
        variables = storage.prepare(self.root, self.workspace, self.other_device, minimum_free=0)
        completed = subprocess.run([pnpm, 'config', 'get', 'store-dir'],
                                   env={**os.environ, **variables}, capture_output=True,
                                   text=True, check=True)
        self.assertEqual(completed.stdout.strip(), variables['pnpm_config_store_dir'])


    def test_other_volume_workspace_cannot_bypass_capacity_guard(self):
        external = next((p for p in [Path('/Volumes/dev'), Path('/dev/shm')]
                         if p.exists() and p.stat().st_dev != self.parent.stat().st_dev), None)
        if external is None:
            self.skipTest('requires distinct real filesystems')
        with self.assertRaisesRegex(ValueError, 'same SSD volume'):
            storage.prepare(self.root, external, -1, minimum_free=0)
        self.assertFalse(self.root.exists())

    def test_newline_path_cannot_inject_job_environment(self):
        with self.assertRaisesRegex(ValueError, 'cannot contain newlines'):
            storage.prepare(self.parent / 'ci\nTMPDIR=/tmp', self.workspace,
                            self.other_device, minimum_free=0)
        self.assertEqual(list(self.parent.iterdir()), [self.workspace])


    def test_node_packager_and_npm_consume_exported_paths(self):
        node = shutil.which('node')
        npm = shutil.which('npm')
        if node is None or npm is None:
            self.skipTest('Node and npm are not installed')
        variables = storage.prepare(self.root, self.workspace, self.other_device, minimum_free=0)
        env = {**os.environ, **variables}
        temporary = subprocess.run([node, '-e', 'process.stdout.write(require("os").tmpdir())'],
                                   env=env, capture_output=True, text=True, check=True)
        cache = subprocess.run([npm, 'config', 'get', 'cache'], env=env,
                               capture_output=True, text=True, check=True)
        self.assertEqual(temporary.stdout, variables['TMPDIR'])
        self.assertEqual(cache.stdout.strip(), variables['npm_config_cache'])


if __name__ == '__main__':
    unittest.main()
