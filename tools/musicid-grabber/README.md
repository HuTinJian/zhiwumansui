# Music ID Grabber (console edition) v1.1

A paste-into-your-browser tool that pulls numeric music/asset IDs out of a web
page, dedupes them, and exports a CSV that Excel/WPS can open directly.

It exists to solve one problem: you should never have to copy thousands of IDs
by hand.

**Every file in this folder is pure ASCII (zero Chinese bytes).**

---

## 1. Quick start (3 steps)

1. Open the target page in Chrome / Edge / 360 / QQ Browser.
2. Press **F12** and click the **Console** tab.
3. Open `musicid-grabber.js`, select all, copy, paste into the Console, press **Enter**.

> **The one trap everyone hits:** Chrome and Edge block the first paste with
> `Warning: Don't paste code you don't understand...`
> Fix: type **`allow pasting`** in the Console and press Enter, then paste again.
> You only do this once per browser. Firefox has no such block.

A small dark panel titled **Music ID Grabber v1.1** appears in the bottom-right.

---

## 2. The five buttons

| Button | What it does | Use it when |
|---|---|---|
| `1) Grab this page` | Immediately extracts IDs from the current page | Everything is on one page (a long forum post, a doc) |
| `2) Auto pages (list pages)` | Walks pages by itself until done or blocked | **List pages**: forums, `?page=` URLs, `pn=` URLs |
| `3) Follow mode (scroll pages)` | Re-scans every 2.5s while you scroll/click | **Infinite scroll**: Bilibili, Tencent Channels, dynamic lists |
| `4) Export CSV` | Downloads a CSV (UTF-8 + BOM, no mojibake in Excel) | When you are done |
| `5) Clear all data` | Wipes stored records | Before switching to another list |

Bottom checkbox **Filter noise (recommended)**:
- checked = strict mode, drops fake IDs such as like counts, phone numbers,
  dates and floor numbers;
- unchecked = loose mode, grabs everything (filter later in Excel).

---

## 3. It still reads Chinese pages fine

The UI is English and the sources are ASCII-only, but that does not limit what
it can read. Chinese noise words (likes / views / floor) are written as
`\uXXXX` escapes inside a regex, so the file stays ASCII while the filter still
works on Chinese text. Chinese song titles are paired with their IDs as usual.

Two automated tests prove it (see section 7).

---

## 4. Tencent Channels (pd.qq.com)

`pd.qq.com` was verified reachable over the web (HTTP 200).

- **If the channel/post opens in the web version** -> open it, paste the script,
  click **`3) Follow mode`**, scroll to the end, then **`4) Export CSV`**.
  (Tencent Channels loads on scroll, so follow mode is the right one; auto
  pagination needs `?page=` style URLs.)
- **If it only exists inside the phone app** -> either copy the text and send it
  to your PC, or take screenshots; both can be cleaned up offline afterwards.

---

## 5. Where the result goes

Clicking `4) Export CSV` downloads a file named like:

```
music-ids-pd.qq.com-1735689000000.csv
```

It lands in your browser's **Downloads** folder. Columns:

| ID | Name/Context | SourceURL | Page | CapturedAt |
|---|---|---|---|---|

`Name/Context` is the raw text of the line the ID was found on. It is a hint for
manual checking, not a guaranteed song title.

---

## 6. Safety notes

- **Nothing is uploaded.** Records live in your own browser `localStorage`.
- **No password or cookie access, no page modification.** Search the source for
  `fetch`: the only network call is "Auto pages", which requests the next page
  of the *same site you are already viewing*.
- **Nothing gets installed.** It is pasted code; closing the tab removes it.
- The panel has `5) Clear all data` and `Close panel (keep data)`.
- Compared with random userscripts from the internet, this one you can actually
  read, and it leaves nothing persistent behind.

---

## 7. Tests (both automated, nothing to click)

**a) Pure logic**

```bash
node self-test.js
```

Covers pager detection, next-page URL building, ID extraction, noise filtering,
dedupe rules and the ASCII-ness of the noise regex. Currently **16 checks, all pass**.

**b) End-to-end in a real browser**

```bash
msedge --headless=new --disable-gpu --dump-dom --virtual-time-budget=5000 smoke-test.html
```

Expected output:

```json
{"panel":true,"added":5,"nameOk":true,"ids":[1836547290,1836547291,1837007494,1838999999,1841234567],"error":null}
```

> This test already caught a real bug: in the first version,
> `document.cloneNode(true)` returns an **empty document with no children**, so
> no page text was ever scanned (only IDs inside links were found). Fixed by
> dropping to `body` before cloning. Pure unit tests could never have caught it.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "wants verification -> stopped" | Site anti-bot | Use `3) Follow mode` and page manually |
| "No paging parameter found" | Page does not page via the URL | Same: use follow mode |
| Only noise captured | Page is full of numbers | Keep "Filter noise" checked, or filter by digit count in Excel |
| Panel never appears | Paste blocked or page CSP | Confirm `allow pasting`; try another browser |
| No download | Browser blocked automatic downloads | Allow downloads for that site |

---

## 9. Caveats

- An ID in hand does not mean it is usable. Many Roblox audio assets are
  private; verify availability after collecting.
- Keep the pace civil. The script already sleeps 1.2-2s between pages; do not
  turn it into a fast concurrent crawler.
- This tool only converts page content **you can already see** into a table. It
  does not bypass logins, captchas or paywalls.
