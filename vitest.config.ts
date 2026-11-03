import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

// テストファイルは同じローカル D1 を順に使う(報告は追記のみで消せないため、毎回まっさらに作って流す)。
// vitest の既定は「前回落ちたファイルを先に」なので、並びが変わるとルール番号などがずれる。ファイル名順に固定する
class ByName extends BaseSequencer {
  async sort(files: TestSpecification[]) {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "hono/jsx" },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { sequencer: ByName },
  },
});
