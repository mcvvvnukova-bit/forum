import { randomUUID } from "node:crypto";

import type {
  BrowserActionEvent,
  DiscoveryExecutionContext,
} from "../../../domain/discovery";

export class BrowserActionRecorder {
  readonly #events: BrowserActionEvent[] = [];

  constructor(
    private readonly execution: DiscoveryExecutionContext,
    private readonly now: () => Date,
    private readonly navigationStatus: () => number | null,
    private readonly sanitizeTarget: (target: string) => string,
  ) {}

  get events(): readonly BrowserActionEvent[] {
    return this.#events;
  }

  async begin(kind: string, target: string): Promise<string> {
    if (this.execution.signal?.aborted === true) {
      throw new Error("browser collection lost its task lease");
    }
    const id = randomUUID();
    await this.#record({
      id,
      at: this.now().toISOString(),
      kind,
      target: this.sanitizeTarget(target),
      outcome: "intent",
      navigationStatus: this.navigationStatus(),
    });
    return id;
  }

  finish(
    id: string,
    kind: string,
    target: string,
    outcome: BrowserActionEvent["outcome"],
  ): Promise<void> {
    return this.#record({
      id,
      at: this.now().toISOString(),
      kind,
      target: this.sanitizeTarget(target),
      outcome,
      navigationStatus: this.navigationStatus(),
    });
  }

  async record(kind: string, target: string): Promise<void> {
    if (this.execution.signal?.aborted === true) {
      throw new Error("browser collection lost its task lease");
    }
    await this.#record({
      id: randomUUID(),
      at: this.now().toISOString(),
      kind,
      target: this.sanitizeTarget(target),
      outcome: "completed",
      navigationStatus: this.navigationStatus(),
    });
  }

  async #record(event: BrowserActionEvent): Promise<void> {
    await this.execution.actionLedger?.record(event);
    this.#events.push(event);
  }
}
