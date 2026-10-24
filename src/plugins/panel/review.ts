/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { HiddenRecord } from "@filter/types";
import { CATEGORY_LABELS, type CategoryId } from "@rules/classifier";
import { FIELD_LABELS } from "@rules/regex";
import { h } from "@ui/h";
import { showToast } from "@ui/toast";
import { N_, t } from "@utils/i18n";
import { parseRoute } from "@x/route";
import { truncate } from "@x/text";

import { getController, isFilterActive } from "../_api/replyFilter";
import { listbox, pill } from "./components";
import type { PageInstance, PanelContext, ReviewAction } from "./types";

export const reviewActions = new Map<string, ReviewAction>();

const SOURCE_LABELS: Record<string, string> = { ai: "AI", regex: N_("正则"), phrase: N_("词语"), domain: N_("域名"), account: N_("账号"), "auto-account": N_("自动账号") };

export function sourceLabel(rec: HiddenRecord): string {
    if (rec.source === "classifier") return CATEGORY_LABELS[rec.category as CategoryId] ?? t("本地识别");
    return t(SOURCE_LABELS[rec.source] ?? "本地识别");
}

export function recordName(rec: HiddenRecord): string {
    return rec.context.displayName || (rec.context.authorHandle ? `@${rec.context.authorHandle}` : "") || t("未知账号");
}

function details(rec: HiddenRecord): HTMLElement | null {
    const lines: string[] = [];
    if (rec.score != null && rec.threshold != null) lines.push(t("得分 {score} / 阈值 {threshold}", { score: rec.score, threshold: rec.threshold }));
    if (rec.confidence != null) lines.push(t("AI 置信度 {pct}%", { pct: Math.round(rec.confidence * 100) }));
    for (const s of rec.signals) lines.push(`${s.label} (${s.weight >= 0 ? "+" : ""}${s.weight})`);
    if (rec.regexMatch) lines.push(t("规则 {rule} · {field}", { rule: rec.regexMatch.ruleName || rec.regexMatch.ruleId, field: FIELD_LABELS[rec.regexMatch.field] }));
    else if (rec.match?.kind === "phrase") lines.push(t("词语 {value}", { value: rec.match.value }));
    else if (rec.match?.kind === "domain") lines.push(t("域名 {value}", { value: rec.match.value }));
    if (!lines.length) return null;
    const d = h("details", { class: "xc-rec-details" }, h("summary", null, t("查看命中规则")), h("ul", null, lines.map(l => h("li", null, l))));
    d.addEventListener("click", e => e.stopPropagation());
    return d;
}

function row(rec: HiddenRecord): Node[] {
    return [
        h("div", { class: "xc-rec-head" },
            h("strong", { class: "xc-rec-name" }, recordName(rec)),
            rec.context.authorHandle ? h("span", { class: "xc-muted" }, `@${rec.context.authorHandle}`) : null,
            pill(sourceLabel(rec), rec.source === "ai" ? "danger" : "accent"),
        ),
        h("div", { class: "xc-rec-reason" }, rec.reason),
        rec.aiStatus && rec.aiStatus !== "pending" ? h("div", { class: "xc-rec-ai xc-muted" }, rec.aiStatus) : null,
        rec.context.bodyText ? h("div", { class: "xc-rec-body" }, truncate(rec.context.bodyText, 160)) : null,
        details(rec),
    ].filter(Boolean) as Node[];
}

export function createReviewPage(_ctx: PanelContext): PageInstance {
    const el = h("div", { class: "xc-page xc-review" });
    const label = h("span", { class: "xc-footer-label" });
    const buttons = h("div", { class: "xc-footer-actions" });
    const footer = h("div", { class: "xc-review-bar" }, label, buttons);
    let selected: string | null = null;
    let records: HiddenRecord[] = [];

    const render = () => {
        records = isFilterActive() ? getController().visibleRecords() : [];
        if (!records.some(r => r.tweetId === selected)) selected = records[0]?.tweetId ?? null;
        const empty = parseRoute().isStatusRoute ? t("当前对话暂无已隐藏回复。") : t("打开一条 X 帖子的对话页后开始工作。");
        el.replaceChildren(listbox({
            label: t("已隐藏回复"),
            items: records,
            key: r => r.tweetId,
            render: row,
            selected,
            empty,
            onSelect: k => {
                const hadFocus = el.contains(document.activeElement);
                selected = k;
                render();
                if (hadFocus) queueMicrotask(() => el.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"]`)?.focus());
            },
        }));
        const rec = records.find(r => r.tweetId === selected);
        footer.hidden = !rec;
        if (!rec) return;
        label.textContent = t("已选 {name}", { name: `${recordName(rec)}${rec.context.authorHandle ? ` · @${rec.context.authorHandle}` : ""}` });
        buttons.replaceChildren(...[...reviewActions.values()].sort((a, b) => a.order - b.order).map(action => {
            const btn = h("button", {
                type: "button",
                class: `xc-btn xc-btn-sm${action.danger ? " xc-btn-danger" : ""}`,
                disabled: !!action.disabled?.(rec),
                onclick: async () => {
                    try {
                        await action.run(rec);
                    } catch (e) {
                        showToast(e instanceof Error ? e.message : String(e), { type: "error" });
                    }
                    render();
                },
            }, action.label(rec));
            return btn;
        }));
    };

    return {
        el,
        footer,
        update: render,
    };
}
