# dsh-price-chip

A DeepSeek Harness sidebar chip that answers two questions at a glance: **which
price period is it right now**, and **what does the model I am talking to cost**.

The chip sits at the bottom of the left sidebar. It shows:

- the current DeepSeek price period — **off-peak** or **peak** (Beijing time);
- the model bound to the open session;
- the model's price per **1M tokens** for **cache hit / cache miss / output**, in CNY;
- the DeepSeek account **balance** and **today's spend**, refreshed every 30 seconds.

Clicking the chip opens a popover with the three prices and their unit, the
account balance, today's spend, and when the price period next switches.

## Install

```sh
dsh plugin add github:DQS-PUBLIC/dsh-price-chip
```

Then restart the harness. The chip appears in the sidebar footer; the collapsed
sidebar shows a `¥` badge instead of the text.

Requires DeepSeek Harness 0.2.x with the web UI.

## Price periods

DeepSeek bills discounted prices outside its peak windows. The plugin treats
**09:00–12:00 and 14:00–18:00, Monday to Friday, Beijing time** as peak, and
skips mainland China's statutory holidays (the holiday table is in
`client.js` / `index.js` and needs a yearly edit). Everything else is off-peak.

Prices per 1M tokens (CNY, off-peak / peak):

| Model | Cache hit | Cache miss | Output |
| --- | --- | --- | --- |
| `deepseek-flash` | 0.02 / 0.04 | 1.00 / 2.00 | 4.00 / 8.00 |
| `deepseek-v4-pro` | 0.15 / 0.30 | 4.50 / 9.00 | 13.50 / 27.00 |

The table is copied from the official pricing page
(<https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>) and is editable in
one place per half of the plugin if prices change.

## How the numbers are produced

- **Balance** comes from the signed-in DeepSeek account through the harness
  account service. When no account is connected the chip shows `—`.
- **Today's spend** is computed from this machine's session logs: every
  assistant message that reported token usage today is priced at the rate that
  applied at its own timestamp, then summed. Sessions are read through
  `sessionQuery`, cached for 20 seconds on the host.
- The chip polls one same-origin route, `/model-pricing/usage`, every 30
  seconds. Nothing leaves the machine, and the plugin has no third-party
  dependencies and no build step.

## Layout

```
index.js          host half: prices, holiday table, today's-spend aggregation, route
client.js         client half: sidebar slot, chip, popover, styles, zh/en strings
cordis.patch.yml  loader row
locale/           zh.json, en.json
icon.svg          source icon
```

## License

MIT
