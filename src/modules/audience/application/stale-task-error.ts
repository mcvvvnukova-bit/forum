export class StaleTaskError extends Error {
  constructor(taskId: string) {
    super(`stale task worker stopped for task ${taskId}`);
    this.name = "StaleTaskError";
  }
}
