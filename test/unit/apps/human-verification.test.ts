import { PassThrough, Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { HumanVerificationGate, OperatorAbortedError } from "../../../src/apps/browser-runner/human-verification";

describe("HumanVerificationGate", () => {
  it("continues only after a full trimmed continue line and revalidates the same source", async () => {
    const input = new PassThrough();
    const output = captureOutput();
    const source = { session: "existing-browser-session", challenge: "never disclose this" };
    let revalidatedSource: unknown;
    const gate = new HumanVerificationGate({ input, output: output.stream });

    const waiting = gate.wait({
      source,
      revalidate: async (activeSource) => { revalidatedSource = activeSource; },
    });
    input.end("continue later\n continue \n");

    await expect(waiting).resolves.toBe("continue");
    expect(revalidatedSource).toBe(source);
    expect(output.text()).not.toContain(source.challenge);
    expect(output.text()).toContain("Type continue to resume or abort to stop.");
  });

  it("reprompts after arbitrary input without exposing challenge contents", async () => {
    const input = new PassThrough();
    const output = captureOutput();
    const gate = new HumanVerificationGate({ input, output: output.stream });

    const waiting = gate.wait({ source: { challenge: "123456" }, revalidate: async () => {} });
    input.end("solve it\ncontinue\n");

    await expect(waiting).resolves.toBe("continue");
    expect(output.text()).toBe(
      "Manual verification is required in the existing browser session. Type continue to resume or abort to stop.\n"
      + "Manual verification is required in the existing browser session. Type continue to resume or abort to stop.\n",
    );
  });

  it("throws when the operator aborts", async () => {
    const input = new PassThrough();
    const gate = new HumanVerificationGate({ input, output: captureOutput().stream });

    const waiting = gate.wait({ source: {}, revalidate: async () => {} });
    input.end("abort\n");

    await expect(waiting).rejects.toThrow(new OperatorAbortedError("operator aborted manual verification"));
  });

  it("throws when operator input ends before continuation", async () => {
    const input = new PassThrough();
    const gate = new HumanVerificationGate({ input, output: captureOutput().stream });

    const waiting = gate.wait({ source: {}, revalidate: async () => {} });
    input.end();

    await expect(waiting).rejects.toThrow(new OperatorAbortedError("operator input ended before manual verification continued"));
  });

  it("cancels when its abort signal is triggered", async () => {
    const input = new PassThrough();
    const controller = new AbortController();
    const gate = new HumanVerificationGate({ input, output: captureOutput().stream });

    const waiting = gate.wait({ source: {}, revalidate: async () => {}, signal: controller.signal });
    controller.abort();

    await expect(waiting).rejects.toThrow(new OperatorAbortedError("manual verification was aborted"));
  });
});

function captureOutput(): { stream: Writable; text: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString("utf8") };
}
