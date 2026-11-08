// RM_4-3 に出す数字。数え方は video/README.md に書いてある。
// 期間: 2026-11-02 12:00 JST から、2026-11-07 の #63 マージ時点まで

export const STATS = {
  days: 6,
  // main に入っているコミットのうち期間内のもの(マージコミットを除く)
  //   git rev-list origin/main --count --no-merges --since='2026-11-02T12:00:00+09:00'
  // マージコミットを含めると 172
  // 前に書いた 76 は、履歴の一部しかない clone で数えた誤り
  commits: 111,
  // マージ済みの PR
  //   gh api -X GET search/issues -f q='repo:h-kazuki-pixel/hikitsugi is:pr is:merged merged:>=2026-11-02T03:00:00Z' --jq .total_count
  prs: 60,
  // npm test と同じ範囲のテストの数: vitest 149 + node --test 23
  //   npx vitest run                      → "Tests  149 passed"
  //   node --test scripts/check-commit.test.mjs scripts/ci/apply-demo-slack-ids.test.mjs scripts/build-seed.test.mjs
  //                                       → "# tests 23"
  tests: 172,
  // そのまま
  handWrittenLines: 0,
} as const;
