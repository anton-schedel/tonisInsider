export type Ref = { id: number; slug: string; name: string };

export type NewsType = "verletzung" | "angeschlagen" | "aufbautraining" | "fit" | "sonstiges";

export type Category = "bundesliga" | "testspiele";

export type ArticleRef = {
  id: number;
  url: string;
  headline: string;
  newsType: NewsType;
  playerPhotoUrl?: string;
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
};
