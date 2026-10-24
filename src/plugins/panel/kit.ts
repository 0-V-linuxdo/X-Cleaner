/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { h } from "@ui/h";
import { showToast } from "@ui/toast";

import { getRuleStats } from "../ruleStats";
import { button, pill, searchBox } from "./components";

export function hitPill(key: string): HTMLElement {
    const n = getRuleStats()?.count(key) ?? 0;
    return pill(`${n} 次`, n ? "accent" : "muted", `累计隐藏 ${n} 条不重复回复`);
}

export interface PageHeader {
    el: HTMLElement;
    query(): string;
    clearQuery(): void;
    update(): void;
}

/** Search box, "清除统计" button and the per-page hit summary shared by the blacklist subpages. */
export function pageHeader(label: string, keys: () => string[], onSearch: () => void): PageHeader {
    let q = "";
    const input = searchBox(`搜索${label}`, "", v => {
        q = v;
        const { selectionStart, selectionEnd } = input;
        onSearch();
        if (document.activeElement !== input) {
            input.focus();
            input.setSelectionRange(selectionStart, selectionEnd);
        }
    });
    const summary = h("p", { class: "xc-page-summary xc-muted" });
    const clear = button("清除统计", () => {
        if (!confirm("清除全部规则命中统计？隐藏记录不会被删除。")) return;
        getRuleStats()?.clear();
        showToast("规则命中统计已清除。", { type: "success" });
    }, { small: true });
    const update = () => {
        const total = getRuleStats()?.total(keys()) ?? 0;
        summary.textContent = `本页规则累计隐藏 ${total} 条不重复回复。`;
        clear.disabled = total === 0;
    };
    update();
    return {
        el: h("div", { class: "xc-page-head" }, h("div", { class: "xc-row" }, input, clear), summary),
        query: () => q.trim().toLowerCase(),
        clearQuery: () => { q = ""; input.value = ""; },
        update,
    };
}

export function section(title: string, ...extra: (Node | null)[]): HTMLElement {
    return h("div", { class: "xc-section-head" }, h("h3", { class: "xc-section-title" }, title), ...extra);
}

export type MsgKind = "error" | "warning" | "success" | "info";
export type MessageLine = HTMLElement & { show(msg: string, kind?: MsgKind): void };

export function errorLine(): MessageLine {
    const el = h("p", { class: "xc-form-msg", role: "status", hidden: true });
    return Object.assign(el, {
        show(msg: string, kind: MsgKind = "error") {
            el.textContent = msg;
            el.hidden = !msg;
            el.dataset.kind = kind;
        },
    });
}

export function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
    return !q || fields.some(f => f?.toLowerCase().includes(q));
}

/** A labelled checkbox row bound to one config flag. */
export function checkRow(label: string, get: () => boolean, set: (v: boolean) => void, description?: string): HTMLElement & { sync(): void } {
    const box = h("input", { type: "checkbox" });
    box.addEventListener("change", () => set(box.checked));
    const row = h("label", { class: "xc-toggle-row" },
        h("span", { class: "xc-item-main" }, h("strong", null, label), description ? h("span", { class: "xc-muted", style: "font-size:12.5px" }, description) : null),
        box,
    );
    const sync = () => { box.checked = get(); };
    sync();
    return Object.assign(row, { sync });
}
