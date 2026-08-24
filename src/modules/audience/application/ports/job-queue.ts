export interface QueuedJob<T> {
  id: string;
  name: string;
  data: T;
}

export interface JobQueue {
  publish<T>(name: string, payload: T, options: { singletonKey: string }): Promise<string>;
  work<T>(name: string, handler: (job: QueuedJob<T>) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
