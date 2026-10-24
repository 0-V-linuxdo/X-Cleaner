/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ConfigStore } from "@config/store";
import type { HiddenRecord } from "@filter/types";

export interface PanelContext {
    store: ConfigStore;
    commit(mutator: Parameters<ConfigStore["update"]>[0]): boolean;
    refresh(): void;
    close(): void;
}

export interface PageInstance {
    el: HTMLElement;
    footer?: HTMLElement | null;
    update?(): void;
    onShow?(): void;
    dispose?(): void;
}

export interface PanelTabDef {
    id: string;
    label: string;
    order: number;
}

export interface PanelPageDef {
    tab: string;
    id: string;
    label: string;
    order: number;
    isDefault?: boolean;
    create(ctx: PanelContext): PageInstance;
}

export interface ReviewAction {
    id: string;
    order: number;
    danger?: boolean;
    label(record: HiddenRecord): string;
    disabled?(record: HiddenRecord): boolean;
    run(record: HiddenRecord): void | Promise<void>;
}

declare module "@utils/types" {
    interface PluginHooks {
        panelTabs?: PanelTabDef[];
        panelPages?: PanelPageDef[];
        reviewActions?: ReviewAction[];
    }
    interface XCleanerEventMap {
        panelOpen: { tab?: string; page?: string };
        panelRefresh: void;
        configImported: void;
    }
}
