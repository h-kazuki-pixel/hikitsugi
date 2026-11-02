-- 完了の根拠(11/3 オーナーの判断: 要確認を「拾いました」の一言で完了にするのは性善説。疑わないが、オーナーには見分けがつくようにする)
--   NULL       : 清掃報告(写真・文)で完了
--   staff_word : 要確認のあと、本人の申告(文だけの返事)で完了。ボードに「完了(本人の申告)」と出す
--   photo      : 要確認のあと、返事の写真を見直して完了
ALTER TABLE board_items ADD COLUMN done_basis TEXT CHECK (done_basis IN ('staff_word', 'photo'));
