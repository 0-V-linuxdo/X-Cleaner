/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export class AiQueueError extends Error {}

interface Job<T> {
    key: string;
    run(): Promise<T>;
    resolve(v: T): void;
    reject(e: unknown): void;
    epoch: number;
}

export class AiQueue {
    used = 0;
    private queue: Job<any>[] = [];
    private active = 0;
    private keys = new Set<string>();
    private epoch = 0;

    constructor(private getLimits: () => { budget: number; concurrency: number }) {}

    get pending(): number {
        return this.queue.length + this.active;
    }

    has(key: string): boolean {
        return this.keys.has(key);
    }

    canEnqueue(key?: string): boolean {
        if (key && this.keys.has(key)) return false;
        return this.used + this.queue.length < this.getLimits().budget;
    }

    enqueue<T>(key: string, run: () => Promise<T>): Promise<T> {
        if (!this.canEnqueue(key)) return Promise.reject(new AiQueueError("budget"));
        return new Promise<T>((resolve, reject) => {
            this.keys.add(key);
            this.queue.push({ key, run, resolve, reject, epoch: this.epoch });
            this.pump();
        });
    }

    private pump() {
        while (this.active < this.getLimits().concurrency && this.queue.length) {
            const job = this.queue.shift()!;
            this.active++;
            this.used++;
            const epoch = job.epoch;
            job.run().then(
                v => (epoch === this.epoch ? job.resolve(v) : job.reject(new AiQueueError("stale"))),
                e => job.reject(epoch === this.epoch ? e : new AiQueueError("stale")),
            ).finally(() => {
                this.keys.delete(job.key);
                if (epoch === this.epoch) this.active--;
                this.pump();
            });
        }
    }

    reset(keepBudget: boolean, reason: (key: string) => unknown = () => new AiQueueError("reset")) {
        this.epoch++;
        for (const job of this.queue.splice(0)) job.reject(reason(job.key));
        this.keys.clear();
        this.active = 0;
        if (!keepBudget) this.used = 0;
    }
}
