import { z } from "zod";
import {
  ActionExecutionSchema,
  ActionSchema,
  ButtonSchema,
  DeviceImageCalibrationSchema,
  DeviceInfoSchema,
  ImageOffsetSchema,
  LocaleCatalogSchema,
  LocaleModeSchema,
  LocalePreferenceSchema,
  LocaleSummarySchema,
  LogEntrySchema,
  ProfileDocumentSchema,
  ProfileSchema,
  ResolvedThemeSchema,
  ThemeAppearanceSchema,
  ThemeModeSchema,
  ThemePreferenceSchema,
  ThemeSummarySchema,
  type ActionExecution,
  type DeviceImageCalibration,
  type DeviceInfo,
  type ImageOffset,
  type LocaleCatalog,
  type LocaleMode,
  type LocalePreference,
  type LocaleSummary,
  type Profile,
  type ProfileDocument,
  type LogEntry,
  type ResolvedTheme,
  type ThemeAppearance,
  type ThemeMode,
  type ThemePreference,
  type ThemeSummary,
} from "@open-panel/shared";

/**
 * The explicit, typed IPC contract required by specs.md #8. Only these DTOs
 * (plain data validated by zod) cross the desktop<->daemon boundary — never
 * internal classes like ProfileRepository or DeviceConnectionManager.
 */

export const ActionSummarySchema = z.object({
  type: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** Heading the desktop groups this action under; absent means "Built-in". */
  category: z.string().optional(),
});
export type ActionSummary = z.infer<typeof ActionSummarySchema>;

/**
 * What the desktop needs to list and switch profiles.
 *
 * Deliberately not the whole Profile: button icons are stored inline as data
 * URIs, so a profile can be tens of megabytes, and returning every profile in
 * full made `listProfiles` a ~50 MB message that a webview client drops the
 * connection over. Only the active profile is fetched whole.
 */
export const ProfileSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  pageCount: z.number().int().nonnegative(),
});
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

/**
 * One row in Settings → Plugins. Every extension is a plugin, so this covers
 * a theme pack, an action plugin and a device adapter alike — `contributes` is
 * what tells them apart, and `problems` is how a contribution that was
 * rejected reaches the author instead of only the log file.
 */
export const PluginSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  contributes: z.object({
    actions: z.number().int().nonnegative(),
    themes: z.number().int().nonnegative(),
    locales: z.number().int().nonnegative(),
    devices: z.number().int().nonnegative(),
  }),
  problems: z.array(z.string()),
  /**
   * Whether `uninstallPlugin` will accept this one. False for a plugin found
   * in a dev checkout's `plugins/` directory, which is part of the source tree
   * and not the user's data — the packaged app has none of those, so every row
   * there is removable.
   */
  removable: z.boolean(),
});
export type PluginSummary = z.infer<typeof PluginSummarySchema>;

/**
 * What the user is told after an install. `restartRequired` is the honest part:
 * a theme or a locale is live the moment it lands, and so is a brand new code
 * plugin, but replacing code that this daemon already imported cannot take
 * effect until it restarts — Node caches modules by URL.
 */
export const PluginInstallResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  replaced: z.boolean(),
  restartRequired: z.boolean(),
  /**
   * Contributions the plugin could not load, read back right after installing
   * it — most often an import of a package it did not bundle. Unpacking a
   * plugin succeeds long before anyone knows whether its code runs, so this is
   * how "installed" and "working" stay honestly separate.
   */
  problems: z.array(z.string()),
});
export type PluginInstallResult = z.infer<typeof PluginInstallResultSchema>;

interface MethodSpec {
  params: z.ZodTypeAny;
  result: z.ZodTypeAny;
}

const noParams = z.tuple([]);

