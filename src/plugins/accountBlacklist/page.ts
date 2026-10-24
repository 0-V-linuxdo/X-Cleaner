/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { AccountEntry, AccountSource } from "@config/config";
import { button, formatTime, listbox, pill } from "@plugins/panel/components";
import { bulkSelection, errorLine, hitPill, matches, pageHeader, section } from "@plugins/panel/kit";
import { LIMITS } from "@config/config";
import type { PageInstance, PanelContext } from "@plugins/panel/types";
import { CATEGORY_LABELS, type CategoryId } from "@rules/classifier";
import { h } from "@ui/h";
import { showToast } from "@ui/toast";
import { N_, t } from "@utils/i18n";
import { toConfigHandle } from "@x/text";

export const SOURCE_LABELS: Record<AccountSource, string> = { manual: N_("手动"), "local-auto": N_("本地自动"), "ai-auto": N_("AI 自动") };

function meta(a: AccountEntry): string {
    const parts: string[] = [];
    if (a.category) parts.push(CATEGORY_LABELS[a.category as CategoryId] ?? t(a.category));
    if (a.score != null) parts.push(t("分数 {score}", { score: a.score }));
    if (a.confidence != null) parts.push(t("置信度 {pct}%", { pct: Math.round(a.confidence * 100) }));
    parts.push(formatTime(a.createdAt));
    return parts.join(" · ");
}

export function createAccountsPage(ctx: PanelContext): PageInstance {
    let editing: AccountEntry | null = null;
    let selected: string | null = null;
    const input = h("input", { class: "xc-input", type: "text", placeholder: "@handle", "aria-label": "@handle", autocomplete: "off" });
    const msg = errorLine();
    const submit = h("button", { class: "xc-btn xc-btn-primary", type: "submit" }, t("添加"));
    const cancel = button(t("取消编辑"), () => stopEditing());
    const form = h("form", { class: "xc-form" }, h("div", { class: "xc-row" }, input, submit, cancel), msg);
    const clearAuto = button(t("清除自动条目 ({n})", { n: 0 }), () => {
        if (!confirm(t("清除所有本地自动和 AI 自动账号条目？"))) return;
        ctx.store.clearAutomaticAccounts();
    }, { small: true });
    const listArea = h("div");
    const header = pageHeader(t("账号"), () => ctx.store.config.blacklists.accounts.map(a => `account:${a.handle}`), () => renderList());
    const bulk = bulkSelection(t("账号"), [
        {
            label: t("移到白名单"),
            confirm: n => t("把 {n} 个账号从黑名单移到白名单？TA 们的回复不会再被隐藏。", { n }),
            run: keys => {
                const move = new Set(keys);
                if (new Set([...ctx.store.config.allowHandles, ...keys]).size > LIMITS.allowHandles) {
                    showToast(t("白名单最多 {max} 个账号。", { max: LIMITS.allowHandles }), { type: "error" });
                    return false;
                }
                return ctx.commit(c => {
                    c.blacklists.accounts = c.blacklists.accounts.filter(a => !move.has(a.handle));
                    c.allowHandles = [...c.allowHandles.filter(x => !move.has(x)), ...keys];
                });
            },
        },
        {
            label: t("移除所选"),
            kind: "danger",
            confirm: n => t("从账号黑名单移除 {n} 个账号？", { n }),
            run: keys => {
                const drop = new Set(keys);
                const ok = ctx.commit(c => { c.blacklists.accounts = c.blacklists.accounts.filter(a => !drop.has(a.handle)); });
                if (ok && editing && drop.has(editing.handle)) stopEditing();
                return ok;
            },
        },
    ]);
    const el = h("div", { class: "xc-page" }, header.el, section(t("账号"), clearAuto), form, bulk.bar, listArea);

    const label = h("span", { class: "xc-footer-label" });
    const footer = h("div", { class: "xc-review-bar" }, label, h("div", { class: "xc-footer-actions" },
        button(t("编辑"), () => {
            const entry = ctx.store.findAccount(selected ?? "");
            if (!entry) return;
            editing = entry;
            input.value = entry.handle;
            renderForm();
            input.focus();
        }, { small: true }),
        button(t("移除"), () => {
            if (!selected) return;
            const handle = selected;
            if (ctx.commit(c => { c.blacklists.accounts = c.blacklists.accounts.filter(a => a.handle !== handle); }) && editing?.handle === handle) stopEditing();
        }, { small: true, kind: "danger" }),
    ));

    const stopEditing = () => {
        editing = null;
        input.value = "";
        msg.show("");
        renderForm();
    };
    const renderForm = () => {
        submit.textContent = editing ? t("保存") : t("添加");
        cancel.hidden = !editing;
    };

    form.addEventListener("submit", e => {
        e.preventDefault();
        const handle = toConfigHandle(input.value);
        if (!handle) return msg.show(t("请输入有效的完整 @handle。"));
        const config = ctx.store.config;
        if (config.allowHandles.includes(handle)) return msg.show(t("该账号已在白名单中。"));
        const accounts = config.blacklists.accounts;
        if (!editing && !accounts.some(a => a.handle === handle) && accounts.length >= 2000) return msg.show(t("账号黑名单已满（{max}）。", { max: 2000 }));
        const base = editing;
        const ok = ctx.commit(c => {
            const entry: AccountEntry = base
                ? { ...base, handle }
                : { handle, source: "manual", category: "", reason: "", score: null, confidence: null, createdAt: Date.now() };
            const list = c.blacklists.accounts.filter(a => a.handle !== handle);
            const at = base ? list.findIndex(a => a.handle === base.handle) : -1;
            if (at >= 0) list.splice(at, 1, entry);
            else list.push(entry);
            c.blacklists.accounts = list;
        });
        if (!ok) return;
        selected = handle;
        showToast(t("账号黑名单已保存。"), { type: "success" });
        stopEditing();
    });

    const renderList = () => {
        header.update();
        const accounts = ctx.store.config.blacklists.accounts;
        const autoCount = accounts.filter(a => a.source !== "manual").length;
        clearAuto.textContent = t("清除自动条目 ({n})", { n: autoCount });
        clearAuto.disabled = autoCount === 0;
        const q = header.query();
        const items = [...accounts].reverse().filter(a => matches(q, a.handle, a.reason, t(SOURCE_LABELS[a.source])));
        if (!items.some(a => a.handle === selected)) selected = items[0]?.handle ?? null;
        bulk.sync(accounts.map(a => a.handle), items.map(a => a.handle));
        listArea.replaceChildren(listbox({
            label: t("账号黑名单"),
            items,
            key: a => a.handle,
            selected,
            empty: q ? t("没有匹配的账号。") : t("暂无账号黑名单。"),
            onSelect: k => {
                const hadFocus = listArea.contains(document.activeElement);
                selected = k;
                renderList();
                if (hadFocus) queueMicrotask(() => listArea.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"]`)?.focus());
            },
            render: a => [
                h("div", { class: "xc-item-head" }, bulk.box(a.handle, a.handle), h("strong", null, a.handle), hitPill(`account:${a.handle}`), pill(t(SOURCE_LABELS[a.source]), a.source === "manual" ? "" : "accent")),
                a.reason ? h("div", { class: "xc-rec-reason" }, a.reason) : null,
                h("div", { class: "xc-item-meta xc-muted" }, meta(a)),
            ].filter(Boolean) as Node[],
        }));
        footer.hidden = !selected;
        label.textContent = selected ? t("已选 {n}", { n: selected }) : "";
    };

    renderForm();
    return {
        el,
        footer,
        update: renderList,
        onShow: () => {
            header.clearQuery();
            stopEditing();
        },
    };
}
