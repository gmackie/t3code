# State maintenance

Large, long-lived environments can accumulate many activity projection rows. Inspect how many rows
would be removed while retaining the newest 500 rows per thread:

```sh
t3 maintenance compact-activities --database-path /path/to/userdata/state.sqlite
```

The command is read-only unless `--apply` is present. To apply the retention policy, stop the T3
server that owns the database and run:

```sh
t3 maintenance compact-activities \
  --database-path /path/to/userdata/state.sqlite \
  --retain-per-thread 500 \
  --apply
```

Apply mode refuses a live server recorded in the state directory. Before deleting anything it writes
a complete SQLite backup under `userdata/backups/`, then removes only derived activity projection
rows and vacuums the offline database. Pending approval requests and unresolved user-input requests
are retained even when they fall outside the newest-row window. Use `--backup-path` to select another
non-existing backup destination.

This operation does not delete the canonical orchestration event log. Rebuilding projections can
therefore restore older activity rows. Keep the backup until the environment has started and its
important threads have been checked.
