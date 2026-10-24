/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exactFallback } from "@rules/safety";
import { fieldValues, synthesizeLocalRule } from "@rules/synthesizer";
import { Icons } from "@ui/icons";
import definePlugin from "@utils/types";

import { closeActiveDraft, type DraftOutcome, type DraftTarget, openRuleDraft } from "./dialog";
import css from "./styles.css";

export type { DraftOutcome, DraftTarget } from "./dialog";
export { activeDraft } from "./dialog";

const INITIAL_REASON = "正在分析回复；如果没有可复用模式，将保留这条本地精确规则。";

/** §17.1 step 6: the first draft is always local; AI only runs when the user asks for it. */
export function draftFor(target: DraftTarget): Promise<DraftOutcome> | null {
    return openRuleDraft(target, ctx => synthesizeLocalRule(ctx) ?? exactFallback(fieldValues(ctx), undefined, INITIAL_REASON));
}

export default definePlugin({
    name: "RuleDraft",
    description: "规则草稿弹窗：从一条回复生成正则规则，支持划词、本地模板、AI 生成与追问，保存前在 Worker 中做安全校验。",
    icon: Icons.regex,
    tags: ["filters", "ai"],
    enabledByDefault: true,
    dependencies: ["AiClient", "ReplyFilter"],
    managedStyle: css,

    stop() {
        closeActiveDraft();
    },
});
