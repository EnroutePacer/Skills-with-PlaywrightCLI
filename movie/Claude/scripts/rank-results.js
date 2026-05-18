#!/usr/bin/env node
// rank-results.js — Score and sort search-all.js JSON output by quality + match accuracy
// Usage:
//   node scripts/rank-results.js < results.json
//   node scripts/rank-results.js --input=results.json

var qualityRank = {
  '4K':          100,
  '1080P':       90, '1080p': 90,
  'BD高清':      85,
  'BD':          80,
  '超清720P':    78,
  '超清':        75,
  'HD高清':      70,
  '高清':        60,
  'HD':          55,
  '720P':        50, '720p': 50,
  '清晰':        40,
  '标清':        20,
};

// Score a link by its URL pattern (play > detail > list > search)
function linkTypeScore(href) {
  if (/\/play\/\d/.test(href))       return 5;  // direct episode play
  if (/\/vodplay\/\d/.test(href))    return 5;
  if (/\/mp\/\w+-\d+-\d+/.test(href)) return 5;  // mdvod play
  if (/\/voddetail\/\d/.test(href))  return 4;  // detail page
  if (/\/detail\/\d/.test(href))     return 4;
  if (/\/md\/\w+/.test(href) && !/\/md\/\w+\/\d/.test(href)) return 4;
  if (/\/dianying\/\d/.test(href))   return 3;  // movie listing
  if (/\/vod\/\d/.test(href))        return 3;
  if (/\/xigua\/\d+\.html/.test(href)) return 3;
  if (/\/q\/\d+\.html/.test(href))   return 2;  // detail (fanqie)
  if (/\/y\/\d+\.html/.test(href))   return 2;  // play (fanqie)
  return 1;  // search page or generic
}

function bestQuality(links) {
  var best = { label: 'unknown', score: 0 };
  links.forEach(function(link) {
    for (var q in qualityRank) {
      if (link.text.indexOf(q) !== -1 && qualityRank[q] > best.score) {
        best = { label: q, score: qualityRank[q] };
      }
    }
  });
  return best;
}

function hasPlayLink(links) {
  return links.some(function(l) { return linkTypeScore(l.href) >= 5; });
}

function hasDetailLink(links) {
  return links.some(function(l) { return linkTypeScore(l.href) >= 4; });
}

function scoreResult(result) {
  var score = 0;
  var links = result.links || [];

  if (links.length === 0) return { quality: 'none', score: 0 };

  // Base score: link count (capped at 5)
  score += Math.min(links.length, 5);

  // Best link type score
  var bestLinkScore = 0;
  links.forEach(function(l) {
    var s = linkTypeScore(l.href);
    if (s > bestLinkScore) bestLinkScore = s;
  });
  score += bestLinkScore * 3;

  // Quality bonus
  var quality = bestQuality(links);
  score += quality.score / 10;

  // Has play link bonus
  if (hasPlayLink(links)) score += 8;
  else if (hasDetailLink(links)) score += 3;

  // Title contains year? Bonus
  var yearMatch = result.title.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) score += 2;

  return {
    quality: quality.label,
    qualityScore: quality.score,
    score: Math.round(score * 10) / 10
  };
}

// --- Main ---
var src = '';
var args = process.argv.slice(2);

if (args.length > 0 && args[0].indexOf('--input=') === 0) {
  var fs = require('fs');
  src = fs.readFileSync(args[0].replace('--input=', ''), 'utf8');
  processData(src);
} else {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function(chunk) { src += chunk; });
  process.stdin.on('end', function() { processData(src); });
  process.stdin.on('error', function() { console.error('No input data'); process.exit(1); });
}

function processData(raw) {
  var data;
  try { data = JSON.parse(raw); } catch(e) {
    console.error('Invalid JSON input');
    process.exit(1);
  }

  // Score each result
  data.results.forEach(function(r) {
    var ranked = scoreResult(r);
    r._quality = ranked.quality;
    r._score = ranked.score;
  });

  // Sort: highest score first
  data.results.sort(function(a, b) { return b._score - a._score; });

  // Add summary
  data._rankedTotal = data.results.length;
  data._topScore = data.results.length > 0 ? data.results[0]._score : 0;

  console.log(JSON.stringify(data, null, 2));
}
