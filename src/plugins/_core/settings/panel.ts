/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Plugin manager modelled on Void++'s settings: a dialog with a tab sidebar, a Plugins tab with
// category tabs, search + enabled filter, a two-column card grid (required plugins after a
// separator) and a nested per-plugin settings dialog.

import { dispatch, subscribe } from "@api/Events";
import { isPluginEnabled, isReloadNeeded, plugins, setPluginEnabled } from "@api/PluginManager";
import { exportSettings, importSettings, isPinned, isStarred, PlainSettings, resetPluginSettings, settingsStore, togglePinned, toggleStarred } from "@api/Settings";
import { addLocalTheme, addThemeFromUrl, getThemes, refreshTheme, removeTheme, setQuickCss, setQuickCssEnabled, setThemeEnabled, setThemesEnabled, validateThemeUrl } from "@api/Themes";
import { renderPluginSettings, switchEl } from "@ui/fields";
import { h, svgIcon } from "@ui/h";
import { Icons } from "@ui/icons";
import { syncTheme } from "@ui/theme";
import { showToast } from "@ui/toast";
import { attachTooltip, type TooltipHandle } from "@ui/tooltip";
import { debounce, errorMessage } from "@utils/misc";
import type { Plugin, PluginTag } from "@utils/types";

export type ListFilter = "all" | "enabled" | "disabled";
export type PluginCategory = "favorites" | "recent" | "all" | PluginTag;

export const CATEGORY_TABS: readonly { id: PluginCategory; label: string }[] = [
    { id: "favorites", label: "收藏" },
    { id: "recent", label: "最近" },
    { id: "all", label: "全部" },
    { id: "replies", label: "回复" },
    { id: "filters", label: "过滤" },
    { id: "ai", label: "AI" },
    { id: "moderation", label: "拉黑" },
    { id: "timeline", label: "时间线" },
    { id: "messages", label: "私信" },
    { id: "appearance", label: "外观" },
    { id: "declutter", label: "精简" },
    { id: "privacy", label: "隐私" },
    { id: "developer", label: "开发者" },
    { id: "core", label: "核心" },
];

const FILTER_OPTIONS: readonly { value: ListFilter; label: string }[] = [
    { value: "all", label: "全部" },
    { value: "enabled", label: "已启用" },
    { value: "disabled", label: "已停用" },
];

/** Void++ NEW_PLUGIN_TTL: a plugin stays 「新」 for two days after it was first seen; viewing does not clear it. */
const RECENT_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export const isNewPlugin = (name: string) => {
    const seen = PlainSettings.core.knownPlugins[name];
    return seen != null && Date.now() - seen < RECENT_TTL_MS;
};

const visible = (p: Plugin) => !p.hidden && !(p.dev && !IS_DEV);

export function pluginMatchesCategory(p: Plugin, category: PluginCategory): boolean {
    if (category === "all" || category === "favorites") return true;
    if (category === "recent") return isNewPlugin(p.name);
    return p.tags?.includes(category) ?? false;
}

function filterByEnabled(list: string[], filter: ListFilter): string[] {
    if (filter === "all") return list;
    return list.filter(n => isPluginEnabled(n) === (filter === "enabled"));
}

function sortPinnedFirst(list: string[]): string[] {
    const rank = new Map(PlainSettings.core.pinnedPlugins.map((n, i) => [n, i]));
    if (!rank.size) return list;
    return list.toSorted((a, b) => {
        const pa = rank.has(a), pb = rank.has(b);
        if (pa !== pb) return pa ? -1 : 1;
        return pa ? rank.get(a)! - rank.get(b)! : 0;
    });
}

function emptyHint(search: string, category: PluginCategory): string {
    if (search) return "没有匹配搜索的插件。";
    if (category === "favorites") return "还没有收藏。给插件点星后会出现在这里。";
    if (category === "recent") return "最近 7 天没有新增的插件。";
    return "没有可用的插件。";
}

