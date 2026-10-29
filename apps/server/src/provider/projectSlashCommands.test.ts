import * as NodeAssert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ProviderInstanceId, type ServerSettings } from "@t3tools/contracts";
import type { DeepPartial } from "@t3tools/shared/Struct";

import { layerTest as serverSettingsLayerTest } from "../serverSettings.ts";
import {
  OpenCodeRuntime,
  OpenCodeRuntimeError,
  type OpenCodeRuntimeShape,
} from "./opencodeRuntime.ts";
import { listProviderProjectSlashCommands } from "./projectSlashCommands.ts";

const OPENCODE_INSTANCE_ID = ProviderInstanceId.make("opencode");

const runtimeMock = {
  state: {
    clientDirectories: [] as Array<string | undefined>,
    commands: [] as Array<{
      name: string;
      description?: string;
      hints: string[];
      template: string;
    }>,
  },
  reset() {
    this.state.clientDirectories = [];
    this.state.commands = [];
  },
};

const unusedRuntimeMember = (operation: string) =>
  Effect.fail(
    new OpenCodeRuntimeError({
      operation,
      detail: `OpenCodeRuntimeTestDouble.${operation} not used in this test`,
      cause: null,
    }),
  );

const OpenCodeRuntimeTestDouble: OpenCodeRuntimeShape = {
  startOpenCodeServerProcess: () => unusedRuntimeMember("startOpenCodeServerProcess"),
  connectToOpenCodeServer: () => unusedRuntimeMember("connectToOpenCodeServer"),
  runOpenCodeCommand: () => unusedRuntimeMember("runOpenCodeCommand"),
  createOpenCodeSdkClient: (input) => {
    runtimeMock.state.clientDirectories.push(input.directory);
    return {} as ReturnType<OpenCodeRuntimeShape["createOpenCodeSdkClient"]>;
  },
  loadOpenCodeInventory: () => unusedRuntimeMember("loadOpenCodeInventory"),
  listOpenCodeCommands: () => Effect.succeed(runtimeMock.state.commands),
  loadInventoryFromCli: () => unusedRuntimeMember("loadInventoryFromCli"),
};

const makeTestLayer = (settingsOverrides: DeepPartial<ServerSettings> = {}) =>
  Layer.mergeAll(
    serverSettingsLayerTest(settingsOverrides),
    Layer.succeed(OpenCodeRuntime, OpenCodeRuntimeTestDouble),
    NodeServices.layer,
  );

const localOpenCodeSettings: DeepPartial<ServerSettings> = {
  providers: {
    opencode: {
      enabled: true,
      binaryPath: "opencode",
      serverUrl: "",
      serverPassword: "",
      customModels: [],
    },
  },
};

const externalOpenCodeSettings: DeepPartial<ServerSettings> = {
  providers: {
    opencode: {
      enabled: true,
      binaryPath: "opencode",
      serverUrl: "http://127.0.0.1:9999",
      serverPassword: "secret-password",
      customModels: [],
    },
  },
};

it.layer(makeTestLayer(localOpenCodeSettings))("listProviderProjectSlashCommands", (it) => {
  it.effect("discovers project markdown commands for the given cwd", () =>
    Effect.gen(function* () {
      runtimeMock.reset();
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const projectDir = yield* fileSystem.makeTempDirectory();
      yield* fileSystem.makeDirectory(path.join(projectDir, ".opencode", "command"), {
        recursive: true,
      });
      yield* fileSystem.makeDirectory(path.join(projectDir, ".opencode", "commands"), {
        recursive: true,
      });
      yield* fileSystem.writeFileString(
        path.join(projectDir, ".opencode", "command", "deploy.md"),
        "---\ndescription: Deploy the project\n---\n\nDeploy $ARGUMENTS\n",
      );
      yield* fileSystem.writeFileString(
        path.join(projectDir, ".opencode", "commands", "triage.md"),
        "Triage issues. No frontmatter here.\n",
      );
      yield* fileSystem.writeFileString(
        path.join(projectDir, ".opencode", "command", "notes.txt"),
        "not a command\n",
      );

      const result = yield* listProviderProjectSlashCommands({
        instanceId: OPENCODE_INSTANCE_ID,
        cwd: projectDir,
      });

      NodeAssert.deepEqual(result.commands, [
        { name: "deploy", description: "Deploy the project" },
        { name: "triage" },
      ]);
      // Local mode must not touch any OpenCode server.
      NodeAssert.deepEqual(runtimeMock.state.clientDirectories, []);
    }),
  );

  it.effect("does not pick up commands from a sibling project directory", () =>
    Effect.gen(function* () {
      runtimeMock.reset();
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempRoot = yield* fileSystem.makeTempDirectory();
      const projectDir = path.join(tempRoot, "project-a");
      const siblingDir = path.join(tempRoot, "project-b");
      yield* fileSystem.makeDirectory(path.join(siblingDir, ".opencode", "command"), {
        recursive: true,
      });
      yield* fileSystem.writeFileString(
        path.join(siblingDir, ".opencode", "command", "deploy.md"),
        "Deploy the project.\n",
      );

      const result = yield* listProviderProjectSlashCommands({
        instanceId: OPENCODE_INSTANCE_ID,
        cwd: projectDir,
      });

      NodeAssert.deepEqual(result.commands, []);
    }),
  );

  it.effect("returns an empty list for unknown instances", () =>
    Effect.gen(function* () {
      const result = yield* listProviderProjectSlashCommands({
        instanceId: ProviderInstanceId.make("does-not-exist"),
        cwd: process.cwd(),
      });

      NodeAssert.deepEqual(result.commands, []);
    }),
  );

  it.effect("returns an empty list for non-OpenCode providers", () =>
    Effect.gen(function* () {
      const result = yield* listProviderProjectSlashCommands({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        cwd: process.cwd(),
      });

      NodeAssert.deepEqual(result.commands, []);
    }),
  );
});

it.layer(makeTestLayer(externalOpenCodeSettings))(
  "listProviderProjectSlashCommands with configured server URL",
  (it) => {
    it.effect("lists commands through a directory-scoped client", () =>
      Effect.gen(function* () {
        runtimeMock.reset();
        runtimeMock.state.commands = [
          { name: "deploy", description: "Deploy the project", hints: ["env"], template: "d" },
          { name: "init", description: "", hints: [], template: "i" },
        ];

        const result = yield* listProviderProjectSlashCommands({
          instanceId: OPENCODE_INSTANCE_ID,
          cwd: "/tmp/some-project",
        });

        NodeAssert.deepEqual(runtimeMock.state.clientDirectories, ["/tmp/some-project"]);
        NodeAssert.deepEqual(result.commands, [
          { name: "deploy", description: "Deploy the project", input: { hint: "env" } },
          { name: "init" },
        ]);
      }),
    );

    it.effect("returns an empty list when the client cannot be created", () =>
      Effect.gen(function* () {
        runtimeMock.reset();

        const result = yield* listProviderProjectSlashCommands({
          instanceId: OPENCODE_INSTANCE_ID,
          cwd: "/tmp/some-project",
        }).pipe(
          Effect.provideService(OpenCodeRuntime, {
            ...OpenCodeRuntimeTestDouble,
            createOpenCodeSdkClient: () => {
              throw new Error("Invalid server URL");
            },
          } satisfies OpenCodeRuntimeShape),
        );

        NodeAssert.deepEqual(result.commands, []);
      }),
    );
  },
);
