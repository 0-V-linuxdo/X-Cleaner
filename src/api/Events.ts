/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
import { mapGetOrCreate } from "@utils/misc";
import type { XCleanerEventMap } from "@utils/types";

const logger = new Logger("Events");
type Handler = (data: any) => void;
const listeners = new Map<string, Set<Handler>>();

export type EventName = keyof XCleanerEventMap;

export function subscribe<E extends EventName>(event: E, handler: (data: XCleanerEventMap[E]) => void): () => void {
    const set = mapGetOrCreate(listeners, event, () => new Set());
    set.add(handler);
    return () => { set.delete(handler); };
}

export function dispatch<E extends EventName>(event: E, ...args: XCleanerEventMap[E] extends void ? [] : [XCleanerEventMap[E]]) {
    for (const h of Array.from(listeners.get(event) ?? [])) {
        try { h(args[0]); } catch (e) { logger.error(`Handler error (${event})`, e); }
    }
}