export const ipcMethods = {
  listDevices: { params: noParams, result: z.array(DeviceInfoSchema) },
  listProfiles: { params: noParams, result: z.array(ProfileSummarySchema) },
  getActiveProfile: { params: noParams, result: ProfileSchema.optional() },
  setActiveProfile: { params: z.tuple([z.string()]), result: z.void() },
  createProfile: { params: z.tuple([z.string()]), result: ProfileSchema },
  renameProfile: { params: z.tuple([z.string(), z.string()]), result: ProfileSchema },
  deleteProfile: { params: z.tuple([z.string()]), result: z.void() },
  duplicateProfile: { params: z.tuple([z.string(), z.string().nullish()]), result: ProfileSchema },
  resetProfile: { params: z.tuple([z.string()]), result: ProfileSchema },
  exportProfile: { params: z.tuple([z.string()]), result: ProfileDocumentSchema },
  importProfile: { params: z.tuple([ProfileDocumentSchema]), result: ProfileSchema },
  addPage: {
    params: z.tuple([z.string(), z.string(), z.string().nullish()]),
    result: ProfileSchema,
  },
  createFolder: {
    params: z.tuple([z.string(), z.string(), z.number().int().nonnegative()]),
    result: ProfileSchema,
  },
  renamePage: { params: z.tuple([z.string(), z.string(), z.string()]), result: ProfileSchema },
  deletePage: { params: z.tuple([z.string(), z.string()]), result: ProfileSchema },
  movePage: {
    params: z.tuple([z.string(), z.string(), z.number().int().nonnegative()]),
    result: ProfileSchema,
  },
  setButton: { params: z.tuple([z.string(), z.string(), ButtonSchema]), result: ProfileSchema },
  removeButton: { params: z.tuple([z.string(), z.string(), z.number()]), result: ProfileSchema },
  executeAction: {
    params: z.tuple([
      ActionSchema,
      z.object({ deviceId: z.string().optional(), buttonId: z.string().optional() }).nullish(),
    ]),
    result: ActionExecutionSchema,
  },
  listActions: { params: noParams, result: z.array(ActionSummarySchema) },
  listPlugins: { params: noParams, result: z.array(PluginSummarySchema) },
  // The archive is base64 rather than binary because the wire format is JSON
  // (see wire.ts) and one encoding for every message is worth more than the
  // third of a megabyte a 1 MB plugin costs on the way in. Nothing is executed
  // here: the daemon validates the manifest and unpacks it into the plugins
  // directory, where the normal scan picks it up (specs.md #18).
  installPlugin: { params: z.tuple([z.string()]), result: PluginInstallResultSchema },
  uninstallPlugin: {
    params: z.tuple([z.string()]),
    result: z.object({ restartRequired: z.boolean() }),
  },
  getLogs: { params: z.tuple([z.number().nullish()]), result: z.array(LogEntrySchema) },
  getDeviceImageCalibration: {
    params: z.tuple([z.string()]),
    result: DeviceImageCalibrationSchema,
  },
  setDeviceImageMargin: {
    params: z.tuple([z.string(), z.number().int().nonnegative()]),
    result: DeviceImageCalibrationSchema,
  },
  setDeviceImageOffset: {
    params: z.tuple([z.string(), z.number().int().nonnegative(), ImageOffsetSchema]),
    result: DeviceImageCalibrationSchema,
  },
  isDeviceCalibrating: { params: z.tuple([z.string()]), result: z.boolean() },
  enterDeviceCalibrationMode: { params: z.tuple([z.string()]), result: z.void() },
  exitDeviceCalibrationMode: { params: z.tuple([z.string()]), result: z.void() },
  listThemes: { params: noParams, result: z.array(ThemeSummarySchema) },
  // Resolved daemon-side: the desktop receives concrete token values and holds
  // no colour logic, which keeps one derivation for every client — and is the
  // seam the device's generated artwork plugs into later.
  getTheme: {
    params: z.tuple([z.string(), ThemeAppearanceSchema]),
    result: ResolvedThemeSchema,
  },
  getThemePreference: { params: noParams, result: ThemePreferenceSchema },
  setThemePreference: {
    params: z.tuple([z.string(), ThemeModeSchema]),
    result: ThemePreferenceSchema,
  },
  // Stored, not resolved: "system" stays "system" until a client that can see
  // the OS language turns it into a concrete locale.
  listLocales: { params: noParams, result: z.array(LocaleSummarySchema) },
  // A built-in comes back with no messages: the client compiles those in, and
  // sending them over IPC would be handing a client its own source.
  getLocale: { params: z.tuple([z.string()]), result: LocaleCatalogSchema },
  getLocalePreference: { params: noParams, result: LocalePreferenceSchema },
  setLocalePreference: {
    params: z.tuple([LocaleModeSchema]),
    result: LocalePreferenceSchema,
  },
  // The daemon outlives every client (specs.md #7), so closing the desktop
  // window does not stop it. This is the only way to ask it to stop on
  // purpose, and the installer and the UI's "quit completely" both go
  // through it. It returns before the daemon is gone: the shutdown sequence
  // has to unload plugins and release the devices first, and by the time it
  // finishes there is no socket left to answer on.
  shutdown: { params: noParams, result: z.void() },
} satisfies Record<string, MethodSpec>;

