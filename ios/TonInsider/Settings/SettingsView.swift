import SwiftUI

/// Hell or Dunkel once chosen; until then the iPhone's own setting (like the website).
enum Appearance: String {
    case light, dark
    var label: String { self == .light ? "Hell" : "Dunkel" }
    var scheme: ColorScheme { self == .light ? .light : .dark }
}

/// Einstellungen (src/pages/einstellungen.astro): appearance, the Kickbase and the LigaInsider login.
struct SettingsView: View {
    @Environment(Account.self) private var account
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage("appearance") private var appearance: Appearance?
    @State private var logoutProblem: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                PageHeader(title: "Einstellungen", logo: true).padding(.bottom, -12)
                section("Darstellung") {
                    Picker("Darstellung", selection: Binding(
                        get: { appearance ?? (colorScheme == .dark ? .dark : .light) },
                        set: { appearance = $0 }
                    )) {
                        Text("Hell").tag(Appearance.light)
                        Text("Dunkel").tag(Appearance.dark)
                    }
                    .pickerStyle(.segmented)
                }
                section("Kickbase") {
                    if account.kickbase {
                        SignedIn(name: account.kickbaseName) { logoutProblem = await account.logOutKickbase() }
                    } else {
                        LoginForm(intro: "Für dein Team, die Aufstellungen und die passenden News.",
                                  userPrompt: "Kickbase E-Mail", userType: .emailAddress) { user, password in
                            await account.logInKickbase(email: user, password: password)
                        }
                    }
                }
                section("LigaInsider") {
                    if account.ligaInsider {
                        SignedIn(name: account.ligaInsiderName) { logoutProblem = await account.logOutLigaInsider() }
                    } else {
                        LoginForm(intro: "Zum Kommentieren, Antworten, Hochvoten und für Umfragen.",
                                  userPrompt: "Benutzername oder E-Mail", userType: .username) { user, password in
                            await account.logInLigaInsider(username: user, password: password)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.tiBackground)
        .navigationTitle("Einstellungen")
        .tabRoot()
        .alert(logoutProblem ?? "", isPresented: Binding(get: { logoutProblem != nil }, set: { if !$0 { logoutProblem = nil } })) {}
    }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.system(size: 15, weight: .semibold))
            content()
        }
    }
}

private struct SignedIn: View {
    let name: String?
    let logOut: () async -> Void
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let name { Text("Angemeldet als **\(name)**.").font(.system(size: 15)) } else { Text("Angemeldet.").font(.system(size: 15)) }
            Button {
                busy = true
                Task { await logOut(); busy = false }
            } label: {
                if busy { ProgressView() } else { Text("Abmelden") }
            }
            .buttonStyle(.destructiveQuiet)
            .disabled(busy)
        }
    }
}

/// Two fields and, a little apart, the black button: it can't be taken for a third field.
private struct LoginForm: View {
    let intro: String
    let userPrompt: String
    let userType: UITextContentType
    let submit: (String, String) async -> String?

    @State private var user = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?
    private enum Field { case user, password }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(intro).font(.system(size: 15)).foregroundStyle(Color.tiMuted)
            TextField(userPrompt, text: $user)
                .textContentType(userType)
                .keyboardType(userType == .emailAddress ? .emailAddress : .default)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($focus, equals: .user)
                .onSubmit { focus = .password }
                .siteField()
            SecureField("Passwort", text: $password)
                .textContentType(.password)
                .submitLabel(.go)
                .focused($focus, equals: .password)
                .onSubmit(send)
                .siteField()
            if let error { Text(error).font(.system(size: 14)).foregroundStyle(Color.tiRed) }
            Button(action: send) {
                if busy { ProgressView().tint(Color.tiBackground) } else { Text("Anmelden") }
            }
            .buttonStyle(.primary)
            .disabled(busy || user.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty)
            .padding(.top, 4)
        }
    }

    private func send() {
        guard !busy, !user.isEmpty, !password.isEmpty else { return }
        busy = true
        focus = nil
        Task {
            error = await submit(user.trimmingCharacters(in: .whitespaces), password)
            if error == nil { password = "" }
            busy = false
        }
    }
}
