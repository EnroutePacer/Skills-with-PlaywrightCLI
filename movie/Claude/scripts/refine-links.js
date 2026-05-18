// Deep-link refinement: visit search result pages to extract actual play links.
// Called after search-all.js when results have text matches but missing play links.
// Usage:
//   1) npx playwright-cli open
//   2) MOVIE_NAME="仲夏夜惊魂" npx playwright-cli run-code --filename=refine-links.js
//   3) npx playwright-cli close-all
// Input: env var MOVIE_NAME + hardcoded site list below (update from search-all output)
async page => {
  var movie = (process.env.MOVIE_NAME || '仲夏夜惊魂');

  // Paste search result URLs here after getting them from search-all.js output
  var sites = [
    // { name: 'xxx', resultUrl: 'https://...' }
  ];

  // If SITE_URLS env var is set, parse it (comma-separated name:url pairs)
  var envUrls = process.env.SITE_URLS || '';
  if (envUrls) {
    sites = envUrls.split(',').map(function(pair) {
      var parts = pair.split('|');
      return { name: parts[0], resultUrl: parts[1] };
    });
  }

  if (sites.length === 0) {
    console.log('No sites to refine. Set SITE_URLS env var or edit sites array.');
    return { error: 'no sites' };
  }

  var ctx = page.context();
  var refined = [];

  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    console.log('--- ' + site.name + ' ---');
    var tab;
    try {
      tab = await ctx.newPage();

      // Navigate to the search result page
      await tab.goto(site.resultUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await tab.waitForTimeout(2000);

      // Strategy 1: find "立即播放" links on the search result page itself
      var playLinks = await tab.evaluate(function(mov) {
        // Find the container that has the movie title
        var allText = document.body.innerText || '';
        if (allText.indexOf(mov) === -1) return { found: false, reason: 'movie not on page' };

        // Look for "立即播放" or "播放" links near the movie title
        var results = [];
        var anchors = document.querySelectorAll('a');

        anchors.forEach(function(a) {
          var t = (a.textContent || '').trim();
          var h = a.href || '';
          if (!h || h === '#' || h.indexOf('javascript') === 0) return;
          if (t.indexOf('立即播放') !== -1 || t.indexOf('播放') === 0) {
            results.push({ text: t, href: h, type: 'play-btn' });
          }
          if (t === mov || t.indexOf(mov) !== -1) {
            results.push({ text: t, href: h, type: 'title-link' });
          }
        });

        // If we found the movie title link but no play button, visit the detail page
        return { found: results.length > 0, links: results };
      }, movie);

      console.log('  Strategy 1: ' + JSON.stringify(playLinks));

      // Strategy 2: if we found a title-link but no play-btn, navigate to detail page
      var detailUrl = null;
      if (playLinks && playLinks.links) {
        for (var li = 0; li < playLinks.links.length; li++) {
          var lk = playLinks.links[li];
          if (lk.type === 'play-btn') {
            refined.push({ name: site.name, resultUrl: site.resultUrl, playUrl: lk.href, method: 'direct' });
            detailUrl = null; // already have play link
            break;
          }
          if (lk.type === 'title-link' && !detailUrl) {
            detailUrl = lk.href;
          }
        }
      }

      // If we have a detail page URL, visit it to find play links
      if (detailUrl && !playLinks.links.some(function(l) { return l.type === 'play-btn'; })) {
        try {
          await tab.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await tab.waitForTimeout(2000);

          var detailLinks = await tab.evaluate(function() {
            var anchors = document.querySelectorAll('a');
            var res = [];
            anchors.forEach(function(a) {
              var t = (a.textContent || '').trim();
              var h = a.href || '';
              if (!h || h === '#' || h.indexOf('javascript') === 0) return;
              if (t.indexOf('立即播放') !== -1 || t === '播放') {
                res.push({ text: t, href: h });
              }
            });
            return res;
          });

          if (detailLinks && detailLinks.length > 0) {
            refined.push({ name: site.name, resultUrl: site.resultUrl, playUrl: detailLinks[0].href, method: 'from-detail' });
            console.log('  Detail play link: ' + detailLinks[0].href);
          } else {
            refined.push({ name: site.name, resultUrl: site.resultUrl, detailUrl: detailUrl, playUrl: null, method: 'detail-no-play' });
            console.log('  Detail page loaded but no play link found');
          }
        } catch (e) {
          console.log('  Detail page error: ' + (e.message || '').substring(0, 80));
          refined.push({ name: site.name, resultUrl: site.resultUrl, detailUrl: detailUrl, playUrl: null, method: 'detail-error' });
        }
      } else if (!detailUrl && (!playLinks || !playLinks.found)) {
        refined.push({ name: site.name, resultUrl: site.resultUrl, playUrl: null, method: 'no-links-found' });
      } else if (!detailUrl && playLinks && playLinks.links && playLinks.links.some(function(l) { return l.type === 'play-btn'; })) {
        // already handled above
      }

      await tab.close();
    } catch (e) {
      console.log('  ERROR: ' + (e.message || '').substring(0, 80));
      try { await tab.close(); } catch(ex) {}
    }
  }

  console.log('\n===== REFINED RESULTS =====');
  console.log(JSON.stringify({ movie: movie, refined: refined }, null, 2));
  return { movie: movie, refined: refined };
}
