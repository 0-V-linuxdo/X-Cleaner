import { beforeEach, describe, expect, test } from "bun:test";

import { definePluginSettings, loadSettings, PlainSettings, Settings } from "@api/Settings";
import { defineHook, isPluginEnabled, plugins, registerPlugin, setPluginEnabled, startAllPlugins, startPlugin, stopPlugin } from "@api/PluginManager";
import { memoryStorage } from "@utils/storage";
import definePlugin, { OptionType, StartAt } from "@utils/types";

declare module "@utils/types" {
    interface PluginHooks { testHook?: string }
}

let n = 0;
const fresh = (prefix: string) => `${prefix}${n++}`;

beforeEach(() => loadSettings(memoryStorage()));

describe("PluginManager", () => {
    test("starts enabled-by-default plugins and runs start/stop", () => {
        const log: string[] = [];
        const p = definePlugin({ name: fresh("A"), description: "", enabledByDefault: true, start: () => log.push("start"), stop: () => log.push("stop") });
        registerPlugin(p);
        startAllPlugins(StartAt.Init);
        expect(p.started).toBe(true);
        setPluginEnabled(p.name, false);
        expect(log).toEqual(["start", "stop"]);
        expect(PlainSettings.plugins[p.name].enabled).toBe(false);
    });

    test("dependencies start first and stop when unused", () => {
        const order: string[] = [];
        const dep = definePlugin({ name: fresh("Dep"), description: "", start: () => order.push("dep") });
        const user = definePlugin({ name: fresh("User"), description: "", dependencies: [dep.name], start: () => order.push("user") });
        registerPlugin(dep);
        registerPlugin(user);
        setPluginEnabled(user.name, true);
        expect(order).toEqual(["dep", "user"]);
        expect(isPluginEnabled(dep.name)).toBe(true);
        setPluginEnabled(user.name, false);
        expect(dep.started).toBe(false);
    });

    test("hooks attach to plugins that declare them and imply a dependency", () => {
        const attached: string[] = [];
        const provider = definePlugin({ name: fresh("Provider"), description: "" });
        registerPlugin(provider);
        defineHook("testHook", { provider: provider.name, attach: (p, v) => { attached.push(`${p.name}:${v}`); return () => attached.push("off"); } });
        const consumer = definePlugin({ name: fresh("Consumer"), description: "", testHook: "hi" });
        registerPlugin(consumer);
        setPluginEnabled(consumer.name, true);
        expect(provider.started).toBe(true);
        expect(attached).toEqual([`${consumer.name}:hi`]);
        stopPlugin(consumer);
        expect(attached.at(-1)).toBe("off");
    });

    test("a failing start rolls back and stays disabled", () => {
        const p = definePlugin({ name: fresh("Bad"), description: "", managedStyle: ".x{}", start() { throw new Error("boom"); } });
        registerPlugin(p);
        expect(setPluginEnabled(p.name, true)).toBe(false);
        expect(p.started).toBe(false);
        expect(document.querySelector(`style[data-xc="plugin:${p.name}"]`)).toBeNull();
    });

    test("settings expose defaults and notify onSettingsChange", () => {
        const changes: string[] = [];
        const settings = definePluginSettings({
            flag: { type: OptionType.BOOLEAN, description: "", default: true },
            mode: { type: OptionType.SELECT, description: "", options: [{ label: "a", value: "a" }, { label: "b", value: "b", default: true }] },
            words: { type: OptionType.LIST, description: "", default: ["x"] },
        });
        const p = definePlugin({ name: fresh("S"), description: "", settings, onSettingsChange: path => changes.push(path) });
        registerPlugin(p);
        startPlugin(p);
        expect(settings.store.flag).toBe(true);
        expect(settings.store.mode).toBe("b");
        expect(settings.store.words).toEqual(["x"]);
        settings.store.flag = false;
        expect(changes).toEqual([`plugins.${p.name}.flag`]);
        expect(Settings.plugins[p.name].flag).toBe(false);
    });

    test("plugin registry holds registered plugins", () => {
        const p = definePlugin({ name: fresh("R"), description: "" });
        registerPlugin(p);
        expect(plugins[p.name]).toBe(p);
    });
});
