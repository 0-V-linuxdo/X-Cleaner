/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AiQueueError } from "@ai/queue";
import { reviewReply } from "@ai/review";
import type { HiddenRecord } from "@filter/types";
import { isAllowed } from "@rules/lists";
import { Icons } from "@ui/icons";
import { showToast } from "@ui/toast";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { type SerializableContext, serializeContext } from "@x/dom";

import { getAiQueue, isAiReady } from "../_api/aiClient";
import { getConfigStore } from "../_api/blockerConfig";
import { eligibleReplyContext, getController } from "../_api/replyFilter";
import type { PostMenuItem } from "../_api/postMenu";
import { createAiSettingsPage } from "./settingsPage";

const logger = new Logger("AiReview");
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function requestAiReview(ctx: SerializableContext): boolean {
    const queue = getAiQueue();
    if (!isAiReady() || !queue.canEnqueue(ctx.tweetId)) return false;
    const controller = getController();
    const routeKey = controller.route.routeKey;
    const store = getConfigStore();
    queue.enqueue(ctx.tweetId, () => reviewReply(ctx, store.config.ai, store.apiKey)).then(result => {
        if (controller.route.routeKey !== routeKey) return;
        if (!isAiReady() || !controller.selfHandle) return;
        const article = controller.findArticle(ctx.tweetId);
        const live = article && controller.extract(article);
        if (!article || !live || !controller.inScope(live)) {
            if (article) controller.processArticle(article);
            return;
        }
        const allowed = result.verdict === "allow";
        const status = allowed ? `AI 判定正常（${pct(result.confidence)}）` : `AI：${result.reason}（${pct(result.confidence)}）`;
        const malicious = !allowed && result.confidence >= 0.8;
        if (malicious && !isAllowed(store.config, live.authorHandle) && !controller.isProtected(live)) {
            const reason = `AI：${result.reason}`;
            controller.hideExternal(live, {
                action: "hide", source: "ai", category: result.verdict, reason, confidence: result.confidence,
                autoEntry: result.confidence >= 0.9 ? { source: "ai-auto", category: result.verdict, reason: result.reason, confidence: result.confidence } : null,
            });
        }
        controller.setAiStatus(ctx.tweetId, status);
        if (allowed) showToast("AI 复核：未判定为恶意引流。", { type: "success" });
        else showToast(`AI 复核：${result.reason}`, { type: malicious ? "error" : "success" });
    }, e => {
        if (e instanceof AiQueueError) return;
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("Review failed", e);
        if (controller.route.routeKey !== routeKey) return;
        controller.setAiStatus(ctx.tweetId, `AI 复核失败：${msg}`);
        showToast(`AI 复核失败：${msg}`, { type: "error" });
    });
    return true;
}

export const aiReviewMenuItem: PostMenuItem = {
    id: "ai-review",
    order: 40,
    icon: Icons.sparkles,
    label: () => "AI 复核这条回复",
    visible: ctx => isAiReady() && !getAiQueue().has(ctx.tweetId) && !!eligibleReplyContext(ctx.article),
    run(ctx) {
        const reply = eligibleReplyContext(ctx.article);
        if (!reply || !requestAiReview(serializeContext(reply))) {
            showToast("AI 未启用、已达本对话上限，或该回复已在复核中。", { type: "error" });
            return;
        }
        getController().setAiStatus(reply.tweetId, "pending");
        showToast("AI 复核已排队。", { type: "success" });
    },
};

export default definePlugin({
    name: "AiReview",
    description: "AI 复核：本地分类器处于临界分数、或带图且有语义信号的回复，送到你配置的 OpenAI 兼容服务复核。需要在设置中确认发送范围后才会启用。",
    icon: Icons.sparkles,
    tags: ["ai", "filters"],
    enabledByDefault: true,
    dependencies: ["AiClient", "ReplyFilter"],
    panelPages: [{ tab: "settings", id: "ai", label: "AI", order: 30, create: createAiSettingsPage }],
    postMenuItems: [aiReviewMenuItem],
    reviewActions: [{
        id: "ai-review",
        order: 40,
        label: (rec: HiddenRecord) => (getAiQueue().has(rec.tweetId) ? "复核中" : "AI 复核"),
        disabled: (rec: HiddenRecord) => !isAiReady() || getAiQueue().has(rec.tweetId),
        run(rec: HiddenRecord) {
            if (!requestAiReview(rec.context)) throw new Error("AI 未启用、已达本对话上限，或该回复已在复核中。");
            getController().setAiStatus(rec.tweetId, "pending");
            showToast("AI 复核已排队。", { type: "success" });
        },
    }],

    events: {
        replyVisible({ ctx, state }) {
            if (state.classification?.action !== "ai-review") return;
            requestAiReview(serializeContext(ctx));
        },
    },
});
