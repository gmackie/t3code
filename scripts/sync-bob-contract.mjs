import * as NodeFS from "node:fs";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
const root = NodePath.resolve(import.meta.dirname, "..");
const output = NodePath.resolve(root, "packages/contracts/src/bob");
const check = process.argv.includes("--check");
if (process.argv[2] && !check) {
  const source = NodePath.resolve(process.argv[2]);
  for (const [from, to] of [["openapi.json", "openapi.generated.json"]]) {
    NodeFS.writeFileSync(
      NodePath.resolve(output, to),
      NodeChildProcess.execFileSync(
        NodePath.resolve(root, "node_modules/.bin/vp"),
        ["fmt", "--stdin-filepath", NodePath.resolve(output, to)],
        {
          input: NodeFS.readFileSync(NodePath.resolve(source, from)),
          stdio: ["pipe", "pipe", "ignore"],
        },
      ),
    );
  }
}
const bytes = NodeFS.readFileSync(NodePath.resolve(output, "openapi.generated.json"));
const api = JSON.parse(bytes);
function type(schema) {
  if (Array.isArray(schema.type))
    return schema.type.map((kind) => type({ ...schema, type: kind })).join(" | ");
  if (schema.anyOf || schema.oneOf) return (schema.anyOf ?? schema.oneOf).map(type).join(" | ");
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.type === "null") return "null";
  if (schema.type === "array") return `ReadonlyArray<${type(schema.items)}>`;
  if (schema.type === "object")
    return `{ ${Object.entries(schema.properties ?? {})
      .map(
        ([key, value]) =>
          `readonly ${JSON.stringify(key)}${schema.required?.includes(key) ? "" : "?"}: ${type(value)};`,
      )
      .join(" ")} }`;
  return schema.type === "integer" ? "number" : (schema.type ?? "unknown");
}
const operations = Object.values(api.paths).flatMap(Object.values);
const types = operations
  .map((op) => {
    const name = op.operationId.split("/").at(-1);
    return `export type ${name}Input = ${type(op.requestBody.content["application/json"].schema)};\nexport type ${name}Output = ${type(op.responses["200"].content["application/json"].schema)};`;
  })
  .join("\n");
const rawGenerated = `// Generated from ForgeC OpenAPI by scripts/sync-bob-contract.mjs. Do not edit.\n// SHA256: ${NodeCrypto.createHash("sha256").update(bytes).digest("hex")}\n${types}\n`;
const generated = NodeChildProcess.execFileSync(
  NodePath.resolve(root, "node_modules/.bin/vp"),
  ["fmt", "--stdin-filepath", NodePath.resolve(output, "types.generated.ts")],
  { input: rawGenerated, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] },
);
if (check) {
  if (NodeFS.readFileSync(NodePath.resolve(output, "types.generated.ts"), "utf8") !== generated)
    throw new Error("Bob contract types are stale. Run node scripts/sync-bob-contract.mjs.");
} else NodeFS.writeFileSync(NodePath.resolve(output, "types.generated.ts"), generated);
console.log("Synchronized ForgeC Bob contract types and artifacts.");
