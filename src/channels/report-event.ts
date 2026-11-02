// 共通の報告イベント(仕様 1-2)
//
// 受け口は2層: チャネルアダプタ → 共通の報告イベント。構造化・畳み込み・エージェントはこの形しか見ない。
// 今回のアダプタは Slack だけ(src/channels/slack.ts)。Web や他のチャットはアダプタを1ファイル足せば入る。

export type ReportImage = {
  id: string; // チャネル上の画像ID(Slack のファイルID)
  url: string; // 取り出し先(Slack はボットトークンが要る)
  mimetype: string;
  name?: string;
};

export type ReportEvent = {
  channel: "slack";
  senderRef: string; // チャネル上の送信者ID(Slack のユーザーID)
  text: string;
  images: ReportImage[];
  sentAt: string; // 送信時刻(ISO、UTC)。判定はこの時刻で行う
  channelRef: string; // チャンネルID。店舗はチャンネルから決まる
  messageRef: string; // メッセージID(Slack の ts)
  threadRef: string; // 返事を返す先(スレッドの親の ts)
  isReplyInThread: boolean; // スレッドの中の返事か(聞き返しへの答えなど)
  isDirect: boolean; // ボットへの DM か(引き継ぎ帳への質問)
};
