// Client half of the dsh-price-chip bundle: a persistent sidebar-foot chip that
// shows the DeepSeek price period (off-peak / peak), the currently selected
// model's cache-hit / cache-miss / output prices per million tokens, the
// account balance and today's spend.
window.__ModuleLoader__.load({
  id: 'dsh-price-chip',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    let ReactDOM = null
    try {
      ReactDOM = require('react-dom')
    } catch {
      ReactDOM = null
    }

    const NS = 'model-pricing'

    // ---------------------------------------------------------------------
    // Price table: [off-peak, peak] per million tokens, in CNY.
    // Source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
    // Edit here when DeepSeek publishes new prices.
    // ---------------------------------------------------------------------
    const PRICES = {
      'deepseek-flash': {
        hit: [0.02, 0.04],
        miss: [1.0, 2.0],
        out: [4.0, 8.0],
      },
      'deepseek-v4-pro': {
        hit: [0.15, 0.3],
        miss: [4.5, 9.0],
        out: [13.5, 27.0],
      },
    }

    // Peak = Beijing time, Monday-Friday, 09:00-12:00 and 14:00-18:00, on days
    // that are not Chinese statutory holidays. Everything else is off-peak.
    const PEAK_WINDOWS = [
      [9 * 60, 12 * 60],
      [14 * 60, 18 * 60],
    ]

    // 2026 statutory holiday ranges (inclusive), State Council notice.
    const HOLIDAY_RANGES = [
      ['2026-01-01', '2026-01-03'],
      ['2026-02-15', '2026-02-23'],
      ['2026-04-04', '2026-04-06'],
      ['2026-05-01', '2026-05-05'],
      ['2026-06-19', '2026-06-21'],
      ['2026-09-25', '2026-09-27'],
      ['2026-10-01', '2026-10-07'],
    ]

    const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
    const DAY_MS = 24 * 60 * 60 * 1000

    const PARTS_FORMAT = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    })

    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    function buildHolidays() {
      const days = new Set()
      for (const [from, to] of HOLIDAY_RANGES) {
        const start = Date.parse(from + 'T00:00:00Z')
        const end = Date.parse(to + 'T00:00:00Z')
        for (let at = start; at <= end; at += DAY_MS) {
          const day = new Date(at)
          days.add(
            `${day.getUTCFullYear()}-${pad2(day.getUTCMonth() + 1)}-${pad2(day.getUTCDate())}`,
          )
        }
      }
      return days
    }

    const HOLIDAYS = buildHolidays()

    /** Beijing-time calendar fields for one instant. */
    function shanghaiParts(ms) {
      const parts = {}
      for (const part of PARTS_FORMAT.formatToParts(new Date(ms))) {
        if (part.type !== 'literal') parts[part.type] = part.value
      }
      return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
        weekday: parts.weekday,
      }
    }

    function dateKey(parts) {
      return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
    }

    /** @returns {'offpeak'|'peak'} */
    function periodAt(ms) {
      const parts = shanghaiParts(ms)
      if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return 'offpeak'
      if (HOLIDAYS.has(dateKey(parts))) return 'offpeak'
      const minutes = parts.hour * 60 + parts.minute
      for (const [from, to] of PEAK_WINDOWS) {
        if (minutes >= from && minutes < to) return 'peak'
      }
      return 'offpeak'
    }

    /** Absolute instant of a Beijing-time wall clock within the given day. */
    function shanghaiInstant(year, month, day, minutes) {
      return Date.UTC(year, month - 1, day, 0, minutes) - SHANGHAI_OFFSET_MS
    }

    /** First instant after `now` whose period differs from the current one. */
    function nextSwitchAt(now) {
      const current = periodAt(now)
      const base = shanghaiParts(now)
      for (let offset = 0; offset <= 21; offset += 1) {
        const day = new Date(Date.UTC(base.year, base.month - 1, base.day + offset))
        const year = day.getUTCFullYear()
        const month = day.getUTCMonth() + 1
        const date = day.getUTCDate()
        for (const minutes of [0, 9 * 60, 12 * 60, 14 * 60, 18 * 60]) {
          const at = shanghaiInstant(year, month, date, minutes)
          if (at <= now) continue
          if (periodAt(at) !== current) return at
        }
      }
      return null
    }

    function money(value) {
      return value.toFixed(2)
    }

    /** Two-decimal rendering of an arbitrary numeric string from the platform. */
    function amountText(value) {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed.toFixed(2) : String(value)
    }

    function dayText(target, now, t) {
      if (target.year === now.year && target.month === now.month && target.day === now.day) {
        return t('day.today')
      }
      const tomorrow = new Date(Date.UTC(now.year, now.month - 1, now.day + 1))
      if (
        target.year === tomorrow.getUTCFullYear() &&
        target.month === tomorrow.getUTCMonth() + 1 &&
        target.day === tomorrow.getUTCDate()
      ) {
        return t('day.tomorrow')
      }
      return t('day.other', { m: target.month, d: target.day })
    }

    function relativeText(at, now, t) {
      const minutes = Math.max(0, Math.round((at - now) / 60000))
      if (minutes < 1) return t('rel.now')
      if (minutes < 60) return t('rel.minutes', { m: minutes })
      if (minutes < 24 * 60) {
        const hours = Math.floor(minutes / 60)
        const rest = minutes % 60
        return rest === 0
          ? t('rel.hoursExact', { h: hours })
          : t('rel.hours', { h: hours, m: rest })
      }
      return t('rel.days', { d: Math.round(minutes / (24 * 60)) })
    }

    function nextSwitchText(now, t) {
      const at = nextSwitchAt(now)
      if (at === null) return t('next.none')
      const target = shanghaiParts(at)
      const when = `${dayText(target, shanghaiParts(now), t)} ${pad2(target.hour)}:${pad2(target.minute)}`
      return t('next.format', { when, rel: relativeText(at, now, t) })
    }

    const CSS = [
      '.dsh-mp-chip{display:flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0;max-width:100%;box-sizing:border-box;margin:0;padding:4px 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:16px;text-align:left;cursor:pointer;white-space:nowrap;overflow:hidden}',
      '.dsh-mp-chip:hover{background:var(--dsw-alias-bg-layer-1)}',
      '.dsh-mp-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsh-mp-chip-rail{justify-content:center;flex:0 0 auto;padding:4px}',
      '.dsh-mp-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary)}',
      '.dsh-mp-dot.is-peak{background:var(--dsw-alias-state-warn-primary)}',
      '.dsh-mp-chip-text{display:flex;flex-direction:column;min-width:0;gap:1px}',
      '.dsh-mp-chip-line{display:flex;align-items:baseline;gap:4px;min-width:0}',
      '.dsh-mp-period{color:var(--dsw-alias-label-primary);font-weight:500}',
      '.dsh-mp-model{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis}',
      '.dsh-mp-numbers{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:10px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-mp-account{display:flex;align-items:baseline;gap:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:10px;line-height:14px;min-width:0;overflow:hidden;white-space:nowrap}',
      '.dsh-mp-account-value{color:var(--dsw-alias-label-primary)}',
      '.dsh-mp-unit{color:var(--dsw-alias-label-secondary);opacity:.7;font-size:11px}',
      '.dsh-mp-rail{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}',
      '.dsh-mp-pop{position:fixed;z-index:1200;width:248px;box-sizing:border-box;padding:10px 12px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 10px 28px rgba(0,0,0,.18);font-size:12px;line-height:18px}',
      '.dsh-mp-pop-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.dsh-mp-pop-title{color:var(--dsw-alias-label-secondary);font-size:11px;letter-spacing:.02em}',
      '.dsh-mp-period-chip{display:inline-flex;align-items:center;gap:5px;padding:1px 8px 1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:11px;line-height:18px}',
      '.dsh-mp-pop-model{margin-top:6px;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-mp-rows{margin-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dsh-mp-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dsh-mp-row:last-child{border-bottom:0}',
      '.dsh-mp-row-label{color:var(--dsw-alias-label-secondary)}',
      '.dsh-mp-row-value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-weight:600}',
      '.dsh-mp-row-value small{margin-left:2px;color:var(--dsw-alias-label-secondary);font-weight:400;font-size:11px}',
      '.dsh-mp-note{margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px}',
    ].join('')

    // ---------------------------------------------------------------------
    // Dictionaries
    // ---------------------------------------------------------------------
    const zh = {
      'period.offpeak': '空闲',
      'period.peak': '高峰',
      'price.hit': '缓存命中',
      'price.miss': '缓存未命中',
      'price.output': '输出',
      'price.none': '暂无价格',
      'unit.short': '元/M',
      'unit.cny': '元',
      'unit.full': '单位：元 / 百万 tokens；空闲价为高峰价的一半',
      'label.short.hit': '缓存',
      'label.short.input': '输入',
      'label.short.output': '输出',
      'popover.title': '模型价格',
      'model.none': '未选择模型',
      'next.label': '下次切换',
      'next.format': '{when}（{rel}）',
      'next.none': '暂无',
      'day.today': '今天',
      'day.tomorrow': '明天',
      'day.other': '{m}月{d}日',
      'rel.now': '即将',
      'rel.minutes': '{m} 分钟后',
      'rel.hours': '{h} 小时 {m} 分后',
      'rel.hoursExact': '{h} 小时后',
      'rel.days': '{d} 天后',
      'chip.aria': '模型价格：{period}；缓存命中 {hit}，缓存未命中 {miss}，输出 {out}，单位元每百万 tokens',
      'chip.aria.none': '模型价格：{period}；当前模型暂无价格数据',
      'acct.balance': '余额',
      'acct.today': '今日',
      'acct.none': '—',
    }

    const en = {
      'period.offpeak': 'Off-peak',
      'period.peak': 'Peak',
      'price.hit': 'Cache hit',
      'price.miss': 'Cache miss',
      'price.output': 'Output',
      'price.none': 'No price',
      'unit.short': 'CNY/M',
      'unit.cny': 'CNY',
      'unit.full': 'Unit: CNY per million tokens; off-peak is half of the peak price',
      'label.short.hit': 'cache',
      'label.short.input': 'input',
      'label.short.output': 'output',
      'popover.title': 'Model pricing',
      'model.none': 'No model selected',
      'next.label': 'Next switch',
      'next.format': '{when} ({rel})',
      'next.none': '—',
      'day.today': 'Today',
      'day.tomorrow': 'Tomorrow',
      'day.other': '{m}/{d}',
      'rel.now': 'any moment',
      'rel.minutes': 'in {m} min',
      'rel.hours': 'in {h} h {m} min',
      'rel.hoursExact': 'in {h} h',
      'rel.days': 'in {d} days',
      'chip.aria': 'Model pricing: {period}; cache hit {hit}, cache miss {miss}, output {out} CNY per million tokens',
      'chip.aria.none': 'Model pricing: {period}; no price data for the current model',
      'acct.balance': 'Balance',
      'acct.today': 'Today',
      'acct.none': '—',
    }

    // ---------------------------------------------------------------------
    // Component
    // ---------------------------------------------------------------------
    function createFooter(ctx) {
      function PriceFooter({ wide }) {
        const t = ctx.locale.bind(NS)
        const [, refreshLocale] = React.useReducer((value) => value + 1, 0)
        React.useEffect(() => ctx.locale.subscribe(refreshLocale), [ctx])

        const [now, setNow] = React.useState(() => Date.now())
        const [balance, setBalance] = React.useState(null)
        const [todayCny, setTodayCny] = React.useState(null)
        React.useEffect(() => {
          let disposed = false
          /** Today's spend and the account balance, both served by the Host half. */
          const refresh = () => {
            setNow(Date.now())
            try {
              Promise.resolve(
                window.fetch('/model-pricing/usage', { headers: { accept: 'application/json' }, cache: 'no-store' }),
              )
                .then((response) => (response.ok ? response.json() : null))
                .then((value) => {
                  if (disposed || value === null || value === undefined) return
                  if (value.ok === true && typeof value.todayCny === 'number') setTodayCny(value.todayCny)
                  const wallet = value.balance
                  if (wallet !== null && wallet !== undefined && typeof wallet.cny === 'number') {
                    setBalance(wallet.cny)
                  } else {
                    setBalance(null)
                  }
                })
                .catch(() => {})
            } catch {
              /* the previous figures stay when the route is unavailable */
            }
          }
          refresh()
          const timer = window.setInterval(refresh, 30000)
          return () => {
            disposed = true
            window.clearInterval(timer)
          }
        }, [ctx])

        const subscribeSession = React.useCallback(
          (listener) => ctx.uiSession.current.subscribe(listener),
          [ctx],
        )
        const getSession = React.useCallback(
          () => ctx.uiSession.current.getSnapshot(),
          [ctx],
        )
        const current = React.useSyncExternalStore(subscribeSession, getSession)
        const sessionId = current === undefined || current === null ? undefined : current.key

        const [directory, setDirectory] = React.useState(null)
        React.useEffect(() => {
          if (sessionId === undefined) {
            setDirectory(null)
            return
          }
          let next = null
          try {
            next = ctx.modelDirectories.directoryFor(sessionId)
          } catch {
            next = null
          }
          setDirectory(next)
          if (next !== null) {
            try {
              Promise.resolve(next.load()).catch(() => {})
            } catch {
              /* ignore a failed catalog reload; the next snapshot may still resolve */
            }
          }
        }, [ctx, sessionId])

        const store = directory === null ? null : directory.store
        const subscribeModel = React.useCallback(
          (listener) => (store === null ? () => {} : store.subscribe(listener)),
          [store],
        )
        const getModel = React.useCallback(
          () => (store === null ? null : store.getSnapshot()),
          [store],
        )
        const modelState = React.useSyncExternalStore(subscribeModel, getModel)

        const selection = modelState === null ? null : modelState.current
        let modelName = t('model.none')
        if (selection !== null && selection !== undefined) {
          modelName = selection.model
          if (modelState !== null && Array.isArray(modelState.groups)) {
            for (const group of modelState.groups) {
              if (group.id !== selection.provider) continue
              for (const model of group.models) {
                if (model.id === selection.model) modelName = model.name
              }
            }
          }
        }

        let pricing = null
        if (selection !== null && selection !== undefined && selection.provider.startsWith('deepseek')) {
          pricing = PRICES[selection.model] ?? null
        }
        const period = periodAt(now)
        const isPeak = period === 'peak'
        const periodLabel = t(isPeak ? 'period.peak' : 'period.offpeak')
        const index = isPeak ? 1 : 0
        const values =
          pricing === null
            ? null
            : {
                hit: pricing.hit[index],
                miss: pricing.miss[index],
                out: pricing.out[index],
              }
        const unit = t('unit.short')
        const numbers =
          values === null
            ? t('price.none')
            : [
                `${money(values.hit)}(${t('label.short.hit')})`,
                `${money(values.miss)}(${t('label.short.input')})`,
                `${money(values.out)}(${t('label.short.output')})`,
              ].join('/')
        const aria =
          values === null
            ? t('chip.aria.none', { period: periodLabel })
            : t('chip.aria', {
                period: periodLabel,
                hit: money(values.hit),
                miss: money(values.miss),
                out: money(values.out),
              })
        const balanceText = balance === null ? t('acct.none') : `¥${amountText(balance)}`
        const todayText = todayCny === null ? t('acct.none') : `¥${amountText(todayCny)}`

        const [open, setOpen] = React.useState(false)
        const [anchor, setAnchor] = React.useState(null)
        const buttonRef = React.useRef(null)
        const popRef = React.useRef(null)

        const place = React.useCallback(() => {
          const button = buttonRef.current
          if (button === null) return
          const rect = button.getBoundingClientRect()
          const left = Math.min(
            Math.max(rect.left, 12),
            Math.max(12, window.innerWidth - 248 - 12),
          )
          setAnchor({ left, bottom: window.innerHeight - rect.top + 8 })
        }, [])

        React.useLayoutEffect(() => {
          if (open) place()
        }, [open, place])

        React.useEffect(() => {
          if (!open) return
          const onPointerDown = (event) => {
            if (popRef.current !== null && popRef.current.contains(event.target)) return
            if (buttonRef.current !== null && buttonRef.current.contains(event.target)) return
            setOpen(false)
          }
          const onKeyDown = (event) => {
            if (event.key !== 'Escape') return
            setOpen(false)
            if (buttonRef.current !== null) buttonRef.current.focus()
          }
          document.addEventListener('mousedown', onPointerDown)
          document.addEventListener('keydown', onKeyDown)
          window.addEventListener('resize', place)
          window.addEventListener('scroll', place, true)
          return () => {
            document.removeEventListener('mousedown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('resize', place)
            window.removeEventListener('scroll', place, true)
          }
        }, [open, place])

        const row = (label, value) =>
          h(
            'div',
            { className: 'dsh-mp-row' },
            h('span', { className: 'dsh-mp-row-label' }, label),
            h(
              'span',
              { className: 'dsh-mp-row-value' },
              value === null ? t('price.none') : money(value),
              value === null ? null : h('small', null, t('unit.cny')),
            ),
          )

        const popover =
          open && anchor !== null
            ? ReactDOM !== null
              ? ReactDOM.createPortal(
                  h(
                    'div',
                    {
                      ref: popRef,
                      className: 'dsh-mp-pop',
                      style: { left: anchor.left, bottom: anchor.bottom },
                      role: 'dialog',
                      'aria-label': t('popover.title'),
                    },
                    h(
                      'div',
                      { className: 'dsh-mp-pop-head' },
                      h('span', { className: 'dsh-mp-pop-title' }, t('popover.title')),
                      h(
                        'span',
                        { className: 'dsh-mp-period-chip' },
                        h('span', { className: 'dsh-mp-dot' + (isPeak ? ' is-peak' : '') }),
                        periodLabel,
                      ),
                    ),
                    h('div', { className: 'dsh-mp-pop-model' }, modelName),
                    h(
                      'div',
                      { className: 'dsh-mp-rows' },
                      row(t('price.hit'), values === null ? null : values.hit),
                      row(t('price.miss'), values === null ? null : values.miss),
                      row(t('price.output'), values === null ? null : values.out),
                      h(
                        'div',
                        { className: 'dsh-mp-row' },
                        h('span', { className: 'dsh-mp-row-label' }, t('acct.balance')),
                        h('span', { className: 'dsh-mp-row-value' }, balanceText),
                      ),
                      h(
                        'div',
                        { className: 'dsh-mp-row' },
                        h('span', { className: 'dsh-mp-row-label' }, t('acct.today')),
                        h('span', { className: 'dsh-mp-row-value' }, todayText),
                      ),
                    ),
                    h('div', { className: 'dsh-mp-note' }, t('unit.full')),
                    h(
                      'div',
                      { className: 'dsh-mp-note' },
                      `${t('next.label')} ${nextSwitchText(now, t)}`,
                    ),
                  ),
                  document.body,
                )
              : null
            : null

        const chip = h(
          'button',
          {
            ref: buttonRef,
            type: 'button',
            className: wide ? 'dsh-mp-chip' : 'dsh-mp-chip dsh-mp-chip-rail',
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-label': aria,
            onClick: () => setOpen((value) => !value),
          },
          h('span', { className: 'dsh-mp-dot' + (isPeak ? ' is-peak' : '') }),
          wide
            ? h(
                'span',
                { className: 'dsh-mp-chip-text' },
                h(
                  'span',
                  { className: 'dsh-mp-chip-line' },
                  h('span', { className: 'dsh-mp-period' }, periodLabel),
                  h('span', { className: 'dsh-mp-model' }, modelName),
                ),
                h(
                  'span',
                  { className: 'dsh-mp-chip-line' },
                  h('span', { className: 'dsh-mp-numbers' }, numbers),
                  h('span', { className: 'dsh-mp-unit' }, unit),
                ),
                h(
                  'span',
                  { className: 'dsh-mp-account' },
                  h('span', null, `${t('acct.balance')} `, h('span', { className: 'dsh-mp-account-value' }, balanceText)),
                  h('span', null, `${t('acct.today')} `, h('span', { className: 'dsh-mp-account-value' }, todayText)),
                ),
              )
            : h('span', { className: 'dsh-mp-rail' }, '¥'),
        )

        return h(React.Fragment, null, chip, popover)
      }

      return PriceFooter
    }

    const inject = ['slots', 'locale', 'uiSession', 'modelDirectories']

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh,
            en,
          }),
        'model-pricing: dictionaries',
      )

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-price-chip'
        style.dataset.pluginCss = 'dsh-price-chip/client.css'
        style.textContent = CSS
        document.head.append(style)
        return () => {
          style.remove()
        }
      }, 'model-pricing: styles')

      const Footer = createFooter(ctx)
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'model-pricing',
            order: 20,
          },
          Footer,
        ),
      )
    }

    return {
      inject,
      apply,
    }
  },
})
