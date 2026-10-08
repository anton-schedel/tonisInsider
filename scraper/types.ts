import type { OddsEvent } from "./odds.ts";
import type { ScorerMatch } from "./scorers.ts";

export type Ref = { id: number; slug: string; name: string };

export type NewsType = "verletzung" | "angeschlagen" | "aufbautraining" | "fit" | "sonstiges";

export type Category = "bundesliga" | "testspiele";

export type ArticleRef = {
  id: number;
  url: string;
  headline: string;
  newsType: NewsType;
  playerPhotoUrl?: string;
  /** The player in the overview photo's caption ("Sebastiaan Bornauw"). */
  playerName?: string;
  /** "Vor 46 Min." / "Vor 2 Std." in the overview, in minutes; reveals republished articles. */
  listedAgoMinutes?: number;
};

export type Article = {
  id: number;
  url: string;
  headline: string;
  listHeadline: string; // headline as shown in the overview; a change triggers a re-fetch
  category: Category;
  newsType: NewsType;
  player?: Ref & { photo?: string };
  club?: Ref & { crest?: string };
  author?: string;
  source?: { name: string; url?: string };
  publishedAt: string;
  bodyHtml: string;
  /**
   * Banner photo above the text: the parser sets LigaInsider's URL, the run replaces it with the local path.
   * null = the article has none. Missing = stored before banners existed (looked up once while listed).
   */
  banner?: string | null;
  /** When LigaInsider's list last showed it as new (from "Vor 46 Min."); detects republishing. */
  listedAt?: string;
  fetchedAt: string;
};

export type ClubRef = Ref & { crestUrl: string };

export type LineupPlayer = Ref & {
  photo?: string;
  photoUrl?: string;
  status: "set" | "doubtful";
  statusLabel?: string;
  alternative?: Ref & { photo?: string; photoUrl?: string };
};

export type Lineup = {
  club: Ref & { crest?: string };
  opponent?: { name: string; home: boolean };
  matchday?: number;
  kickoff?: string;
  formation: string;
  lines: LineupPlayer[][];
  updatedAt: string;
};

export type State = {
  lineupsFetchedAt?: string;
  lastChangeAt?: string;
  /** Articles that are listed but 404 on LigaInsider: id → list headline. Skipped until the headline changes. */
  unavailable?: Record<string, string>;
  /** Articles that failed validation: id → list headline. Reported once, skipped until the headline or code changes. */
  invalid?: Record<string, string>;
  /** Git SHA of the code that last ran; a change forces a rebuild and retries invalid articles. */
  codeVersion?: string;
  /** Comment counts from the overviews: id → count. Updating them alone doesn't trigger a rebuild. */
  commentCounts?: Record<string, number>;
  /** Win chances from bookmaker odds (The Odds API), refreshed every 3 hours. */
  odds?: OddsEvent[];
  oddsFetchedAt?: string;
  /** Articles LigaInsider pins on top of its news list, in its order. */
  pinned?: number[];
  /** Anytime-goalscorer odds per match id, fetched per matchday. */
  scorers?: Record<string, ScorerMatch>;
  /** Problems of the last runs: key → runs in a row (see problems.ts). */
  problemStreaks?: Record<string, number>;
};