const matchesSearch = (name: string, q: string) => !q || `${name} ${plugins[name].description ?? ""}`.toLowerCase().includes(q.trim().toLowerCase());

/** Has a settings dialog, or a page in the drawer to jump to. */
export function hasConfig(p: Plugin): boolean {
    const hasSettings = !!p.settings && Object.values(p.settings.def as Record<string, { hidden?: boolean }>).some(s => !s.hidden);
    return hasSettings || !!p.panelPages?.length;
}

function iconButton(icon: string, label: string, onClick: () => void, className: string, tips: TooltipHandle[]): HTMLButtonElement {
    const btn = h("button", { type: "button", class: `xc-pm-icon-btn ${className}`, "aria-label": label, onclick: (e: Event) => { e.stopPropagation(); onClick(); } }, svgIcon(icon, 14));
    tips.push(attachTooltip(btn, label, "top"));
    return btn;
}

export interface CardOptions {
    tips: TooltipHandle[];
    rerender(): void;
    onConfig(p: Plugin): void;
}

/** One plugin card: icon tile, name, badges, star / pin / config / switch, two-line description, author footer. */
export function pluginCard(name: string, opts: CardOptions): HTMLElement {
    const p = plugins[name];
    const enabled = isPluginEnabled(name);
    const crashed = enabled && !p.started && !p.required;
    const starred = isStarred(name);
    const pinned = isPinned(name);
    // Soft breaks at camel-case boundaries so a long name wraps as 「Account / Blacklist」 instead of being cut off.
    const title = h("span", { class: "xc-pm-card-title" }, ...name.split(/(?<=[a-z])(?=[A-Z])/).flatMap((part, i) => (i ? [document.createElement("wbr"), part] : [part])));
    opts.tips.push(attachTooltip(title, name, "top"));
    const badges: Node[] = [];
    if (crashed) {
        const icon = h("span", { class: "xc-pm-card-badge xc-pm-card-crashed-icon" }, svgIcon(Icons.alert, 13));
        opts.tips.push(attachTooltip(icon, p.startError ? `该插件启动失败：${p.startError}` : "该插件启动失败", "top"));
        badges.push(icon);
    }
    if (p.healthWarnings?.length) {
        const icon = h("span", { class: "xc-pm-card-badge xc-pm-card-health-icon" }, svgIcon(Icons.heartPulse, 13));
        opts.tips.push(attachTooltip(icon, `X 页面上找不到：${p.healthWarnings.join("、")}`, "top"));
        badges.push(icon);
    }
    if (p.required) {
        const icon = h("span", { class: "xc-pm-card-badge" }, svgIcon(Icons.info, 13));
        opts.tips.push(attachTooltip(icon, "X Cleaner 运行必需的插件", "top"));
        badges.push(icon);
    }
    if (isNewPlugin(name)) badges.push(h("span", { class: "xc-pm-badge-accent" }, "新"));

    const controls: Node[] = [
        iconButton(starred ? Icons.starFilled : Icons.star, starred ? "取消收藏" : "收藏", () => { toggleStarred(name); opts.rerender(); }, `xc-pm-star${starred ? " is-active" : ""}`, opts.tips),
    ];
    if (!p.required) controls.push(iconButton(pinned ? Icons.pinFilled : Icons.pin, pinned ? "取消置顶" : "置顶", () => { togglePinned(name); opts.rerender(); }, `xc-pm-pin${pinned ? " is-active" : ""}`, opts.tips));
    if (hasConfig(p)) controls.push(iconButton(Icons.sliders, "配置", () => opts.onConfig(p), "xc-pm-config", opts.tips));
    controls.push(switchEl(enabled, v => {
        if (!setPluginEnabled(name, v)) showToast(`${name} ${v ? "启动" : "停止"}失败，详见控制台。`, { type: "error" });
        opts.rerender();
    }, `启用 ${name}`, !!p.required));

    return h("div", { class: `xc-pm-card${p.required ? " is-required" : ""}${crashed ? " is-crashed" : ""}`, dataset: { plugin: name, enabled: String(enabled) } },
        h("div", { class: "xc-pm-card-body" },
            h("div", { class: "xc-pm-card-head" },
                h("div", { class: "xc-pm-card-name" }, h("span", { class: "xc-pm-card-icon" }, svgIcon(p.icon ?? Icons.unplug, 14)), title, badges),
                h("div", { class: "xc-pm-card-controls" }, controls),
            ),
            p.description ? h("div", { class: "xc-pm-card-desc" }, p.description) : null,
            crashed && p.startError ? h("div", { class: "xc-pm-card-error" }, `启动失败：${p.startError}`) : null,
        ),
        h("div", { class: "xc-pm-card-sep" }),
        h("div", { class: "xc-pm-card-footer" }, h("span", { class: "xc-pm-card-author" }, p.authors?.join(", ") || "X Cleaner Contributors")),
    );
}

