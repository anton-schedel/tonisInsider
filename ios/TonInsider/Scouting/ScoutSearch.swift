import Foundation

/// The Scouting page's search (src/pages/scouting.astro search): every word of the query must match the player's
/// name or his club, as written or by the club's nickname.
enum ScoutSearch {
    /// So many hits are shown; the rest is a note ("Und 12 weitere …").
    static let limit = 40

    /// Nicknames the clubs go by, so "bvb" or "gladbach" finds them.
    static let nicknames: [String: String] = [
        "Borussia Dortmund": "bvb", "Hamburger SV": "hsv", "FC Bayern München": "fcb", "Borussia Mönchengladbach": "gladbach bmg fohlen",
        "Eintracht Frankfurt": "sge", "SV Werder Bremen": "svw werder", "FC Schalke 04": "s04", "Bayer 04 Leverkusen": "b04 bayer",
        "1. FC Union Berlin": "fcu eisern", "1. FC Köln": "effzeh koeln", "TSG Hoffenheim": "tsg", "RB Leipzig": "rbl", "SC Freiburg": "scf",
    ]

    /// Lower case, no accents, hyphens and dots as spaces: "Simpson-Pusey" and "1. FC Köln" match as written.
    static func normal(_ s: String) -> String {
        String(fold(s).map { "-.'".contains($0) ? " " : $0 })
    }

    /// "mueller", "koeln": the German spellings without umlauts find the names with them.
    static func plain(_ word: String) -> String {
        word.replacingOccurrences(of: "ae", with: "a").replacingOccurrences(of: "oe", with: "o").replacingOccurrences(of: "ue", with: "u")
    }

    /// What a player is found by: his name, his club and its nicknames, each word after a space.
    static func key(name: String, club: String) -> String {
        " " + normal("\(name) \(club) \(nicknames[club] ?? "")")
    }

    static func search(_ index: some Sequence<PlayerEntry>, _ query: String) -> (hits: [PlayerEntry], more: Int) {
        let words = normal(query).split(whereSeparator: \.isWhitespace).map(String.init)
        guard let first = words.first else { return ([], 0) }
        // Every word must start a word of the name or club (longer ones may sit inside one: "gladbach").
        func has(_ key: String, _ w: String) -> Bool { key.contains(" \(w)") || (w.count >= 4 && key.contains(w)) }
        // A surname match first, then starters, then the name.
        let german = Locale(identifier: "de")
        var hits: [(player: PlayerEntry, surname: Bool)] = []
        for p in index where words.allSatisfy({ has(p.key, $0) || has(p.key, plain($0)) }) {
            let surname = normal(p.name).split(separator: " ", omittingEmptySubsequences: false).last ?? ""
            hits.append((p, surname.hasPrefix(first)))
        }
        hits.sort { a, b in
            if a.surname != b.surname { return a.surname }
            if a.player.rank != b.player.rank { return a.player.rank < b.player.rank }
            let order = a.player.name.compare(b.player.name, options: [.caseInsensitive, .diacriticInsensitive], locale: german)
            return order == .orderedSame ? a.player.id < b.player.id : order == .orderedAscending
        }
        return (hits.prefix(limit).map(\.player), max(0, hits.count - limit))
    }
}

/// Lower case without accents, so "vidovic" finds Vidović and "muller" Müller (src/lib/format.ts fold).
/// Ø, æ, ł, đ and co. have no accent to drop: they're mapped by hand ("moller" finds Møller, "duric" Đurić).
func fold(_ s: String) -> String {
    let letters: [Character: String] = ["ø": "o", "æ": "ae", "œ": "oe", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ß": "ss", "ı": "i"]
    let folded = s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "de_DE"))
    return folded.reduce(into: "") { out, c in out += letters[c] ?? String(c) }
}

/// The scout list's order and the suggestions for an empty one (scouting.astro renderList).
enum ScoutList {
    /// Players with news since the last look first, then the newest news; else as the list has them.
    static func sorted(_ players: [PlayerEntry], fresh: Set<Int>, now: Date) -> [PlayerEntry] {
        players.enumerated().map { (index: $0.offset, player: $0.element, at: $0.element.latestNews(now: now)?.at ?? .distantPast) }
            .sorted { a, b in
                let (freshA, freshB) = (fresh.contains(a.player.id), fresh.contains(b.player.id))
                if freshA != freshB { return freshA }
                return a.at != b.at ? a.at > b.at : a.index < b.index
            }
            .map(\.player)
    }

    /// Something to scout right away: the players with the newest news, one per club (so it isn't one club's press day).
    static func suggestions(_ players: some Sequence<PlayerEntry>, now: Date, count: Int = 6) -> [PlayerEntry] {
        var dated: [(player: PlayerEntry, at: Date)] = []
        for p in players {
            if let news = p.latestNews(now: now) { dated.append((p, news.at)) }
        }
        dated.sort { a, b in a.at != b.at ? a.at > b.at : a.player.id < b.player.id }
        var clubs = Set<String>()
        var out: [PlayerEntry] = []
        for (player, _) in dated where out.count < count && clubs.insert(player.club).inserted { out.append(player) }
        return out
    }
}

extension PlayerEntry {
    /// His newest news that is out (posts scheduled for later appear from their minute).
    func latestNews(now: Date) -> PlayerCardData.CardNews? {
        card.news?.first { $0.at <= now }
    }
}
