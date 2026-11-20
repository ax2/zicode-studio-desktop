import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {setLocale} from "../../shared/i18n";
import {MailDisconnect} from "./MailDisconnect";
afterEach(()=>{cleanup();vi.restoreAllMocks()});
it("keeps cached messages by default and requires explicit confirmation to clear them",async()=>{
  setLocale("en");
  const disconnect=vi.fn(async()=>{});
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(true);
  render(<MailDisconnect connected label="Disconnect" prompt="Keep cache?" disconnect={disconnect}/>);
  const action=screen.getByRole("button",{name:"Disconnect"});
  fireEvent.click(action);await waitFor(()=>expect(disconnect).toHaveBeenCalledWith(false));
  fireEvent.click(screen.getByRole("checkbox"));confirm.mockReturnValue(Promise.resolve(false) as unknown as boolean);
  fireEvent.click(action);await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(2));
  expect(disconnect).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);fireEvent.click(action);
  await waitFor(()=>expect(disconnect).toHaveBeenCalledWith(true));
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
});

it("ignores a pending confirmation after the user leaves that account",async()=>{
  setLocale("en");let finish:(ok:boolean)=>void=()=>{};
  vi.spyOn(window,"confirm").mockImplementation(()=>new Promise<boolean>(r=>{finish=r;}) as unknown as boolean);
  const disconnect=vi.fn(async()=>{});
  const view=render(<MailDisconnect connected label="Disconnect" prompt="Keep cache?" disconnect={disconnect}/>);
  fireEvent.click(screen.getByRole("button",{name:"Disconnect"}));view.unmount();finish(true);
  await Promise.resolve();expect(disconnect).not.toHaveBeenCalled();
});
