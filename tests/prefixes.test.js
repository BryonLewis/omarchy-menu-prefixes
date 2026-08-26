// Unit tests for PrefixModel.js — run with: node --test tests/

const test = require("node:test")
const assert = require("node:assert")

const PrefixModel = require("../PrefixModel.js")

function tableFor(config) {
  return PrefixModel.normalizeTable(PrefixModel.mergeConfig(PrefixModel.defaultConfig(), config))
}

test("defaults include file:, g:, yt:, =, !", () => {
  const table = tableFor(null)
  const prefixes = table.map((e) => e.prefix)
  assert.ok(prefixes.includes("file:"))
  assert.ok(prefixes.includes("g:"))
  assert.ok(prefixes.includes("yt:"))
  assert.ok(prefixes.includes("="))
  assert.ok(prefixes.includes("!"))
})

test("table is sorted longest prefix first", () => {
  const table = PrefixModel.normalizeTable({
    prefixes: { "g:": { kind: "web", url: "https://x/?q={query}" }, "gh:": { kind: "web", url: "https://y/?q={query}" } }
  })
  assert.equal(table[0].prefix, "gh:")
})

test("resolvePrefix matches and extracts the query", () => {
  const table = tableFor(null)
  const match = PrefixModel.resolvePrefix("g:data pipelines", table)
  assert.equal(match.prefix, "g:")
  assert.equal(match.kind, "web")
  assert.equal(match.query, "data pipelines")
})

test("resolvePrefix picks the longest matching prefix", () => {
  const table = tableFor({ prefixes: { "gh:": { kind: "web", label: "GitHub", url: "https://github.com/search?q={query}" } } })
  const match = PrefixModel.resolvePrefix("gh:omarchy", table)
  assert.equal(match.prefix, "gh:")
  assert.equal(match.query, "omarchy")
})

test("resolvePrefix returns null on no match, empty remainder, or blank remainder", () => {
  const table = tableFor(null)
  assert.equal(PrefixModel.resolvePrefix("firefox", table), null)
  assert.equal(PrefixModel.resolvePrefix("g:", table), null)
  assert.equal(PrefixModel.resolvePrefix("g:   ", table), null)
  assert.equal(PrefixModel.resolvePrefix("", table), null)
})

test("file prefix matches file: queries", () => {
  const table = tableFor(null)
  const match = PrefixModel.resolvePrefix("file:bashrc", table)
  assert.equal(match.kind, "file")
  assert.equal(match.query, "bashrc")
  assert.equal(match.entry.maxResults, 60)
  assert.equal(match.entry.caseInsensitive, true)
})

test("user config overrides defaults per key", () => {
  const table = tableFor({ prefixes: { "g:": { fontIcon: "X" } } })
  const g = table.find((e) => e.prefix === "g:")
  assert.equal(g.fontIcon, "X")
  assert.equal(g.label, "Google") // default survives
  assert.equal(g.url, "https://www.google.com/search?q={query}")
})

test("legacy icon key maps to fontIcon", () => {
  const table = tableFor({ prefixes: { "g:": { icon: "legacy" } } })
  const g = table.find((e) => e.prefix === "g:")
  assert.equal(g.fontIcon, "legacy")
})

test("appIcon is normalized alongside fontIcon", () => {
  const table = tableFor({
    prefixes: {
      "g:": { appIcon: "google-chrome", fontIcon: "" },
      "yt:": { appIcon: "youtube" }
    }
  })
  const g = table.find((e) => e.prefix === "g:")
  const yt = table.find((e) => e.prefix === "yt:")
  assert.equal(g.appIcon, "google-chrome")
  assert.equal(g.fontIcon, "")
  assert.equal(yt.appIcon, "youtube")
  assert.equal(yt.fontIcon, "\uf167") // default font glyph kept when only appIcon set
})

test("null prefix entry removes the default", () => {
  const table = tableFor({ prefixes: { "g:": null } })
  assert.equal(table.find((e) => e.prefix === "g:"), undefined)
})

test("user can add custom prefixes of every kind", () => {
  const table = tableFor({
    file: { prefix: "f:" },
    prefixes: {
      "gh:": { kind: "web", label: "GitHub", url: "https://github.com/search?q={query}" },
      "t:": { kind: "cmd", label: "Terminal", cmd: "foot -- {query}" }
    }
  })
  assert.equal(table.find((e) => e.prefix === "f:").kind, "file")
  assert.equal(table.find((e) => e.prefix === "file:"), undefined)
  assert.equal(table.find((e) => e.prefix === "gh:").kind, "web")
  assert.equal(table.find((e) => e.prefix === "t:").kind, "cmd")
})

