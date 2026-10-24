/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { isSafeSource, type RegexContext, type RegexMatch, type RegexResult, type RegexRule, runRulesSync, toResult } from "./regex";

export const BATCH_TIMEOUT_MS = 30;
export const STARTUP_TIMEOUT_MS = 1000;
export const PROBE_TIMEOUT_MS = 150;

const WORKER_SOURCE = `"use strict";
self.onmessage = function (event) {
    var data = event.data || {};
    var requestId = data.requestId;
    try {
        if (data.mode === "probe") {
            var re = new RegExp(data.source, data.flags);
            var matched = [];
            for (var i = 0; i < data.samples.length; i++) {
                re.lastIndex = 0;
                if (re.test(String(data.samples[i].text))) matched.push(data.samples[i].key);
            }
            self.postMessage({ type: "result", requestId: requestId, matched: matched });
            return;
        }
        var matches = [];
        for (var r = 0; r < data.rules.length; r++) {
            var rule = data.rules[r];
            self.postMessage({ type: "started", requestId: requestId, ruleId: rule.id });
            var rx = new RegExp(rule.source, rule.flags);
            for (var f = 0; f < rule.fields.length; f++) {
                var text = String(data.context[rule.fields[f]] || "");
                rx.lastIndex = 0;
                var m = rx.exec(text);
                if (m) {
                    matches.push({ ruleId: rule.id, name: rule.name, field: rule.fields[f], preview: text.slice(0, 160), matchedText: String(m[0]).slice(0, 160), index: m.index });
                    break;
                }
            }
        }
        self.postMessage({ type: "result", requestId: requestId, matches: matches });
    } catch (err) {
        self.postMessage({ type: "error", requestId: requestId, message: String(err && err.message || err) });
    }
};
self.postMessage({ type: "ready" });
`;

export type WorkerOutcome<T> =
    | { status: "ok"; value: T }
    | { status: "timeout"; startedRuleId: string | null }
    | { status: "unavailable"; message: string }
    | { status: "error"; message: string };

let workerFactory: (() => { worker: Worker; dispose(): void } | null) | null = null;

export function setWorkerFactory(factory: typeof workerFactory) {
    workerFactory = factory;
}

function defaultFactory(): { worker: Worker; dispose(): void } | null {
    if (typeof Worker !== "function" || typeof Blob !== "function" || typeof URL?.createObjectURL !== "function") return null;
    let url = "";
    try {
        url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
        const worker = new Worker(url);
        return { worker, dispose: () => { try { worker.terminate(); } catch {} try { URL.revokeObjectURL(url); } catch {} } };
    } catch {
        if (url) try { URL.revokeObjectURL(url); } catch {}
        return null;
    }
}

let nextRequest = 1;

export function runInWorker<T>(payload: Record<string, unknown>, timeoutMs: number, pick: (msg: any) => T): Promise<WorkerOutcome<T>> {
    const created = (workerFactory ?? defaultFactory)();
    if (!created) return Promise.resolve({ status: "unavailable", message: "Worker unavailable" });
    const { worker, dispose } = created;
    const requestId = nextRequest++;
    return new Promise(resolve => {
        let settled = false;
        let startedRuleId: string | null = null;
        let batchTimer: ReturnType<typeof setTimeout> | undefined;
        const finish = (outcome: WorkerOutcome<T>) => {
            if (settled) return;
            settled = true;
            clearTimeout(startupTimer);
            clearTimeout(batchTimer);
            dispose();
            resolve(outcome);
        };
        const startupTimer = setTimeout(() => finish({ status: "unavailable", message: "Worker startup timed out" }), STARTUP_TIMEOUT_MS);
        worker.onerror = (e: ErrorEvent) => {
            e.preventDefault?.();
            finish({ status: "unavailable", message: e.message || "Worker error" });
        };
        worker.onmessage = (event: MessageEvent) => {
            const msg = event.data ?? {};
            if (msg.type === "ready") {
                clearTimeout(startupTimer);
                worker.postMessage({ requestId, ...payload });
                batchTimer = setTimeout(() => finish({ status: "timeout", startedRuleId }), timeoutMs);
            } else if (msg.requestId !== requestId) {
                return;
            } else if (msg.type === "started") {
                startedRuleId = String(msg.ruleId);
            } else if (msg.type === "result") {
                finish({ status: "ok", value: pick(msg) });
            } else if (msg.type === "error") {
                finish({ status: "error", message: String(msg.message ?? "Worker error") });
            }
        };
    });
}

export interface RegexRunResult {
    result: RegexResult | null;
    status: "sync" | "ok" | "timeout" | "unavailable" | "error";
    timedOutRuleIds: string[];
}

export function splitRules<R extends Pick<RegexRule, "source">>(rules: readonly R[]) {
    const safe: R[] = [];
    const unsafe: R[] = [];
    for (const r of rules) (isSafeSource(r.source) ? safe : unsafe).push(r);
    return { safe, unsafe };
}

export async function runRegexRules(rules: readonly RegexRule[], context: RegexContext): Promise<RegexRunResult> {
    const { safe, unsafe } = splitRules(rules);
    const safeMatches = runRulesSync(safe, context);
    if (safeMatches.length || !unsafe.length) return { result: toResult(safeMatches), status: "sync", timedOutRuleIds: [] };
    const outcome = await runInWorker<RegexMatch[]>({ rules: unsafe.map(({ id, name, source, flags, fields }) => ({ id, name, source, flags, fields })), context }, BATCH_TIMEOUT_MS, msg => (Array.isArray(msg.matches) ? msg.matches : []));
    if (outcome.status === "ok") return { result: toResult(outcome.value), status: "ok", timedOutRuleIds: [] };
    if (outcome.status === "timeout") {
        const ids = outcome.startedRuleId ? [outcome.startedRuleId] : unsafe.map(r => r.id);
        return { result: null, status: "timeout", timedOutRuleIds: ids };
    }
    return { result: null, status: outcome.status, timedOutRuleIds: [] };
}

export function probeRegex(source: string, flags: string, samples: { key: string; text: string }[], timeoutMs = PROBE_TIMEOUT_MS): Promise<WorkerOutcome<string[]>> {
    return runInWorker<string[]>({ mode: "probe", source, flags, samples }, timeoutMs, msg => (Array.isArray(msg.matched) ? msg.matched.map(String) : []));
}

export function probeRegexSync(source: string, flags: string, samples: { key: string; text: string }[]): string[] {
    const re = new RegExp(source, flags);
    return samples.filter(s => { re.lastIndex = 0; return re.test(s.text); }).map(s => s.key);
}
