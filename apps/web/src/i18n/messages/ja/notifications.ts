import type en from "../en/notifications";
import type { MessageShape } from "../en";

const ja: MessageShape<typeof en> = {
  notifications: {
    title: "通知",
    lead: "チャットの新しいメッセージ、自分への TODO、フォローしているページの変更、メンション。ページを開くと、そのページの通知は既読になります。",
    empty: "まだ通知はありません。",
    markAllRead: "すべて既読にする",
    unread: "未読",
    someone: "誰か",
    kind: {
      CHAT_MESSAGE: "{actor}さんが「{page}」のチャットに投稿しました",
      TODO_ASSIGNED: "{actor}さんが「{page}」であなたに TODO を割り当てました",
      TODO_OVERDUE: "「{page}」のあなたの TODO が期限を過ぎました",
      PAGE_CHANGED: "{actor}さんが「{page}」を変更しました",
      MENTION: "{actor}さんが「{page}」であなたをメンションしました",
    },
    push: {
      CHAT_MESSAGE: "チャットに新しいメッセージがあります",
      TODO_ASSIGNED: "あなたに TODO が割り当てられました",
      TODO_OVERDUE: "あなたの TODO が期限を過ぎました",
      PAGE_CHANGED: "フォローしているページが変更されました",
      MENTION: "あなたがメンションされました",
    },
    sidebar: "通知",
    sidebarUnread: "通知（未読 {count, number} 件）",
    follow: {
      follow: "フォロー",
      following: "フォロー中",
      followHint: "ほかの人がこのページを変更したら通知します",
      followingHint: "ほかの人がこのページを変更すると通知されます。クリックでやめます",
      failed: "フォローを変更できませんでした。もう一度お試しください。",
    },
    mention: {
      menuTitle: "メンションする人",
      noOne: "メンションできる人がいません",
      someone: "@ユーザー",
      unknown: "@（不明なユーザー）",
    },
    settings: {
      heading: "通知",
      allEnabled: "通知を受け取る",
      allEnabledNote: "オフにすると、アプリにもデスクトップにも、通知は一切届きません。下の選択は、オンに戻したときのために残ります。",
      lead: "通知を受け取る出来事を選びます。オフにすると、アプリにもデスクトップにも届きません。",
      kinds: {
        CHAT_MESSAGE: "参加しているチャットの新しいメッセージ（投稿した・ページをフォローしている・ページでメンションされている）",
        TODO_ASSIGNED: "自分に割り当てられた TODO",
        TODO_OVERDUE: "期限を過ぎた自分の TODO",
        PAGE_CHANGED: "フォローしているページの変更",
        MENTION: "自分へのメンション",
      },
      pushDetails: "デスクトップ通知に、誰が・どのページで・内容の一部を表示する",
      pushDetailsNote: "オフにすると、出来事の種類だけ（「あなたがメンションされました」）を表示します。デスクトップ通知はロック画面にも表示されることがあります。",
      desktop: "このデバイスのデスクトップ通知",
      desktopNote: "サイトを開いていないときも届きます。使うブラウザーごとにオンにしてください。",
      enable: "オンにする",
      disable: "オフにする",
      enabled: "このブラウザーではオンです。",
      disabled: "このブラウザーではオフです。",
      blocked: "このブラウザーは、このサイトからの通知をブロックしています。ブラウザーのサイトの設定で許可してから、もう一度お試しください。",
      unsupported: "このブラウザーはデスクトップ通知を受け取れません（iPhone・iPad では、サイトをホーム画面に追加して、そこから開いてください）。",
      needsHttps: "デスクトップ通知には安全な接続（https）が必要です。",
      siteOff: "このサイトでは、デスクトップ通知がオフになっています。",
      failed: "デスクトップ通知をオンにできませんでした。もう一度お試しください。",
      test: "テストを送る",
      testSent: "送りました。まもなく表示されます。",
      testTitle: "デスクトップ通知が届きました",
      testBody: "このサイトからの通知は、このように表示されます。",
    },
  },
};

export default ja;
