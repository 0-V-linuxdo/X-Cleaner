/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { BlockerConfig } from "@config/config";
import { h } from "@ui/h";
import { showToast } from "@ui/toast";
import { t } from "@utils/i18n";

import { button } from "./components";
import { bulkSelection, errorLine, hitPill, matches, type MsgKind, pageHeader } from "./kit";
import type { PageInstance, PanelContext } from "./types";

/** Text options are N_() strings, translated when the page is built; `fullMessage` gets `{max}`. */
export interface StringListOptions {
    label: string;
    placeholder: string;
    description?: string;
    statsPrefix: string;
    limit: number;
    fullMessage: string;
    savedToast: string;
    get(config: BlockerConfig): string[];
    set(config: BlockerConfig, list: string[]): void;
    /** Returns the normalized value, or an error message. */
    normalize(raw: string): { value: string } | { error: string };
    /** Live hint under the input; "warning" level needs a confirm on save. */
    hint?(raw: string): { level: MsgKind; message: string } | null;
}

/** A plain list of strings with an add/edit form, used by the phrase and domain subpages. */
export function stringListPage(opts: StringListOptions) {
    return (ctx: PanelContext): PageInstance => {
        let editing: string | null = null;
        const label = t(opts.label);
        const placeholder = t(opts.placeholder);
        const input = h("input", { class: "xc-input", type: "text", placeholder, "aria-label": placeholder });
        const msg = errorLine();
        const submit = h("button", { class: "xc-btn xc-btn-primary", type: "submit" }, t("添加"));
        const cancel = button(t("取消编辑"), () => stopEditing());
        const form = h("form", { class: "xc-form" }, opts.description ? h("p", { class: "xc-muted" }, t(opts.description)) : null, h("div", { class: "xc-row" }, input, submit, cancel), msg);
        const list = h("div", { class: "xc-items", role: "list", "aria-label": label });
        const header = pageHeader(label, () => opts.get(ctx.store.config).map(v => `${opts.statsPrefix}:${v}`), () => renderList());
        const bulk = bulkSelection(t("条目"), [{
            label: t("移除所选"),
            kind: "danger",
            confirm: n => t("从{label}中移除 {n} 个条目？", { label, n }),
            run: keys => {
                const drop = new Set(keys);
                const ok = ctx.commit(c => opts.set(c, opts.get(c).filter(x => !drop.has(x))));
                if (ok && editing !== null && drop.has(editing)) stopEditing();
                return ok;
            },
        }]);
        const el = h("div", { class: "xc-page" }, header.el, form, bulk.bar, list);

        const stopEditing = () => {
            editing = null;
            input.value = "";
            msg.show("");
            renderForm();
        };

        const renderForm = () => {
            submit.textContent = editing === null ? t("添加") : t("保存");
            cancel.hidden = editing === null;
        };

        const hint = () => {
            const result = opts.hint?.(input.value);
            msg.show(input.value.trim() && result ? result.message : "", result?.level ?? "error");
        };
        if (opts.hint) input.addEventListener("input", hint);

        form.addEventListener("submit", e => {
            e.preventDefault();
            const result = opts.normalize(input.value);
            if ("error" in result) {
                msg.show(result.error);
                return;
            }
            const warn = opts.hint?.(input.value);
            if (warn?.level === "warning" && !confirm(t("{message}\n\n仍要保存吗？", { message: warn.message }))) return;
            const current = opts.get(ctx.store.config);
            const value = result.value;
            if (editing === null && !current.includes(value) && current.length >= opts.limit) {
                msg.show(t(opts.fullMessage, { max: opts.limit }));
                return;
            }
            const ok = ctx.commit(c => {
                const items = opts.get(c);
                const next = editing !== null && items.includes(editing) ? items.map(v => (v === editing ? value : v)) : [...items, value];
                opts.set(c, [...new Set(next)]);
            });
            if (!ok) return;
            showToast(t(opts.savedToast), { type: "success" });
            stopEditing();
        });

        const renderList = () => {
            const q = header.query();
            const all = opts.get(ctx.store.config);
            const items = all.filter(v => matches(q, v));
            header.update();
            bulk.sync(all, items);
            if (!items.length) {
                list.replaceChildren(h("div", { class: "xc-empty" }, q ? t("没有匹配的条目。") : t("暂无{label}。", { label })));
                return;
            }
            list.replaceChildren(...items.map(v => h("div", { class: "xc-item", role: "listitem" },
                bulk.box(v, v),
                h("div", { class: "xc-item-main" }, h("div", { class: "xc-item-head" }, h("span", null, v), hitPill(`${opts.statsPrefix}:${v}`))),
                h("div", { class: "xc-item-actions" },
                    button(t("编辑"), () => {
                        editing = v;
                        input.value = v;
                        renderForm();
                        hint();
                        input.focus();
                    }, { small: true }),
                    button(t("移除"), () => {
                        if (ctx.commit(c => opts.set(c, opts.get(c).filter(x => x !== v))) && editing === v) stopEditing();
                    }, { small: true, kind: "danger" }),
                ),
            )));
        };

        renderForm();
        return {
            el,
            update: renderList,
            onShow: () => {
                header.clearQuery();
                stopEditing();
            },
        };
    };
}
