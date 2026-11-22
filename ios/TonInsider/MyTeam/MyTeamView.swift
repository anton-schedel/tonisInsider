import SwiftUI

/// Mein Team (src/pages/mein-team.astro): the league switch, the XI on the pitch with live points, the matchday
/// summary, the bench; without a lineup set, the squad by position. Tapping a player opens his card.
struct MyTeamView: View {
    @State private var model = MyTeamModel()
    @Environment(Account.self) private var account
    @Environment(Tabs.self) private var tabs
    @State private var card: PlayerCardData?
    @State private var logoutProblem: String?
    @State private var loggingOut = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                PageHeader(title: "Mein Team")
                if let team = model.team {
                    content(team)
                } else if model.loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
                } else if let message = model.message {
                    EmptyNote(text: message)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        .background(Color.tiBackground)
        .navigationTitle("Mein Team")
        .tabRoot()
        .refreshable { await model.load() }
        .task {
            model.loadCached()
            await model.load()
            if let team = model.team { account.update(from: team) }
        }
        .task { await model.pollLive() }
        .onChange(of: account.kickbase) { _, signedIn in Task { await model.accountChanged(signedIn: signedIn) } }
        // Back in the app: the team and its live state as they are now (points start without a pull).
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await model.load() } } }
        .playerCard($card)
        .alert(logoutProblem ?? "", isPresented: Binding(get: { logoutProblem != nil }, set: { if !$0 { logoutProblem = nil } })) {}
        .withSiteRoutes()
    }

    @ViewBuilder private func content(_ team: AppTeam) -> some View {
        if let signedOut = team.signedOut {
            VStack(spacing: 8) {
                Text(signedOut == "expired" ? "Deine Kickbase-Sitzung ist abgelaufen." : "Dein Kickbase-Team auf einen Blick.")
                    .font(.system(size: 17, weight: .semibold))
                Text("Melde dich mit Kickbase an: Hier siehst du dann deine Spieler, ob sie spielen, und ihre Punkte live.")
                    .font(.system(size: 15)).foregroundStyle(Color.tiMuted).multilineTextAlignment(.center).frame(maxWidth: 320)
                Button("Mit Kickbase anmelden") { tabs.selected = .settings }
                    .buttonStyle(.borderedProminent).tint(Color.tiForeground).padding(.top, 12)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
        } else {
            if let error = model.message ?? team.error { Text(error).foregroundStyle(Color.tiRed).padding(.bottom, 16) }
            if team.leagues.count > 1 {
                Picker("Liga", selection: Binding(get: { model.leagueId ?? team.leagueId ?? "" }, set: { id in Task { await model.choose(league: id) } })) {
                    ForEach(team.leagues, id: \.id) { Text($0.name).tag($0.id) }
                }
                .pickerStyle(.segmented)
                .padding(.bottom, 16)
            }
            // A league picked whose team isn't here yet: the one shown fades back until it is.
            let switching = model.loading && model.leagueId != nil && model.leagueId != team.leagueId
            Group {
            if team.leagueId == nil && team.error == nil { EmptyNote(text: "Du bist in keiner Kickbase-Liga.") }
            else if team.players.isEmpty && team.error == nil { EmptyNote(text: "Keine Spieler in dieser Liga.") }

            if team.lines.isEmpty {
                // No Kickbase lineup set: the summary leads, then the squad by position.
                if let summary = team.summary { MatchdaySummaryView(summary: summary).padding(.bottom, 32) }
                ForEach([(1, "Torwart"), (2, "Abwehr"), (3, "Mittelfeld"), (4, "Sturm")], id: \.0) { pos, label in
                    let group = team.bench.compactMap { team.players[$0] }.filter { $0.position == pos }
                    if !group.isEmpty {
                        Text(label).font(.system(size: 15, weight: .semibold)).padding(.top, 12).padding(.bottom, 4)
                        rows(group, team: team)
                    }
                }
            } else {
                SectionTitle(title: "Aufstellung", detail: team.formation + (team.started && team.points != nil ? " · \(team.points!) Pkt." : ""))
                    .padding(.bottom, 12)
                Pitch(lines: team.lines.map { Array($0.indices) }) { i, j in
                    if let p = team.players[team.lines[i][j]] { MyPitchFace(player: p) { card = Self.card(p) } }
                }
                let xi = team.lines.flatMap { $0 }.compactMap { team.players[$0] }
                MyPitchLegend(confirmed: xi.contains { $0.status == .confirmed }, news: xi.contains(where: \.freshNews))
                if let summary = team.summary { MatchdaySummaryView(summary: summary).padding(.top, 32) }
                let bench = team.bench.compactMap { team.players[$0] }
                if !bench.isEmpty {
                    SectionTitle(title: "Bank").padding(.top, 20).padding(.bottom, 4)
                    rows(bench, team: team)
                }
            }
            }
            .opacity(switching ? 0.4 : 1)
            .animation(.easeOut(duration: 0.2), value: switching)
            Button {
                loggingOut = true
                Task {
                    if let problem = await account.logOutKickbase() { logoutProblem = problem }
                    loggingOut = false
                }
            } label: {
                if loggingOut { ProgressView() } else { Text("Abmelden") }
            }
            .disabled(loggingOut)
                .buttonStyle(.destructiveQuiet).padding(.top, 32)
        }
    }

    /// His card; from kickoff on with his points and Kickbase id (the player id here), for "Punkte am Spieltag".
    static func card(_ p: AppTeam.Player) -> PlayerCardData {
        var data = p.card
        if let label = p.live.flatMap({ PointsLabel(state: $0.state, points: $0.points) }) {
            data.points = label
            data.kickbaseId = p.id
        }
        return data
    }

    private func rows(_ players: [AppTeam.Player], team: AppTeam) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(players.enumerated()), id: \.element.id) { index, p in
                Button { card = Self.card(p) } label: { MyPlayerRow(player: p) }
                    .buttonStyle(CardPressStyle(scale: 0.985, kickbaseId: Self.card(p).kickbaseId))
                if index < players.count - 1 { Divider().overlay(Color.tiHairline) }
            }
        }
    }
}

