#!/usr/bin/env node
// filter-results.js — Post-process search-all.js JSON output to reduce AI review effort
// Usage:
//   npx playwright-cli run-code --filename=scripts/search-all.js 2>&1 | grep '^{' > results.json
//   node scripts/filter-results.js < results.json        # full filtered JSON
//   node scripts/filter-results.js --summary < results.json  # compact summary (省 token)
//
// What it does:
//   1. Group fofo mirrors: merge fofo11/22/33 entries that share the same movie IDs,
//      keeping the best one with a note about mirrors
//   2. Remove results that have no useful links after cleanup
//   3. Tag each result with _useful flag for AI
//   4. --summary mode outputs only key fields for AI review (省 token)

var src = '';
var args = process.argv.slice(2);
var summaryMode = args.indexOf('--summary') !== -1;
var yearArg = '';

var inputArg = '';
for (var a = 0; a < args.length; a++) {
  if (args[a].indexOf('--input=') === 0) { inputArg = args[a].replace('--input=', ''); break; }
  if (args[a].indexOf('--year=') === 0) { yearArg = args[a].replace('--year=', ''); }
}

if (inputArg) {
  var fs = require('fs');
  src = fs.readFileSync(inputArg, 'utf8');
  processData(src);
} else {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function(chunk) { src += chunk; });
  process.stdin.on('end', function() { processData(src); });
}

function isPlayLink(href) {
  return /\/play\/\d/.test(href) || /\/vodplay\/\d/.test(href) || /\/mp\/\w+-\d+-\d+/.test(href);
}

function isDetailLink(href) {
  return /\/vod\/\d+\.html$/.test(href) || /\/voddetail\/\d/.test(href) ||
         /\/detail\/\d/.test(href) || /\/md\/\w+$/.test(href) ||
         /\/dianying\/\d+$/.test(href) || /\/q\/\d+\.html$/.test(href) ||
         /\/xigua\/\d+\.html$/.test(href);
}

function qualityScore(text) {
  var q = (text || '').trim();
  if (/4K/i.test(q)) return 100;
  if (/1080P/i.test(q)) return 90;
  if (/超清/.test(q)) return 75;
  if (/HD/i.test(q)) return 55;
  if (/720P/i.test(q)) return 50;
  if (/BD/i.test(q)) return 45;
  return 0;
}

function linkCandidateScore(link, movie, index) {
  var href = link && link.href ? link.href : '';
  var text = link && link.text ? link.text : '';
  var score = 0;

  if (isPlayLink(href)) score += 60;
  else if (isDetailLink(href)) score += 35;
  else score += 10;

  if (movie && text.indexOf(movie) !== -1) score += 70;

  if (/\/vod\/type\//.test(href) || /\/index\.php\/vod\/type\//.test(href) ||
      /\/xigua\/\d+\/\d+\.html$/.test(href) || /\/ma\/\d+\//.test(href)) {
    score -= 80;
  }

  score += Math.max(0, 8 - index);
  score += qualityScore(text);

  return score;
}

function extractYears(s) {
  var m = String(s || '').match(/(19\d{2}|20\d{2})/g);
  return m || [];
}

function linkCandidateScoreAdvanced(link, movie, index, targetYear) {
  var href = link && link.href ? link.href : '';
  var text = link && link.text ? link.text : '';
  var score = linkCandidateScore(link, movie, index);

  if (/\/play\/\d/.test(href) || /\/vodplay\/\d/.test(href)) score += 25;

  if (targetYear) {
    var years = extractYears(text + ' ' + href);
    if (years.indexOf(targetYear) !== -1) score += 40;
    else if (years.length > 0) score -= 25;
  }
  return score;
}

function pickCandidates(links, movie, limit, targetYear) {
  var rows = (links || []).map(function(l, i) {
    var href = l && l.href ? l.href : '';
    var isDirectPlay = /\/play\/\d/.test(href) || /\/vodplay\/\d/.test(href);
    return {
      href: href,
      text: l.text || '',
      score: linkCandidateScoreAdvanced(l, movie, i, targetYear),
      isDirectPlay: isDirectPlay
    };
  }).filter(function(x) { return !!x.href && x.score > 0; });

  rows.sort(function(a, b) {
    if (a.isDirectPlay && !b.isDirectPlay) return -1;
    if (!a.isDirectPlay && b.isDirectPlay) return 1;
    return b.score - a.score;
  });

  var unique = [];
  for (var i = 0; i < rows.length && unique.length < limit; i++) {
    if (!unique.some(function(x) { return x.href === rows[i].href; })) {
      unique.push(rows[i]);
    }
  }
  return unique;
}

