// Prefix search modes for omarchy-menu-prefixes.
//
// Pure JS with no QML dependencies so the config parsing, prefix resolution,
// and template expansion logic can be unit-tested with plain `node` (see
// tests/prefixes.test.js). Menu.qml imports this the same way it imports
// MenuModel.js.

// JSONC stripping identical to MenuModel.js (duplicated rather than imported
// so this file stays loadable by plain node).
function stripJsonc(raw) {
  return String(raw || "")
    .replace(/^\s*\/\/[^\n]*(\n|$)/gm, "")
    .replace(/,(\s*[}\]])/g, "$1")
}

// Single-quote a string for bash, matching Util.shellQuote in the shell.
function shellQuote(value) {
  return "'" + String(value || "").replace(/'/g, "'\\''") + "'"
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function clampInt(value, min, max, fallback) {
  var parsed = parseInt(value, 10)
  if (!isFinite(parsed)) parsed = fallback
  return Math.min(max, Math.max(min, parsed))
}

// Kinds a prefix entry may declare. `file` comes from the dedicated `file`
// config section; the rest live in the `prefixes` map.
var VALID_KINDS = ["file", "web", "cmd", "calc", "currency"]

// Resolve a prefix entry's icons. Prefer fontIcon/appIcon; fall back to the
// legacy `icon` key as fontIcon so older configs keep working.
function entryIcons(entry) {
  var src = isPlainObject(entry) ? entry : ({})
  return {
    fontIcon: String(src.fontIcon || src.icon || ""),
    appIcon: String(src.appIcon || "")
  }
}

// Baked-in defaults, used verbatim when no user config exists and as the
// base the user config overlays. fontIcon values are Nerd Font glyphs (BMP
// codepoints so they can be written as \uXXXX escapes in both JS and JSONC).
// appIcon values are Freedesktop theme icon names (same as desktop Icon=).
function defaultConfig() {
  return {
    file: {
      prefix: "file:",
      label: "Files",
      fontIcon: "\uf15b",
      appIcon: "",
      maxResults: 60,
      caseInsensitive: true
    },
    prefixes: {
      "g:": {
        kind: "web",
        label: "Google",
        fontIcon: "\uf1a0",
        appIcon: "",
        url: "https://www.google.com/search?q={query}"
      },
      "yt:": {
        kind: "web",
        label: "YouTube",
        fontIcon: "\uf167",
        appIcon: "",
        url: "https://www.youtube.com/results?search_query={query}"
      },
      "=": { kind: "calc", label: "Calculator", fontIcon: "\uf1ec", appIcon: "" },
      "!": { kind: "currency", label: "Currency", fontIcon: "\uf155", appIcon: "" }
    }
  }
}

// Parse a JSONC config body. Returns the parsed object, or null when empty
// or invalid (caller falls back to defaults).
function parseConfig(raw) {
  var stripped = stripJsonc(raw)
  if (!stripped.trim()) return null
  var parsed
  try {
    parsed = JSON.parse(stripped)
  } catch (e) {
    return null
  }
  return isPlainObject(parsed) ? parsed : null
}

// Per-key merge of one config entry. An overlay key always wins; keys only
// present in the base survive (so a user can tweak just the fontIcon of `g:`).
function mergeEntry(base, overlay) {
  var out = ({})
  if (isPlainObject(base)) {
    for (var k in base) out[k] = base[k]
  }
  if (isPlainObject(overlay)) {
    for (var k2 in overlay) out[k2] = overlay[k2]
  }
  // Legacy `icon` → fontIcon when the overlay only set the old key.
  if (isPlainObject(overlay) && overlay.icon != null && overlay.fontIcon == null) {
    out.fontIcon = overlay.icon
  }
  return out
}

// Merge a user config over the defaults. The `file` section merges per-key;
// each `prefixes` entry merges per-key, and an explicit null removes that
// prefix entirely.
function mergeConfig(defaults, user) {
  var base = defaults || defaultConfig()
  var overlay = user || ({})

  var prefixes = ({})
  var basePrefixes = isPlainObject(base.prefixes) ? base.prefixes : ({})
  var overlayPrefixes = isPlainObject(overlay.prefixes) ? overlay.prefixes : ({})

  var keys = Object.keys(basePrefixes)
  for (var i = 0; i < keys.length; i++) {
    if (overlayPrefixes[keys[i]] === null) continue // removed by the user
    prefixes[keys[i]] = mergeEntry(basePrefixes[keys[i]], overlayPrefixes[keys[i]])
  }

  var overlayKeys = Object.keys(overlayPrefixes)
  for (var j = 0; j < overlayKeys.length; j++) {
    var key = overlayKeys[j]
    if (prefixes[key] || overlayPrefixes[key] === null) continue
    prefixes[key] = mergeEntry(null, overlayPrefixes[key])
  }

  return {
    file: mergeEntry(base.file, overlay.file),
    prefixes: prefixes
  }
}

// Flatten a merged config into a match table: one record per prefix, sorted
// by descending prefix length so `gh:` wins over `g:` for "gh:omarchy".
// Invalid entries (unknown kind, web without url, cmd without cmd) are
// dropped rather than failing the whole config.
function normalizeTable(config) {
  var cfg = config || defaultConfig()
  var table = []
  var seen = ({})

  var fileCfg = isPlainObject(cfg.file) ? cfg.file : ({})
  var filePrefix = String(fileCfg.prefix || "")
  if (filePrefix) {
    seen[filePrefix] = true
    var fileIcons = entryIcons(fileCfg)
    table.push({
      prefix: filePrefix,
      kind: "file",
      label: String(fileCfg.label || "Files"),
      fontIcon: fileIcons.fontIcon,
      appIcon: fileIcons.appIcon,
      maxResults: clampInt(fileCfg.maxResults, 1, 500, 60),
      caseInsensitive: fileCfg.caseInsensitive !== false
    })
  }

  var prefixes = isPlainObject(cfg.prefixes) ? cfg.prefixes : ({})
  var keys = Object.keys(prefixes)
  for (var i = 0; i < keys.length; i++) {
    var prefix = String(keys[i] || "")
    var entry = prefixes[keys[i]]
    if (!prefix || seen[prefix]) continue
    if (!isPlainObject(entry)) continue
    var kind = String(entry.kind || "")
    if (VALID_KINDS.indexOf(kind) < 0) continue
    if (kind === "web" && !String(entry.url || "")) continue
    if (kind === "cmd" && !String(entry.cmd || "")) continue

    seen[prefix] = true
    var icons = entryIcons(entry)
    table.push({
      prefix: prefix,
      kind: kind,
      label: String(entry.label || ""),
      rowLabel: String(entry.rowLabel || ""),
      fontIcon: icons.fontIcon,
      appIcon: icons.appIcon,
      url: String(entry.url || ""),
      cmd: String(entry.cmd || "")
    })
  }

  table.sort(function(a, b) { return b.prefix.length - a.prefix.length })
  return table
}

// Longest configured prefix that `text` starts with, leaving at least one
// non-blank character of query after it. Returns
// { prefix, kind, query, entry } or null when nothing matches.
function resolvePrefix(text, table) {
  var value = String(text || "")
  var entries = Array.isArray(table) ? table : []
  for (var i = 0; i < entries.length; i++) {
    var prefix = entries[i].prefix
    if (!prefix || value.length <= prefix.length) continue
    if (value.indexOf(prefix) !== 0) continue
    var query = value.substring(prefix.length).trim()
    if (!query) continue
    return {
      prefix: prefix,
      kind: entries[i].kind,
      query: query,
      entry: entries[i]
    }
  }
  return null
}

// ---------------------------------------------------------------- templates

// Row label template for web/cmd prefixes. Placeholders:
//   {label}  -> entry label, or the prefix when label is empty
//   {query}  -> the text after the prefix
//   {prefix} -> the trigger string (e.g. "ob:")
function expandRowLabel(template, context) {
  var ctx = isPlainObject(context) ? context : ({})
  var label = String(ctx.label || "")
  var query = String(ctx.query || "")
  var prefix = String(ctx.prefix || "")
  return String(template || "").replace(/\{(label|query|prefix)\}/g, function(match, name) {
    if (name === "label") return label
    if (name === "query") return query
    if (name === "prefix") return prefix
    return match
  })
}

// Default row text when rowLabel is not set. web -> Search X for "…"; cmd ->
// Run X (or "Run command" when label is empty). mergedPrefixes is the merged
// config's `prefixes` map; when the flattened table entry lacks rowLabel (for
// example after a hot reload picked up config before updated PrefixModel.js),
// the template is read from there instead.
function formatRowLabel(kind, entry, prefix, query, mergedPrefixes) {
  var src = isPlainObject(entry) ? entry : ({})
  var prefixText = String(prefix || "")
  var queryText = String(query || "")
  var labelText = String(src.label || prefixText || "")
  var template = String(src.rowLabel || "")
  if (!template && isPlainObject(mergedPrefixes)) {
    var cfgEntry = mergedPrefixes[prefixText]
    if (isPlainObject(cfgEntry)) {
      template = String(cfgEntry.rowLabel || "")
      if (!src.label && cfgEntry.label) labelText = String(cfgEntry.label)
    }
  }
  if (template) {
    return expandRowLabel(template, {
      label: labelText,
      query: queryText,
      prefix: prefixText
    })
  }
  if (kind === "web") {
    return "Search " + (src.label || prefixText) + ' for "' + queryText + '"'
  }
  if (kind === "cmd") {
    return src.label ? ("Run " + src.label) : "Run command"
  }
  return labelText
}

// Web URL template: {query} becomes the URL-encoded search text. Replaced in
// a single pass so an encoded query can never re-enter the template.
function expandUrl(template, query) {
  var value = String(query || "")
  return String(template || "").replace(/\{query\}/g, function() {
    return encodeURIComponent(value)
  })
}

// Command template. Placeholders, replaced in one pass:
//   {query}    -> the input, shell-quoted (passed to the command as ONE argument)
//   {urlquery} -> the input, URL-encoded then shell-quoted (for URI arguments)
//   {raw}      -> the input, substituted verbatim (treated as shell code)
// {urlquery} exists so a command that builds a URI never has to interpolate
// the input inside quotes it wrote itself, which is how a query containing a
// quote character escapes into shell syntax.
function expandCommand(template, query) {
  var value = String(query || "")
  return String(template || "").replace(/\{(query|urlquery|raw)\}/g, function(match, name) {
    if (name === "raw") return value
    if (name === "urlquery") return shellQuote(encodeURIComponent(value))
    return shellQuote(value)
  })
}

// ------------------------------------------------------------- calculator
//
// The calculator is a tokenizer plus a recursive-descent parser that computes
// as it parses. It never builds a string that gets handed to Function() or
// eval(): the only things it can do are the arithmetic below and the Math
// calls named in CALC_FUNCTIONS, so an expression has no reachable path to
// the surrounding QML scope no matter what is typed.

// Longest expression accepted. The menu filter can be pasted into and every
// keystroke re-evaluates, so cap the work per keystroke.
var CALC_MAX_LENGTH = 256
// Parenthesis/call nesting limit, so a pasted "((((((…" cannot recurse the
// parser deep enough to exhaust the JS stack.
var CALC_MAX_DEPTH = 32

var CALC_CONSTANTS = ({ pi: Math.PI, e: Math.E })

function calcFixed(count, call) {
  return { minArgs: count, maxArgs: count, call: call }
}

function calcVariadic(minimum, call) {
  return { minArgs: minimum, maxArgs: Infinity, call: call }
}

// Every callable the calculator knows, keyed by lowercase spelling so
// "SQRT"/"Sqrt"/"sqrt" all work. Arity is checked at parse time so
// "pow(2)" is a parse error rather than a silent NaN.
var CALC_FUNCTIONS = ({
  sqrt: calcFixed(1, function(a) { return Math.sqrt(a[0]) }),
  cbrt: calcFixed(1, function(a) { return Math.cbrt(a[0]) }),
  abs: calcFixed(1, function(a) { return Math.abs(a[0]) }),
  sin: calcFixed(1, function(a) { return Math.sin(a[0]) }),
  cos: calcFixed(1, function(a) { return Math.cos(a[0]) }),
  tan: calcFixed(1, function(a) { return Math.tan(a[0]) }),
  asin: calcFixed(1, function(a) { return Math.asin(a[0]) }),
  acos: calcFixed(1, function(a) { return Math.acos(a[0]) }),
  atan: calcFixed(1, function(a) { return Math.atan(a[0]) }),
  log: calcFixed(1, function(a) { return Math.log(a[0]) }),
  log2: calcFixed(1, function(a) { return Math.log2(a[0]) }),
  log10: calcFixed(1, function(a) { return Math.log10(a[0]) }),
  exp: calcFixed(1, function(a) { return Math.exp(a[0]) }),
  floor: calcFixed(1, function(a) { return Math.floor(a[0]) }),
  ceil: calcFixed(1, function(a) { return Math.ceil(a[0]) }),
  round: calcFixed(1, function(a) { return Math.round(a[0]) }),
  trunc: calcFixed(1, function(a) { return Math.trunc(a[0]) }),
  sign: calcFixed(1, function(a) { return Math.sign(a[0]) }),
  pow: calcFixed(2, function(a) { return Math.pow(a[0], a[1]) }),
  atan2: calcFixed(2, function(a) { return Math.atan2(a[0], a[1]) }),
  hypot: calcVariadic(1, function(a) { return Math.hypot.apply(Math, a) }),
  min: calcVariadic(1, function(a) { return Math.min.apply(Math, a) }),
  max: calcVariadic(1, function(a) { return Math.max.apply(Math, a) })
})

// Own-property lookups only. `"constructor" in CALC_FUNCTIONS` and
// `CALC_FUNCTIONS["__proto__"]` both answer from Object.prototype, so a plain
// `in` test would admit those two names into the allowlist.
function calcConstant(name) {
  return Object.prototype.hasOwnProperty.call(CALC_CONSTANTS, name) ? CALC_CONSTANTS[name] : undefined
}

function calcFunction(name) {
  return Object.prototype.hasOwnProperty.call(CALC_FUNCTIONS, name) ? CALC_FUNCTIONS[name] : null
}

function isCalcDigit(ch) {
  return ch >= "0" && ch <= "9"
}

function isCalcNameStart(ch) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_"
}

function isCalcNameChar(ch) {
  return isCalcNameStart(ch) || isCalcDigit(ch)
}

// Split an expression into number/name/operator/punctuation tokens. Returns
// null on the first character that has no arithmetic meaning, so nothing
// outside this grammar ever reaches the parser.
function tokenizeCalc(text) {
  var tokens = []
  var i = 0

  while (i < text.length) {
    var ch = text.charAt(i)

    if (ch === " " || ch === "\t") { i++; continue }

    if (isCalcDigit(ch) || ch === ".") {
      var numberStart = i
      while (isCalcDigit(text.charAt(i))) i++
      if (text.charAt(i) === ".") {
        i++
        while (isCalcDigit(text.charAt(i))) i++
      }
      // Exponent, but only when it is actually followed by digits — otherwise
      // the "e" belongs to the constant and "2e" stays a parse error rather
      // than becoming 2.
      if (text.charAt(i) === "e" || text.charAt(i) === "E") {
        var exponentStart = i
        i++
        if (text.charAt(i) === "+" || text.charAt(i) === "-") i++
        if (isCalcDigit(text.charAt(i))) {
          while (isCalcDigit(text.charAt(i))) i++
        } else {
          i = exponentStart
        }
      }
      var number = parseFloat(text.substring(numberStart, i))
      if (!isFinite(number)) return null
      tokens.push({ type: "number", value: number })
      continue
    }

    if (isCalcNameStart(ch)) {
      var nameStart = i
      while (i < text.length && isCalcNameChar(text.charAt(i))) i++
      tokens.push({ type: "name", value: text.substring(nameStart, i).toLowerCase() })
      continue
    }

    // "**" is accepted as a second spelling of "^".
    if (ch === "*" && text.charAt(i + 1) === "*") {
      tokens.push({ type: "op", value: "^" })
      i += 2
      continue
    }
    if (ch === "(") { tokens.push({ type: "lparen" }); i++; continue }
    if (ch === ")") { tokens.push({ type: "rparen" }); i++; continue }
    if (ch === ",") { tokens.push({ type: "comma" }); i++; continue }
    if ("+-*/%^".indexOf(ch) >= 0) { tokens.push({ type: "op", value: ch }); i++; continue }

    return null
  }

  return tokens
}

// Parser state: the token list, a cursor, and the current nesting depth. Kept
// as a plain object so each production below is a top-level function.
function calcPeek(state) {
  return state.pos < state.tokens.length ? state.tokens[state.pos] : null
}

function calcIsOperator(token, operators) {
  return !!token && token.type === "op" && operators.indexOf(token.value) >= 0
}

function calcFail() {
  throw new Error("calc: not an arithmetic expression")
}

function calcParseExpression(state) {
  var value = calcParseTerm(state)
  for (;;) {
    var token = calcPeek(state)
    if (!calcIsOperator(token, ["+", "-"])) return value
    state.pos++
    var right = calcParseTerm(state)
    value = token.value === "+" ? value + right : value - right
  }
}

function calcParseTerm(state) {
  var value = calcParseUnary(state)
  for (;;) {
    var token = calcPeek(state)
    if (!calcIsOperator(token, ["*", "/", "%"])) return value
    state.pos++
    var right = calcParseUnary(state)
    if (token.value === "*") value = value * right
    else if (token.value === "/") value = value / right
    else value = value % right
  }
}

function calcParseUnary(state) {
  var token = calcPeek(state)
  if (calcIsOperator(token, ["+", "-"])) {
    state.pos++
    var value = calcParseUnary(state)
    return token.value === "-" ? -value : value
  }
  return calcParsePower(state)
}

// Right-associative, and binding looser than unary minus so "-2^2" is -4 the
// way it reads on paper rather than 4 the way JS "**" would have it.
function calcParsePower(state) {
  var base = calcParsePrimary(state)
  if (!calcIsOperator(calcPeek(state), ["^"])) return base
  state.pos++
  return Math.pow(base, calcParseUnary(state))
}

function calcParseArguments(state) {
  var args = []
  if (calcPeek(state) && calcPeek(state).type === "rparen") {
    state.pos++
    return args
  }
  for (;;) {
    args.push(calcParseExpression(state))
    var token = calcPeek(state)
    if (token && token.type === "comma") { state.pos++; continue }
    if (token && token.type === "rparen") { state.pos++; return args }
    calcFail()
  }
}

function calcParsePrimary(state) {
  if (++state.depth > CALC_MAX_DEPTH) calcFail()

  var token = calcPeek(state)
  if (!token) calcFail()

  var value
  if (token.type === "number") {
    state.pos++
    value = token.value
  } else if (token.type === "lparen") {
    state.pos++
    value = calcParseExpression(state)
    if (!calcPeek(state) || calcPeek(state).type !== "rparen") calcFail()
    state.pos++
  } else if (token.type === "name") {
    state.pos++
    var constant = calcConstant(token.value)
    if (constant !== undefined) {
      value = constant
    } else {
      var spec = calcFunction(token.value)
      if (!spec || !calcPeek(state) || calcPeek(state).type !== "lparen") calcFail()
      state.pos++
      var args = calcParseArguments(state)
      if (args.length < spec.minArgs || args.length > spec.maxArgs) calcFail()
      value = spec.call(args)
    }
  } else {
    calcFail()
  }

  state.depth--
  return value
}

function evaluateCalc(expr) {
  var trimmed = String(expr || "").trim()
  if (!trimmed || trimmed.length > CALC_MAX_LENGTH) return null

  var tokens = tokenizeCalc(trimmed)
  if (!tokens || tokens.length === 0) return null

  var state = { tokens: tokens, pos: 0, depth: 0 }
  var value
  try {
    value = calcParseExpression(state)
    if (state.pos !== tokens.length) calcFail()
  } catch (e) {
    return null
  }

  if (typeof value !== "number" || !isFinite(value)) return null
  // Trim the binary-float tail (0.1+0.2), but not at the cost of turning a
  // large-but-finite result into Infinity on the way through.
  var rounded = Math.round(value * 1e10) / 1e10
  return isFinite(rounded) ? rounded : value
}

// --------------------------------------------------------------- currency

// "!" prefix: currency conversion (e.g. "!420 usd to dkk", "!$420 to dkk",
// "!420 to £"). Case-insensitive; recognizes a few common currency symbols
// in addition to 3-letter ISO codes, in either position.
var CURRENCY_SYMBOLS = ({
  "$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY", "₹": "INR", "₩": "KRW"
})

// Swaps each known symbol for its ISO code with padding spaces, so
// "$420 to dkk" and "420$ to dkk" both normalize to word-separated form
// regardless of which side of the amount the symbol was on.
function normalizeCurrencyText(text) {
  var result = text
  for (var symbol in CURRENCY_SYMBOLS) {
    if (result.indexOf(symbol) === -1) continue
    result = result.split(symbol).join(" " + CURRENCY_SYMBOLS[symbol] + " ")
  }
  return result.replace(/\s+/g, " ").trim()
}

// Accepts the currency code either before or after the amount (covers both
// "usd 420 to dkk" and "420 usd to dkk", which the symbol normalization
// above can produce depending on where the symbol was typed).
function parseCurrencyQuery(text) {
  var normalized = normalizeCurrencyText(text)
  var match = normalized.match(/^(?:([a-zA-Z]{3})\s+(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s+([a-zA-Z]{3}))\s+to\s+([a-zA-Z]{3})$/i)
  if (!match) return null
  var fromCode = (match[1] || match[4] || "").toUpperCase()
  var amountStr = (match[2] || match[3] || "").replace(",", ".")
  var toCode = match[5].toUpperCase()
  var amount = parseFloat(amountStr)
  if (!fromCode || !toCode || !isFinite(amount)) return null
  return { amount: amount, from: fromCode, to: toCode }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    VALID_KINDS: VALID_KINDS,
    CALC_FUNCTIONS: CALC_FUNCTIONS,
    CALC_CONSTANTS: CALC_CONSTANTS,
    CALC_MAX_LENGTH: CALC_MAX_LENGTH,
    CURRENCY_SYMBOLS: CURRENCY_SYMBOLS,
    tokenizeCalc: tokenizeCalc,
    stripJsonc: stripJsonc,
    shellQuote: shellQuote,
    isPlainObject: isPlainObject,
    entryIcons: entryIcons,
    defaultConfig: defaultConfig,
    parseConfig: parseConfig,
    mergeEntry: mergeEntry,
    mergeConfig: mergeConfig,
    normalizeTable: normalizeTable,
    resolvePrefix: resolvePrefix,
    expandUrl: expandUrl,
    expandRowLabel: expandRowLabel,
    formatRowLabel: formatRowLabel,
    expandCommand: expandCommand,
    evaluateCalc: evaluateCalc,
    normalizeCurrencyText: normalizeCurrencyText,
    parseCurrencyQuery: parseCurrencyQuery
  }
}
