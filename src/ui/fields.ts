/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { markReloadNeeded } from "@api/PluginManager";
import { type DefinedSettings, OptionType, type SettingDef } from "@utils/types";

import { h, svgIcon } from "./h";
import { Icons } from "./icons";

export function switchEl(checked: boolean, onChange: (v: boolean) => void, label?: string, disabled = false): HTMLButtonElement {
    const el = h("button", { class: "xc-switch", role: "switch", "aria-checked": String(checked), "aria-label": label, title: label, disabled, type: "button" });
    el.addEventListener("click", e => {
        e.stopPropagation();
        const next = el.getAttribute("aria-checked") !== "true";
        el.setAttribute("aria-checked", String(next));
        onChange(next);
    });
    return el;
}

export function listEditor(values: string[], onChange: (v: string[]) => void, opts: { placeholder?: string; isValid?(v: string): true | string } = {}): HTMLElement {
    let list = [...values];
    const items = h("div", { class: "xc-list-items" });
    const error = h("div", { class: "xc-field-error", hidden: true });
    const input = h("input", { class: "xc-input", placeholder: opts.placeholder ?? "Add an item and press Enter" });
    const render = () => {
        items.replaceChildren(...list.map((v, i) => h("span", { class: "xc-chip", title: v },
            h("span", null, v),
            h("button", { type: "button", "aria-label": `Remove ${v}`, onclick: () => { list = list.filter((_, j) => j !== i); onChange(list); render(); } }, svgIcon(Icons.close, 14)),
        )));
    };
    const add = () => {
        const parts = input.value.split("\n").map(s => s.trim()).filter(Boolean);
        for (const value of parts) {
            const valid = opts.isValid?.(value) ?? true;
            if (valid !== true) {
                error.textContent = valid;
                error.hidden = false;
                return;
            }
        }
        error.hidden = true;
        const fresh = parts.filter(p => !list.includes(p));
        if (!fresh.length) return;
        list = [...list, ...fresh];
        input.value = "";
        onChange(list);
        render();
    };
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    render();
    return h("div", { class: "xc-list-editor" }, items, h("div", { class: "xc-field-row" }, input, h("button", { class: "xc-btn xc-btn-sm", type: "button", onclick: add }, "Add")), error);
}

function control(key: string, def: SettingDef, settings: DefinedSettings, onError: (msg: string | null) => void): HTMLElement {
    const store = settings.store as Record<string, any>;
    const set = (value: unknown) => {
        store[key] = value;
        def.onChange?.(value);
        if (def.restartNeeded) markReloadNeeded(settings.pluginName);
    };
    const disabled = def.disabled?.() ?? false;
    switch (def.type) {
        case OptionType.BOOLEAN:
            return switchEl(!!store[key], set, def.label ?? key, disabled);
        case OptionType.STRING: {
            const input = def.multiline
                ? h("textarea", { class: "xc-textarea", placeholder: def.placeholder, disabled })
                : h("input", { class: "xc-input", type: def.secret ? "password" : "text", placeholder: def.placeholder, disabled, autocomplete: "off" });
            input.value = store[key] ?? "";
            input.addEventListener("change", () => {
                const valid = def.isValid?.(input.value) ?? true;
                onError(valid === true ? null : valid);
                if (valid === true) set(input.value);
            });
            return input;
        }
        case OptionType.NUMBER: {
            const input = h("input", { class: "xc-input", type: "number", min: def.min, max: def.max, step: def.step, disabled, style: "max-width:140px" });
            input.value = String(store[key] ?? "");
            input.addEventListener("change", () => {
                const n = Number(input.value);
                const ok = input.value !== "" && Number.isFinite(n) && (def.min == null || n >= def.min) && (def.max == null || n <= def.max);
                onError(ok ? null : "Invalid number");
                if (ok) set(n);
            });
            return input;
        }
        case OptionType.SLIDER: {
            const out = h("span", { class: "xc-badge" });
            const input = h("input", { type: "range", min: def.min, max: def.max, step: def.step ?? 1, disabled });
            input.value = String(store[key]);
            const sync = () => { out.textContent = `${input.value}${def.unit ?? ""}`; };
            input.addEventListener("input", sync);
            input.addEventListener("change", () => set(Number(input.value)));
            sync();
            return h("div", { class: "xc-slider" }, input, out);
        }
        case OptionType.SELECT: {
            const select = h("select", { class: "xc-select", disabled, style: "max-width:240px" },
                def.options.map(o => h("option", { value: String(o.value) }, o.label)));
            select.value = String(store[key]);
            select.addEventListener("change", () => set(def.options.find(o => String(o.value) === select.value)?.value));
            return select;
        }
        case OptionType.LIST:
            return listEditor(store[key] ?? [], v => set(v), { placeholder: def.itemPlaceholder, isValid: def.isValid });
        case OptionType.CUSTOM:
            return def.render({ get: () => store[key], set, pluginName: settings.pluginName });
    }
}

export function renderSettingField(key: string, def: SettingDef, settings: DefinedSettings): HTMLElement {
    const error = h("div", { class: "xc-field-error", hidden: true });
    const ctrl = control(key, def, settings, msg => { error.textContent = msg ?? ""; error.hidden = !msg; });
    const inline = def.type === OptionType.BOOLEAN || def.type === OptionType.SELECT || def.type === OptionType.NUMBER;
    const label = h("div", null,
        h("div", { class: "xc-field-label" }, def.label ?? key, def.restartNeeded ? h("span", { class: "xc-badge", style: "margin-left:6px" }, "需刷新") : null),
        def.description ? h("div", { class: "xc-field-desc" }, def.description) : null,
    );
    return h("div", { class: "xc-field", dataset: { key } },
        inline ? h("div", { class: "xc-field-row" }, label, ctrl) : [label, ctrl],
        error,
    );
}

export function renderPluginSettings(settings: DefinedSettings): HTMLElement {
    const fields = Object.entries(settings.def).filter(([, d]) => !d.hidden).map(([k, d]) => renderSettingField(k, d, settings));
    return h("div", { class: "xc-fields" }, fields);
}
