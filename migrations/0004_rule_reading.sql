-- オーナーが自然文で足したルールの「読み取った内容」(仕様 2章)
-- 構造化の結果をオーナーが確かめてから承認できるよう、Claude が読み取った一文と、決められなかった点を残す
ALTER TABLE rules ADD COLUMN reading TEXT;
ALTER TABLE rules ADD COLUMN unclear TEXT;
