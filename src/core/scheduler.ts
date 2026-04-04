import { CronJob } from 'cron';
import { randomUUID } from 'crypto';
import type { Logger } from './logger.js';

interface ScheduledTask {
  id: string;
  expression: string;
  job: CronJob;
  handler: () => void | Promise<void>;
  name?: string;
}

export class Scheduler {
  private tasks = new Map<string, ScheduledTask>();
  private log: Logger;

  constructor(logger: Logger) {
    this.log = logger;
  }

  /**
   * Schedule a recurring cron job.
   * Returns the task ID for later management.
   */
  add(cronExpr: string, handler: () => void | Promise<void>, name?: string): string {
    const id = randomUUID();

    const job = CronJob.from({
      cronTime: cronExpr,
      onTick: async () => {
        try {
          await handler();
        } catch (err) {
          this.log.error(`Scheduled task "${name ?? id}" failed: ${err}`);
        }
      },
      start: true,
      timeZone: 'Asia/Kolkata', // IST — all scheduled tasks run in user's timezone
    });

    this.tasks.set(id, { id, expression: cronExpr, job, handler, name });
    this.log.info(`Scheduled task "${name ?? id}" (${cronExpr})`);
    return id;
  }

  /**
   * Schedule a one-shot delayed task.
   */
  once(delayMs: number, handler: () => void | Promise<void>, name?: string): string {
    const id = randomUUID();
    const timer = setTimeout(async () => {
      try {
        await handler();
      } catch (err) {
        this.log.error(`One-shot task "${name ?? id}" failed: ${err}`);
      } finally {
        this.tasks.delete(id);
      }
    }, delayMs);

    // Store with a dummy CronJob for interface consistency
    const dummyJob = { stop: () => clearTimeout(timer) } as unknown as CronJob;
    this.tasks.set(id, { id, expression: `once:${delayMs}ms`, job: dummyJob, handler, name });
    this.log.info(`One-shot task "${name ?? id}" in ${delayMs}ms`);
    return id;
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    task.job.stop();
    this.tasks.delete(id);
    this.log.info(`Cancelled task "${task.name ?? id}"`);
    return true;
  }

  list(): Array<{ id: string; expression: string; name?: string; running: boolean }> {
    return Array.from(this.tasks.values()).map(t => ({
      id: t.id,
      expression: t.expression,
      name: t.name,
      running: t.job.running ?? false,
    }));
  }

  stopAll(): void {
    for (const task of this.tasks.values()) {
      task.job.stop();
    }
    this.tasks.clear();
    this.log.info('All scheduled tasks stopped');
  }
}