/** Void++'s reload banner: shown once any change needs a page reload to apply. Re-renders itself on reloadNeeded. */
export function reloadBanner(): { el: HTMLElement; dispose(): void } {
    const el = h("div", { class: "xc-pm-reload", role: "status" },
        h("span", null, "部分改动需要刷新页面后才会生效。"),
        h("button", { type: "button", class: "xc-btn xc-btn-sm", onclick: () => location.reload() }, "刷新"),
    );
    const sync = () => { el.hidden = !isReloadNeeded(); };
    sync();
    return { el, dispose: subscribe("reloadNeeded", sync) };
}

/** Search box plus the 全部 / 已启用 / 已停用 select. */
export function searchFilterBar(placeholder: string, onSearch: (v: string) => void, onFilter: (v: ListFilter) => void) {
    const input = h("input", { class: "xc-input xc-pm-search", type: "text", placeholder, "aria-label": "搜索插件" });
    const select = h("select", { class: "xc-select xc-pm-filter", "aria-label": "按状态筛选" }, FILTER_OPTIONS.map(o => h("option", { value: o.value }, o.label)));
    input.addEventListener("input", () => onSearch(input.value));
    select.addEventListener("change", () => onFilter(select.value as ListFilter));
    return { el: h("div", { class: "xc-pm-searchbar" }, input, select), input };
}

// ---------- nested per-plugin dialog ----------