/// A player on Mein Team's pitch (MyPitch.astro): the dot answers "will he start?" (S11 once confirmed), ⇄ top left
/// when LigaInsider names a rival, a newspaper for fresh news, his club's crest bottom left; from kickoff on his
/// points under the photo instead of the note.
private struct MyPitchFace: View {
    let player: AppTeam.Player
    let open: () -> Void

    var body: some View {
        let live = (player.live?.state ?? 0) > 0
        Button(action: open) {
        PitchFace(photo: siteURL(player.card.photo ?? player.image), name: player.card.name,
                  note: live ? nil : player.note,
                  noteColor: player.status == .bench ? PitchColor.red : PitchColor.yellow,
                  points: player.live.flatMap { PointsLabel(state: $0.state, points: $0.points) }) {
            if player.status == .confirmed { PitchBadge.s11 } else { PitchBadge.dot(dot) }
            if player.rival != nil { PitchBadge.swap(top: true) }
            if let crest = player.card.crest {
                Crest(url: siteURL(crest), size: 20).shadow(color: .black.opacity(0.35), radius: 1, y: 1)
                    .pinned(.bottomLeading, x: -4, y: 2)
            }
            if player.freshNews { PitchBadge.news }
        }
        .contentShape(Rectangle())
        }
        .buttonStyle(CardPressStyle(kickbaseId: MyTeamView.card(player).kickbaseId))
    }

    private var dot: Color {
        switch player.status {
        case .start: PitchColor.green
        case .contested, .doubtful, .alternative: PitchColor.yellow
        case .bench: PitchColor.redDot
        default: .white.opacity(0.5)
        }
    }
}

/// A bench (or squad) row (MyPlayerRow.astro): photo with his club's crest, name, his next match; on the right
/// whether he starts until kickoff, from then on his points instead.
private struct MyPlayerRow: View {
    let player: AppTeam.Player

