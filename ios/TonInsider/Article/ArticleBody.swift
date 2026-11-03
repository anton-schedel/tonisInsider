import Foundation

/// One block of an article's text: a paragraph (bold, italic and links inside) or a subheading.
enum ArticleBlock: Hashable {
    case paragraph(AttributedString)
    case heading(String)
}

/// LigaInsider's article HTML as native text. The feed uses only p, b, i, br, h3 and a; any other tag is dropped
/// and its text kept. Text outside a paragraph becomes one; empty paragraphs disappear.
func articleBlocks(_ html: String) -> [ArticleBlock] {
    var blocks: [ArticleBlock] = []
    var current = AttributedString()
    var bold = 0, italic = 0, heading = false
    var link: URL?

    func flush() {
        let text = String(current.characters).trimmingCharacters(in: .whitespacesAndNewlines)
        if heading { if !text.isEmpty { blocks.append(.heading(text)) } }
        else if !text.isEmpty { blocks.append(.paragraph(trimmed(current))) }
        current = AttributedString()
    }

    func append(_ raw: String) {
        let text = decodeEntities(raw.replacingOccurrences(of: "\n", with: " "))
        guard !text.isEmpty else { return }
        var run = AttributedString(text)
        var intent: InlinePresentationIntent = []
        if bold > 0 { intent.insert(.stronglyEmphasized) }
        if italic > 0 { intent.insert(.emphasized) }
        if !intent.isEmpty { run.inlinePresentationIntent = intent }
        if let link { run.link = link }
        current += run
    }

    var rest = Substring(html)
    while let open = rest.firstIndex(of: "<") {
        append(String(rest[..<open]))
        guard let close = rest[open...].firstIndex(of: ">") else { rest = rest[open...]; break }
        let tag = rest[rest.index(after: open)..<close].trimmingCharacters(in: .whitespaces)
        rest = rest[rest.index(after: close)...]
        let closing = tag.hasPrefix("/")
        let name = tag.drop { $0 == "/" }.prefix { $0.isLetter || $0.isNumber }.lowercased()
        switch (name, closing) {
        case ("p", _): flush()
        case ("h3", false): flush(); heading = true
        case ("h3", true): flush(); heading = false
        case ("br", _): current += AttributedString("\n")
        case ("b", false), ("strong", false): bold += 1
        case ("b", true), ("strong", true): bold = max(0, bold - 1)
        case ("i", false), ("em", false): italic += 1
        case ("i", true), ("em", true): italic = max(0, italic - 1)
        case ("a", false): link = attribute("href", in: tag).flatMap { URL(string: decodeEntities($0)) }
        case ("a", true): link = nil
        default: break
        }
    }
    append(String(rest))
    flush()
    return blocks
}

/// Leading and trailing spaces and line breaks of a paragraph, removed with their attributes kept.
private func trimmed(_ s: AttributedString) -> AttributedString {
    var s = s
    while let first = s.characters.first, first.isWhitespace, first != "\u{a0}" { s.removeSubrange(s.startIndex..<s.index(afterCharacter: s.startIndex)) }
    while let last = s.characters.last, last.isWhitespace, last != "\u{a0}" { s.removeSubrange(s.index(beforeCharacter: s.endIndex)..<s.endIndex) }
    return s
}

private func attribute(_ name: String, in tag: String) -> String? {
    guard let range = tag.range(of: #"\#(name)\s*=\s*("([^"]*)"|'([^']*)')"#, options: .regularExpression) else { return nil }
    return String(tag[range].drop { $0 != "\"" && $0 != "'" }.dropFirst().dropLast())
}

private let named: [String: String] = ["amp": "&", "quot": "\"", "apos": "'", "lt": "<", "gt": ">", "nbsp": "\u{a0}",
                                       "ndash": "–", "mdash": "—", "hellip": "…", "bdquo": "„", "ldquo": "“", "rdquo": "”"]

func decodeEntities(_ s: String) -> String {
    guard s.contains("&") else { return s }
    var out = ""
    var rest = Substring(s)
    while let amp = rest.firstIndex(of: "&") {
        out += rest[..<amp]
        let after = rest[rest.index(after: amp)...]
        if let semi = after.prefix(10).firstIndex(of: ";") {
            let entity = after[..<semi]
            var replacement: String?
            if entity.hasPrefix("#x") || entity.hasPrefix("#X") {
                replacement = UInt32(entity.dropFirst(2), radix: 16).flatMap(Unicode.Scalar.init).map(String.init)
            } else if entity.hasPrefix("#") {
                replacement = UInt32(entity.dropFirst()).flatMap(Unicode.Scalar.init).map(String.init)
            } else {
                replacement = named[String(entity)]
            }
            if let replacement {
                out += replacement
                rest = after[after.index(after: semi)...]
                continue
            }
        }
        out += "&"
        rest = after
    }
    return out + rest
}

/// A confirmed lineup post ("Aufstellung von …"): its XI and bench as text, shown right in the feed
/// (src/lib/lineupNews.ts confirmedLineup).
func confirmedLineup(url: String, bodyHtml: String) -> (xi: String, bench: String?)? {
    guard url.range(of: #"/aufstellung-(?:von|vom|des|der)-"#, options: .regularExpression) != nil else { return nil }
    let text = decodeEntities(bodyHtml
        .replacingOccurrences(of: #"<br\s*/?>"#, with: "\n", options: [.regularExpression, .caseInsensitive])
        .replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression))
        .replacingOccurrences(of: "\u{a0}", with: " ")
    func line(_ label: String) -> String? {
        guard let r = text.range(of: #"\#(label):\s*[^\n]+"#, options: .regularExpression) else { return nil }
        let value = text[r].dropFirst(label.count + 1).trimmingCharacters(in: .whitespaces)
        return value.isEmpty ? nil : value
    }
    guard let xi = line("Startelf") else { return nil }
    return (xi, line("Bank"))
}

extension Article {
    var confirmedXI: (xi: String, bench: String?)? { confirmedLineup(url: url, bodyHtml: bodyHtml) }
}
