# 日本語文言を直す

設定・通知・コマンドの日本語は **[src/locales/ja.json](../src/locales/ja.json)** に集めています。右側の文章だけを書き換えてください。英語は同じキーの [en.json](../src/locales/en.json) にあります。

```json
"plugins": "プラグイン読み込みの高速化",
"pluginsHelp": "プログラムのファイルサイズが大きいプラグインの読み取り処理を、高速な方法に差し替えます。実行順序は変わりません。"
```

左側の `plugins` などは変更しません。`{count}` や `{time}` もそのまま残します。項目名・説明・選択肢・通知は別々の行なので、必要な文章だけを変更できます。

| 表示箇所 | 主なキー |
| --- | --- |
| 起動状態 | `status`、`currentTime`、`background`、`waiting` など |
| 高速化の設定 | `inventorySetting`、`tabs`、`plugins`、`previews` と各 `Help` |
| 対象フォルダ | `scope`、`chooseFolders`、`addFolder` |
| 起動記録 | `history`、`historyHelp`、`showAll`、`showLess`、`copy`、`clear` |

日本語を編集したら、その差分を基準に英語も調整します。日本語の変更が英語へ自動翻訳されるわけではありません。こちらへ「ja.jsonに合わせて英語を調整して」と依頼しても大丈夫です。復旧案内で使う設定名は共通の項目名から差し込むので、名前を直すだけで案内にも反映されます。

## 反映する

このリポジトリで `node docs/check-text.cjs` を実行すると、日英のキーと差し込み値が揃っているか確認できます。文章の意味や自然さは確認の対象外です。

`node docs/prepare-candidate.mjs` で型検査・テスト・ビルドを行い、新しい試用ZIPを作ります。JSONはビルド時に本体へ組み込まれるため、インストール先へJSONだけをコピーしても表示は変わりません。候補作成には開発依存が必要です。

READMEの日本語は [README.ja.md](../README.ja.md)、公開用の英語は [README.md](../README.md)、導入案内は [candidate-install.md](candidate-install.md) です。これらはUIのJSONとは別に編集します。掲載先やGitHubへの自動反映はありません。
