import * as React from "react";
import { expect, it } from "vitest";
import * as vendor from "./vendor";

it("exports the same Component base used by feature error boundaries through the shared import map", () => {
  expect(vendor).toHaveProperty("Component", React.Component);
});
