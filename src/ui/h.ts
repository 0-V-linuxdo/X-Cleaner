/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> | string; dataset?: Record<string, string> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
        if (value == null || value === false) continue;
        if (key === "class") el.className = String(value);
        else if (key === "style") {
            if (typeof value === "string") el.setAttribute("style", value);
            else Object.assign(el.style, value);
        } else if (key === "dataset") Object.assign(el.dataset, value);
        else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
        else if (key in el && typeof value !== "string") (el as any)[key] = value;
        else el.setAttribute(key, value === true ? "" : String(value));
    }
    append(el, children);
    return el;
}

function append(parent: Node, children: Child[]) {
    for (const child of children) {
        if (child == null || child === false) continue;
        if (Array.isArray(child)) append(parent, child);
        else parent.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
    }
}

export function svgIcon(markup: string, size = 18): HTMLElement {
    const span = h("span", { class: "xc-icon", "aria-hidden": "true" });
    const withNs = /<svg[^>]*\sxmlns=/.test(markup) ? markup : markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    const doc = new DOMParser().parseFromString(withNs, "image/svg+xml");
    const svg = doc.documentElement;
    if (svg.nodeName.toLowerCase() === "svg") {
        svg.setAttribute("width", String(size));
        svg.setAttribute("height", String(size));
        span.appendChild(document.importNode(svg, true));
    }
    return span;
}
