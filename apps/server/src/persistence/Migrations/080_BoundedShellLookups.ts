import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Shell reads must not visit transcript payloads to discover that no prompt
  // or error is pending. These indexes contain only the relevant item types.
  yield* sql`
    CREATE INDEX orchestration_v2_projection_turn_items_waiting_secret_idx
    ON orchestration_v2_projection_turn_items(thread_id, run_id, updated_at DESC, turn_item_id DESC)
    WHERE type = 'secret_request' AND status = 'waiting'
  `;
  yield* sql`
    CREATE INDEX orchestration_v2_projection_turn_items_failed_error_idx
    ON orchestration_v2_projection_turn_items(thread_id, run_id, node_id, updated_at DESC, ordinal DESC, turn_item_id DESC)
    WHERE type = 'error' AND status = 'failed'
  `;
  yield* sql`
    CREATE INDEX orchestration_v2_projection_messages_latest_authored_idx
    ON orchestration_v2_projection_messages(thread_id, updated_at DESC, message_id DESC)
    WHERE role = 'user' AND json_extract(payload_json, '$.createdBy') = 'user'
  `;
});
