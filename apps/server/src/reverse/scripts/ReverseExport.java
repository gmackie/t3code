// Ghidra script: export a bounded, read-only analysis snapshot to T3 Reverse Workbench.
// @category T3.Reverse
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Runs only under analyzeHeadless, never within an Electron renderer. */
public class ReverseExport extends GhidraScript {
    private static String json(String value) {
        if (value == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '\"' || c == '\\') b.append('\\').append(c);
            else if (c == '\n') b.append("\\n");
            else if (c == '\r') b.append("\\r");
            else if (c == '\t') b.append("\\t");
            else if (c < 32) b.append(String.format("\\u%04x", (int)c));
            else b.append(c);
        }
        return b.append('\"').toString();
    }

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) throw new IllegalArgumentException("Expected output JSON path");
        StringBuilder out = new StringBuilder("{\"functions\":[");
        DecompInterface decompiler = new DecompInterface();
        if (!decompiler.openProgram(currentProgram)) throw new IllegalStateException("Unable to open program decompiler");
        try {
            FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
            int count = 0;
            while (it.hasNext() && count < 500) {
                monitor.checkCancelled();
                Function fn = it.next();
                if (count++ > 0) out.append(',');
                out.append("{\"address\":").append(json(fn.getEntryPoint().toString()));
                out.append(",\"name\":").append(json(fn.getName()));
                String pseudocode = "";
                DecompileResults decomp = decompiler.decompileFunction(fn, 8, monitor);
                if (decomp != null && decomp.decompileCompleted() && decomp.getDecompiledFunction() != null)
                    pseudocode = decomp.getDecompiledFunction().getC();
                if (pseudocode.length() > 12000) pseudocode = pseudocode.substring(0,12000);
                out.append(",\"pseudocode\":").append(json(pseudocode)).append(",\"instructions\":[");
                InstructionIterator instructions = currentProgram.getListing().getInstructions(fn.getBody(), true);
                int n = 0;
                while (instructions.hasNext() && n < 100) {
                    Instruction insn = instructions.next();
                    if (n++ > 0) out.append(',');
                    out.append("{\"address\":").append(json(insn.getAddress().toString()))
                       .append(",\"text\":").append(json(insn.toString())).append("}");
                }
                out.append("]}");
            }
            out.append("]}");
            Files.writeString(Path.of(args[0]), out.toString(), StandardCharsets.UTF_8);
        } finally {
            decompiler.closeProgram();
            decompiler.dispose();
        }
    }
}
