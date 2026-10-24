/*
 * X Cleaner, a plugin-based cleaner for x.com
 * Copyright (c) 2026 X Cleaner Contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const isObject = (v: unknown): v is Record<string, any> => v != null && typeof v === "object" && !Array.isArray(v);
export const isNonNullish = <T>(v: T): v is NonNullable<T> => v != null;