function processData(raw) {
  var data;
  try { data = JSON.parse(raw); } catch(e) {
    console.error('Invalid JSON input');
    process.exit(1);
  }
  var movie = data.movieName || '';
  var inferredYear = '';
  var ym = String(movie).match(/(19\d{2}|20\d{2})/);
  if (ym) inferredYear = ym[1];
  var targetYear = String(yearArg || process.env.TARGET_YEAR || data.targetYear || inferredYear || '');
  var filtered = [];

  var fofoGroups = {};
  var nonFofo = [];

  (data.results || []).forEach(function(r) {
    if (r.siteName.indexOf('fofo') === 0) {
      var urlParts = (r.resultUrl || '').match(/\/\w+\/\d+/);
      if (!urlParts) {
        var firstLink = (r.links || [])[0];
        urlParts = firstLink ? firstLink.href.match(/\/\w+\/\d+/) : null;
      }
      var key = urlParts ? urlParts[0] : r.resultUrl;
      if (!fofoGroups[key]) {
        fofoGroups[key] = { siteNames: [], best: null };
      }
      fofoGroups[key].siteNames.push(r.siteName);
      if (!fofoGroups[key].best || (r.links || []).length > (fofoGroups[key].best.links || []).length) {
        fofoGroups[key].best = r;
      }
    } else {
      nonFofo.push(r);
    }
  });

  Object.keys(fofoGroups).forEach(function(key) {
    var group = fofoGroups[key];
    var best = JSON.parse(JSON.stringify(group.best));
    var mirrors = group.siteNames.filter(function(n) { return n !== best.siteName; });
    best._mirrors = mirrors;
    best._grouped = true;
    filtered.push(best);
  });

  filtered = filtered.concat(nonFofo);

  filtered.forEach(function(r) {
    var links = r.links || [];
    var hasPlayLink = links.some(function(l) { return isPlayLink(l.href || ''); });
    var hasDetailLink = links.some(function(l) { return isDetailLink(l.href || ''); });
    var hasMovieName = links.some(function(l) {
      var t = l && l.text ? l.text : '';
      return movie && t.indexOf(movie) !== -1;
    });
    r._useful = hasPlayLink || (hasDetailLink && hasMovieName) || hasMovieName;
    r._hasPlayLink = hasPlayLink;
    r._hasDetailLink = hasDetailLink;
  });

  filtered.sort(function(a, b) {
    if (a._useful && !b._useful) return -1;
    if (!a._useful && b._useful) return 1;
    return (b.links || []).length - (a.links || []).length;
  });

  data.results = filtered;
  data._totalAfterFilter = filtered.length;
  data._usefulCount = filtered.filter(function(r) { return r._useful; }).length;

  if (summaryMode) {
    var summaryResults = filtered.map(function(r) {
      var bestQuality = r.rowQuality || '—';
      var candidates = pickCandidates(r.links || [], movie, 3, targetYear);
      var bestUrl = candidates.length > 0 ? candidates[0].href : '';
      if (!r.rowQuality) {
        (r.links || []).forEach(function(l) {
          var q = (l.text || '').trim();
          if (/4K/.test(q)) bestQuality = '4K';
          else if (/1080P/.test(q) && bestQuality !== '4K') bestQuality = '1080P';
          else if (/超清/.test(q) && bestQuality !== '4K' && bestQuality !== '1080P') bestQuality = '超清';
          else if (/HD/.test(q) && bestQuality !== '4K' && bestQuality !== '1080P' && bestQuality !== '超清') bestQuality = 'HD';
          else if (/BD/.test(q)) bestQuality = 'BD';
        });
      }
      var out = {
        site: r.siteName,
        useful: r._useful,
        play: r._hasPlayLink,
        detail: r._hasDetailLink,
        quality: bestQuality,
        url: bestUrl,
        urls: candidates.map(function(c) { return c.href; }),
        links: (r.links || []).length
      };
      if (r._mirrors && r._mirrors.length > 0) out.mirrors = r._mirrors;
      return out;
    });

    var verifyPairs = [];
    summaryResults.forEach(function(r) {
      var urls = (r.urls && r.urls.length > 0) ? r.urls : (r.url ? [r.url] : []);
      urls.forEach(function(u) {
        if (!u) return;
        var pair = (r.site || 'site') + '|' + u;
        if (verifyPairs.indexOf(pair) === -1) verifyPairs.push(pair);
      });
    });
    var verifyUrls = verifyPairs.join(',');
    var verifyCmd = '-Urls "' + verifyUrls.replace(/"/g, '\\"') + '"';
    var verifyUrlsFilePath = '$env:USERPROFILE\\.codex\\skills\\movie\\scripts\\_verify_urls.txt';
    var verifyCmdViaFile = '-UrlsFile "' + verifyUrlsFilePath + '"';
    var verifyCmdRecommended = verifyCmd.length > 800 ? verifyCmdViaFile : verifyCmd;

    var summary = {
      movieName: data.movieName,
      total: data.total,
      found: data.found,
      failed: data.failed,
      _totalAfterFilter: data._totalAfterFilter,
      _usefulCount: data._usefulCount,
      results: summaryResults,
      _verifyUrls: verifyUrls,
      _verifyCmd: (verifyCmd.length > 800 ? null : verifyCmd),
      _verifyUrlsFilePath: verifyUrlsFilePath,
      _verifyCmdRecommended: verifyCmdRecommended,
      _targetYear: targetYear || null,
      failures: data.failures
    };
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}
