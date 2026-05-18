// verify-links.js — Batch-verify result URLs in a single playwright run-code call
// Usage:
//   1) npx playwright-cli open
//   2) Prefer wrapper script (absolute path):
//      PowerShell:
//        $SKDIR = "$env:USERPROFILE\.claude\skills\movie\scripts"
//        & "$SKDIR\verify.ps1" -Urls "name1|url1,name2|url2"
//      (Long payload fallback)
//        & "$SKDIR\verify.ps1" -UrlsFile "$SKDIR\_verify_urls.txt"
//   3) npx playwright-cli close-all
//      (_v.js is auto-cleaned by verify.ps1)
// Input sources (comma-sep name|url pairs):
//   1) __URLS__ placeholder replacement
//   2) VERIFY_URLS env var
//   3) process.argv[2]
// Output: compact JSON with title + ok status for each URL
async page => {
  function cleanText(s) {
    return String(s || '').replace(/[\u0000-\u001F\u007F]/g, ' ');
  }

  var proc = (typeof process !== 'undefined') ? process : { env: {}, argv: [] };
  var injected = '__URLS__'.trim();
  var envUrls = (proc.env.VERIFY_URLS || '').trim();
  var argUrls = (proc.argv && proc.argv[2] ? String(proc.argv[2]).trim() : '');
  var urlStr = injected;
  if (!urlStr || urlStr === '__URLS__') {
    urlStr = envUrls || argUrls || '';
  }
  // Parse and validate: must have at least one pipe-separated name|url pair
  var rawPairs = urlStr.split(',').filter(function(s) { return s; });
  var hasValid = false;
  for (var p = 0; p < rawPairs.length; p++) {
    if (rawPairs[p].indexOf('|') !== -1) { hasValid = true; break; }
  }
  if (!hasValid) {
    console.log('No valid name|url pairs. Use one of:');
    console.log('1) replace __URLS__ in script');
    console.log('2) set VERIFY_URLS env var to "name|url,name|url"');
    console.log('3) pass urls as argv[2]');
    return { error: 'no urls' };
  }
  var pairs = rawPairs;
  var ctx = page.context();
  var results = [];

  for (var i = 0; i < pairs.length; i++) {
    var sep = pairs[i].indexOf('|');
    if (sep === -1) {
      results.push({ url: pairs[i], ok: false, error: 'bad format (missing |)' });
      continue;
    }
    var name = pairs[i].substring(0, sep);
    var url = pairs[i].substring(sep + 1);

    try {
      var tab = await ctx.newPage();
      await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await tab.waitForTimeout(1000);
      var title = cleanText(await tab.title());
      // Check if page loaded properly (not an error page)
      var bodyText = await tab.evaluate(function() {
        return (document.body.innerText || '').substring(0, 200);
      });
      var hasContent = bodyText.length > 50;
      results.push({
        name: name,
        url: url,
        title: title,
        ok: hasContent,
        snippet: cleanText(bodyText.substring(0, 80))
      });
      await tab.close();
    } catch (e) {
      results.push({
        name: name,
        url: url,
        ok: false,
        error: cleanText((e.message || e.name || 'unknown').substring(0, 100))
      });
      try { await tab.close(); } catch(ex) {}
    }
  }

  var passed = results.filter(function(r) { return r.ok; }).length;
  console.log('VERIFIED ' + passed + '/' + results.length);
  console.log(JSON.stringify({ verified: results, total: results.length, passed: passed }));
  return { verified: results };
}
