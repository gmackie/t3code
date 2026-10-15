export interface CandidateGadget {
  address: string;
  instructions: string;
  kind: "rop" | "jop" | "cop" | "other";
  classification: "syntactic";
  effects: "not-modeled";
}
/** This classifies disassembler output, not reachability, semantic safety or exploitability. */
export function parseGadgets(stdout: string): CandidateGadget[] {
  const result: CandidateGadget[] = [],
    seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const match = /^\s*(0x[0-9a-f]+)\s*:\s*(.{1,2048})\s*$/iu.exec(line);
    if (!match) continue;
    const address = `0x${BigInt(match[1]!).toString(16)}`,
      instructions = match[2]!.trim();
    const key = address + ":" + instructions;
    if (seen.has(key)) continue;
    seen.add(key);
    const ops = instructions
      .toLowerCase()
      .split(";")
      .map((x) => x.trim());
    let tail = ops.at(-1) ?? "";
    // MIPS control transfers have one delay-slot instruction.
    const prior = ops.at(-2) ?? "";
    if (/^(?:jr|jalr)\s/u.test(prior)) tail = prior;
    const kind: CandidateGadget["kind"] =
      /^(?:ret\b|bx\s+lr\b|pop\b.*\bpc\b|jr\s+\$(?:ra|31)\b)/u.test(tail)
        ? "rop"
        : /^(?:call\b|blr\s|blx\s|jalr\s)/u.test(tail)
          ? "cop"
          : /^(?:jmp\b|br\s|bx\s|jr\s)/u.test(tail)
            ? "jop"
            : "other";
    result.push({
      address,
      instructions,
      kind,
      classification: "syntactic",
      effects: "not-modeled",
    });
    if (result.length >= 1000) break;
  }
  return result;
}
