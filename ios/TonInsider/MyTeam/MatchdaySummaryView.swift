import SwiftUI

/// The matchday at a glance (TeamSummary.astro): a few sentences, then one row per game of his starters
/// (best win chance first) with a slim bar, green (our logo's) from 55 %, his players with their notes, the kickoff; notes below.
struct MatchdaySummaryView: View {
    let summary: AppTeam.Summary

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionTitle(title: "Spieltag", detail: "\(summary.inXi) von \(summary.total) in der Startelf").padding(.bottom, 4)
            if !summary.text.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(summary.text, id: \.self) { Text(nb($0)).font(.system(size: 15)) }
                }
                .padding(.top, 4).padding(.bottom, 8)
            }
            ForEach(Array(summary.games.enumerated()), id: \.offset) { index, game in
                GameRowView(game: game, index: index)
                if index < summary.games.count - 1 { Divider().overlay(Color.tiHairline) }
            }
            if !summary.notes.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(summary.notes, id: \.self) { Text(nb($0)).font(.system(size: 14)).foregroundStyle(Color.tiMuted) }
                }
                .padding(.top, 12)
                .overlay(alignment: .top) { Divider().overlay(Color.tiHairline) }
                .padding(.top, 8)
            }
        }
    }
}

/// A number and its "%" never break apart ("38 % zu Null").
private func nb(_ s: String) -> String { s.replacingOccurrences(of: " %", with: "\u{a0}%") }

struct GameRowView: View {
    let game: AppTeam.Summary.Game
    let index: Int
    @State private var grown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static func isFavourite(_ win: Int) -> Bool { win >= 55 }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Crest(url: siteURL(game.crest), size: 28).padding(.top, 2)
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("\(game.team) \(Text("\(game.home ? "gegen" : "bei") \(game.opponent)").fontWeight(.regular).foregroundStyle(Color.tiMuted))")
                        .font(.system(size: 16, weight: .semibold)).lineLimit(1)
                    Spacer(minLength: 0)
                    Text("\(game.win)\u{a0}%").font(.system(size: 16, weight: .semibold)).monospacedDigit()
                }
                GeometryReader { geo in
                    Capsule().fill(Color.tiHairline)
                        .overlay(alignment: .leading) {
                            Capsule()
                                .fill(Self.isFavourite(game.win) ? Color.tiBrand : Color.tiMuted.opacity(0.45))
                                .frame(width: geo.size.width * CGFloat(game.win) / 100)
                                .scaleEffect(x: grown ? 1 : 0, anchor: .leading)
                        }
                }
                .frame(height: 4)
                .accessibilityLabel("\(game.win) Prozent Siegchance")
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(game.players.map { p in p.note.map { "\(p.name) (\(nb($0)))" } ?? p.name }.joined(separator: ", "))
                        .font(.system(size: 14))
                    Spacer(minLength: 0)
                    Text("\(Berlin.shortDay(game.kickoff).split(separator: " ").first ?? "") \(Berlin.time(game.kickoff))")
                        .font(.system(size: 14)).foregroundStyle(Color.tiMuted).monospacedDigit()
                }
            }
        }
        .padding(.vertical, 12)
        .onAppear {
            // One reveal when the screen opens: the bars grow in, top to bottom.
            if reduceMotion { grown = true; return }
            withAnimation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.7).delay(Double(index) * 0.04)) { grown = true }
        }
    }
}
