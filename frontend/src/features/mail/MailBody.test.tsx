import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MailBody } from "./MailBody";

afterEach(cleanup);

it("retains reading structure and image descriptions without live resources or sender attributes", () => {
  const html = '<style>.x{color:red}</style><h2 id="sender">Heading</h2><p class="x" style="color:red"><strong>Body</strong><a href="https://example.invalid/">Link label</a><img alt="Chart" src="https://example.invalid/pixel"></p><table><tr><td>12</td></tr></table><form><input></form><svg><text>hidden</text></svg>';
  const { container } = render(<MailBody text="fallback" html={html}/>);
  expect(screen.getByRole("heading", { name: "Heading" }).tagName).toBe("H2");
  expect(screen.getByText("Body").tagName).toBe("STRONG");
  expect(screen.getByRole("cell").textContent).toBe("12");
  expect(container.textContent).toContain("Link labelChart");
  expect(container.textContent).not.toContain("hidden");
  expect(container.querySelector(".mail-read-body")?.querySelector("style,a,img,svg,form,input,[src],[href],[style],[class],[id]")).toBeNull();
});

it.each(["<style>hidden</style>", "<div><p>   <br></p></div>", "<img src='https://example.invalid/pixel'>"])(
  "falls back to the readable plain body when formatting leaves no sender text: %s", (html) => {
    const { container } = render(<MailBody html={html} text="Readable alternative"/>);
    expect(container.querySelector("pre")?.textContent).toBe("Readable alternative");
  }
);

it("keeps a standalone image description", () => {
  const { container } = render(<MailBody html='<img alt="Delivery map">' text="Fallback"/>);
  expect(container.textContent).toBe("Delivery map");
  expect(container.querySelector("img,pre")).toBeNull();
});

it("keeps old cached plain text literal and uses it when the HTML exceeds the depth limit", () => {
  const text = "<b>literal</b>";
  const { container, rerender } = render(<MailBody text={text}/>);
  expect(container.querySelector("pre")?.textContent).toBe(text);
  rerender(<MailBody html={"<div>".repeat(80)+"deep"+"</div>".repeat(80)} text={text}/>);
  expect(container.querySelector("pre")?.textContent).toBe(text);
});