function openLayer(content: HTMLElement, label: string, nested: boolean, onClose: () => void) {
    syncTheme();
    const overlay = h("div", { class: `xc-root xc-pm-overlay${nested ? " is-nested" : ""}` }, content);
    content.setAttribute("role", "dialog");
    content.setAttribute("aria-modal", "true");
    content.setAttribute("aria-label", label);
    const close = () => {
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        onClose();
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || overlay !== [...document.querySelectorAll(".xc-pm-overlay")].at(-1)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
    };
    overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); });
    content.addEventListener("keydown", e => { if (e.key !== "Escape") e.stopPropagation(); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    return close;
}

function closeButton(onClick: () => void): HTMLButtonElement {
    return h("button", { type: "button", class: "xc-pm-icon-btn xc-pm-close", "aria-label": "关闭", onclick: onClick }, svgIcon(Icons.close, 16));
}

export function openPluginSettings(plugin: Plugin, nested = true): () => void {
    let close = () => {};
    const content = h("div", { class: "xc-pm-dialog" });
    const render = () => {
        content.replaceChildren(...[
            closeButton(() => close()),
            h("div", { class: "xc-pm-dialog-header" }, h("h2", { class: "xc-pm-dialog-title" }, plugin.name), h("p", { class: "xc-pm-dialog-sub" }, plugin.description)),
            h("div", { class: "xc-pm-sep" }),
            plugin.authors?.length ? h("div", { class: "xc-pm-field" }, h("span", { class: "xc-pm-field-label" }, "作者"), h("p", null, plugin.authors.join(", "))) : null,
            h("div", { class: "xc-pm-field xc-pm-dialog-settings" },
                h("span", { class: "xc-pm-field-label" }, "设置"),
                plugin.settings ? renderPluginSettings(plugin.settings) : h("p", { class: "xc-muted" }, "没有可配置的设置。"),
            ),
            plugin.settings ? h("div", { class: "xc-pm-dialog-footer" }, h("button", {
                type: "button", class: "xc-btn xc-btn-sm",
                onclick: () => {
                    if (!confirm("将该插件的设置恢复为默认值？此操作无法撤销。")) return;
                    resetPluginSettings(plugin.name);
                    render();
                },
            }, "重置")) : null,
        ].filter((n): n is NonNullable<typeof n> => !!n));
    };
    render();
    close = openLayer(content, plugin.name, nested, () => {});
    return close;
}

// ---------- the main dialog ----------

interface SettingsTab {
    id: string;
    name: string;
    icon: string;
    description?: string;
    render(ctx: { close(): void }): { el: HTMLElement; dispose?(): void };
}

function pluginsTab(ctx: { close(): void }, initialPlugin?: string) {
    let category: PluginCategory = initialPlugin ? "all" : "favorites";
    let filter: ListFilter = "all";
    let search = "";
    let tips: TooltipHandle[] = [];
    const all = Object.keys(plugins).filter(n => visible(plugins[n])).sort((a, b) => a.localeCompare(b));
    const userPlugins = all.filter(n => !plugins[n].required);
    const requiredPlugins = all.filter(n => plugins[n].required);
    const tabsEl = h("div", { class: "xc-pm-tabs", role: "tablist", "aria-label": "插件分类" });
    const list = h("div", { class: "xc-pm-list" });
    const bar = searchFilterBar("", v => { search = v; render(); }, v => { filter = v; render(); });

    const onConfig = (p: Plugin) => {
        if (p.settings && Object.values(p.settings.def as Record<string, { hidden?: boolean }>).some(s => !s.hidden)) {
            openPluginSettings(p);
            return;
        }
        const page = p.panelPages?.[0];
        if (!page) return;
        ctx.close();
        dispatch("panelOpen", { tab: page.tab, page: page.id });
    };

    const grid = (names: string[]) => h("div", { class: "xc-pm-grid" }, names.map(n => pluginCard(n, { tips, rerender: render, onConfig })));

    function render() {
        for (const t of tips) t.destroy();
        tips = [];
        const visibleTabs = CATEGORY_TABS.filter(t => t.id === "favorites" || t.id === "all" || t.id === "recent" || all.some(n => pluginMatchesCategory(plugins[n], t.id)));
        tabsEl.replaceChildren(...visibleTabs.map(t => h("button", {
            type: "button", role: "tab", class: `xc-pm-tab${t.id === category ? " is-active" : ""}`, "aria-selected": String(t.id === category),
            onclick: () => { category = t.id; render(); },
        }, t.label)));

        let tabUser: string[];
        let tabRequired: string[] = [];
        if (category === "favorites") tabUser = filterByEnabled(PlainSettings.core.starredPlugins.filter(n => plugins[n] && visible(plugins[n])), filter);
        else if (category === "recent") tabUser = filterByEnabled(all.filter(n => isNewPlugin(n)), filter);
        else if (category === "all") {
            tabUser = sortPinnedFirst(filterByEnabled(userPlugins, filter));
            tabRequired = filterByEnabled(requiredPlugins, filter);
        } else tabUser = sortPinnedFirst(filterByEnabled(all.filter(n => pluginMatchesCategory(plugins[n], category)), filter));

        bar.input.placeholder = `搜索 ${tabUser.length + tabRequired.length} 个插件...`;
        const shownUser = tabUser.filter(n => matchesSearch(n, search));
        const shownRequired = tabRequired.filter(n => matchesSearch(n, search));
        const children: Node[] = [];
        if (shownUser.length) children.push(grid(shownUser));
        if (shownRequired.length) children.push(h("div", { class: "xc-pm-sep" }), grid(shownRequired));
        if (!children.length) children.push(h("p", { class: "xc-pm-empty" }, emptyHint(search, category)));
        const scroll = list.scrollTop;
        list.replaceChildren(...children);
        list.scrollTop = scroll;
    }

    const banner = reloadBanner();
    const offs = [subscribe("pluginToggle", render), subscribe("healthChange", render), banner.dispose];
    render();
    if (initialPlugin && plugins[initialPlugin]) queueMicrotask(() => onConfig(plugins[initialPlugin]));
    return {
        el: h("div", { class: "xc-pm-tab-root" }, banner.el, tabsEl, bar.el, list),
        dispose() {
            for (const off of offs) off();
            for (const t of tips) t.destroy();
        },
    };
}

function backupTab() {
    const fileInput = h("input", { type: "file", accept: "application/json,.json", hidden: true });
    fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const ok = importSettings(await file.text());
        showToast(ok ? "插件设置已导入，刷新页面后全部生效。" : "该文件不是 X Cleaner 插件设置备份。", { type: ok ? "success" : "error", action: ok ? { label: "刷新", onClick: () => location.reload() } : undefined });
        fileInput.value = "";
    });
    const exportBtn = h("button", {
        type: "button", class: "xc-btn xc-btn-sm",
        onclick: () => {
            const url = URL.createObjectURL(new Blob([exportSettings()], { type: "application/json" }));
            h("a", { href: url, download: `x-cleaner-settings-${new Date().toISOString().slice(0, 10)}.json` }).click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
    }, "导出");
    return {
        el: h("div", { class: "xc-pm-tab-root" },
            h("div", { class: "xc-pm-row" },
                h("div", { class: "xc-pm-row-body" }, h("strong", null, "插件设置"), h("span", { class: "xc-muted" }, "导出或导入各插件的开关、收藏、置顶、插件设置、主题和快速 CSS。回复屏蔽的名单与规则在面板「设置 → 导入」里单独导入导出。")),
                h("div", { class: "xc-pm-row-actions" }, h("button", { type: "button", class: "xc-btn xc-btn-sm", onclick: () => fileInput.click() }, "导入"), exportBtn),
            ),
            fileInput,
        ),
    };
}

