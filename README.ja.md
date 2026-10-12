# Boot Booster

[English](README.md)

**待ち時間を減らして、もっと早くノートへ。**

Boot Boosterは、ノートの多いAndroidのVaultで起動時の処理を減らし、使い始めるまでの待ち時間を短くします。

## できること

- 前回のファイル一覧を使い、全ファイルの確認を待たずに起動する。
- タブ復元と、大きいプラグイン本体の読み取りの負担を減らす。
- 背景での確認状況と、起動時間の変化を確認する。

## 仕組み

初回にファイル一覧を記録し、次回から暫定的に使いながら実ファイルを確認します。ノートを開く前に個別に確認し、書き込み前には毎回確認します。WorkspaceはObsidian標準の遅延復元に表示情報を補い、大きいプラグイン本体はAndroidのローカルファイル経路で読み込みます。ほかのプラグイン同士の実行順序は保ちます。

Obsidianの内部APIを使用します。ノート本文はキャッシュせず、一覧と起動記録は端末内に保存します。高速読み取りの通信先はlocalhostのみで、外部送信・自己更新は行いません。

確認中の検索・クエリ結果は不完全な場合があります。確認に失敗した場合は「ファイル一覧の高速化」を「使わない」にして再起動してください。外部アプリの同時書き込みを排他制御するものではありません。起動時間は観測値で、予測値ではありません。[対応環境・検証範囲](docs/testing.md#compatibility)。

## 導入

**設定 → コミュニティプラグイン → 閲覧** で **Boot Booster** を検索し、インストールして有効にします。[掲載ページ](https://community.obsidian.md/plugins/boot-booster)。

手動の場合は [Releases](https://github.com/kgway/boot-booster/releases) の `main.js`・`manifest.json`・`styles.css` を `.obsidian/plugins/boot-booster/` に置きます。更新時は `data.json` を保持してください。

[不具合の報告](https://github.com/kgway/boot-booster/issues) · [文言の編集](docs/editing-text.md) · [配布用ビルド](docs/releasing.md)

[MIT](LICENSE) © 2026 kgway。本体にもライセンスを含めます。[第三者コンポーネント](THIRD_PARTY_NOTICES.md)。
