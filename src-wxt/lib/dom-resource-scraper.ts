/** Injected into the page to collect static DOM-linked resource URLs. */
export function scrapeDomResources(): { url: string; type: string }[] {
  const res: { url: string; type: string }[] = [];

  const collect = (url: string, type: string) => {
    if (
      url &&
      !url.startsWith('data:') &&
      !url.startsWith('blob:') &&
      !url.startsWith('chrome-extension://')
    ) {
      try {
        const absoluteUrl = new URL(url, document.baseURI).href;
        res.push({ url: absoluteUrl, type });
      } catch {
        /* ignore invalid URLs */
      }
    }
  };

  document.querySelectorAll('img').forEach((img) => collect(img.src, 'image'));
  document.querySelectorAll('script').forEach((s) => s.src && collect(s.src, 'script'));
  document.querySelectorAll('link[rel="stylesheet"]').forEach((l) =>
    collect((l as HTMLLinkElement).href, 'stylesheet')
  );
  document.querySelectorAll('link[rel*="icon"]').forEach((l) =>
    collect((l as HTMLLinkElement).href, 'image')
  );
  document.querySelectorAll('video, audio, source').forEach((m) => {
    const el = m as HTMLMediaElement | HTMLSourceElement;
    collect(el.src || (el as HTMLSourceElement).srcset || '', 'media');
  });

  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          const cssText = rule.cssText;
          const urls = cssText.match(/url\(['"]?([^'")]+)['"]?\)/g);
          if (urls) {
            urls.forEach((u) => {
              const rawUrl = u.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1];
              if (rawUrl) {
                if (rawUrl.match(/\.(woff2?|ttf|otf|eot)$/i)) collect(rawUrl, 'font');
                else if (rawUrl.match(/\.(png|jpe?g|gif|svg|webp|avif)$/i)) collect(rawUrl, 'image');
                else collect(rawUrl, 'asset');
              }
            });
          }
        }
      } catch {
        /* CORS may block some stylesheets */
      }
    }
  } catch {
    /* ignore */
  }

  document.querySelectorAll('[style]').forEach((el) => {
    const bg = (el as HTMLElement).style.backgroundImage;
    if (bg && bg !== 'none') {
      const url = bg.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1];
      if (url) collect(url, 'image');
    }
  });

  const fileRegex =
    /\.(png|jpe?g|gif|svg|webp|avif|js|css|woff2?|ttf|mp4|webm|mp3|pdf|zip|json|wasm)(\?.*)?$/i;
  document.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.match(fileRegex)) {
        const type = attr.value.match(/\.(png|jpe?g|gif|svg|webp|avif)$/i)
          ? 'image'
          : attr.value.match(/\.js$/i)
            ? 'script'
            : attr.value.match(/\.css$/i)
              ? 'stylesheet'
              : 'file';
        collect(attr.value, type);
      }
    }
  });

  return res;
}
