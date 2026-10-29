/**
 * Project-scoped slash-command discovery backing the
 * `providers.listProjectSlashCommands` RPC.
 *
 * Provider snapshots carry server-level commands (built-ins, global config,
 * and the probe cwd's project config), but project commands differ per
 * working directory. The composer asks for them separately with the
 * thread's cwd and merges the result over the snapshot, so this module
 * reports only what the given directory adds.
 *
 * Discovery is best-effort end to end: unknown instances, undecodable
 * configs, unreachable servers, and unreadable directories all yield an
 * empty command list rather than an RPC error.
 *
 * @module provider/projectSlashCommands
 */
import {
  OpenCodeSettings,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderProjectSlashCommandsResult,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ServerSettingsService } from "../serverSettings.ts";
import { deriveProviderInstanceConfigMap } from "./Layers/ProviderInstanceRegistryHydration.ts";
import {
  discoverProjectOpenCodeSlashCommands,
  openCodeCommandToSlashCommand,
} from "./Layers/OpenCodeProvider.ts";
import { OpenCodeRuntime } from "./opencodeRuntime.ts";

const EMPTY_RESULT: ProviderProjectSlashCommandsResult = { commands: [] };

const decodeOpenCodeSettings = Schema.decodeUnknownEffect(OpenCodeSettings);

const listOpenCodeProjectSlashCommands = (input: {
  readonly settings: OpenCodeSettings;
  readonly cwd: string;
}): Effect.Effect<
  ReadonlyArray<ServerProviderSlashCommand>,
  never,
  OpenCodeRuntime | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    if (input.settings.serverUrl.trim().length > 0) {
      // External server: the client is created with the project directory,
      // so `GET /command` is already scoped to the right project.
      const openCodeRuntime = yield* OpenCodeRuntime;
      const client = yield* Effect.try({
        try: () =>
          openCodeRuntime.createOpenCodeSdkClient({
            baseUrl: input.settings.serverUrl,
            directory: input.cwd,
            ...(input.settings.serverPassword
              ? { serverPassword: input.settings.serverPassword }
              : {}),
          }),
        catch: () => undefined,
      });
      if (client === undefined) {
        return [];
      }
      const commands = yield* openCodeRuntime.listOpenCodeCommands(client);
      return commands.flatMap((command) => {
        const mapped = openCodeCommandToSlashCommand(command);
        return mapped ? [mapped] : [];
      });
    }
    // Local mode: no server to ask, so read the project markdown command
    // files OpenCode itself loads.
    return yield* discoverProjectOpenCodeSlashCommands(input.cwd);
  }).pipe(Effect.orElseSucceed((): ReadonlyArray<ServerProviderSlashCommand> => []));

export const listProviderProjectSlashCommands = (input: {
  readonly instanceId: ProviderInstanceId;
  readonly cwd: string;
}): Effect.Effect<
  ProviderProjectSlashCommandsResult,
  never,
  ServerSettingsService | OpenCodeRuntime | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const settings = yield* serverSettings.getSettings;
    const instanceConfig = deriveProviderInstanceConfigMap(settings)[input.instanceId];
    if (!instanceConfig || instanceConfig.driver !== ProviderDriverKind.make("opencode")) {
      return EMPTY_RESULT;
    }
    const openCodeSettings = yield* decodeOpenCodeSettings(instanceConfig.config ?? {}).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    if (!openCodeSettings) {
      return EMPTY_RESULT;
    }
    const commands = yield* listOpenCodeProjectSlashCommands({
      settings: openCodeSettings,
      cwd: input.cwd,
    });
    return { commands } satisfies ProviderProjectSlashCommandsResult;
  }).pipe(Effect.orElseSucceed(() => EMPTY_RESULT));
