import { expect, it } from "vitest";
import { HostControlGateway } from "./control-gateway.js";
import { HostDataGateway } from "./data-gateway.js";
import { createInMemoryRuntimeAdapter } from "./runtime-gateway.js";

it("scopes all terminal operations and ignores routing overrides in parameters", async () => {
  const adapter = createInMemoryRuntimeAdapter();
  const gateway = new HostControlGateway(adapter);
  for (const operation of [
    "terminal_open",
    "terminal_list",
    "terminal_read",
    "terminal_input",
    "terminal_resize",
    "terminal_close",
  ]) {
    const promise = gateway.projectTerminal(operation, "project", {
      workspaceId: "wrong",
      operation: "delete_workspace",
      type: "data_request",
      requestId: "spoofed",
      terminalId: "term",
      cols: 80,
      rows: 24,
      offset: 5,
      data: "YQ==",
      command: "ignored",
      path: "ignored",
    });
    const frame = adapter.takeSent();
    expect(frame).toMatchObject({
      type: "host_request",
      operation,
      workspaceId: "project",
      terminalId: "term",
      offset: 5,
      data: "YQ==",
    });
    expect(frame.requestId).not.toBe("spoofed");
    expect(frame.command).toBeUndefined();
    expect(frame.path).toBeUndefined();
    adapter.receive({
      type: "host_response",
      requestId: frame.requestId,
      terminal: { id: "term" },
    });
    await expect(promise).resolves.toMatchObject({ terminal: { id: "term" } });
  }
});

it("rejects terminal operations through the read gateway and unrelated writes through the terminal gateway", async () => {
  const adapter = createInMemoryRuntimeAdapter();
  const data = new HostDataGateway(adapter);
  const control = new HostControlGateway(adapter);
  await expect(data.request("terminal_read", {})).rejects.toThrow("Unsupported read-only");
  await expect(data.request("terminal_input", {})).rejects.toThrow("Unsupported read-only");
  await expect(control.projectTerminal("delete_workspace", "project")).rejects.toThrow(
    "terminal_operation_unsupported",
  );
});
