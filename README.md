# 栞棚

読みたい本、読んでいる頁、読了日、私的な感想を、公開せず端末内の棚へ残すローカルファーストの読書台帳です。

## できること

- 書名・ISBNと任意の著者名から国立国会図書館サーチを検索し、書誌情報を取り込む
- 手入力、または一行一冊の貼り付けで最大500冊を棚に置く
- 読みたい・積んでいる・読んでいる・読了・ひと休みの状態を管理する
- 現在頁、読書日、私的メモ、評価、タグ、再読回数を最大5,000件のしおりとして残す
- 12週間の読書量と最近のしおりを振り返る
- 書名やメモを含まない共有画像、CSV、編集用`.shiori`を保存する

本、頁、評価、タグ、メモはIndexedDBに保存され、栞棚のサーバーへは送信されません。アカウント、SNS、公開レビュー、ランキング、広告、通知、決済は持ちません。

## 開発

```powershell
npm install
npm run dev
npm run check
npm test
npm run build
```

公開前の契約監査は`npm run release:check`、D1を含む公開は`npm run deploy`です。Cloudflare D1作成後、`wrangler.jsonc`の`database_id`を置き換えてください。

## 運用

- 公開先: <https://shiori-dana.yhay81.com/>
- 匿名イベントの保持期間: 最大45日
- 書誌検索: [国立国会図書館サーチAPI](https://ndlsearch.ndl.go.jp/help/api)
- 30日判断: [EXPERIMENT.md](./EXPERIMENT.md)
- 計測定義: [METRICS.md](./METRICS.md)
- 保存境界: [PRIVACY.md](./PRIVACY.md)

現在は`yhay81`の個人・非収益パイロットです。収益化または`haya-inc`移管前に、国立国会図書館サーチAPIと各データ提供元の利用条件を再確認し、必要な申請を行います。

## License

MIT
