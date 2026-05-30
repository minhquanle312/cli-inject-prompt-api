import type { AdapterConfig, CommandResult, ModelId, RunCommandInput } from "./types.js";

type Runner = (input: RunCommandInput) => Promise<CommandResult>;

type QueueJob = {
  adapter: AdapterConfig;
  prompt: string;
  resolve: (result: CommandResult) => void;
  reject: (error: Error) => void;
};

export class QueueFullError extends Error {
  constructor(maxQueue: number) {
    super(`Queue is full; max waiting jobs is ${maxQueue}`);
    this.name = "QueueFullError";
  }
}

export class Scheduler {
  private readonly queue: QueueJob[] = [];
  private readonly runningByModel = new Map<ModelId, number>();
  private runningGlobal = 0;

  constructor(
    private readonly globalConcurrency: number,
    private readonly maxQueue: number,
    private readonly runner: Runner,
  ) {}

  enqueue(adapter: AdapterConfig, prompt: string): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const job: QueueJob = { adapter, prompt, resolve, reject };
      if (this.canRun(adapter)) {
        this.start(job);
        return;
      }
      if (this.queue.length >= this.maxQueue) {
        reject(new QueueFullError(this.maxQueue));
        return;
      }
      this.queue.push(job);
    });
  }

  get waitingJobs(): number {
    return this.queue.length;
  }

  get runningJobs(): number {
    return this.runningGlobal;
  }

  private canRun(adapter: AdapterConfig): boolean {
    const runningForModel = this.runningByModel.get(adapter.id) ?? 0;
    return this.runningGlobal < this.globalConcurrency && runningForModel < adapter.concurrency;
  }

  private start(job: QueueJob): void {
    this.runningGlobal += 1;
    this.runningByModel.set(job.adapter.id, (this.runningByModel.get(job.adapter.id) ?? 0) + 1);

    this.runner({
      command: job.adapter.command,
      args: job.adapter.args,
      promptTransport: job.adapter.promptTransport,
      prompt: job.prompt,
      timeoutMs: job.adapter.timeoutMs,
    })
      .then(job.resolve, job.reject)
      .finally(() => {
        this.runningGlobal -= 1;
        const nextModelCount = (this.runningByModel.get(job.adapter.id) ?? 1) - 1;
        if (nextModelCount <= 0) this.runningByModel.delete(job.adapter.id);
        else this.runningByModel.set(job.adapter.id, nextModelCount);
        this.drain();
      });
  }

  private drain(): void {
    let index = this.queue.findIndex((job) => this.canRun(job.adapter));
    while (index >= 0) {
      const [job] = this.queue.splice(index, 1);
      if (job === undefined) return;
      this.start(job);
      index = this.queue.findIndex((queuedJob) => this.canRun(queuedJob.adapter));
    }
  }
}