test("file search can be disabled with an empty prefix", () => {
  const table = tableFor({ file: { prefix: "" } })
  assert.equal(table.find((e) => e.kind === "file"), undefined)
})

test("invalid entries are dropped without breaking the rest", () => {
  const table = PrefixModel.normalizeTable({
    prefixes: {
      "a:": { kind: "web" }, // web without url
      "b:": { kind: "cmd" }, // cmd without cmd
      "c:": { kind: "bogus" }, // unknown kind
      "d:": "not an object",
      "e:": { kind: "web", url: "https://e/?q={query}" }
    }
  })
  const prefixes = table.map((e) => e.prefix)
  assert.deepEqual(prefixes, ["e:"])
})

test("parseConfig accepts JSONC with comments and trailing commas", () => {
  const parsed = PrefixModel.parseConfig('{\n  // comment\n  "prefixes": { "g:": null, },\n}')
  assert.deepEqual(parsed, { prefixes: { "g:": null } })
})

test("parseConfig returns null for empty or invalid input", () => {
  assert.equal(PrefixModel.parseConfig(""), null)
  assert.equal(PrefixModel.parseConfig("   "), null)
  assert.equal(PrefixModel.parseConfig("{ nope"), null)
  assert.equal(PrefixModel.parseConfig("[1,2]"), null)
})

test("expandUrl URL-encodes the query once", () => {
  assert.equal(
    PrefixModel.expandUrl("https://x/search?q={query}", "hello world & more"),
    "https://x/search?q=hello%20world%20%26%20more"
  )
})

test("expandCommand quotes {query} and passes {raw} verbatim", () => {
  assert.equal(PrefixModel.expandCommand("foot -- {query}", "ls -la"), "foot -- 'ls -la'")
  assert.equal(PrefixModel.expandCommand("echo {raw}", "ls -la"), "echo ls -la")
  assert.equal(PrefixModel.expandCommand("{query} && {raw}", "x"), "'x' && x")
})

test("expandCommand escapes embedded single quotes", () => {
  assert.equal(PrefixModel.expandCommand("echo {query}", "it's"), "echo 'it'\\''s'")
})

test("expandCommand does not re-expand placeholders inside the query", () => {
  assert.equal(PrefixModel.expandCommand("echo {query} {raw}", "{raw}"), "echo '{raw}' {raw}")
})

test("evaluateCalc computes expressions and functions", () => {
  assert.equal(PrefixModel.evaluateCalc("4*23"), 92)
  assert.equal(PrefixModel.evaluateCalc("sqrt(16)"), 4)
  assert.equal(PrefixModel.evaluateCalc("pow(2,10)+round(pi)"), 1027)
  assert.equal(PrefixModel.evaluateCalc("2^10"), 1024)
})

test("evaluateCalc rejects anything that is not arithmetic", () => {
  assert.equal(PrefixModel.evaluateCalc("process.exit(1)"), null)
  assert.equal(PrefixModel.evaluateCalc("while(true){}"), null)
  assert.equal(PrefixModel.evaluateCalc("constructor"), null)
  assert.equal(PrefixModel.evaluateCalc(""), null)
})

test("parseCurrencyQuery handles codes, symbols, and either position", () => {
  assert.deepEqual(PrefixModel.parseCurrencyQuery("420 usd to dkk"), { amount: 420, from: "USD", to: "DKK" })
  assert.deepEqual(PrefixModel.parseCurrencyQuery("usd 420 to dkk"), { amount: 420, from: "USD", to: "DKK" })
  assert.deepEqual(PrefixModel.parseCurrencyQuery("$420 to dkk"), { amount: 420, from: "USD", to: "DKK" })
  assert.deepEqual(PrefixModel.parseCurrencyQuery("420$ to dkk"), { amount: 420, from: "USD", to: "DKK" })
  assert.deepEqual(PrefixModel.parseCurrencyQuery("420,50 EUR to GBP"), { amount: 420.5, from: "EUR", to: "GBP" })
  assert.equal(PrefixModel.parseCurrencyQuery("420 usd"), null)
  assert.equal(PrefixModel.parseCurrencyQuery("420 to dkk"), null) // no source currency
})

test("mergeConfig keeps defaults for a missing file section", () => {
  const merged = PrefixModel.mergeConfig(PrefixModel.defaultConfig(), { prefixes: { "w:": { kind: "web", url: "https://w/?q={query}" } } })
  assert.equal(merged.file.prefix, "file:")
  assert.equal(merged.prefixes["g:"].url, "https://www.google.com/search?q={query}")
})
