// Movie search — MOVIE_NAME is replaced by search.ps1 before execution
async page => {
  var movie = 'MOVIE_NAME';
  var ctx = page.context();
  var sites = [
    { name:'fanqieyingyuan', url:'https://www.fanqieyingyuan.com/' },
    { name:'zxtqd',          url:'https://zxtqd.com/' },
    { name:'hz-c',           url:'https://www.hz-c.com/' },
    { name:'byptc',          url:'https://www.byptc.com/' },
    { name:'fofo11',         url:'https://fofo11.com/' },
    { name:'fofo22',         url:'https://fofo22.com/' },
    { name:'fofo33',         url:'https://fofo33.com/' },
    { name:'mdvod',          url:'https://www.mdvod.com/' },
    { name:'2046ys',         url:'https://2046ys.ink/' },
    { name:'baichatv',       url:'https://www.baichatv.com/' },
    { name:'yupteam',        url:'https://v.yupteam.com/' },
    { name:'yuny',           url:'https://www.yuny.live/' },
    { name:'pptsearch',      url:'https://www.pptsearch365.com/' }
  ];
  var results = [];
  var failures = [];

  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    console.log('--- ' + site.name + ' ---');
    var tab;
    try {
      tab = await ctx.newPage();

      // Direct URL sites — determine target BEFORE first navigation
      // to avoid homepage blocks/slow redirects.
      var directUrlSites = {
        'baichatv': { url: 'https://www.baichatv.com/index.php/vod/search.html?wd=URLENCODED' },
        'hz-c':     { url: 'https://www.hz-c.com/vodsearch/_____________.html?wd=URLENCODED' },
        'byptc':    { url: 'https://www.byptc.com/vodsearch/_____________.html?wd=URLENCODED' }
      };
      var targetUrl = site.url;
      var useDirect = !!directUrlSites[site.name];
      if (useDirect) {
        var encoded = encodeURIComponent(movie);
        targetUrl = directUrlSites[site.name].url.replace('URLENCODED', encoded);
      }

      await tab.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await tab.waitForTimeout(useDirect ? 2000 : 1500);
      if (useDirect) console.log('  direct url: ' + targetUrl);

      // Cloudflare / anti-bot page check (runs before search input detection)
      var pageTitle = await tab.title();
      var pageBody = await tab.evaluate(function() {
        return (document.body.innerText || '').substring(0, 500);
      });
      var blocked = false;
      if (pageTitle.indexOf('Attention Required') !== -1 || pageTitle.indexOf('Cloudflare') !== -1 ||
          pageBody.indexOf('Cloudflare') !== -1 || pageBody.indexOf('blocked') !== -1 ||
          pageBody.indexOf('DDOS') !== -1 || pageBody.indexOf('Just a moment') !== -1) {
        blocked = true;
      }
      if (blocked && useDirect) {
        failures.push({ name:site.name, url:targetUrl, reason:'Blocked by Cloudflare/WAF' });
        await tab.close(); continue;
      }

      if (!useDirect) {
        var searchSelectors = [
          // Exact name/id matches
          'input[name="wd"]', 'input[name="searchword"]', 'input[name="key"]',
          'input[id="wd"]', 'input[id="hl-search-text"]',
          // Partial name/id matches
          'input[name*="search"]', 'input[name*="key"]', 'input[name*="word"]', 'input[name*="text"]',
          'input[id*="search"]', 'input[id*="key"]', 'input[id*="word"]', 'input[id*="text"]',
          // Class partial matches
          'input[class*="search"]', 'input[class*="input"]', 'input[class*="text"]',
          'input[type="search"]',
          // Placeholder matches
          'input[placeholder]', 'input[placeholder*="请输入"]', 'input[placeholder*="关键字"]',
          'input[placeholder*="关键词"]', 'input[placeholder*="搜索"]', 'input[placeholder*="片名"]',
          // Non-input element types
          'textarea', '[contenteditable="true"]', '[role="textbox"]',
          // Broad fallback — any non-hidden, non-button input
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"])'
        ];

        var searchInput = null;
        for (var s = 0; s < searchSelectors.length; s++) {
          try {
            var el = tab.locator(searchSelectors[s]).first();
            var visible = await el.isVisible();
            if (visible) { searchInput = el; break; }
          } catch(e) {}
        }
        if (!searchInput) {
          for (var s = 0; s < searchSelectors.length; s++) {
            try {
              var el = tab.locator(searchSelectors[s]).first();
              if (await el.count() > 0) { searchInput = el; break; }
            } catch(e) {}
          }
        }
        if (!searchInput) {
          // Last-resort fallback: use JS evaluate to find ANY visible text input,
          // returning a CSS selector that Playwright can use directly
          try {
            var sel = await tab.evaluate(function() {
              var candidates = document.querySelectorAll(
                'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="password"]):not([type="image"]):not([type="reset"]):not([type="color"]), textarea, [contenteditable="true"], [role="textbox"]'
              );
              for (var i = 0; i < candidates.length; i++) {
                var el = candidates[i];
                if (el.offsetParent === null) continue;
                // Found a visible element — build a unique CSS selector
                if (el.id) return '#' + el.id.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
                if (el.name) {
                  var tag = el.tagName.toLowerCase();
                  return tag + '[name="' + el.name.replace(/"/g, '\\"') + '"]';
                }
                // Last-resort: nth-of-type within parent
                var parent = el.parentElement;
                if (parent) {
                  var tag = el.tagName.toLowerCase();
                  var all = parent.querySelectorAll(':scope > ' + tag);
                  for (var j = 0; j < all.length; j++) {
                    if (all[j] === el) return tag + ':nth-of-type(' + (j + 1) + ')';
                  }
                }
              }
              return null;
            });
            if (sel) {
              var el = tab.locator(sel).first();
              if (await el.count() > 0) { searchInput = el; }
            }
          } catch(e) {}
        }

        // Final attempt: wait briefly for any search-like input to appear (dynamic loading)
        if (!searchInput) {
          try {
            var waiter = tab.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, [role="textbox"]').first();
            await waiter.waitFor({ timeout: 3000 });
            if (await waiter.count() > 0) { searchInput = waiter; }
          } catch(e) {}
        }

        if (!searchInput) {
          var failReason = blocked ? 'Blocked by Cloudflare/WAF' : 'No search input';
          console.log('  ' + failReason.toLowerCase());
          failures.push({ name:site.name, url:site.url, reason:failReason });
          await tab.close(); continue;
        }

        await tab.waitForTimeout(300);
        try {
          await searchInput.fill(movie);
          await tab.waitForTimeout(500);
        } catch(e) {
          console.log('  fill failed: ' + (e.message || '').substring(0, 100));
          failures.push({ name:site.name, url:site.url, reason:'Fill failed: ' + (e.message || '').substring(0, 80) });
          await tab.close(); continue;
        }

        // Submit — yupteam needs button click (Enter loses the keyword)
        if (site.name === 'yupteam') {
          var submitBtn = await tab.locator('button[type="submit"], button:has-text("Submit")').first();
          if (await submitBtn.count() > 0) {
            await submitBtn.click();
          } else {
            await searchInput.press('Enter');
          }
        } else {
          await searchInput.press('Enter');
        }
      }
      await tab.waitForTimeout(3000);

      var resultUrl = tab.url();
      var resultTitle = await tab.title();
      var textSnippet = await tab.evaluate(function() {
        return (document.body.innerText || '').substring(0, 1200).replace(/\s+/g, ' ').trim();
      });
      var matched = textSnippet.indexOf(movie) !== -1 || resultTitle.indexOf(movie) !== -1;

      // Check for "no results" indicators — override match if page says nothing found
      var noResultPhrases = ['没有找到', '没有记录', '无搜索结果', '找不到'];
      var hasNoResult = noResultPhrases.some(function(p) {
        return textSnippet.indexOf(p) !== -1 || resultTitle.indexOf(p) !== -1;
      });
      if (hasNoResult && matched) {
        // Page title/body contains movie name but also says "not found" — false positive
        console.log('  false positive (no results)');
        matched = false;
      }

      var linkData = await tab.evaluate(function(mov) {
        var out = [];
        var rowQuality = '';
        // exclude navigation/noise links; match play/detail patterns
        var exclude = ['vodsearch', 'vodtype', 'vodclass', 'javascript'];
        var anchorSelector =
          'a[href*="/y/"], a[href*="/q/"], a[href*="/vod/"], a[href*="/play/"],' +
          'a[href*="/vodplay/"], a[href*="/voddetail/"],' +
          'a[href*="/dianying/"], a[href*="/detail/"],' +
          'a[href*="/md/"], a[href*="/mp/"],' +
          'a[href*="/xigua/"]';

        function normalize(s) {
          return (s || '')
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[·•\-\–\—_:：,，.。!?！？'"“”‘’()（）\[\]【】]/g, '');
        }

        function normalizeTitle(s) {
          return normalize(s)
            .replace(/(第\d+集|第\d+话|全\d+集|中英双字|双语|国语|粤语|中字|英字|原声|完整版|正片|抢先版|预告|花絮|解说|合集|短剧|高清|超清|蓝光|4k|1080p|720p|bd|hd|未删减|修复版)/g, '');
        }

        function titleMatches(haystack, needle) {
          if (!haystack || !needle) return false;
          return haystack.indexOf(needle) !== -1 || needle.indexOf(haystack) !== -1;
        }

        function isCandidateHref(h) {
          if (!h || h === '#') return false;
          if (/\/xigua\/\d+\/\d+\.html$/.test(h)) return false;
          if (/\/ma\/\d+\/$/.test(h)) return false;
          for (var e = 0; e < exclude.length; e++) {
            if (h.indexOf(exclude[e]) !== -1) return false;
          }
          return true;
        }

        function qualityScore(q) {
          var t = (q || '').toUpperCase();
          if (t.indexOf('4K') !== -1) return 100;
          if (t.indexOf('1080P') !== -1) return 90;
          if (q.indexOf('超清') !== -1) return 75;
          if (q.indexOf('高清') !== -1) return 65;
          if (t.indexOf('HD') !== -1) return 55;
          if (t.indexOf('720P') !== -1) return 50;
          if (t.indexOf('BD') !== -1) return 45;
          return 0;
        }

        function detectBestQualityFromText(text) {
          var src = text || '';
          var patterns = ['4K', '1080P', '超清', '高清', 'HD', '720P', 'BD'];
          var best = { label: '', score: 0 };
          for (var i = 0; i < patterns.length; i++) {
            var p = patterns[i];
            if (src.toUpperCase().indexOf(p.toUpperCase()) !== -1) {
              var s = qualityScore(p);
              if (s > best.score) best = { label: p, score: s };
            }
          }
          return best.label;
        }

        var movieN = normalizeTitle(mov);
        var anchors = Array.prototype.slice.call(document.querySelectorAll(anchorSelector));

        // First, find blocks that contain movie title text and collect links only from those blocks.
        // This removes unrelated movies shown on the same result page.
        var focusedAnchors = [];
        if (movieN) {
          var blocks = [];
          var textNodes = Array.prototype.slice.call(document.querySelectorAll('a, h1, h2, h3, h4, h5, h6, strong, span, p, em'));
          for (var ni = 0; ni < textNodes.length; ni++) {
            var txt = normalizeTitle(textNodes[ni].textContent || '');
            if (!txt || !titleMatches(txt, movieN)) continue;
            var node = textNodes[ni];
            var box = node.closest('.search-list, .module-item, .stui-vodlist__box, .myui-vodlist__box, .vodlist, .list, li, .item, .module, .card');
            if (!box) box = node.closest('article, li, .row, .col') || node.parentElement;
            if (box && blocks.indexOf(box) === -1) blocks.push(box);
          }

          for (var bi = 0; bi < blocks.length; bi++) {
            var blockLinks = blocks[bi].querySelectorAll(anchorSelector);
            for (var ai = 0; ai < blockLinks.length; ai++) {
              if (focusedAnchors.indexOf(blockLinks[ai]) === -1) focusedAnchors.push(blockLinks[ai]);
            }
            // Per-result quality: extract from the matched result block only.
            if (!rowQuality) {
              var blockText = (blocks[bi].innerText || '');
              rowQuality = detectBestQualityFromText(blockText);
            }
          }
        }

        var sourceAnchors = focusedAnchors.length > 0 ? focusedAnchors : anchors;
        for (var i = 0; i < sourceAnchors.length && out.length < 20; i++) {
          var t = (sourceAnchors[i].textContent || '').trim();
          var h = sourceAnchors[i].href;
          if (!t || t.length > 100) continue;
          if (!isCandidateHref(h)) continue;
          if (movieN) {
            var ctxNode = sourceAnchors[i].closest('.search-list, .module-item, .stui-vodlist__box, .myui-vodlist__box, .vodlist, .list, li, .item, .module, .card, article, .row, .col') || sourceAnchors[i].parentElement;
            var ctxText = normalizeTitle((ctxNode && ctxNode.innerText) ? ctxNode.innerText : sourceAnchors[i].textContent || '');
            var linkText = normalizeTitle(t);
            if (!titleMatches(ctxText, movieN) && !titleMatches(linkText, movieN)) continue;
          }
          // Skip short-drama links (text contains "短剧" or episode-number patterns)
          if (/短剧/.test(t) || /全\d+集/.test(t)) continue;
          if (out.some(function(x) { return x.href === h; })) continue; // deduplicate
          out.push({ text: t, href: h });
        }
        if (!rowQuality) {
          // Fallback: infer quality from selected link texts.
          for (var qi = 0; qi < out.length; qi++) {
            var maybe = detectBestQualityFromText(out[qi].text || '');
            if (maybe) {
              rowQuality = maybe;
              break;
            }
          }
        }
        return { links: out, rowQuality: rowQuality || '' };
      }, movie);
      var links = linkData && linkData.links ? linkData.links : [];
      var rowQuality = linkData && linkData.rowQuality ? linkData.rowQuality : '';

      // Filter noise links on MAC CMS sites (zxtqd, hz-c, byptc, mdvod)
      // These sites mix searched-movie results with popular movie recommendations
      var macCmsSites = ['zxtqd', 'hz-c', 'byptc', 'mdvod'];
      if (macCmsSites.indexOf(site.name) !== -1 && links.length > 3) {
        var cleaned = [];
        for (var fi = 0; fi < links.length; fi++) {
          var ft = links[fi].text.trim();
          var fh = links[fi].href;
          // Always keep: play links, links whose text contains movie name, short labels
          if (/\/play\/\d/.test(fh) || /\/vodplay\/\d/.test(fh) || /\/mp\/\w+-\d+-\d+/.test(fh)) {
            cleaned.push(links[fi]);
          } else if (movie && ft.indexOf(movie) !== -1) {
            cleaned.push(links[fi]);
          } else if (ft.length > 0 && ft.length <= 12) {
            cleaned.push(links[fi]);  // short text = quality label (HD, 超清, 正片, etc.)
          } else if (ft.indexOf('立即播放') !== -1) {
            cleaned.push(links[fi]);
          }
        }
        if (cleaned.length > 0) { links = cleaned; }
      }

      // Check if all remaining links are category/navigation only (baichatv pattern)
      if (matched && links.length > 0) {
        var allCat = true;
        for (var ci = 0; ci < links.length; ci++) {
          var catHref = links[ci].href;
          if (catHref.indexOf('/vod/type/') === -1 && catHref.indexOf('/index.php/vod/type/') === -1) {
            allCat = false; break;
          }
        }
        if (allCat) {
          console.log('  false positive (category links only)');
          matched = false;
          links = [];
        }
      }

      console.log('  ' + resultTitle);
      console.log('  ' + resultUrl);
      console.log('  match:' + matched);

      if (matched) {
        results.push({ siteName:site.name, siteUrl:site.url, resultUrl:resultUrl, title:resultTitle, rowQuality:rowQuality, links:links });
      } else {
        failures.push({ name:site.name, url:site.url, reason:'No match in results' });
      }
      await tab.close();
    } catch (e) {
      var msg = (e.message || e.name || 'unknown').substring(0, 100);
      console.log('  ERROR: ' + msg);
      failures.push({ name:site.name, url:site.url, reason:msg });
      try { await tab.close(); } catch(ex) {}
    }
  }

  // return full data to caller

  return {
    movieName: movie,
    total: sites.length,
    found: results.length,
    failed: failures.length,
    results: results,
    failures: failures
  };
}
