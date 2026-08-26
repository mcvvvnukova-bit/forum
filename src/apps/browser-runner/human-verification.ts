import { createInterface } from "node:readline";

export class OperatorAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorAbortedError";
  }
}

export class HumanVerificationGate {
  constructor(private readonly streams: {
    input: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
  }) {}

  async wait<TSource>(input: {
    source: TSource;
    revalidate: (source: TSource) => Promise<void> | void;
    signal?: AbortSignal;
  }): Promise<"continue"> {
    const reader = createInterface({ input: this.streams.input, crlfDelay: Infinity });
    const lines = reader[Symbol.asyncIterator]();
    try {
      while (true) {
        this.streams.output.write("Manual verification is required in the existing browser session. Type continue to resume or abort to stop.\n");
        const next = await nextLine(lines, input.signal);
        if (next.done) {
          throw new OperatorAbortedError("operator input ended before manual verification continued");
        }
        const response = next.value.trim();
        if (response === "abort") {
          throw new OperatorAbortedError("operator aborted manual verification");
        }
        if (response === "continue") {
          await input.revalidate(input.source);
          return "continue";
        }
      }
    } finally {
      reader.close();
    }
  }
}

function nextLine(
  lines: AsyncIterator<string>,
  signal: AbortSignal | undefined,
): Promise<IteratorResult<string>> {
  if (signal === undefined) return lines.next();
  if (signal.aborted) return Promise.reject(new OperatorAbortedError("manual verification was aborted"));

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new OperatorAbortedError("manual verification was aborted"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    void lines.next().then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
