/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { h } from "@ui/h";

export function pill(text: string, kind: "" | "accent" | "danger" | "success" | "muted" = "", title?: string): HTMLElement {
    return h("span", { class: `xc-pill${kind ? ` xc-pill-${kind}` : ""}`, title }, text);
}

export function button(label: string, onclick: (e: MouseEvent) => void, opts: { kind?: "primary" | "danger" | ""; disabled?: boolean; small?: boolean; type?: string } = {}): HTMLButtonElement {
    const cls = ["xc-btn", opts.kind === "primary" && "xc-btn-primary", opts.kind === "danger" && "xc-btn-danger", opts.small && "xc-btn-sm"].filter(Boolean).join(" ");
    return h("button", { class: cls, type: opts.type ?? "button", disabled: !!opts.disabled, onclick }, label);
}

export function setupRovingTabs(list: HTMLElement, tabs: HTMLElement[], onSelect: (index: number) => void) {
    list.addEventListener("keydown", e => {
        const i = tabs.findIndex(t => t === document.activeElement);
        if (i < 0) return;
        let next = -1;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabs.length - 1;
        if (next < 0) return;
        e.preventDefault();
        e.stopPropagation();
        onSelect(next);
        tabs[next]?.focus();
    });
}

export interface TabBarOptions {
    label: string;
    items: { id: string; label: string; panelId?: string }[];
    selected: string;
    className?: string;
    onSelect(id: string): void;
}

export function tabBar(opts: TabBarOptions): { el: HTMLElement; tabs: HTMLElement[] } {
    const list = h("div", { class: opts.className ?? "xc-tabs", role: "tablist", "aria-label": opts.label });
    const tabs = opts.items.map(item => h("button", {
        type: "button",
        class: "xc-tab",
        role: "tab",
        id: `xc-tab-${item.id}`,
        "aria-selected": String(item.id === opts.selected),
        "aria-controls": item.panelId,
        tabindex: item.id === opts.selected ? "0" : "-1",
        dataset: { id: item.id },
        onclick: () => opts.onSelect(item.id),
    }, item.label));
    list.append(...tabs);
    setupRovingTabs(list, tabs, i => opts.onSelect(opts.items[i].id));
    return { el: list, tabs };
}

export interface ListboxOptions<T> {
    label: string;
    items: T[];
    key(item: T): string;
    render(item: T): Node[];
    selected: string | null;
    onSelect(key: string): void;
    empty: string;
}

export function listbox<T>(opts: ListboxOptions<T>): HTMLElement {
    if (!opts.items.length) return h("div", { class: "xc-empty" }, opts.empty);
    const list = h("div", { class: "xc-listbox", role: "listbox", "aria-label": opts.label, tabindex: "-1" });
    const keys = opts.items.map(opts.key);
    const options = opts.items.map((item, i) => h("div", {
        class: "xc-option",
        role: "option",
        tabindex: keys[i] === opts.selected ? "0" : "-1",
        "aria-selected": String(keys[i] === opts.selected),
        dataset: { key: keys[i] },
        onclick: () => opts.onSelect(keys[i]),
    }, opts.render(item)));
    list.append(...options);
    list.addEventListener("keydown", e => {
        const i = options.findIndex(o => o === document.activeElement || o.contains(document.activeElement));
        if (i < 0) return;
        let next = -1;
        if (e.key === "ArrowDown") next = Math.min(options.length - 1, i + 1);
        else if (e.key === "ArrowUp") next = Math.max(0, i - 1);
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = options.length - 1;
        if (next < 0) return;
        e.preventDefault();
        e.stopPropagation();
        opts.onSelect(keys[next]);
        queueMicrotask(() => (list.querySelector<HTMLElement>(`[data-key="${CSS.escape(keys[next])}"]`) ?? options[next]).focus());
    });
    return list;
}

export function searchBox(placeholder: string, value: string, onInput: (v: string) => void): HTMLInputElement {
    const input = h("input", { class: "xc-input xc-search", type: "search", placeholder, "aria-label": placeholder });
    input.value = value;
    input.addEventListener("input", () => onInput(input.value));
    return input;
}

export function formatTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function autoGrow(textarea: HTMLTextAreaElement) {
    const fit = () => {
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;
    };
    textarea.addEventListener("input", fit);
    queueMicrotask(fit);
}
