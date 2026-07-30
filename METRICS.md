# 匿名利用計測

`product_events`は内容を持たない操作名だけを保持します。

| イベント           | 意味                             |
| ------------------ | -------------------------------- |
| `visited`          | ページを開いた                   |
| `book_searched`    | 書誌検索が完了した               |
| `book_added`       | 本を棚へ追加した                 |
| `progress_updated` | 現在頁を記録した                 |
| `book_finished`    | 読了として記録した               |
| `review_opened`    | 読書の歩みを開いた               |
| `share_card_saved` | 内容を含まない共有画像を保存した |
| `csv_exported`     | CSVを保存した                    |
| `project_exported` | 編集用`.shiori`を保存した        |
| `project_imported` | 編集用`.shiori`を読み込んだ      |
| `returned`         | 前回とは別の日に戻った           |

書名、著者、ISBN、出版社、検索語、頁数、読書時刻、評価、タグ、メモ、ファイル名、IP、User-Agentはイベント表へ保存しません。

## 派生指標

- `book_adders`: 本を1冊以上追加した人数
- `progress_updaters`: 現在頁を1回以上記録した人数
- `five_book_users`: `book_added`が5回以上の人数
- `three_day_readers`: `progress_updated`が3日以上ある人数
- `readers_spanning_7d`: 最初と最後の進捗更新が7日以上離れた人数
- `three_update_readers`: 進捗更新が3回以上の人数
- `carry_percent`: 振り返り・共有画像・CSV・編集用保存の最大利用者数 ÷ 進捗更新者

同じ本の削除と再追加などで`five_book_users`が過大になる可能性があります。匿名性を守るため本の識別子を送らず、30日判断では補助指標として扱います。

## 品質境界

- `is_qa=1`を実利用から除外
- 匿名UUIDはブラウザー内で生成
- 保持期間は最大45日
- 許可リスト外のイベントと追加フィールドは拒否
- SQL定義変更時はテストとこの文書を同時更新
