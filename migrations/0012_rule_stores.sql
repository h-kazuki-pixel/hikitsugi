-- 0012_rule_stores: ルールを適用する店を選べるようにする(11/5 橋本の決定。撮影のあとに入れる)
--
-- いままで rules.store_id の1列で「1店」か「全店(NULL)」しか表せなかった。
-- 「西新と原四つ角だけ」のように一部の店に共通する決まりのために、適用する店の表を足す。
--
-- 読み方(src/rules/scope.ts の RULE_APPLIES_SQL に一つにまとめる):
--   rule_stores に行があるルール        → その店だけ
--   行がなく rules.store_id が NULL     → 全店(これから増える店も含む)
--   行がなく rules.store_id がある      → その店だけ(いまのルールはすべてこれか全店。動きは変わらない)
-- rules.store_id は「ルールが生まれた店」としてそのまま残す(引き継ぎ帳の候補なら質問の店、オーナーが足したものは足した店)
CREATE TABLE rule_stores (
  rule_id  TEXT NOT NULL REFERENCES rules(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  PRIMARY KEY (rule_id, store_id)
);
