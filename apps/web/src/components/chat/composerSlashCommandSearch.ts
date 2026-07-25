import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@t3tools/shared/searchRanking";
import type { ServerProviderSlashCommand } from "@t3tools/contracts";

import type { ComposerCommandItem } from "./ComposerCommandMenu";

/**
 * Merge project-scoped commands (per-thread cwd) with the provider
 * snapshot's server-level commands. Project commands come first so they win
 * name clashes — matching OpenCode's project-over-global precedence — while
 * a missing description or hint is filled in from the snapshot entry.
 */
export function mergeProjectSlashCommands(
  projectCommands: ReadonlyArray<ServerProviderSlashCommand>,
  snapshotCommands: ReadonlyArray<ServerProviderSlashCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  const merged = new Map<string, ServerProviderSlashCommand>();
  for (const command of [...projectCommands, ...snapshotCommands]) {
    const key = command.name.toLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, command);
      continue;
    }
    merged.set(key, {
      ...existing,
      ...(existing.description
        ? {}
        : command.description
          ? { description: command.description }
          : {}),
      ...(existing.input?.hint
        ? {}
        : command.input?.hint
          ? { input: { hint: command.input.hint } }
          : {}),
    });
  }
  return [...merged.values()];
}

function scoreSlashCommandItem(
  item: Extract<ComposerCommandItem, { type: "slash-command" | "provider-slash-command" }>,
  query: string,
): number | null {
  const primaryValue =
    item.type === "slash-command" ? item.command.toLowerCase() : item.command.name.toLowerCase();
  const description = item.description.toLowerCase();

  const scores = [
    scoreQueryMatch({
      value: primaryValue,
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-", "_", "/"],
    }),
    scoreQueryMatch({
      value: description,
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
  ].filter((score): score is number => score !== null);

  if (scores.length === 0) {
    return null;
  }

  return Math.min(...scores);
}

export function searchSlashCommandItems(
  items: ReadonlyArray<
    Extract<ComposerCommandItem, { type: "slash-command" | "provider-slash-command" }>
  >,
  query: string,
): Array<Extract<ComposerCommandItem, { type: "slash-command" | "provider-slash-command" }>> {
  const normalizedQuery = normalizeSearchQuery(query, { trimLeadingPattern: /^\/+/ });
  if (!normalizedQuery) {
    return [...items];
  }

  const ranked: Array<{
    item: Extract<ComposerCommandItem, { type: "slash-command" | "provider-slash-command" }>;
    score: number;
    tieBreaker: string;
  }> = [];

  for (const item of items) {
    const score = scoreSlashCommandItem(item, normalizedQuery);
    if (score === null) {
      continue;
    }

    insertRankedSearchResult(
      ranked,
      {
        item,
        score,
        tieBreaker:
          item.type === "slash-command"
            ? `0\u0000${item.command}`
            : `1\u0000${item.command.name}\u0000${item.provider}`,
      },
      Number.POSITIVE_INFINITY,
    );
  }

  return ranked.map((entry) => entry.item);
}
