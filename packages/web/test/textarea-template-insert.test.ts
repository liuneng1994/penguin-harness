/** @vitest-environment jsdom */
/**
 * - Given a controlled textarea selection, inserting a template replaces only that range.
 * - Given an unsupported native edit API or an absent textarea, the fallback preserves text
 *   outside the selection and appends when no selection exists.
 */
import { insertTextareaText } from "@prismshadow/penguin-ui";
import { afterEach, expect, it, vi } from "vitest";
import { run } from "./helpers/dom";

afterEach(() => {
  document.body.innerHTML = "";
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

it("inserts at the saved selection through the native editing boundary", () => {
  const textarea = document.createElement("textarea");
  textarea.value = "Before old after";
  document.body.appendChild(textarea);
  // The native browser API is the boundary; browser tests also exercise its real undo stack.
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: () => {
      textarea.setRangeText("Template", textarea.selectionStart, textarea.selectionEnd, "end");
      return true;
    },
  });
  const fallback = vi.fn();
  insertTextareaText(textarea, textarea.value, "Template", fallback, { start: 7, end: 10 });
  expect(textarea.value).toBe("Before Template after");
  expect(fallback).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(textarea);
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

it("preserves the surrounding text and restores the caret in the fallback", async () => {
  const textarea = document.createElement("textarea");
  textarea.value = "Before after";
  document.body.appendChild(textarea);
  insertTextareaText(
    textarea,
    textarea.value,
    "Template ",
    (next) => {
      textarea.value = next;
    },
    { start: 7, end: 7 },
  );
  await run(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(textarea.value).toBe("Before Template after");
  expect(textarea.selectionStart).toBe(16);
});

it("uses the field's current selection when no saved range is supplied", async () => {
  const textarea = document.createElement("textarea");
  textarea.value = "Before old after";
  textarea.setSelectionRange(7, 10);
  document.body.appendChild(textarea);
  insertTextareaText(textarea, textarea.value, "Template", (next) => {
    textarea.value = next;
  });
  await run(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(textarea.value).toBe("Before Template after");
  expect(textarea.selectionStart).toBe(15);
});

it("appends when the field is absent and clamps a stale range to the current text", () => {
  const values: string[] = [];
  insertTextareaText(null, "Draft ", "Template", (next) => values.push(next));
  insertTextareaText(null, "Draft", " Template", (next) => values.push(next), {
    start: 80,
    end: 90,
  });
  expect(values).toEqual(["Draft Template", "Draft Template"]);
});
