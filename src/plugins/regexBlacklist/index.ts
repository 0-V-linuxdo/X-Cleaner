/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { activeRules, FIELD_LABELS, regexContextOf, type RegexResult, runRulesSync, toResult } from "@rules/regex";
import { runRegexRules, splitRules } from "@rules/regex-runner";
import { showToast } from "@ui/toast";
import { Icons } from "@ui/icons";
import definePlugin from "@utils/types";
import type { Verdict } from "@filter/types";

import { getConfigStore } from "../_api/blockerConfig";
import { createRegexPage } from "./page";

const runtimeDisabled = new Set<string>();

function rules(config = getConfigStore().config) {
    return activeRules(config.blacklists.regexRules).filter(r => !runtimeDisabled.has(r.id));
}

function verdictOf(result: RegexResult): Verdict {
    const reason = `正则“${result.ruleName || result.ruleId}”命中 ${FIELD_LABELS[result.field]}`;
    return { action: "hide", source: "regex", category: "正则黑名单", reason, regexMatch: result, match: { kind: "regex", value: result.ruleId, field: result.field }, statsKey: `regex:${result.ruleId.trim().slice(0, 120)}`, autoEntry: { source: "local-auto", category: "正则黑名单", reason } };
}

function disableTimedOut(ids: string[]) {
    const store = getConfigStore();
    const unsafe = new Set(splitRules(store.config.blacklists.regexRules).unsafe.map(r => r.id));
    const targets = ids.filter(id => unsafe.has(id));
    if (!targets.length) return;
    for (const id of targets) runtimeDisabled.add(id);
    store.update(c => {
        for (const r of c.blacklists.regexRules) {
            if (!targets.includes(r.id)) continue;
            r.enabled = false;
            r.errorCode = "timeout";
            r.error = "正则执行超过 30ms，已自动禁用。";
        }
    });
    showToast("有正则执行超过 30ms，已自动禁用。", { type: "error" });
}

export default definePlugin({
    name: "RegexBlacklist",
    description: "正则黑名单：安全模式在主线程同步执行，其余规则放进可终止的 Worker，超过 30ms 自动停用。",
    icon: Icons.regex,
    tags: ["filters"],
    enabledByDefault: true,
    dependencies: ["BlockerConfig"],
    panelPages: [{ tab: "blacklist", id: "regex", label: "正则", order: 30, create: createRegexPage }],

    events: {
        configurationChanged() { runtimeDisabled.clear(); },
        filterRouteChanged() { runtimeDisabled.clear(); },
    },

    replyJudges: [
        {
            id: "regex-safe",
            priority: 80,
            judge(ctx, env) {
                const { safe } = splitRules(rules(env.config));
                const result = toResult(runRulesSync(safe, regexContextOf(ctx)));
                return result ? verdictOf(result) : null;
            },
            quick(input, env) {
                const { safe } = splitRules(rules(env.config));
                return runRulesSync(safe, regexContextOf(input)).length ? { action: "hide" } : null;
            },
        },
        {
            id: "regex-worker",
            priority: 100,
            judge(ctx, env) {
                const { unsafe } = splitRules(rules(env.config));
                if (!unsafe.length) return null;
                env.state.deferredRegex = true;
                return runRegexRules(unsafe, regexContextOf(ctx)).then(r => {
                    if (r.status === "timeout") disableTimedOut(r.timedOutRuleIds);
                    return r.result ? verdictOf(r.result) : null;
                });
            },
        },
    ],
});
