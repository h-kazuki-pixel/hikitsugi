-- 引き継ぎ帳の返事を返す先(設計書 5-5、仕様 1-2「スタッフへの返事は元メッセージのスレッドに返す」)
--
-- question_ref / owner_ask_ref は Slack の ts で、ts はチャンネルの中でだけ一意。
-- 返事を返すにはチャンネルも要るので、それぞれの場所を足す
--   question_channel_ref : 質問が来た場所(店舗チャンネル、またはボットとの DM)
--   owner_ask_channel_ref: オーナーに一度だけ聞いた DM の場所(オーナーがそのスレッドで答えたら結ぶ)
ALTER TABLE knowledge ADD COLUMN question_channel_ref TEXT;
ALTER TABLE knowledge ADD COLUMN owner_ask_channel_ref TEXT;

-- オーナーへの問い合わせは一度だけ。同じ DM のスレッドに2つの質問を結ばない
CREATE UNIQUE INDEX knowledge_owner_ask ON knowledge (owner_ask_channel_ref, owner_ask_ref)
  WHERE owner_ask_ref IS NOT NULL;
