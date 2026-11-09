// @vitest-environment jsdom
/**
 * - Given an open connection form, a Session ownership change must not move its saved preference to another machine.
 * - Given a failed save, keep the dialog open and the connection editable for a retry.
 */
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VSCodeSettings } from "../src/features/chat/vscode-settings";
import { S } from "../src/lib/strings";
import { rememberSessionMachine, forgetSessionMachines } from "../src/lib/session-machines";
import { button, click, field, mount, type, unmountAll } from "./helpers/dom";
import { stubLocalStorage } from "./helpers/storage";

describe("VS Code connection settings", () => {
  beforeEach(() => {
    stubLocalStorage();
  });
  afterEach(async () => {
    await unmountAll();
    forgetSessionMachines();
  });
  it("keeps the save on the machine the dialog opened for", async () => {
    const scope = { kind: "session" as const, sessionId: "s" };
    rememberSessionMachine("s", "original");
    let closed = false;
    await mount(
      createElement(VSCodeSettings, {
        scope,
        userId: "reader",
        onClose: () => {
          closed = true;
        },
      }),
    );
    await type(field(S.files.editorSshAlias), "reader-dev");
    rememberSessionMachine("s", "replacement");
    await click(button(S.common.save));
    expect(closed).toBe(true);
    expect(localStorage.getItem("penguin.vscodeSsh.reader.original")).toBe("reader-dev");
    expect(localStorage.getItem("penguin.vscodeSsh.reader.replacement")).toBeNull();
  });
  it("keeps failed storage writes editable and allows a retry", async () => {
    const store = stubLocalStorage();
    const write = store.setItem;
    store.setItem = () => {
      throw new DOMException("Storage denied", "SecurityError");
    };
    let closed = false;
    await mount(
      createElement(VSCodeSettings, {
        scope: { kind: "session", sessionId: "s" },
        userId: "reader",
        onClose: () => {
          closed = true;
        },
      }),
    );
    await type(field(S.files.editorSshAlias), "reader-dev");
    await click(button(S.common.save));
    expect(closed).toBe(false);
    expect(field(S.files.editorSshAlias).value).toBe("reader-dev");
    expect(button(S.common.save).disabled).toBe(false);
    store.setItem = write;
    await click(button(S.common.save));
    expect(closed).toBe(true);
    expect(store.getItem("penguin.vscodeSsh.reader.local")).toBe("reader-dev");
  });
});
