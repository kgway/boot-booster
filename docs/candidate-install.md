# Boot Booster — ローカル試用候補

このZIPは非公開開発中の試用候補です。版は `manifest.json` で確認できます。
型検査・公式lint・自動テスト・再ビルド一致を確認して作成します。合成Vaultでの検証範囲は公開ソースの `docs/testing.md` と候補記録に記載しています。実機での短縮量は利用環境に依存します。

## 導入・更新

1. Vaultと既存プラグインのバックアップを取ってからObsidianを終了します。
2. ZIP内の `boot-booster` をVaultの `.obsidian/plugins/` に置きます。
3. 更新時は `main.js`・`manifest.json`・`styles.css` の3ファイルだけを置き換えます。
   既存の `data.json` を削除したり、プラグインのフォルダごと置き換えたりしないでください。
4. Obsidianを起動し、Boot Boosterを有効にします。高速化は検証対象のAndroid API 1.13.8 / 1.14.4に限定しています。
   未検証の版では通常起動します。初回は一覧とプラグイン本体のサイズを学習し、次回から利用します。

設定・通知・コマンドは日本語と英語に対応しています。Obsidianが日本語なら日本語、それ以外なら英語が初期表示です。「言語」で切り替えると即時反映し、この端末だけに保存します。

## 今回確認すること

- プログラムのファイルサイズが大きいプラグインも普段どおり起動し、設定・ノート・タブの状態を保持する。
- 起動直後の入力、ノート切替、標準の画像付きタブ一覧が使える。
- 設定の最上部の「起動状態」で、現在の作業・進捗・待機理由・次の動作を確認できる。確認中は現在のフォルダも表示します。
- 起動時に保存した選択タブが復元され、入力やノート切替ができる。
- 起動記録は1項目に表・操作ボタン・JSONをまとめています。小さな「すべて表示」リンクで同じ表に続きが並び、「閉じる」で5回に戻る。JSONを閉じた状態でもコピー・消去できる。
- 比較する場合は「起動方法」を「通常起動を計測」「高速化」で切り替え、各回アプリを終了して開き直す。
  同じ設定の記録がそろうと、設定の先頭に通常起動と高速化の中央値・差・回数を表示します。比較後は「高速化」に戻します。
  参考値であり、今回の起動に高速化がなかった場合の時間を断定するものではありません。

「タブプレビューの省略」は初期設定オフです。高速化する範囲を「フォルダを選ぶ」にした場合は、対象フォルダを追加してください。未選択では一覧の高速化は働きません。一覧照合中の検索・Graph・クエリ結果は暫定です。
照合中はフォルダ削除・移動・コピーを止め、完了後の再操作を案内します。

## 通信・保存

高速読み取りは端末内の `localhost/_capacitor_file_/` だけを使用します。
外部サービスへの送信、コードのダウンロード、自己更新は行いません。
ノート本文をキャッシュせず、一覧・ファイルサイズ・タブ表示情報・起動記録を端末内に保存します。
起動記録は直近20回で、Vault名・本文・ノートのパスを含みません。ラベルの機能は撤去しました。旧版の履歴に保存されたラベルは、履歴を消去するまでJSONに残る場合があります。
設定内の「起動記録」は直近5回を表示し、「すべて表示」で同じ表に続きを並べます。JSONも同じ項目内で開けます。表の下に「コピー」と「記録を消去」があり、JSONを閉じていても使えます。コピーはクリップボードへの保存です。消去後は次の起動から記録を再開します。起動状態と診断情報も設定内で確認できます。

## 戻し方

Obsidianを終了し、バックアップの本体3ファイルを戻します。`data.json` は保持します。
一覧照合に失敗する場合は「ファイル一覧の高速化」を「使わない」にして再起動すると通常読み取りに戻せます。
プラグイン本体の高速読み取りだけを止める場合も、設定をオフにして再起動してください。
ライセンスはMIT、作者表記はkgwayです。コミュニティでの配布は準備中です。

## English quick guide

Close Obsidian and back up your vault before installing. Extract `boot-booster` into `.obsidian/plugins/`. When updating, replace only `main.js`, `manifest.json` and `styles.css`, keeping `data.json`. Enable Boot Booster after reopening Obsidian. This is a private trial candidate; community publication is being prepared.

Android file-list optimization supports Obsidian API 1.13.8 / 1.14.4. The first startup builds a reference inventory. The interface starts in Japanese when Obsidian uses Japanese, and in English otherwise. The Language dropdown switches it immediately and saves the preference on this device.

History, its small Show all link, Copy, Clear history and JSON share one setting item. Copy and clear work with JSON closed. Startup status and diagnostics share another item. Measure normal startup disables optimizations for reference measurements; restart for each run. Timings are local observations, not native app launch time or predictions.

Notes are not cached or sent elsewhere. File inventories and the latest 20 path-free startup records stay on this device. While verification is running, folder removal/move/copy is refused and indexes can be provisional. Writes are checked again; observed external changes cause an operation to be refused. This does not lock writes by external apps.

If verification fails, set File list optimization to Off and restart. To roll back, close Obsidian and restore the three backed-up plugin files, keeping `data.json`. Emulator checks do not establish physical-device speed or sync safety.
