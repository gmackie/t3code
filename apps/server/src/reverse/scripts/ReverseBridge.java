// Persistent Ghidra program bridge. Imported once, reopened with -process -noanalysis.
// @category T3.Reverse
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.framework.Application;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

public class ReverseBridge extends GhidraScript {
    private final Gson gson = new Gson();
    private DecompInterface decompiler;
    private boolean closing = false;
    public void run() throws Exception {
        // GhidraScript starts an outer transaction. End it before serving requests:
        // each mutation below owns its transaction and saves before acknowledging.
        end(true);
        decompiler = new DecompInterface();
        if (!decompiler.openProgram(currentProgram)) throw new IOException("Cannot initialize decompiler");
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while (!closing && (line = reader.readLine()) != null) {
                JsonObject response = new JsonObject();
                try {
                    if (line.length() > 65536) throw new IllegalArgumentException("Request too large");
                    JsonObject request = JsonParser.parseString(line).getAsJsonObject();
                    response.addProperty("id", request.get("id").getAsString());
                    JsonObject params = request.has("params") ? request.getAsJsonObject("params") : new JsonObject();
                    response.add("result", dispatch(request.get("method").getAsString(), params));
                } catch (Exception error) {
                    if (!response.has("id")) response.addProperty("id", "invalid");
                    response.addProperty("error", error.getClass().getSimpleName() + ": " + error.getMessage());
                }
                System.out.println("@T3RE:" + gson.toJson(response)); System.out.flush();
            }
        } finally { decompiler.dispose(); }
    }
    private JsonObject base() {
        JsonObject result = new JsonObject(); result.add("functions", new JsonArray());
        result.addProperty("truncated", false); result.addProperty("toolVersion", Application.getApplicationVersion()); return result;
    }
    private Address address(JsonObject p) {
        String raw = p.get("address").getAsString();
        if (!raw.matches("0x[0-9a-fA-F]{1,16}")) throw new IllegalArgumentException("Invalid address");
        return currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(Long.parseUnsignedLong(raw.substring(2), 16));
    }
    private String hex(Address a) { return "0x" + Long.toUnsignedString(a.getOffset(), 16); }
    private String digest(java.security.MessageDigest d) {
        StringBuilder out = new StringBuilder();
        for (byte b : d.digest()) out.append(String.format("%02x", b));
        return out.toString();
    }
    private JsonObject identity(Function f) {
        JsonObject value = new JsonObject(); value.addProperty("address", hex(f.getEntryPoint())); value.addProperty("name", f.getName());
        value.addProperty("pseudocode", ""); value.add("instructions", new JsonArray()); return value;
    }
    private JsonObject dispatch(String method, JsonObject p) throws Exception {
        JsonObject result = base();
        if (method.equals("ping")) return result;
        if (method.equals("close")) { currentProgram.save("T3 Reverse close", monitor); closing = true; return result; }
        if (method.equals("save")) { currentProgram.save("T3 Reverse save", monitor); return result; }
        if (method.equals("fingerprints")) {
            // Address-independent shape (mnemonic sequence) plus exact bytes, for diffing builds.
            JsonArray rows = new JsonArray();
            FunctionIterator iterator = currentProgram.getFunctionManager().getFunctions(true);
            while (iterator.hasNext() && rows.size() < 20000) {
                Function f = iterator.next();
                if (f.isExternal() || f.isThunk()) continue;
                java.security.MessageDigest shape = java.security.MessageDigest.getInstance("SHA-256");
                java.security.MessageDigest bytes = java.security.MessageDigest.getInstance("SHA-256");
                int count = 0;
                InstructionIterator instructions = currentProgram.getListing().getInstructions(f.getBody(), true);
                while (instructions.hasNext()) {
                    Instruction ins = instructions.next();
                    shape.update(ins.getMnemonicString().getBytes(StandardCharsets.UTF_8)); shape.update((byte) 0);
                    bytes.update(ins.getBytes()); count++;
                }
                JsonObject row = new JsonObject();
                row.addProperty("address", hex(f.getEntryPoint())); row.addProperty("name", f.getName());
                row.addProperty("instructions", count);
                row.addProperty("shape", digest(shape)); row.addProperty("bytes", digest(bytes));
                rows.add(row);
            }
            result.add("fingerprints", rows); result.addProperty("truncated", iterator.hasNext()); return result;
        }
        if (method.equals("list")) {
            int cursor = Math.max(0, p.has("cursor") ? p.get("cursor").getAsInt() : 0);
            if (cursor > 1000000) throw new IllegalArgumentException("Cursor exceeds limit");
            int limit = Math.min(128, Math.max(1, p.has("limit") ? p.get("limit").getAsInt() : 128));
            FunctionIterator iterator = currentProgram.getFunctionManager().getFunctions(true);
            for (int i = 0; i < cursor && iterator.hasNext(); i++) iterator.next();
            JsonArray functions = result.getAsJsonArray("functions");
            while (iterator.hasNext() && functions.size() < limit) functions.add(identity(iterator.next()));
            result.addProperty("truncated", iterator.hasNext());
            if (iterator.hasNext()) result.addProperty("nextCursor", cursor + functions.size()); return result;
        }
        Address at = address(p);
        Function function = currentProgram.getFunctionManager().getFunctionContaining(at);
        if (function == null) throw new IllegalArgumentException("No function at address; raw images require a correct loader profile and recovered entry points");
        if (method.equals("rename") || method.equals("comment")) {
            int transaction = currentProgram.startTransaction("T3 Reverse " + method); boolean commit = false;
            try {
                if (method.equals("rename")) {
                    if (!function.getName().equals(p.get("expectedName").getAsString())) throw new IllegalStateException("Symbol changed; refresh before renaming");
                    String name = p.get("name").getAsString();
                    if (!name.matches("[A-Za-z_$][A-Za-z0-9_.$]{0,127}")) throw new IllegalArgumentException("Invalid symbol name");
                    function.setName(name, SourceType.USER_DEFINED);
                } else {
                    String comment = p.get("comment").getAsString();
                    if (comment.length() > 8192) throw new IllegalArgumentException("Comment too long");
                    currentProgram.getListing().setComment(at, CodeUnit.EOL_COMMENT, comment);
                }
                commit = true;
            } finally { currentProgram.endTransaction(transaction, commit); }
            currentProgram.save("T3 Reverse annotation", monitor); decompiler.flushCache();
        } else if (!method.equals("function")) throw new IllegalArgumentException("Unknown method");
        JsonObject value = identity(function);
        DecompileResults decompiled = decompiler.decompileFunction(function, 20, monitor);
        if (!decompiled.decompileCompleted()) throw new IOException(decompiled.getErrorMessage());
        if (decompiled.getDecompiledFunction() != null) {
            String text = decompiled.getDecompiledFunction().getC();
            if (text.length() > 1000000) throw new IOException("Decompiled function exceeds response limit");
            value.addProperty("pseudocode", text);
        }
        JsonArray tokens = new JsonArray(); collectTokens(decompiled.getCCodeMarkup(), tokens); value.add("tokens", tokens);
        JsonArray instructions = value.getAsJsonArray("instructions");
        InstructionIterator iterator = currentProgram.getListing().getInstructions(function.getBody(), true);
        while (iterator.hasNext() && instructions.size() < 2048) {
            Instruction instruction = iterator.next(); JsonObject row = new JsonObject();
            row.addProperty("address", hex(instruction.getAddress())); row.addProperty("text", instruction.toString());
            StringBuilder bytes = new StringBuilder(); for (byte b : instruction.getBytes()) bytes.append(String.format("%02x", b & 255));
            row.addProperty("bytes", bytes.toString()); instructions.add(row);
        }
        JsonArray calls = new JsonArray();
        for (Function callee : function.getCalledFunctions(monitor)) {
            if (calls.size() >= 512) break;
            JsonObject row = new JsonObject(); row.addProperty("address", hex(callee.getEntryPoint())); row.addProperty("name", callee.getName()); calls.add(row);
        }
        value.add("callees", calls);
        JsonArray references = new JsonArray(); ReferenceIterator refs = currentProgram.getReferenceManager().getReferencesTo(function.getEntryPoint());
        while (refs.hasNext() && references.size() < 512) {
            Reference ref = refs.next(); JsonObject row = new JsonObject(); row.addProperty("address", hex(ref.getFromAddress())); row.addProperty("type", ref.getReferenceType().toString()); references.add(row);
        }
        value.add("xrefs", references); result.getAsJsonArray("functions").add(value);
        result.addProperty("truncated", iterator.hasNext() || tokens.size() >= 5000 || refs.hasNext() || calls.size() >= 512); return result;
    }
    private void collectTokens(ClangNode node, JsonArray output) {
        if (node == null || output.size() >= 5000) return;
        if (node instanceof ClangToken) {
            ClangToken token = (ClangToken) node; JsonObject value = new JsonObject();
            value.addProperty("text", token.getText()); value.addProperty("syntaxType", token.getSyntaxType());
            if (token.getMinAddress() != null) value.addProperty("address", hex(token.getMinAddress())); output.add(value);
        }
        for (int i = 0; i < node.numChildren() && output.size() < 5000; i++) collectTokens(node.Child(i), output);
    }
}
