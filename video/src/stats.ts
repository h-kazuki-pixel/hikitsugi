// RM_4-3 に出す数字。数え方は video/README.md に書いてある。
// 期間: 2026-11-02 12:00 JST から数えた時点(2026-11-06)まで

export const STATS = {
  days: 6,
  // main に入っているコミットのうち期間内のもの(マージコミットを除く)
  //   git rev-list origin/main --count --no-merges --since='2026-11-02T12:00:00+09:00'
  // マージコミットを含めると 128
  commits: 76,
  // マージ済みの PR
  //   gh api -X GET search/issues -f q='repo:h-kazuki-pixel/hikitsugi is:pr is:merged merged:>=2026-11-02T03:00:00Z' --jq .total_count
  prs: 59,
  // vitest のテストの数(npx vitest run の "Tests  143 passed")
  tests: 143,
  // そのまま
  handWrittenLines: 0,
} as const;
