export type ResourceStatus = 'pending' | 'downloading' | 'success' | 'failed';

/** Map HTTP status from HAR / DevTools network to UI status. */
export function statusFromHttpCode(httpStatus: number | undefined): ResourceStatus {
  if (httpStatus === undefined || httpStatus === 0) return 'pending';
  if (httpStatus >= 200 && httpStatus < 400) return 'success';
  return 'failed';
}

type HarEntryLike = {
  response?: { status?: number; content?: { size?: number } };
};

export function statusFromHarEntry(entry: HarEntryLike): ResourceStatus {
  return statusFromHttpCode(entry.response?.status);
}

export function harEntrySize(entry: HarEntryLike): number {
  return entry.response?.content?.size ?? 0;
}

/** Probe DevTools getContent; empty body with no error still counts as success if HTTP was OK. */
export function probeContentHandler(
  handler: (cb: (content: string, encoding: string) => void) => void,
  timeoutMs = 2500
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (hasContent: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(hasContent);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    try {
      handler((content) => {
        finish(Boolean(content && content.length > 0));
      });
    } catch {
      finish(false);
    }
  });
}
