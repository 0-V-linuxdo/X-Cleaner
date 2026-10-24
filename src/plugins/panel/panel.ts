/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { subscribe } from "@api/Events";
import type { ConfigStore } from "@config/store";
import { h, svgIcon } from "@ui/h";
import { Icons } from "@ui/icons";
import { syncTheme } from "@ui/theme";
import { showToast } from "@ui/toast";
import { attachTooltip, type TooltipHandle } from "@ui/tooltip";
import { t } from "@utils/i18n";
import { Logger } from "@utils/Logger";
import { isRendered, OWNED_ATTR, SEL } from "@x/dom";
import { parseRoute } from "@x/route";

import { tabBar } from "./components";
import type { PageInstance, PanelContext, PanelPageDef, PanelTabDef } from "./types";

const logger = new Logger("Panel");

export const HOST_ID = "x-cleaner-ui";

const shield = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m4.5 4.5 15 15"/></svg>';

export class Panel {
    readonly tabs = new Map<string, PanelTabDef>();
    readonly pages = new Map<string, PanelPageDef>();
    private instances = new Map<string, PageInstance>();
    private host: HTMLElement;
    private fab: HTMLButtonElement;
    private badge: HTMLElement;
    private overlay: HTMLElement;
    private drawer: HTMLElement;
    private tabArea: HTMLElement;
    private subTabArea: HTMLElement;
    private content: HTMLElement;
    private footer: HTMLElement;
    private fabTip: TooltipHandle;
    private currentTab = "review";
    private subSelection = new Map<string, string>();
    private open = false;
    private yielding = false;
    private observedLayers: HTMLElement | null = null;
    private count = 0;
    private offs: Array<() => void> = [];
    private layersObserver: MutationObserver | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private routeTimer: ReturnType<typeof setInterval> | undefined;
    private returnFocus: HTMLElement | null = null;
    readonly ctx: PanelContext;

    constructor(private store: ConfigStore) {
        this.ctx = {
            store,
            commit: mutator => {
                try {
                    store.update(mutator);
                    return true;
                } catch (e) {
                    logger.error("Commit failed", e);
                    showToast(t("保存设置失败。"), { type: "error" });
                    return false;
                }
            },
            refresh: () => this.refresh(),
            close: () => this.close(),
        };
        this.badge = h("span", { class: "xc-fab-badge", hidden: true });
        this.fab = h("button", { class: "xc-fab", type: "button", onclick: () => this.show() }, svgIcon(shield, 28), this.badge);
        this.fabTip = attachTooltip(this.fab, () => t("X Cleaner · {count} 条待复查", { count: this.count }), "left");
        this.tabArea = h("div", { class: "xc-drawer-tabs" });
        this.subTabArea = h("div", { class: "xc-drawer-subtabs" });
        this.content = h("div", { class: "xc-drawer-content", role: "tabpanel" });
        this.footer = h("div", { class: "xc-drawer-footer", hidden: true });
        this.drawer = h("section", { class: "xc-drawer", role: "dialog", "aria-modal": "true", "aria-label": "X Cleaner" },
            h("header", { class: "xc-drawer-head" },
                h("h2", { class: "xc-drawer-title" }, "X Cleaner"),
                h("button", { class: "xc-btn xc-btn-icon xc-drawer-close", type: "button", "aria-label": t("关闭"), onclick: () => this.close() }, svgIcon(Icons.close, 20)),
            ),
            this.tabArea, this.subTabArea, this.content, this.footer,
        );
        this.overlay = h("div", { class: "xc-drawer-overlay", hidden: true }, this.drawer);
        this.overlay.addEventListener("mousedown", e => { if (e.target === this.overlay) this.close(); });
        this.overlay.addEventListener("keydown", e => this.onKey(e));
        (this.overlay as HTMLElement & { inert: boolean }).inert = true;
        this.host = h("div", { id: HOST_ID, class: "xc-root", [OWNED_ATTR]: "", "data-active": "false" }, this.fab, this.overlay);
    }

    mount() {
        if (!this.host.isConnected) document.body.appendChild(this.host);
        this.updateActive();
        this.watchGrok();
        this.routeTimer = setInterval(() => {
            if (!this.host.isConnected && document.body) document.body.appendChild(this.host);
            this.updateActive();
        }, 500);
        this.offs.push(subscribe("navigate", () => this.updateActive()));
        this.offs.push(this.store.subscribe(() => this.refresh()));
        this.updateFab();
    }

    destroy() {
        for (const off of this.offs) off();
        this.offs = [];
        clearInterval(this.routeTimer);
        this.layersObserver?.disconnect();
        this.resizeObserver?.disconnect();
        for (const inst of this.instances.values()) inst.dispose?.();
        this.instances.clear();
        this.fabTip.destroy();
        this.host.remove();
    }

    setCount(n: number) {
        this.count = n;
        this.updateFab();
    }

    private updateFab() {
        this.badge.hidden = this.count <= 0;
        this.badge.textContent = this.count > 99 ? "99+" : String(this.count);
        this.fab.setAttribute("aria-label", t("X Cleaner，{count} 条待复查", { count: this.count }));
        this.fabTip.refresh();
    }

    private updateActive() {
        this.host.dataset.active = String(parseRoute().isStatusRoute);
    }

