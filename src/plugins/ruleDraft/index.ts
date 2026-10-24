/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exactFallback } from "@rules/safety";
import { fieldValues, synthesizeLocalRule } from "@rules/synthesizer";
import { Icons } from "@ui/icons";
import { showToast } from "@ui/toast";
import { N_, t } from "@utils/i18n";
import definePlugin from "@utils/types";
import { contextSignature } from "@x/dom";
import type { PostMenuItem } from "@plugins/_api/postMenu";

import { eligibleReplyContext, getController } from "../_api/replyFilter";

import { closeActiveDraft, type DraftOutcome, type DraftTarget, openRuleDraft } from "./dialog";
import css from "./styles.css";

export type { DraftOutcome, DraftTarget } from "./dialog";
export { activeDraft } from "./dialog";

const INITIAL_REASON = N_("正在分析回复；如果没有可复用模式，将保留这条本地精确规则。");

/** §17.1 step 6: the first draft is always local; AI only runs when the user asks for it. */
export function draftFor(target: DraftTarget): Promise<DraftOutcome> | null {
    return openRuleDraft(target, ctx => synthesizeLocalRule(ctx) ?? exactFallback(fieldValues(ctx), undefined, t(INITIAL_REASON)));
}

/** Same draft as the shield button, opened from the post's 「…」 menu. */
export const ruleDraftMenuItem: PostMenuItem = {
    id: "rule-draft",
    order: 30,
    icon: Icons.regex,
    label: () => t("用这条回复生成屏蔽规则"),
    visible: ctx => !!eligibleReplyContext(ctx.article),
    run(ctx) {
        const reply = eligibleReplyContext(ctx.article);
        if (!reply) {
            showToast(t("这条回复已不在可处理范围内。"), { type: "error" });
            return;
        }
        const target = { routeKey: getController().route.routeKey, tweetId: reply.tweetId, handle: reply.authorHandle, signature: contextSignature(reply) };
        draftFor(target)?.catch(err => showToast(err instanceof Error ? err.message : t("无法生成屏蔽规则。"), { type: "error" }));
    },
};

export default definePlugin({
    name: "RuleDraft",
    description: N_("规则草稿弹窗：从一条回复生成正则规则，支持划词、本地模板、AI 生成与追问，保存前在 Worker 中做安全校验。"),
    icon: Icons.regex,
    tags: ["filters", "ai"],
    enabledByDefault: true,
    dependencies: ["AiClient", "ReplyFilter"],
    managedStyle: css,
    postMenuItems: [ruleDraftMenuItem],

    stop() {
        closeActiveDraft();
    },
});
