import * as NodeWorkerThreads from "node:worker_threads";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

import {
  commandInbox,
  conformanceOf,
  driveRun,
  type FromWorker,
  type WorkerJob,
} from "./systems/SystemsWorkerProtocol.ts";

// Worker-thread entry for Systems runs; see SystemsService for the host side.
const port = NodeWorkerThreads.parentPort;
if (port === null) throw new Error("systems-worker runs only as a worker thread");
const job: WorkerJob = NodeWorkerThreads.workerData;
const post = (message: FromWorker) => port.postMessage(message);

if (job.kind === "run") {
  const inbox = commandInbox();
  port.on("message", inbox.push);
  await driveRun(job, { post, next: inbox.next });
} else {
  const exit = await Effect.runPromiseExit(
    conformanceOf(job.files).pipe(Effect.provide(NodeServices.layer)),
  );
  post(
    exit._tag === "Success"
      ? { type: "conformance", reports: exit.value }
      : { type: "error", message: String(exit.cause) },
  );
}
port.close();