// ---------- themes and Quick CSS (Void++ ThemesTab / CustomCSSTab) ----------

function themesTab() {
    let tips: TooltipHandle[] = [];
    const list = h("div", { class: "xc-pm-themes" });
    const error = h("div", { class: "xc-field-error", hidden: true });
    const urlInput = h("input", { class: "xc-input", type: "url", placeholder: "https://example.com/theme.css", "aria-label": "主题地址" });
    const addBtn = h("button", { type: "button", class: "xc-btn xc-btn-sm xc-btn-primary" }, "添加");
    const fileInput = h("input", { type: "file", accept: "text/css,.css", hidden: true });
    const master = switchEl(PlainSettings.core.themesEnabled, v => setThemesEnabled(v), "启用主题");
    const fail = (msg: string | null) => { error.textContent = msg ?? ""; error.hidden = !msg; };

    const add = async () => {
        const invalid = validateThemeUrl(urlInput.value);
        if (invalid) return fail(invalid);
        fail(null);
        addBtn.disabled = true;
        try {
            const t = await addThemeFromUrl(urlInput.value);
            urlInput.value = "";
            showToast(`已添加主题「${t.name}」。`, { type: "success" });
        } catch (e) { fail(errorMessage(e)); } finally { addBtn.disabled = false; }
    };
    addBtn.addEventListener("click", add);
    urlInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    fileInput.addEventListener("change", async () => {
        for (const file of fileInput.files ?? []) addLocalTheme(file.name, await file.text());
        fileInput.value = "";
    });

    function render() {
        for (const t of tips) t.destroy();
        tips = [];
        master.setAttribute("aria-checked", String(PlainSettings.core.themesEnabled));
        const themes = getThemes();
        if (!themes.length) {
            list.replaceChildren(h("p", { class: "xc-pm-empty" }, "还没有主题。粘贴一个 CSS 主题地址，或导入本地 .css 文件。"));
            return;
        }
        list.replaceChildren(...themes.map(t => {
            const controls: Node[] = [];
            if (t.url) controls.push(iconButton(Icons.refresh, "重新下载", async () => {
                try { await refreshTheme(t.id); showToast(`主题「${t.name}」已更新。`, { type: "success" }); } catch (e) { showToast(errorMessage(e), { type: "error" }); }
            }, "xc-pm-theme-refresh", tips));
            controls.push(iconButton(Icons.trash, "删除", () => {
                if (confirm(`删除主题「${t.name}」？`)) removeTheme(t.id);
            }, "xc-pm-theme-delete", tips));
            controls.push(switchEl(t.enabled, v => setThemeEnabled(t.id, v), `启用 ${t.name}`));
            return h("div", { class: "xc-pm-card xc-pm-theme", dataset: { theme: t.id } },
                h("div", { class: "xc-pm-card-body" },
                    h("div", { class: "xc-pm-card-head" },
                        h("div", { class: "xc-pm-card-name" }, h("span", { class: "xc-pm-card-icon" }, svgIcon(t.url ? Icons.link : Icons.palette, 14)), h("span", { class: "xc-pm-card-title" }, t.name)),
                        h("div", { class: "xc-pm-card-controls" }, controls),
                    ),
                    t.description ? h("div", { class: "xc-pm-card-desc" }, t.description) : null,
                ),
                h("div", { class: "xc-pm-card-sep" }),
                h("div", { class: "xc-pm-card-footer" }, h("span", { class: "xc-pm-card-author" }, [t.author || (t.url ? new URL(t.url).hostname : "本地文件"), `更新于 ${new Date(t.updatedAt).toLocaleDateString()}`].join(" · "))),
            );
        }));
    }

    const offs = [settingsStore.addPrefixChangeListener("core.themes", render), settingsStore.addPrefixChangeListener("core.themesEnabled", render)];
    render();
    return {
        el: h("div", { class: "xc-pm-tab-root" },
            h("div", { class: "xc-pm-row" },
                h("div", { class: "xc-pm-row-body" }, h("strong", null, "启用主题"), h("span", { class: "xc-muted" }, "关闭后所有主题暂停生效，列表和开关会保留。")),
                h("div", { class: "xc-pm-row-actions" }, master),
            ),
            h("div", { class: "xc-pm-theme-add" }, urlInput, addBtn, h("button", { type: "button", class: "xc-btn xc-btn-sm", onclick: () => fileInput.click() }, "导入文件"), fileInput),
            error,
            h("p", { class: "xc-muted xc-pm-theme-hint" }, "主题就是 CSS 文件，文件开头的 @name、@author、@description 注释会显示在卡片上。远程主题只在添加或点「重新下载」时联网。"),
            list,
        ),
        dispose() {
            for (const off of offs) off();
            for (const t of tips) t.destroy();
        },
    };
}

