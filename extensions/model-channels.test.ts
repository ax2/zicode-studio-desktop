import { expect, it } from "vitest";
import { modelChannelDocument, providerKeyReference } from "./model-channels";

it("normalizes empty documents without adding providers or altering existing records", () => {
  expect(modelChannelDocument({})).toEqual({ providers: {} });
  const source = {
    custom: true,
    providers: { personal: { baseUrl: "http://localhost/v1", authHeader: false, models: [] } },
  };
  const before = JSON.stringify(source);
  expect(modelChannelDocument(source)).toEqual(source);
  expect(JSON.stringify(source)).toBe(before);
});

it("rejects invalid documents instead of replacing them with an empty catalog", () => {
  for (const value of [null, [], { providers: [] }, { providers: { local: null } }])
    expect(() => modelChannelDocument(value)).toThrow();
});

it("uses the same provider key names as the native runtime environment", () => {
  expect(providerKeyReference("team-proxy.v2")).toBe("$TEAM_PROXY_V2_API_KEY");
  expect(providerKeyReference("qveris")).toBe("$QVERIS_API_KEY");
});
