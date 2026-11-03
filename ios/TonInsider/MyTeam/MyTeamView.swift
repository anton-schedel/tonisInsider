import SwiftUI

/// Mein Team (src/pages/mein-team.astro): the league switch, the XI on the pitch with live points, the matchday
/// summary, the bench; without a lineup set, the squad by position. Tapping a player opens his card.
struct MyTeamView: View {
    @State private var model = MyTeamModel()
    @Environment(Account.self) private var account
    @Environment(Tabs.self) private var tabs
    @State private var card: PlayerCardData?
    @State private var logoutProblem: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
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
        .refreshable { await model.load() }
        .task {
            model.loadCached()
            await model.load()
            if let team = model.team { account.update(from: team) }
        }
        .task { await model.pollLive() }
        .onChange(of: account.kickbase) { _, signedIn in if signedIn { Task { await model.load() } } }
        .sheet(item: $card) { PlayerCardView(data: $0) }
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
                Picker("Liga", selection: Binding(get: { team.leagueId ?? "" }, set: { id in Task { await model.choose(league: id) } })) {
                    ForEach(team.leagues, id: \.id) { Text($0.name).tag($0.id) }
                }
                .pickerStyle(.segmented)
                .padding(.bottom, 16)
            }
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
                    if let p = team.players[team.lines[i][j]] { MyPitchFace(player: p) { card = p.card } }
                }
                if let summary = team.summary { MatchdaySummaryView(summary: summary).padding(.top, 32) }
                let bench = team.bench.compactMap { team.players[$0] }
                if !bench.isEmpty {
                    SectionTitle(title: "Bank").padding(.top, 20).padding(.bottom, 4)
                    rows(bench, team: team)
                }
            }
            Button("Abmelden", role: .destructive) {
                Task {
                    if let problem = await account.logOutKickbase() { logoutProblem = problem } else { await model.load() }
                }
            }
                .font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 10)
                .background(Color.tiSurface, in: RoundedRectangle(cornerRadius: 12)).buttonStyle(.plain).padding(.top, 32)
        }
    }

    private func rows(_ players: [AppTeam.Player], team: AppTeam) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(players.enumerated()), id: \.element.id) { index, p in
                Button { card = p.card } label: { MyPlayerRow(player: p) }.buttonStyle(.plain)
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
        PitchFace(photo: siteURL(player.card.photo ?? player.image), name: player.card.name,
                  note: live ? nil : player.note,
                  noteColor: player.status == .bench ? PitchColor.red : PitchColor.yellow,
                  points: live ? player.live?.points.map(String.init) ?? "–" : nil) {
            if player.status == .confirmed { PitchBadge.s11 } else { PitchBadge.dot(dot) }
            if player.rival != nil { PitchBadge.swap(top: true) }
            if let crest = player.card.crest {
                Crest(url: siteURL(crest), size: 20).shadow(color: .black.opacity(0.35), radius: 1, y: 1)
                    .pinned(.bottomLeading, x: -4, y: 2)
            }
            if player.freshNews { PitchBadge.news }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: open)
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

/// A bench (or squad) row: photo, name, start status and his next match; his points once it started.
private struct MyPlayerRow: View {
    let player: AppTeam.Player

    var body: some View {
        HStack(spacing: 12) {
            Avatar(url: siteURL(player.card.photo ?? player.image), name: player.card.name, size: 44)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(player.card.name).font(.system(size: 16, weight: .semibold))
                    if player.freshNews { Image(systemName: "newspaper.fill").font(.system(size: 11)).foregroundStyle(Color.tiMuted) }
                }
                HStack(spacing: 6) {
                    if let status = player.card.status { Pill(text: status, tone: player.card.statusTone) }
                    if let match = player.card.match { Text(match).lineLimit(1) }
                }
                .font(.system(size: 13)).foregroundStyle(Color.tiMuted)
            }
            Spacer(minLength: 0)
            if (player.live?.state ?? 0) > 0 {
                Text(player.live?.points.map { "\($0)" } ?? "–").font(.system(size: 15, weight: .bold)).monospacedDigit()
            }
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}
