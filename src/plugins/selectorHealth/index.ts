/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// X's counterpart of Void++'s BuildHealth. Void++ notices a new Grok build by its chunk names;
// X Cleaner depends on X's DOM instead, so each plugin declares the selectors it needs and this
// plugin reports when one stops matching on a page where it should, instead of failing silently.

import { dispatch } from "@api/Events";
import { plugins } from "@api/PluginManager";
import { openSettingsPanel } from "@plugins/_core/settings/panel";
import { Icons } from "@ui/icons";
import { showNotice } from "@ui/notice";
import { Logger } from "@utils/Logger";
import definePlugin, { type HealthCheck, StartAt } from "@utils/types";

const logger = new Logger("SelectorHealth");

/** Time for X to render a page after load or navigation before anything is judged missing. */
export const SETTLE_MS = 8000;
/** A miss must repeat this much later before it is reported, so one slow render never alerts. */
export const CONFIRM_MS = 6000;

export interface HealthIssue { plugin: string; check: HealthCheck }

const issues = new Map<string, HealthIssue>();
const suspects = new Set<string>();
const notified = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

const keyOf = (plugin: string, check: HealthCheck) => `${plugin}:${check.id}`;

export const healthIssues = (plugin?: string): HealthIssue[] => [...issues.values()].filter(i => !plugin || i.plugin === plugin);

function evaluate(check: HealthCheck): boolean | null {
    try {
        if (check.when && !check.when()) return null;
        return !!document.querySelector(check.selector);
    } catch (e) {
        logger.warn(`Health check ${check.id} threw`, e);
        return null;
    }
}

/** One pass over every running plugin. A first miss only marks a suspect; a second consecutive miss is an issue. */
export function runChecks(): { pending: boolean } {
    let changed = false;
    let pending = false;
    const fresh: HealthIssue[] = [];
    for (const p of Object.values(plugins)) {
        if (!p.started || !p.healthChecks) continue;
        for (const check of p.healthChecks) {
            const key = keyOf(p.name, check);
            const ok = evaluate(check);
            if (ok === null) { suspects.delete(key); continue; }
            if (ok) {
                suspects.delete(key);
                if (issues.delete(key)) changed = true;
                continue;
            }
            if (issues.has(key)) continue;
            if (!suspects.has(key)) {
                suspects.add(key);
                pending = true;
                continue;
            }
            suspects.delete(key);
            const issue = { plugin: p.name, check };
            issues.set(key, issue);
            fresh.push(issue);
            changed = true;
        }
    }
    for (const issue of fresh) report(issue);
    if (changed) syncWarnings();
    return { pending };
}

function syncWarnings() {
    for (const p of Object.values(plugins)) {
        const labels = healthIssues(p.name).map(i => i.check.label);
        if (labels.length) p.healthWarnings = labels;
        else delete p.healthWarnings;
    }
    dispatch("healthChange");
}

function report({ plugin, check }: HealthIssue) {
    const key = keyOf(plugin, check);
    logger.warn(`${plugin}: no element matches ${check.selector} (${check.label})`);
    if (notified.has(key)) return;
    notified.add(key);
    showNotice({
        id: `health:${key}`,
        type: "warning",
        message: `X 的页面结构可能更新了：${plugin} 找不到「${check.label}」，相关功能可能暂时失灵。`,
        action: { label: "查看插件", onClick: () => openSettingsPanel({ tab: "plugins" }) },
    });
}

export function schedule(delay = SETTLE_MS) {
    clearTimeout(timer);
    timer = setTimeout(() => {
        if (runChecks().pending) schedule(CONFIRM_MS);
    }, delay);
}

export function resetHealth() {
    clearTimeout(timer);
    issues.clear();
    suspects.clear();
    notified.clear();
}

export default definePlugin({
    name: "SelectorHealth",
    description: "页面结构检查：X 改版后，如果插件依赖的按钮、菜单、侧栏找不到了，主动提示哪个插件受影响，而不是悄悄失灵。",
    icon: Icons.heartPulse,
    tags: ["core", "developer"],
    enabledByDefault: true,
    startAt: StartAt.DOMContentLoaded,

    events: {
        navigate: () => schedule(),
        pluginToggle: () => schedule(),
    },

    start() {
        schedule();
    },

    stop() {
        resetHealth();
        syncWarnings();
    },
});