    private watchGrok() {
        const check = () => {
            const drawer = document.querySelector<HTMLElement>(SEL.grokDrawer);
            let overlap = false;
            if (drawer && isRendered(drawer)) {
                const a = drawer.getBoundingClientRect();
                const b = this.fab.getBoundingClientRect();
                overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
            }
            if (overlap === this.yielding) return;
            this.yielding = overlap;
            this.fab.classList.toggle("xc-fab-yield", overlap);
            if (overlap) {
                this.fab.setAttribute("aria-hidden", "true");
                this.fab.tabIndex = -1;
            } else {
                this.fab.removeAttribute("aria-hidden");
                this.fab.removeAttribute("tabindex");
            }
        };
        const attach = () => {
            const layers = document.getElementById("layers");
            this.observedLayers = layers;
            this.layersObserver?.disconnect();
            this.layersObserver = new MutationObserver(() => {
                if (document.getElementById("layers") !== this.observedLayers) attach();
                else check();
            });
            if (layers) this.layersObserver.observe(layers, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden"] });
            if (typeof ResizeObserver === "function") {
                this.resizeObserver?.disconnect();
                this.resizeObserver = new ResizeObserver(check);
                if (layers) this.resizeObserver.observe(layers);
            }
            check();
        };
        attach();
        addEventListener("resize", check, { passive: true });
        this.offs.push(() => removeEventListener("resize", check));
        const poll = setInterval(() => { if (document.getElementById("layers") !== this.observedLayers) attach(); else check(); }, 1500);
        this.offs.push(() => clearInterval(poll));
    }

    private pagesOf(tab: string): PanelPageDef[] {
        return [...this.pages.values()].filter(p => p.tab === tab).sort((a, b) => a.order - b.order);
    }

    private visibleTabs(): PanelTabDef[] {
        return [...this.tabs.values()].filter(t => this.pagesOf(t.id).length).sort((a, b) => a.order - b.order);
    }

    private instanceFor(def: PanelPageDef): PageInstance {
        const key = `${def.tab}/${def.id}`;
        let inst = this.instances.get(key);
        if (!inst) {
            inst = def.create(this.ctx);
            this.instances.set(key, inst);
        }
        return inst;
    }

    removePage(tab: string, id: string) {
        const key = `${tab}/${id}`;
        this.instances.get(key)?.dispose?.();
        this.instances.delete(key);
        this.pages.delete(key);
        if (this.open) this.render();
    }

    show(tab?: string, page?: string) {
        syncTheme();
        if (tab) this.currentTab = tab;
        if (tab && page) this.subSelection.set(tab, page);
        if (!this.open) this.returnFocus = document.activeElement as HTMLElement | null;
        this.open = true;
        this.overlay.hidden = false;
        (this.overlay as HTMLElement & { inert: boolean }).inert = false;
        document.documentElement.classList.add("xc-drawer-open");
        this.render(true);
        queueMicrotask(() => this.drawer.querySelector<HTMLElement>(".xc-drawer-close")?.focus());
    }

    close() {
        if (!this.open) return;
        this.open = false;
        this.overlay.hidden = true;
        (this.overlay as HTMLElement & { inert: boolean }).inert = true;
        document.documentElement.classList.remove("xc-drawer-open");
        const target = this.host.dataset.active === "true" ? this.fab : this.returnFocus;
        target?.focus?.();
    }

    rerenderIfOpen() {
        if (this.open) this.render();
    }

    get isOpen() {
        return this.open;
    }

    refresh() {
        if (!this.open) return;
        const def = this.currentPage();
        if (def) {
            const inst = this.instanceFor(def);
            inst.update?.();
            this.syncFooter(inst);
        }
    }

    private currentPage(): PanelPageDef | null {
        const tabs = this.visibleTabs();
        if (!tabs.some(t => t.id === this.currentTab)) this.currentTab = tabs[0]?.id ?? "";
        const pages = this.pagesOf(this.currentTab);
        const chosen = this.subSelection.get(this.currentTab);
        return pages.find(p => p.id === chosen) ?? pages.find(p => p.isDefault) ?? pages[0] ?? null;
    }

    private syncFooter(inst: PageInstance) {
        const footer = inst.footer ?? null;
        this.footer.hidden = !footer || footer.hidden;
        if (footer && this.footer.firstChild !== footer) this.footer.replaceChildren(footer);
        if (!footer) this.footer.replaceChildren();
    }

    render(showing = false) {
        const tabs = this.visibleTabs();
        const def = this.currentPage();
        const bar = tabBar({ label: t("主标签"), items: tabs.map(tab => ({ id: tab.id, label: t(tab.label), panelId: "xc-drawer-content" })), selected: this.currentTab, className: "xc-tabs xc-main-tabs", onSelect: id => { this.currentTab = id; this.render(true); this.tabArea.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus(); } });
        this.tabArea.replaceChildren(bar.el);
        const pages = this.pagesOf(this.currentTab);
        if (pages.length > 1 && def) {
            const label = this.currentTab === "blacklist" ? t("黑名单类型") : this.currentTab === "settings" ? t("设置类型") : t("子标签");
            const sub = tabBar({ label, items: pages.map(p => ({ id: p.id, label: t(p.label) })), selected: def.id, className: "xc-tabs xc-sub-tabs", onSelect: id => { this.subSelection.set(this.currentTab, id); this.render(true); this.subTabArea.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus(); } });
            this.subTabArea.replaceChildren(sub.el);
            this.subTabArea.hidden = false;
        } else {
            this.subTabArea.replaceChildren();
            this.subTabArea.hidden = true;
        }
        this.content.id = "xc-drawer-content";
        if (!def) {
            this.content.replaceChildren(h("div", { class: "xc-empty" }, t("没有可用的页面。")));
            this.syncFooter({ el: this.content });
            return;
        }
        const inst = this.instanceFor(def);
        if (this.content.firstChild !== inst.el) this.content.replaceChildren(inst.el);
        if (showing) inst.onShow?.();
        inst.update?.();
        this.syncFooter(inst);
    }

    private onKey(e: KeyboardEvent) {
        e.stopPropagation();
        if (e.key === "Escape") {
            e.preventDefault();
            this.close();
        }
    }
}