function quickCssTab() {
    const editor = h("textarea", { class: "xc-textarea xc-pm-css-editor", spellcheck: false, placeholder: "/* 在这里写 CSS，输入后立即生效 */\n[data-testid=\"sidebarColumn\"] { display: none; }", "aria-label": "快速 CSS" });
    editor.value = PlainSettings.core.quickCss;
    const save = debounce(() => setQuickCss(editor.value), 300);
    editor.addEventListener("input", save);
    editor.addEventListener("keydown", e => {
        if (e.key !== "Tab") return;
        e.preventDefault();
        editor.setRangeText("    ", editor.selectionStart, editor.selectionEnd, "end");
        save();
    });
    return {
        el: h("div", { class: "xc-pm-tab-root" },
            h("div", { class: "xc-pm-row" },
                h("div", { class: "xc-pm-row-body" }, h("strong", null, "启用快速 CSS"), h("span", { class: "xc-muted" }, "在所有主题之后加载，所以同名规则以这里为准。")),
                h("div", { class: "xc-pm-row-actions" }, switchEl(PlainSettings.core.quickCssEnabled, v => setQuickCssEnabled(v), "启用快速 CSS")),
            ),
            editor,
        ),
        dispose() {
            save.cancel();
            if (editor.value !== PlainSettings.core.quickCss) setQuickCss(editor.value);
        },
    };
}

