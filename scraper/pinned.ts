/**
 * Articles LigaInsider pins to the top of its news list (e.g. the weekly press-conference schedule).
 * There is no marker in the HTML: a pinned article is one at the start of the list that is older than an
 * article listed after it. Stops at the first article that is in normal time order.
 */
export function pinnedIds(listed: number[], known: { id: number; publishedAt: string }[]): number[] {
  const time = new Map(known.map((a) => [a.id, Date.parse(a.publishedAt)]));
  const pinned: number[] = [];
  for (let i = 0; i < listed.length; i++) {
    const t = time.get(listed[i]);
    if (t === undefined) break;
    const newerLater = listed.slice(i + 1).some((id) => (time.get(id) ?? -Infinity) > t);
    if (!newerLater) break;
    pinned.push(listed[i]);
  }
  return pinned;
}
