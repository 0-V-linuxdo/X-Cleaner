/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { HiddenRecord } from "@filter/types";
import { Icons } from "@ui/icons";
import { showToast } from "@ui/toast";
import { Logger } from "@utils/Logger";
import definePlugin, { StartAt } from "@utils/types";
import { findIdentityLink, isInNestedStatusCard, isRendered, SEL } from "@x/dom";

import { getController } from "../_api/replyFilter";
import { CHECKS } from "@x/health";

const logger = new Logger("NativeBlock");

export const INTENT_KEY = "xReplyBlockerNativeBlockIntentV1";
const INTENT_TTL_MS = 30_000;
const RESUME_TRIES = 40;
const RESUME_INTERVAL_MS = 250;
const WAIT_MS = 2500;
const POLL_MS = 50;
const DEFAULT_ERROR = "无法打开 X 原生拉黑确认框。";

interface Intent {
    tweetId: string;
    authorHandle: string;
    createdAt: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function identityMatches(article: HTMLElement, tweetId: string, handle: string): boolean {
    const id = article.isConnected ? findIdentityLink(article) : null;
    return !!id && id.tweetId === tweetId && id.handle === handle;
}

/** Waits for an element that was not present before the wait started. */
async function waitForNew(selector: string, before: Set<Element>): Promise<HTMLElement | null> {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
        for (const el of document.querySelectorAll<HTMLElement>(selector)) {
            if (!before.has(el) && isRendered(el)) return el;
        }
        await sleep(POLL_MS);
    }
    return null;
}

const snapshot = (selector: string) => new Set(document.querySelectorAll(selector));

/** Opens X's own block confirmation for a mounted reply. Never presses the final confirm button. */
export async function openNativeBlock(article: HTMLElement, tweetId: string, handle: string) {
    if (!identityMatches(article, tweetId, handle)) throw new Error("回复身份已变化，已中止 X 原生拉黑。");
    const caret = [...article.querySelectorAll<HTMLElement>(SEL.caret)].find(c => !isInNestedStatusCard(c, article, tweetId));
    if (!caret || !isRendered(caret)) throw new Error("找不到该回复的 X 操作菜单。");
    const blockSel = '[role="menuitem"][data-testid="block"]';
    const beforeMenu = snapshot(blockSel);
    caret.click();
    const item = await waitForNew(blockSel, beforeMenu);
    if (!item) throw new Error("X 未显示原生拉黑菜单项，操作已中止。");
    if (!identityMatches(article, tweetId, handle)) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
        throw new Error("菜单打开后回复身份发生变化，操作已中止。");
    }
    const confirmSel = '[data-testid="confirmationSheetConfirm"]';
    const beforeConfirm = snapshot(confirmSel);
    item.click();
    const confirmButton = await waitForNew(confirmSel, beforeConfirm);
    if (!confirmButton) throw new Error("X 未显示原生确认框，操作已中止。");
    // Deliberately stop here: the final confirmation is the user's decision.
}

function readIntent(): Intent | null {
    try {
        const raw = sessionStorage.getItem(INTENT_KEY);
        if (!raw) return null;
        const intent = JSON.parse(raw) as Intent;
        if (typeof intent?.tweetId !== "string" || typeof intent.authorHandle !== "string" || typeof intent.createdAt !== "number" || Date.now() - intent.createdAt > INTENT_TTL_MS) {
            sessionStorage.removeItem(INTENT_KEY);
            return null;
        }
        return intent;
    } catch {
        return null;
    }
}

function clearIntent() {
    try { sessionStorage.removeItem(INTENT_KEY); } catch {}
}

async function blockRecord(rec: HiddenRecord) {
    const { tweetId, authorHandle, statusUrl } = rec.context;
    if (!tweetId || !authorHandle) throw new Error("缺少回复身份，无法核对拉黑目标。");
    const controller = getController();
    if (!controller.records.has(tweetId)) throw new Error("找不到该回复，操作已中止。");
    controller.restore(tweetId);
    const article = controller.findArticle(tweetId);
    if (article && identityMatches(article, tweetId, authorHandle)) {
        await openNativeBlock(article, tweetId, authorHandle);
        showToast("已打开 X 原生确认框；脚本不会点击最终确认。", { type: "success" });
        return;
    }
    try {
        if (!statusUrl) throw new Error("no url");
        sessionStorage.setItem(INTENT_KEY, JSON.stringify({ tweetId, authorHandle, createdAt: Date.now() } satisfies Intent));
    } catch {
        throw new Error("该回复已离开页面，请先打开回复再操作。");
    }
    location.assign(statusUrl);
}

let resumeTimer: ReturnType<typeof setTimeout> | undefined;

function resume() {
    const intent = readIntent();
    if (!intent) return;
    let tries = 0;
    const attempt = () => {
        resumeTimer = undefined;
        const live = readIntent();
        if (!live) return;
        const article = getController().findArticle(live.tweetId);
        if (article && identityMatches(article, live.tweetId, live.authorHandle)) {
            clearIntent();
            getController().restore(live.tweetId);
            openNativeBlock(article, live.tweetId, live.authorHandle).then(
                () => showToast("已打开 X 原生确认框；最终确认必须由你完成。", { type: "success" }),
                e => showToast(e instanceof Error && e.message ? e.message : DEFAULT_ERROR, { type: "error" }),
            );
            return;
        }
        if (++tries < RESUME_TRIES) resumeTimer = setTimeout(attempt, RESUME_INTERVAL_MS);
    };
    attempt();
}

export default definePlugin({
    name: "NativeBlock",
    description: "在 X 中拉黑：从复查页打开 X 原生的拉黑确认框。脚本只打开确认框，永远不会替你点最终确认。",
    icon: Icons.ban,
    tags: ["moderation"],
    enabledByDefault: true,
    startAt: StartAt.DOMContentLoaded,
    dependencies: ["ReplyFilter"],
    healthChecks: [CHECKS.postCaret],
    reviewActions: [{
        id: "native-block",
        order: 50,
        danger: true,
        label: () => "在 X 中拉黑",
        disabled: rec => !rec.context.authorHandle,
        async run(rec) {
            try {
                await blockRecord(rec);
            } catch (e) {
                logger.warn("Native block failed", e);
                throw new Error(e instanceof Error && e.message ? e.message : DEFAULT_ERROR);
            }
        },
    }],

    start() {
        resume();
    },

    stop() {
        clearTimeout(resumeTimer);
    },
});