    var body: some View {
        HStack(spacing: 12) {
            Avatar(url: siteURL(player.card.photo ?? player.image), name: player.card.name, size: 44)
                .overlay {
                    if let crest = player.card.crest {
                        Crest(url: siteURL(crest), size: 20).shadow(color: .black.opacity(0.35), radius: 1, y: 1)
                            .pinned(.bottomTrailing, x: 6, y: 4)
                    }
                }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(player.card.name).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                    if player.freshNews { Image(systemName: "newspaper.fill").font(.system(size: 11)).foregroundStyle(Color.tiMuted) }
                }
                if let match = player.card.match {
                    Text(match).font(.system(size: 13)).foregroundStyle(Color.tiMuted).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // Before kickoff: will he start? From kickoff on: his Kickbase points.
            if let label = player.live.flatMap({ PointsLabel(state: $0.state, points: $0.points) }) {
                PointsChip(label: label, style: .row)
            } else if let status = player.card.status {
                Pill(text: status, tone: player.card.statusTone).layoutPriority(1)
            }
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

/// What the marks on Mein Team's pitch mean (MyPitch.astro's legend): small, muted, centred under the pitch,
/// wrapping as the width allows. S11 and the newspaper only when the pitch shows one.
private struct MyPitchLegend: View {
    let confirmed: Bool
    let news: Bool

    var body: some View {
        CentredFlow(spacing: 16, lineSpacing: 4) {
            if confirmed {
                item("Startelf bestätigt") {
                    Text("S11").font(.system(size: 9, weight: .heavy)).foregroundStyle(.white)
                        .padding(.horizontal, 4).frame(height: 13).background(PitchColor.green, in: Capsule())
                }
            }
            item("Startelf") { dot(PitchColor.green) }
            item("Fraglich oder Alternative") { dot(PitchColor.yellow) }
            item("Nicht in der Startelf") { dot(Color.tiRed) }
            item("Keine Infos") { dot(Color.tiMuted) }
            if news {
                item("Neue News") {
                    Image(systemName: "newspaper.fill").font(.system(size: 9)).foregroundStyle(Color.tiForeground)
                        .frame(width: 18, height: 18).background(Color.tiSurface, in: Circle())
                }
            }
            Text("Tippen für Prognose")
        }
        .font(.system(size: 11))
        .foregroundStyle(Color.tiMuted)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }

    private func dot(_ color: Color) -> some View { Circle().fill(color).frame(width: 8, height: 8) }

    private func item(_ text: String, @ViewBuilder mark: () -> some View) -> some View {
        HStack(spacing: 4) {
            mark().accessibilityHidden(true)
            Text(text)
        }
    }
}

/// Items side by side, onto the next line when the width runs out, each line centred (the legend's flex-wrap).
private struct CentredFlow: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat

    private func lines(_ subviews: Subviews, width: CGFloat) -> [(items: [(index: Int, size: CGSize)], width: CGFloat, height: CGFloat)] {
        var lines: [(items: [(index: Int, size: CGSize)], width: CGFloat, height: CGFloat)] = []
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            if let last = lines.last, last.width + spacing + size.width <= width {
                lines[lines.count - 1] = (last.items + [(index, size)], last.width + spacing + size.width, max(last.height, size.height))
            } else {
                lines.append(([(index, size)], size.width, size.height))
            }
        }
        return lines
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let lines = lines(subviews, width: proposal.width ?? .infinity)
        return CGSize(width: lines.map(\.width).max() ?? 0,
                      height: lines.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(0, lines.count - 1)))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for line in lines(subviews, width: bounds.width) {
            var x = bounds.midX - line.width / 2
            for item in line.items {
                subviews[item.index].place(at: CGPoint(x: x, y: y + (line.height - item.size.height) / 2), proposal: ProposedViewSize(item.size))
                x += item.size.width + spacing
            }
            y += line.height + lineSpacing
        }
    }
}