export type IpcMethods = typeof ipcMethods;
export type IpcMethodName = keyof IpcMethods;

/** The client interface every transport (WebSocket now, others later) must implement. */
export interface OpenPanelClient {
  listDevices(): Promise<DeviceInfo[]>;
  listProfiles(): Promise<ProfileSummary[]>;
  getActiveProfile(): Promise<Profile | undefined>;
  setActiveProfile(profileId: string): Promise<void>;
  createProfile(name: string): Promise<Profile>;
  renameProfile(profileId: string, name: string): Promise<Profile>;
  deleteProfile(profileId: string): Promise<void>;
  duplicateProfile(profileId: string, newName?: string): Promise<Profile>;
  resetProfile(profileId: string): Promise<Profile>;
  exportProfile(profileId: string): Promise<ProfileDocument>;
  importProfile(document: ProfileDocument): Promise<Profile>;
  addPage(profileId: string, name: string, parentButtonId?: string): Promise<Profile>;
  /** Turns the button at `position` into a folder: a page behind it, with a Back key inside. */
  createFolder(profileId: string, pageId: string, position: number): Promise<Profile>;
  renamePage(profileId: string, pageId: string, name: string): Promise<Profile>;
  deletePage(profileId: string, pageId: string): Promise<Profile>;
  /** Reorders a page within its own layer; `toIndex` is an index among its siblings. */
  movePage(profileId: string, pageId: string, toIndex: number): Promise<Profile>;
  setButton(
    profileId: string,
    pageId: string,
    button: z.infer<typeof ButtonSchema>,
  ): Promise<Profile>;
  removeButton(profileId: string, pageId: string, position: number): Promise<Profile>;
  executeAction(
    action: z.infer<typeof ActionSchema>,
    meta?: { deviceId?: string; buttonId?: string },
  ): Promise<ActionExecution>;
  listActions(): Promise<ActionSummary[]>;
  listPlugins(): Promise<PluginSummary[]>;
  /** Installs a plugin from a base64-encoded .zip. Rejects with a readable reason. */
  installPlugin(archiveBase64: string): Promise<PluginInstallResult>;
  /** Removes an installed plugin. Refuses anything outside the user plugins directory. */
  uninstallPlugin(pluginId: string): Promise<{ restartRequired: boolean }>;
  getLogs(limit?: number): Promise<LogEntry[]>;
  getDeviceImageCalibration(deviceId: string): Promise<DeviceImageCalibration>;
  setDeviceImageMargin(deviceId: string, marginPx: number): Promise<DeviceImageCalibration>;
  setDeviceImageOffset(
    deviceId: string,
    position: number,
    offset: ImageOffset,
  ): Promise<DeviceImageCalibration>;
  isDeviceCalibrating(deviceId: string): Promise<boolean>;
  enterDeviceCalibrationMode(deviceId: string): Promise<void>;
  exitDeviceCalibrationMode(deviceId: string): Promise<void>;
  listThemes(): Promise<ThemeSummary[]>;
  getTheme(themeId: string, appearance: ThemeAppearance): Promise<ResolvedTheme>;
  getThemePreference(): Promise<ThemePreference>;
  setThemePreference(themeId: string, mode: ThemeMode): Promise<ThemePreference>;
  listLocales(): Promise<LocaleSummary[]>;
  getLocale(localeId: string): Promise<LocaleCatalog>;
  getLocalePreference(): Promise<LocalePreference>;
  setLocalePreference(locale: LocaleMode): Promise<LocalePreference>;
  /** Asks the daemon to stop. Resolves when the shutdown has been accepted, not when it is done. */
  shutdown(): Promise<void>;
}

export { OpenPanelEventPayloads } from "@open-panel/shared";
export type { OpenPanelEvents } from "@open-panel/shared";