const TABS: SettingsTab[] = [
    { id: "plugins", name: "插件", icon: Icons.unplug, description: "开关功能。点击滑杆图标进入配置。", render: ctx => pluginsTab(ctx) },
    { id: "themes", name: "主题", icon: Icons.palette, description: "从网址或本地 .css 文件添加主题，每个主题单独开关。", render: () => themesTab() },
    { id: "quickCss", name: "快速 CSS", icon: Icons.braces, description: "直接写 CSS 改 X 的样式，输入后立即生效，不需要刷新。", render: () => quickCssTab() },
    { id: "backup", name: "备份", icon: Icons.archive, render: () => backupTab() },
];

let closeCurrent: (() => void) | null = null;

export function openSettingsPanel(options: { tab?: string; plugin?: string } = {}): () => void {
    closeCurrent?.();
    let current: { el: HTMLElement; dispose?(): void } | null = null;
    let activeId = options.tab ?? "plugins";
    const nav = h("nav", { class: "xc-pm-nav", "aria-label": "X Cleaner 设置" });
    const heading = h("h2", { class: "xc-pm-title" });
    const hint = h("span", { class: "xc-pm-hint", tabindex: "0" }, svgIcon(Icons.info, 14));
    const hintTip = attachTooltip(hint, () => TABS.find(t => t.id === activeId)?.description ?? "", "bottom");
    const body = h("div", { class: "xc-pm-body" });
    const version = h("div", { class: "xc-pm-version" },
        h("div", null, "X Cleaner · ", VERSION),
        h("div", null, IS_DEV ? "开发版" : "正式版", " · 用户脚本"),
        // Opening the script URL makes the script manager compare versions and offer the update.
        h("div", null,
            h("a", { href: DOWNLOAD_URL, target: "_blank", rel: "noopener" }, "检查更新"), " · ",
            h("a", { href: `${REPO_URL}/commits/main`, target: "_blank", rel: "noopener" }, "更新记录")),
    );
    const content = h("div", { class: "xc-pm-shell" },
        h("aside", { class: "xc-pm-sidebar" }, nav, version),
        h("section", { class: "xc-pm-main" }, h("header", { class: "xc-pm-header" }, heading, hint, closeButton(() => close())), body),
    );

    const show = (id: string, plugin?: string) => {
        activeId = id;
        current?.dispose?.();
        const tab = TABS.find(t => t.id === id) ?? TABS[0];
        heading.textContent = tab.name;
        hint.hidden = !tab.description;
        current = tab.id === "plugins" ? pluginsTab({ close: () => close() }, plugin) : tab.render({ close: () => close() });
        body.replaceChildren(current.el);
        nav.replaceChildren(...TABS.map(t => h("button", {
            type: "button", class: `xc-pm-nav-item${t.id === id ? " is-active" : ""}`, "aria-current": t.id === id ? "page" : null,
            onclick: () => show(t.id),
        }, svgIcon(t.icon, 16), h("span", null, t.name))));
    };

    const close = openLayer(content, "X Cleaner 设置", false, () => {
        current?.dispose?.();
        hintTip.destroy();
        closeCurrent = null;
    });
    closeCurrent = close;
    show(activeId, options.plugin);
    queueMicrotask(() => content.querySelector<HTMLInputElement>(".xc-pm-search")?.focus());
    return close;
}
