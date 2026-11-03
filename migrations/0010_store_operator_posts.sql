-- テスト用の店舗チャンネルだけ、オーナー・副担当の投稿も報告として受ける(11/4)
--
-- ふだんは運営の投稿を報告として数えない(設計書 5-2)。実店舗で動かし始める前に、オーナーだけが入った
-- テスト用のプライベートチャンネルで経路を確かめるため、店舗ごとの印を足す。既定は 0(受けない)
ALTER TABLE stores ADD COLUMN accepts_operator_posts INTEGER NOT NULL DEFAULT 0 CHECK (accepts_operator_posts IN (0, 1));
