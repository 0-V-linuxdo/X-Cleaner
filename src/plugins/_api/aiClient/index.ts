/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AiQueue } from "@ai/queue";
import { aiReady } from "@ai/transport";
import type { AiConfig } from "@config/config";
import definePlugin from "@utils/types";

import { getConfigStore } from "../blockerConfig";

let queue: AiQueue | null = null;
let unsub: (() => void) | null = null;
const aiListeners = new Set<() => void>();

/** One budgeted queue per conversation, shared by AI review and AI rule generation (spec §15.5). */
export function getAiQueue(): AiQueue {
    return queue ??= new AiQueue(() => {
        const ai = getConfigStore().config.ai;
        return { budget: ai.maxReviewsPerConversation, concurrency: ai.concurrency };
    });
}

export function isAiReady(): boolean {
    const config = getConfigStore().config;
    return config.enabled && aiReady(config.ai);
}

/** Fires when anything under `ai` changes (endpoint, model, consent…), but not for other config edits. */
export function onAiConfigChange(listener: () => void): () => void {
    aiListeners.add(listener);
    return () => aiListeners.delete(listener);
}

const aiKey = (ai: AiConfig) => JSON.stringify([ai.enabled, ai.consented, ai.endpoint, ai.model, ai.timeoutMs]);

export default definePlugin({
    name: "AiClient",
    description: "AI 客户端：OpenAI 兼容接口的请求、解析，以及按对话计数的预算队列。",
    tags: ["core", "ai"],
    required: true,
    hidden: true,
    dependencies: ["BlockerConfig"],

    events: {
        filterRouteChanged() {
            queue?.reset(false);
        },
    },

    start() {
        unsub = getConfigStore().subscribe(({ config, previous }) => {
            if (aiKey(config.ai) === aiKey(previous.ai)) return;
            for (const l of [...aiListeners]) l();
        });
        const offKey = getConfigStore().onApiKeyChange(() => { for (const l of [...aiListeners]) l(); });
        const offCfg = unsub;
        unsub = () => { offCfg(); offKey(); };
    },

    stop() {
        unsub?.();
        unsub = null;
        queue?.reset(false);
    },
});
